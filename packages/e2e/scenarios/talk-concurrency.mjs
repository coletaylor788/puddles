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
  for (const name of readdirSync(dist)) {
    if (!name.endsWith(".mjs")) continue;
    const path = join(dist, name);
    const source = readFileSync(path, "utf8");
    const alias = source.match(/\bOpenAIQuicksilverDelegationController as ([\w$]+)/)?.[1];
    if (alias) { Controller = (await import(pathToFileURL(path)))[alias]; break; }
  }
  assert.equal(typeof Controller, "function", "compiled Talk controller export is required");
  let finish;
  let appendFinal;
  const sent = [];
  const calls = [];
  const fatal = [];
  const run = Object.assign(async (request) => {
    calls.push(request);
    appendFinal = request.requesterFinal.append;
    return new Promise(resolve => { finish = resolve; });
  }, {
    claimAppend: () => true,
    claimFailureAppend: () => true,
    steer: async () => { throw Object.assign(new Error("synthetic unsupported steering"), { code: "TALK_STEERING_UNSUPPORTED" }); },
  });
  const controller = new Controller({
    model: "gpt-live-1", signal: new AbortController().signal,
    getSocket: () => socket, logger: { debug() {}, warn() {} },
    runAgentConsult: run, onFatalError: error => fatal.push(error),
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
    for (const id of ["weather", "memory"]) {
      request(id, `also read synthetic ${id}`);
      await tick();
      assert.equal(replies(id).length, 1);
      assert.match(replies(id)[0].content, /not accepted/);
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0].signal.aborted, false);
    assert.deepEqual(fatal, []);
    finish({ text: "", yielded: true });
    await tick();
    assert.equal(appendFinal("original child result"), true);
    assert.equal(appendFinal("duplicate result"), false);
    assert.ok(replies("first").some(e => e.content === "original child result"));
    request("next", "now read synthetic memory");
    await tick();
    assert.equal(calls.length, 2);
    finish({ text: "next result" });
    await tick();
    assert.equal(replies("next")[0].content, "next result");
    assert.deepEqual(fatal, []);
    console.log(JSON.stringify({ status: "passed", checks: ["compiled-public-wire", "repeated-overlap-rejection", "original-run-preserved", "delayed-child-once", "subsequent-request"], modelCalls: 0, externalWrites: 0 }));
  } finally { controller.stop(new Error("fixture complete")); }
}
