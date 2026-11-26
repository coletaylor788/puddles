import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setImmediate as tick } from "node:timers/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";

// Run against built or installed bytes, in a disposable state directory. The
// provider and backend are explicit doubles; no live service is contacted.
const runtime = resolve(process.argv[2]);
if (process.argv[3] !== "--child") {
  const root = mkdtempSync(join(tmpdir(), "talk-concurrency-fixture-"));
  try {
    const config = join(root, "openclaw.json");
    writeFileSync(config, "{}");
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), runtime, "--child"], {
      env: { ...process.env, HOME: root, OPENCLAW_STATE_DIR: root, OPENCLAW_CONFIG_PATH: config },
      encoding: "utf8", timeout: 30_000,
    });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    process.stdout.write(result.stdout);
  } finally { rmSync(root, { recursive: true, force: true }); }
} else {
  assert.ok(process.env.OPENCLAW_STATE_DIR?.includes("talk-concurrency-fixture-"));
  const deny = () => { throw new Error("Network access is forbidden in the Talk fixture"); };
  globalThis.fetch = deny;
  http.request = http.get = https.request = https.get = deny;
  const dist = join(runtime, "dist");
  let Controller;
  let classify;
  for (const name of readdirSync(dist)) {
    if (!name.endsWith(".mjs")) continue;
    const path = join(dist, name);
    const source = readFileSync(path, "utf8");
    const alias = source.match(/\bOpenAIQuicksilverDelegationController as ([\w$]+)/)?.[1];
    if (alias) Controller = (await import(pathToFileURL(path)))[alias];
    const classifierAlias = source.match(/\bresolveRealtimeVoiceAgentControlIntent as ([\w$]+)/)?.[1];
    if (classifierAlias) classify = (await import(pathToFileURL(path)))[classifierAlias];
    if (Controller && classify) break;
  }
  assert.equal(typeof Controller, "function", "compiled Talk controller export is required");
  assert.equal(typeof classify, "function", "compiled Talk control classifier is required");
  let finish;
  let failAttempt;
  let active = false;
  let rejectSteering = false;
  const steering = [];
  let appendFinal;
  const sent = [];
  const calls = [];
  const fatal = [];
  const run = Object.assign(async (request) => {
    calls.push(request);
    active = true;
    appendFinal = request.requesterFinal.append;
    try { return await new Promise((resolve, reject) => { finish = resolve; failAttempt = reject; }); }
    finally { active = false; }
  }, {
    claimAppend: () => true,
    claimFailureAppend: () => true,
    steer: async request => {
      steering.push(request);
      if (rejectSteering) throw Object.assign(new Error("synthetic unsupported steering"), { code: "TALK_STEERING_UNSUPPORTED" });
      return { text: "" };
    },
  });
  const controller = new Controller({
    model: "gpt-live-1", signal: new AbortController().signal,
    getSocket: () => socket, logger: { debug() {}, warn() {} },
    runAgentConsult: run, handleDelegationInput: (text, respond) => {
      const intent = classify({ text });
      if (intent.shouldAutoControl && intent.mode === "status") {
        respond(active ? "The original task is active." : "The original task has ended.");
        return "control";
      }
      return "consult";
    },
    onFatalError: error => fatal.push(error),
  }, error => String(error));
  const socket = { readyState: 1, send: text => sent.push(JSON.parse(text)) };
  let offset = 0;
  const request = (id, text) => {
    for (const event of [
      { type: "session.input_transcript.delta", delta: text, start_ms: offset, end_ms: offset + 100 },
      { type: "session.delegation.created", offset_ms: offset + 100, delegation: { id, type: "delegation", target: "client" } },
    ]) controller.handleFrame(Buffer.from(JSON.stringify(event)), false);
    offset += 200;
  };
  const replies = id => sent.filter(e => e.type === "session.commentary.append" && e.delegation_id === id);
  try {
    request("first", "research two synthetic options");
    await tick();
    assert.equal(calls.length, 1);
    assert.ok(sent.some(e => e.type === "session.commentary.append" && e.delegation_id === null),
      "native launch acknowledgement should confirm hearing without claiming admission");
    controller.handleFrame(Buffer.from(JSON.stringify({
      type: "session.input_transcript.delta", delta: "While that runs, I like plants. ",
      start_ms: 110, end_ms: 140,
    })), false);
    controller.handleFrame(Buffer.from(JSON.stringify({
      type: "session.output_transcript.delta", delta: "A warm lamp would help.",
      start_ms: 150, end_ms: 180,
    })), false);
    assert.equal(calls[0].signal.aborted, false, "conversation must not abort accepted research");
    request("refined", "limit that research to the smaller option");
    await tick();
    assert.equal(calls.length, 1, "steering must retain the original task");
    assert.equal(steering.length, 1);
    assert.match(steering[0].prompt, /smaller option/);
    finish({ text: "", yielded: true });
    await tick();
    assert.equal(appendFinal("original child result"), true);
    assert.equal(appendFinal("duplicate result"), false);
    assert.ok(replies("refined").some(e => e.content === "original child result"),
      "native completion must target the latest steering presentation");
    assert.equal(sent.some(e => e.type === "session.thinking.append"), false,
      "the removed silent-progress shim must not be required for completion");
    request("next", "now read synthetic memory");
    await tick();
    assert.equal(calls.length, 2);
    finish({ text: "next result" });
    await tick();
    assert.equal(replies("next")[0].content, "next result");
    request("failed", "read the synthetic document");
    await tick();
    failAttempt(new Error("synthetic reader handoff failure"));
    await tick();
    assert.match(replies("failed")[0].content, /failed/);
    request("retry", "try again using the other document");
    await tick();
    assert.equal(calls.length, 4);
    rejectSteering = true;
    request("unsupported", "refine that task again");
    await tick();
    assert.equal(fatal.length, 1, "unsupported native steering must surface failure");
    assert.equal(calls[3].signal.aborted, true);
    assert.equal(appendFinal("stale completion"), false);
    finish({ text: "stale result" });
    await tick();
    assert.equal(replies("unsupported").some(e => /stale result/.test(e.content)), false);
    console.log(JSON.stringify({ status: "passed", checks: ["compiled-public-wire", "native-launch-ack", "conversation-while-working", "same-task-steering", "proactive-child-once", "subsequent-request", "failure-then-fresh-request", "native-unsupported-steering-failure"], modelCalls: 0, externalWrites: 0 }));
  } finally { controller.stop(new Error("fixture complete")); }
}
