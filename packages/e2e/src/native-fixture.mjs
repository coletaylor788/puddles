import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  appendFileSync, chmodSync, closeSync, cpSync, existsSync, mkdirSync,
  mkdtempSync, openSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createServer as createSocketServer } from "node:net";
import { atomicJson } from "./native-state.mjs";
import { runCommand } from "./process-runner.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const activeFixtures = new Set();
export async function cleanupNativeFixtures() {
  const errors = [];
  for (const cleanup of activeFixtures) {
    try { await cleanup(); } catch (error) { errors.push(error); }
  }
  return errors;
}
export function records(path) {
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
}

export function isolatedContext(root) {
  const context = {
    schemaVersion: 1, root, isolationRoot: root, home: join(root, "home"), stateDir: join(root, "state"),
    configPath: join(root, "state", "openclaw.json"), workspace: join(root, "workspace"),
    recordingsDir: join(root, "recordings"), tempDir: join(root, "tmp"),
  };
  for (const key of ["home", "stateDir", "workspace", "recordingsDir", "tempDir"]) {
    mkdirSync(context[key], { recursive: true, mode: 0o700 });
  }
  return context;
}

export function fixtureEnv(context) {
  return {
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
    HOME: context.home, USERPROFILE: context.home,
    TMPDIR: context.tempDir, TMP: context.tempDir, TEMP: context.tempDir,
    XDG_CONFIG_HOME: join(context.home, ".config"), XDG_CACHE_HOME: join(context.home, ".cache"),
    XDG_DATA_HOME: join(context.home, ".local", "share"),
    OPENCLAW_HOME: context.home, OPENCLAW_STATE_DIR: context.stateDir,
    OPENCLAW_CONFIG_PATH: context.configPath,
    E2E_MOCK_STATE: context.recordingsDir,
    OPENCLAW_DISABLE_BONJOUR: "1", OPENCLAW_SKIP_CANVAS_HOST: "1",
    npm_config_offline: "true", npm_config_cache: join(context.home, ".npm"),
    COREPACK_ENABLE_NETWORK: "0",
    NODE_ENV: "production", NO_COLOR: "1",
  };
}

async function freePort() {
  const server = createSocketServer();
  await new Promise((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
  const port = server.address().port;
  await new Promise((yes, no) => server.close((error) => error ? no(error) : yes()));
  return port;
}

async function until(check, description, timeoutMs, child) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`Gateway exited before ${description}`);
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`Fixture timed out waiting for ${description}`);
}

