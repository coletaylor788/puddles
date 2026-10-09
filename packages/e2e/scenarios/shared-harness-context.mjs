import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const runtimePath = resolve(process.argv[2]);
if (process.argv[3] !== "--child") {
  const root = mkdtempSync(join(tmpdir(), "shared-harness-context-"));
  try {
    writeFileSync(join(root, "openclaw.json"), "{}");
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), runtimePath, "--child"],
      {
        env: {
          ...process.env,
          HOME: root,
          OPENCLAW_STATE_DIR: root,
          OPENCLAW_CONFIG_PATH: join(root, "openclaw.json"),
        },
        encoding: "utf8",
        timeout: 40000,
      },
    );
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    process.stdout.write(result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
} else {
  const root = process.env.OPENCLAW_STATE_DIR;
  assert.ok(root?.includes("shared-harness-context-"));
  const deny = () => {
    throw Error("Live network denied");
  };
  globalThis.fetch = deny;
  http.request = http.get = https.request = https.get = deny;
  const runtime = process.argv[2];
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith("openclaw/plugin-sdk/"))
        return {
          url: pathToFileURL(
            join(
              runtime,
              "dist/plugin-sdk",
              specifier.slice("openclaw/plugin-sdk/".length) + ".js",
            ),
          ).href,
          shortCircuit: true,
        };
      return next(specifier, context);
    },
  });
  const sdk = async (n) => import(pathToFileURL(join(runtime, "dist/plugin-sdk", n + ".js")));
  const { upsertSessionEntry } = await sdk("session-store-runtime");
  const { appendSessionTranscriptMessageByIdentity } = await sdk("session-transcript-runtime");
  const harnessPath = ["dist/extensions/copilot/harness.js", "dist/extensions/copilot/dist/harness.js"]
    .map((file) => join(runtime, file)).find(existsSync);
  assert.ok(harnessPath, "Candidate must contain compiled Copilot harness");
  const { createCopilotAgentHarness } = await import(pathToFileURL(harnessPath));
  const scope = {
    agentId: "main",
    sessionId: "probe-main",
    sessionKey: "agent:main:main",
    storePath: join(root, "sessions.json"),
  };
  await upsertSessionEntry({
    ...scope,
    entry: { sessionId: scope.sessionId, updatedAt: Date.now() },
  });
  const captured = [];
  let turns = 0;
  const makeSession = (id, config) => {
    const listeners = new Map();
    const emit = (type, data) => {
      const e = {
        type,
        id: type + "-" + turns,
        parentId: null,
        timestamp: new Date().toISOString(),
        data,
      };
      for (const cb of listeners.get(type) ?? []) cb(e);
      return e;
    };
    return {
      sessionId: id,
      on(type, cb) {
        listeners.set(type, [...(listeners.get(type) ?? []), cb]);
        return () => {};
      },
      abort: async () => {},
      disconnect: async () => {},
      sendAndWait: async (options) => {
        turns++;
        captured.push({ options, system: config.systemMessage });
        emit("user.message", { content: options.prompt });
        const result = emit("assistant.message", {
          content: "Recorded response",
          messageId: "answer-" + turns,
        });
        emit("session.idle", {});
        return result;
      },
    };
  };
  const client = {
    createSession: async (c) => makeSession("sdk-probe", c),
    resumeSession: async (id, c) => makeSession(id, c),
    deleteSession: async () => {},
  };
  const pool = {
    acquire: async (key) => ({ client, key }),
    release: async () => {},
    dispose: async () => [],
    size: () => 0,
  };
  const harness = createCopilotAgentHarness({ pool });
  const params = {
    ...scope,
    sessionTarget: scope,
    agentDir: root,
    workspaceDir: root,
    cwd: root,
    runId: "probe-1",
    prompt: "Remember the synthetic appointment.",
    timeoutMs: 5000,
    disableTools: true,
    promptMode: "minimal",
    config: { agents: { list: [{ id: "main", default: true }] } },
    model: {
      api: "openai-responses",
      id: "gpt-5.6-luna",
      name: "Fixture",
      provider: "github-copilot",
      baseUrl: "https://api.githubcopilot.com",
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 4096,
    },
    auth: { useLoggedInUser: true },
    hostCapabilities: {
      kind: "agent-harness-host-capability",
      version: 1,
      assertActive() {},
      createToolSurface: () => [],
      bindToolSurface: (tools) => tools,
      runBeforeToolCall: async (r) => ({ blocked: false, params: r.params }),
      requestApproval: async () => {},
      waitForApproval: async () => {},
    },
  };
  const recorder = (prompt) => {
    let receipt;
    const message = { role: "user", content: prompt, timestamp: Date.now() };
    return {
      message,
      resolveMessage: async () => message,
      isBlocked: () => false,
      markBlocked() {},
      markSentToProvider() {},
      markRuntimePersistencePending() {},
      markRuntimePersisted(m, a) {
        receipt = a;
      },
      getAdmissionReceipt: () => receipt,
      hasPersisted: () => Boolean(receipt),
      hasRuntimePersistencePending: () => false,
      waitForRuntimePersistence: async () => {},
    };
  };
  params.userTurnTranscriptRecorder = recorder(params.prompt);
  const first = await harness.runAttempt(params);
  assert.equal(first.terminal.kind, "ok");
  await appendSessionTranscriptMessageByIdentity({
    ...scope,
    eventId: "voice:fixture:user",
    message: {
      role: "user",
      content: [{ type: "text", text: "The voice-only code word is COBALT." }],
      provenance: { kind: "realtime_voice", sourceChannel: "talk" },
      timestamp: Date.now(),
    },
  });
  const second = await harness.runAttempt({
    ...params,
    runId: "probe-2",
    prompt: "What code word did I just say on the call?",
    userTurnTranscriptRecorder: recorder("What code word did I just say on the call?"),
  });
  assert.equal(second.terminal.kind, "ok");
  assert.equal(second.replayMetadata.replaySafe, true);
  assert.equal(second.journalValidated, true);
  assert.equal(turns, 2);
  assert.equal(captured[1].options.prompt, "What code word did I just say on the call?");
  assert.match(captured[1].system.content, /COBALT/);
  await appendSessionTranscriptMessageByIdentity({
    ...scope,
    eventId: "text:correction",
    message: {
      role: "user",
      content: [{ type: "text", text: "Change the code word to AMBER." }],
      timestamp: Date.now(),
    },
  });
  const third = await harness.runAttempt({
    ...params,
    runId: "probe-3",
    prompt: "Which word is current?",
    userTurnTranscriptRecorder: recorder("Which word is current?"),
  });
  assert.equal(third.terminal.kind, "ok");
  const context = captured.at(-1).system.content;
  assert.ok(context.indexOf("AMBER") > context.indexOf("COBALT"));
  assert.equal(turns, 3);
  console.log(
    JSON.stringify({
      status: "passed",
      checks: [
        "ordinary-turn-context",
        "resumed-speech-context",
        "later-text-correction",
        "current-request-unchanged",
        "journal-replay-safe",
      ],
      modelCalls: 0,
      externalWrites: 0,
    }),
  );
  await harness.dispose?.();
}
