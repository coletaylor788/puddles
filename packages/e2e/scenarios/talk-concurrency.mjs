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
    steer: async () => { throw Object.assign(new Error("synthetic unsupported steering"), { code: "TALK_STEERING_UNSUPPORTED" }); },
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
    request("first", "read the synthetic calendar");
    await tick();
    assert.deepEqual(sent, [], "calling the runner must not announce admission");
    assert.equal(typeof calls[0].onProgress, "function");
    calls[0].onProgress("Existing notes identify two options. Research is running.");
    assert.deepEqual(sent, [{
      type: "session.thinking.append", delegation_id: "first",
      content: "Existing notes identify two options. Research is running.",
    }]);
    controller.handleFrame(Buffer.from(JSON.stringify({
      type: "session.input_transcript.delta",
      delta: "While that lookup runs, help me brainstorm a cozy reading nook. I like plants ",
      start_ms: 110, end_ms: 140,
    })), false);
    controller.handleFrame(Buffer.from(JSON.stringify({
      type: "session.output_transcript.delta", delta: "A warm lamp would help.",
      start_ms: 150, end_ms: 180,
    })), false);
    request("status", "Are you actually checking that request?");
    await tick();
    assert.equal(calls.length, 1, "status must not launch another task");
    assert.equal(replies("status")[0].content, "The original task is active.");
    assert.equal(classify({ text: "Also, that result makes sense." }).shouldAutoControl, false);
    for (const id of ["weather", "memory"]) {
      request(id, `also read synthetic ${id}`);
      await tick();
      assert.equal(replies(id).length, 1);
      assert.match(replies(id)[0].content, /not accepted/);
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].signal.aborted, false);
    assert.deepEqual(fatal, []);
    calls[0].onProgress("The original research is still running.");
    assert.equal(sent.at(-1).type, "session.thinking.append");
    assert.equal(sent.at(-1).delegation_id, "first");
    finish({ text: "", yielded: true });
    await tick();
    const settledCount = sent.length;
    calls[0].onProgress("Late context must be dropped.");
    assert.equal(sent.length, settledCount);
    assert.equal(appendFinal("original child result"), true);
    assert.equal(appendFinal("duplicate result"), false);
    assert.ok(replies("first").some(e => e.content === "original child result"));
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
    assert.equal(replies("failed").length, 1);
    assert.match(replies("failed")[0].content, /failed/);
    request("retry", "try again using the other document");
    await tick();
    assert.equal(calls.length, 4);
    assert.match(calls[3].prompt, /try again using the other document/);
    request("overlap-one", "also read the second document");
    request("overlap-two", "also read the third document");
    await tick();
    for (const id of ["overlap-one", "overlap-two"]) {
      assert.equal(replies(id).length, 1, "every unaccepted input needs its own outcome");
      assert.match(replies(id)[0].content, /not accepted/);
    }
    assert.equal(calls[3].signal.aborted, false);
    finish({ text: "fresh attempt result" });
    await tick();
    assert.equal(replies("retry")[0].content, "fresh attempt result");
    assert.deepEqual(fatal, []);
    console.log(JSON.stringify({ status: "passed", checks: ["compiled-public-wire", "no-premature-admission", "native-status", "discussion-not-control", "silent-progress", "progress-fenced-after-yield", "repeated-overlap-rejection", "original-run-preserved", "delayed-child-once", "subsequent-request", "failure-then-fresh-request", "rapid-overlap-outcomes"], modelCalls: 0, externalWrites: 0 }));
  } finally { controller.stop(new Error("fixture complete")); }
}