async function stop(child) {
  if (!child?.pid) return;
  const kill = (signal) => {
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const closed = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve() : new Promise((yes) => child.once("close", yes));
  kill("SIGTERM");
  let timer;
  await Promise.race([closed, new Promise((yes) => { timer = setTimeout(yes, 5_000); })]);
  clearTimeout(timer);
  kill("SIGKILL");
  await closed;
}

function validateScenario(scenario) {
  if (!/^[a-z0-9-]+$/.test(scenario.id) || !scenario.steps?.length) throw new Error("Invalid native scenario");
  if (scenario.inboundDebounceMs !== undefined && scenario.inboundDebounceMs !== null &&
      (!Number.isInteger(scenario.inboundDebounceMs) || scenario.inboundDebounceMs < 0 || scenario.inboundDebounceMs > 15_000)) {
    throw new Error("Invalid fixture inbound debounce");
  }
  for (const [name, adapter] of Object.entries(scenario.adapters ?? {})) {
    if (!/^[a-z][a-z0-9_]+$/.test(name) || !["read", "write"].includes(adapter.kind) || !adapter.operations?.length) {
      throw new Error("Missing required recording adapter");
    }
    if (adapter.kind === "read" && adapter.operations.some((operation) => adapter.responses?.[operation] === undefined)) {
      throw new Error("Missing deterministic read fixture");
    }
  }
  for (const step of scenario.steps) {
    for (const incoming of step.incoming ?? []) {
      if (incoming.delayMs !== undefined &&
          (!Number.isInteger(incoming.delayMs) || incoming.delayMs < 0 || incoming.delayMs > 1_000)) {
        throw new Error("Invalid fixture incoming delay");
      }
    }
    for (const response of step.responses) {
      for (const tool of response.toolCalls ?? []) {
        if (!scenario.adapters?.[tool.name]) throw new Error(`Missing required recording adapter: ${tool.name}`);
      }
    }
  }
}

export async function runScenario(installedDir, scenario, options = {}) {
  validateScenario(scenario);
  if (!existsSync(join(installedDir, "openclaw.mjs")) ||
      !existsSync(join(installedDir, "dist", "entry.js")) ||
      !existsSync(join(installedDir, "node_modules"))) {
    throw new Error("A real installed OpenClaw candidate with runtime dependencies is required");
  }
  const imessageManifest = join(installedDir, "dist/extensions/imessage/package.json");
  if (!existsSync(imessageManifest) ||
      JSON.parse(readFileSync(imessageManifest, "utf8")).openclaw?.build?.bundledDist !== true) {
    throw new Error("The maintained iMessage plugin must be bundled in the installed candidate");
  }
  const channelSchema = JSON.parse(readFileSync(
    join(installedDir, "dist/extensions/imessage/openclaw.plugin.json"), "utf8",
  )).channelConfigs?.imessage?.schema;
  assert.equal(channelSchema?.properties?.coalesceSameSenderDms?.type, "boolean",
    "packaged channel schema is missing maintained iMessage coalescing");
  assert.equal(channelSchema?.properties?.accounts?.additionalProperties?.properties?.coalesceSameSenderDms?.type,
    "boolean", "packaged account schema is missing maintained iMessage coalescing");
  const root = mkdtempSync(join(options.runDir ?? tmpdir(), `fixture-${scenario.id}-`));
  const context = isolatedContext(root);
  const requests = [];
  const responses = [];
  let modelError;
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") throw new Error("Unexpected model endpoint");
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 4 * 1024 * 1024) throw new Error("Model request exceeds bound");
      }
      const parsed = JSON.parse(body);
      requests.push(parsed);
      const scripted = responses.shift();
      if (!scripted) throw new Error("Unscripted model request");
      if (scripted.error) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: scripted.error, type: "invalid_request_error" } }));
        return;
      }
      const message = { role: "assistant", content: scripted.text ?? null };
      if (scripted.toolCalls) {
        message.tool_calls = scripted.toolCalls.map((tool, index) => ({
          index, id: `fixture_call_${requests.length}_${index}`, type: "function",
          function: { name: tool.name, arguments: JSON.stringify(tool.args) },
        }));
      }
      const finish = scripted.toolCalls ? "tool_calls" : "stop";
      const base = { id: `fixture-${requests.length}`, object: "chat.completion.chunk", created: 1, model: "fixture-model" };
      if (parsed.stream) {
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: message, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
        response.end("data: [DONE]\n\n");
      } else {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message, finish_reason: finish }] }));
      }
    } catch (error) {
      modelError = error;
      response.writeHead(500);
      response.end("Fixture model rejected request");
    }
  });
  let child;
  let log;
  let primaryError;
  const cleanup = async () => {
    await stop(child);
    server.closeAllConnections();
    await new Promise((yes) => server.close(yes));
  };
  activeFixtures.add(cleanup);
  try {
    await new Promise((yes, no) => { server.once("error", no); server.listen(0, "127.0.0.1", yes); });
    const modelPort = server.address().port;
    const port = await freePort();
    const bridge = join(root, "imsg-fixture");
    cpSync(join(packageDir, "mocks", "imsg-mock.mjs"), bridge);
    chmodSync(bridge, 0o700);
    const plugin = join(root, "recording-tools");
    cpSync(join(packageDir, "mocks", "recording-tools"), plugin, { recursive: true });
    atomicJson(join(plugin, "openclaw.plugin.json"), {
      ...JSON.parse(readFileSync(join(plugin, "openclaw.plugin.json"), "utf8")),
      contracts: { tools: Object.keys(scenario.adapters ?? {}) },
    });
    atomicJson(join(context.recordingsDir, "adapters.json"), scenario.adapters ?? {});
    writeFileSync(join(context.workspace, "AGENTS.md"), "This is a scripted fixture. Follow the model response exactly.\n");
    atomicJson(context.configPath, {
      gateway: { mode: "local", port, bind: "loopback", auth: { mode: "token", token: "synthetic-fixture-gateway-token" }, controlUi: { enabled: false } },
      logging: { file: join(root, "openclaw.log") },
      update: { checkOnStart: false },
      cron: { enabled: false },
      browser: { enabled: false },
      agents: { defaults: { workspace: context.workspace, model: { primary: "fixture/fixture-model" }, compaction: { mode: "default" }, heartbeat: { every: "0m" } } },
      models: { mode: "replace", providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${modelPort}/v1`, apiKey: "synthetic-fixture-key", models: [{ id: "fixture-model", name: "Scripted model", contextWindow: 128000, maxTokens: 4096, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } },
      channels: { imessage: { enabled: true, cliPath: bridge, dbPath: join(context.stateDir, "fixture-chat.db"), dmPolicy: "allowlist", allowFrom: ["+15550001111"], groupPolicy: "disabled", coalesceSameSenderDms: true, sendReadReceipts: false } },
      ...(scenario.inboundDebounceMs === null ? {} : {
        messages: { inbound: { debounceMs: scenario.inboundDebounceMs ?? 250 } },
      }),
      plugins: { allow: ["imessage", "puddles-recording-tools"], load: { paths: [plugin] }, entries: { imessage: { enabled: true }, "puddles-recording-tools": { enabled: true } } },
      tools: { allow: Object.keys(scenario.adapters ?? {}), deny: ["exec", "process", "browser", "web_fetch", "web_search", "cron", "sessions_spawn", "nodes"] },
      session: { dmScope: "per-channel-peer" },
    });
    if (scenario.expectBundledSkills) {
      const listed = JSON.parse(await runCommand(process.execPath, [join(installedDir, "openclaw.mjs"), "skills", "list", "--json"], {
        cwd: context.workspace, env: fixtureEnv(context), capture: true, quiet: true, timeoutMs: 60_000,
      }));
      for (const name of scenario.expectBundledSkills) {
        assert.ok(listed.skills.some((skill) => skill.name === name && skill.source === "openclaw-bundled"), "installed bundled skill missing");
      }
    }
    log = openSync(join(root, "gateway.log"), "w", 0o600);
    child = spawn(process.execPath, [join(installedDir, "openclaw.mjs"), "gateway", "run", "--port", String(port), "--bind", "loopback"], {
      cwd: context.workspace, env: fixtureEnv(context), detached: true, stdio: ["ignore", log, log],
    });
    let spawnError;
    child.once("error", (error) => { spawnError = error; });
    const timeout = options.timeoutMs ?? 90_000;
    await until(() => {
      if (spawnError) throw spawnError;
      return records(join(context.recordingsDir, "imsg-ready.jsonl")).length > 0;
    }, "real iMessage subscription", timeout, child);
    let requestCount = 0;
    let sendCount = 0;
    let rowid = 1;
    for (const step of scenario.steps) {
      responses.push(...step.responses);
      requestCount += step.responses.length;
      for (const incoming of step.incoming) {
        const { delayMs = 0, ...payload } = incoming;
        if (delayMs) await delay(delayMs);
        const message = {
          id: rowid++, guid: incoming.guid ?? `fixture-inbound-${rowid}`, chat_id: 123,
          sender: "+15550001111", is_from_me: false, is_group: false,
          chat_identifier: "+15550001111", created_at: new Date().toISOString(), ...payload,
        };
        appendFileSync(join(context.recordingsDir, "imsg-incoming.jsonl"), JSON.stringify(message) + "\n");
      }
      const expected = step.expect.sends;
      await until(() => {
        if (modelError) throw modelError;
        return requests.length >= requestCount &&
          records(join(context.recordingsDir, "imsg-sends.jsonl")).length >= sendCount + expected.length;
      }, "scripted response and recorded delivery", timeout, child);
      // Include the quiet tail to catch duplicate sends and suppressed-output failures.
      await delay(step.expect.quietMs ?? 1200);
      if (modelError) throw modelError;
      assert.equal(requests.length, requestCount, "unexpected model request count");
      const sends = records(join(context.recordingsDir, "imsg-sends.jsonl")).slice(sendCount);
      assert.equal(sends.length, expected.length, "unexpected outbound message count");
      sends.forEach((send, index) => assert.ok((send.params?.text ?? "").includes(expected[index]), "recorded reply differs"));
      if (step.expect.promptIncludes) {
        const prompt = JSON.stringify(requests[requestCount - step.responses.length].messages);
        for (const text of step.expect.promptIncludes) assert.ok(prompt.includes(text), "incoming event missing from real model request");
      }
      sendCount += expected.length;
    }
    const calls = records(join(context.recordingsDir, "tool-calls.jsonl"));
    for (const name of ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md"]) {
      assert.ok(existsSync(join(context.workspace, name)), "normal workspace bootstrap file missing");
    }
    assert.equal(JSON.parse(readFileSync(context.configPath, "utf8")).channels.imessage.coalesceSameSenderDms,
      true, "startup removed the maintained coalescing policy");
    if (scenario.expectCalls) assert.deepEqual(calls, scenario.expectCalls);
    assert.equal(records(join(context.recordingsDir, "imsg-denied.jsonl")).length, 0, "unsupported bridge method");
    assert.equal(responses.length, 0, "unconsumed model script");
    return { id: scenario.id, passed: true, modelRequests: requests.length, sends: sendCount, toolCalls: calls.length };
  } catch (error) {
    primaryError = error;
    writeFileSync(join(root, "failure.log"), `${error.stack}\n`, { mode: 0o600 });
    throw new Error(`Native scenario failed. Protected local diagnostic: ${join(root, "failure.log")}`, { cause: error });
  } finally {
    const errors = [];
    try { await cleanup(); } catch (error) { errors.push(error); }
    activeFixtures.delete(cleanup);
    if (log !== undefined) closeSync(log);
    if (!primaryError && errors.length === 0) {
      try {
        assert.equal(records(join(context.recordingsDir, "imsg-sends.jsonl")).length, scenario.steps.reduce((count, step) => count + step.expect.sends.length, 0), "unexpected delivery during shutdown");
        assert.equal(records(join(context.recordingsDir, "imsg-denied.jsonl")).length, 0, "unsupported bridge operation");
      } catch (error) { errors.push(error); }
    }
    if (!primaryError && errors.length === 0) rmSync(root, { recursive: true });
    if (errors.length) throw new AggregateError([...(primaryError ? [primaryError] : []), ...errors], "Native fixture cleanup failed");
  }
}
