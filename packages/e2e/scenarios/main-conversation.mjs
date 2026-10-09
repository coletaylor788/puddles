import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Exercise installed routing and transcript storage with synthetic identities.
// The runtime is read-only; all writes belong to this disposable fixture.
const runtime = resolve(process.argv[2]);
if (process.argv[3] !== "--child") {
  const root = mkdtempSync(join(tmpdir(), "main-conversation-fixture-"));
  try {
    const config = join(root, "openclaw.json");
    writeFileSync(config, "{}");
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), runtime, "--child"],
      {
        env: { ...process.env, HOME: root, OPENCLAW_STATE_DIR: root, OPENCLAW_CONFIG_PATH: config },
        encoding: "utf8",
        timeout: 40_000,
      },
    );
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    process.stdout.write(result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
} else {
  assert.ok(process.env.OPENCLAW_STATE_DIR?.includes("main-conversation-fixture-"));
  const deny = () => {
    throw new Error("Network access is forbidden in the conversation fixture");
  };
  globalThis.fetch = deny;
  http.request = http.get = https.request = https.get = deny;
  const dist = join(runtime, "dist");
  const chunks = readdirSync(dist)
    .filter((name) => /\.(mjs|js)$/.test(name))
    .map((name) => [join(dist, name), readFileSync(join(dist, name), "utf8")]);
  const compiled = async (name) => {
    for (const [path, source] of chunks) {
      const alias = source.match(new RegExp(`\\b${name} as ([\\w$]+)`))?.[1];
      if (alias) return (await import(pathToFileURL(path)))[alias];
    }
    throw new Error(`Missing compiled export ${name}`);
  };
  const sdk = async (name) => import(pathToFileURL(join(dist, "plugin-sdk", `${name}.js`)));
  const { resolveAgentRoute } = await sdk("routing");
  const { appendSessionTranscriptMessageByIdentity, readSessionTranscriptEvents } = await sdk(
    "session-transcript-runtime",
  );
  const prepare = await compiled("prepareTalkSessionTarget");
  const ensure = await compiled("ensureClientVoiceAgentSessionEntry");
  const createCall = await compiled("createOrResumeClientVoiceSession");
  const appendSpeech = await compiled("appendClientVoiceTranscript");
  const history = await compiled("readTalkRealtimeInitialItems");
  const cfg = {
    agents: { list: [{ id: "main", default: true }, { id: "household" }] },
    session: { dmScope: "per-channel-peer" },
    talk: { agentId: "main" },
    bindings: [
      { agentId: "main", match: { channel: "imessage", accountId: "default" } },
      {
        agentId: "household",
        match: { channel: "imessage", peer: { kind: "direct", id: "+15555550101" } },
      },
      {
        agentId: "main",
        match: {
          channel: "imessage",
          accountId: "default",
          peer: { kind: "direct", id: "+15555550100" },
        },
        session: { dmScope: "main" },
      },
    ],
  };
  writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(cfg));
  const route = (id, accountId = "default", kind = "direct") =>
    resolveAgentRoute({ cfg, channel: "imessage", accountId, peer: { kind, id } });
  const owner = route("+15555550100");
  assert.equal(owner.sessionKey, "agent:main:main");
  assert.notEqual(route("+15555550102").sessionKey, owner.sessionKey);
  assert.equal(route("+15555550101").agentId, "household");
  assert.notEqual(route("+15555550100", "another-account").sessionKey, owner.sessionKey);
  assert.notEqual(route("+15555550100", "default", "group").sessionKey, owner.sessionKey);
  const target = prepare(cfg);
  assert.equal(target.canonicalKey, owner.sessionKey);
  assert.deepEqual(prepare(cfg, "agent:main:main"), { ...target, sessionKey: "agent:main:main" });
  const scope = {
    agentId: target.agentId,
    sessionKey: target.canonicalKey,
    storePath: target.storePath,
  };
  const sessionId = await ensure(scope);
  const appendText = (eventId, text) =>
    appendSessionTranscriptMessageByIdentity({
      ...scope,
      sessionId,
      eventId,
      message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
    });
  await appendText("text-before-call", "The synthetic appointment is on Tuesday.");
  assert.deepEqual(await history(target, () => {}), [
    { role: "user", text: "The synthetic appointment is on Tuesday." },
  ]);
  const voiceSessionId = createCall({ ...scope, origin: "client", transcriptCapable: true });
  const speech = {
    ...scope,
    sessionTarget: scope,
    voiceSessionId,
    config: cfg,
    entryId: "speech-1",
    role: "user",
    text: "Make that Wednesday instead.",
  };
  await appendSpeech(speech);
  await appendSpeech(speech); // Transport replay must not duplicate conversation history.
  await appendSpeech({
    ...speech,
    entryId: "speech-2",
    role: "assistant",
    text: "We are discussing Wednesday.",
  });
  await appendText("text-during-call", "Use the afternoon slot.");
  assert.equal(createCall({ ...scope, origin: "client", voiceSessionId }), voiceSessionId);
  assert.equal(await ensure(scope), sessionId);
  const context = await history(target, () => {});
  assert.deepEqual(
    context.map((item) => item.text),
    [
      "The synthetic appointment is on Tuesday.",
      "Make that Wednesday instead.",
      "We are discussing Wednesday.",
      "Use the afternoon slot.",
    ],
  );
  const transcript = await readSessionTranscriptEvents({ ...scope, sessionId });
  const messages = transcript
    .filter((event) => event.type === "message")
    .map((event) => event.message);
  assert.equal(messages.length, 4);
  assert.equal(messages[1].provenance.kind, "realtime_voice");
  assert.equal(messages[2].provenance.kind, "realtime_voice");
  console.log(
    JSON.stringify({
      status: "passed",
      checks: [
        "owner-only-routing",
        "talk-default-main",
        "text-to-voice",
        "speech-without-consult",
        "text-during-call-persisted",
        "reconnect-history",
        "transcript-deduplication",
      ],
      modelCalls: 0,
      externalWrites: 0,
    }),
  );
}
