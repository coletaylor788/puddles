import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
const runtime = resolve(process.argv[2]);
const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
if (process.argv[3] !== "--child") {
  const root = mkdtempSync(join(tmpdir(), "gmail-approval-fixture-"));
  try {
    writeFileSync(join(root, "config.json"), "{}");
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), runtime, "--child"], {
      cwd: root, encoding: "utf8", timeout: 45000,
      env: { ...process.env, HOME: root, OPENCLAW_STATE_DIR: root, OPENCLAW_CONFIG_PATH: join(root, "config.json") },
    });
    assert.equal(run.status, 0, run.error?.message ?? run.stderr);
    process.stdout.write(run.stdout);
  } finally { rmSync(root, { recursive: true, force: true }); }
} else {
  assert.ok(process.env.OPENCLAW_STATE_DIR.includes("gmail-approval-fixture-"));
  const deny = () => { throw new Error("Live network is forbidden in Gmail approval fixtures"); };
  globalThis.fetch = http.request = http.get = https.request = https.get = deny;
  const root = process.cwd();
  const dist = join(runtime, "dist");
  const modules = readdirSync(dist).filter(n => n.endsWith(".mjs")).map(n => [join(dist, n), readFileSync(join(dist, n), "utf8")]);
  async function native(name) {
    for (const [path, source] of modules) {
      const alias = source.match(new RegExp(`\\b${name} as ([\\w$]+)`))?.[1];
      if (alias) return (await import(pathToFileURL(path)))[alias];
    }
    throw new Error("Missing compiled native export: " + name);
  }
  const wrap = await native("wrapToolWithBeforeToolCallHook");
  const initialize = await native("initializeGlobalHookRunner");
  const reset = await native("resetGlobalHookRunner");
  const setMode = await native("setEmbeddedMode");
  const setBroker = await native("setEmbeddedPluginApprovalBroker");
  const Broker = await native("EmbeddedPluginApprovalBroker");
  const record = join(root, "send.jsonl"), classification = join(root, "classify.jsonl");
  const provider = join(root, "provider.mjs");
  writeFileSync(provider, `import {appendFileSync} from 'node:fs'; export default class {
    async classify(content) { appendFileSync(${JSON.stringify(classification)},'checked\\n');
      return JSON.stringify({detected:content.includes('BLOCK_ME'),evidence:''}); }
  }`);
  const { default: plugin } = await import(pathToFileURL(join(repo, "openclaw-plugins/secure-gmail/dist/plugin.js")));
  let send, close;
  const hooks = [];
  plugin.register({
    pluginConfig: { gmailMcpCommand: process.execPath, gmailMcpArgs: [join(repo, "packages/e2e/fixtures/gmail/recording-mcp.mjs"), record],
      llmProvider: provider, sendEnabled: true, auditLogPath: join(root, "audit.jsonl") },
    logger: { info() {}, warn() {}, error() {} },
    registerTool(factory) { const tool = factory({ agentId: "main", workspaceDir: root }); if (tool?.name === "send_email") send = tool; },
    on(hookName, handler) { if (hookName === "session_end") close = handler;
      else hooks.push({ pluginId: "secure-gmail", hookName, handler, priority: 100 }); },
  });
  const contract = spawnSync(process.env.GMAIL_MCP_PYTHON ?? "python3", ["-c", "import json; from gmail_mcp.send import SEND_SCHEMA; print(json.dumps(SEND_SCHEMA))"], {
    encoding: "utf8", timeout: 10000, env: { ...process.env, PYTHONPATH: join(repo, "servers/gmail-mcp/src") },
  });
  assert.equal(contract.status, 0, contract.stderr);
  assert.deepEqual(send.parameters, JSON.parse(contract.stdout), "Gmail schemas must match across the bridge");
  hooks.push({ pluginId: "earlier", hookName: "before_tool_call", priority: 200,
    handler: (event) => ({ params: { ...event.params, to: ["earlier@example.net"] } }) });
  hooks.push({ pluginId: "later", hookName: "before_tool_call", priority: 0, handler: () => ({ params: { to: ["rewritten@example.net"] } }) });
  initialize({ plugins: ["secure-gmail", "earlier", "later"].map(id => ({ id, status: "loaded" })), hooks: [], typedHooks: hooks });
  const broker = new Broker(); setMode(true); setBroker(broker);
  const tool = wrap(send, { agentId: "main", sessionKey: "agent:main:fixture", runId: "fixture-run", config: {}, requester: { senderIsOwner: true } }, { emitDiagnostics: false });
  const args = () => ({ to: ["new@example.net"], cc: ["copy@example.net"], bcc: ["hidden@example.net"], subject: "Fixture", body_text: "Hello" });
  async function pending() {
    for (let i = 0; i < 100; i++) { const request = broker.listPending()[0]; if (request) return request; await new Promise(r => setTimeout(r, 10)); }
    throw new Error("Native approval was not requested");
  }
  const count = () => existsSync(record) ? readFileSync(record, "utf8").trim().split("\n").length : 0;
  try {
    const original = args(); const running = tool.execute("allow", original);
    const approval = await pending();
    assert.equal(count(), 0); assert.equal(existsSync(classification), false, "guard must run after approval");
    assert.ok(approval.request.description.includes("hidden@example.net"));
    original.to[0] = "mutated@example.net";
    assert.equal(broker.resolve(approval.id, "allow-always"), false);
    assert.equal(broker.resolve(approval.id, "allow-once"), true);
    assert.equal((await running).details.status, "sent");
    assert.equal(broker.resolve(approval.id, "allow-once"), false);
    const sent = JSON.parse(readFileSync(record, "utf8").trim());
    assert.deepEqual(sent.arguments, args()); assert.equal(count(), 1);

    const denied = tool.execute("deny", args()); const denial = await pending();
    broker.resolve(denial.id, "deny"); await denied.catch(() => {}); assert.equal(count(), 1);
    const blocked = tool.execute("blocked", { ...args(), body_text: "BLOCK_ME" });
    broker.resolve((await pending()).id, "allow-once");
    assert.equal((await blocked).details.status, "blocked"); assert.equal(count(), 1);
    const abort = new AbortController();
    const cancelled = tool.execute("cancel", args(), abort.signal).catch(() => {});
    const cancelledId = (await pending()).id; abort.abort(); await cancelled;
    assert.equal(broker.resolve(cancelledId, "allow-once"), false); assert.equal(count(), 1);
    const stopped = tool.execute("stop", args()).catch(() => {});
    const stoppedId = (await pending()).id; broker.stop(new Error("Fixture runtime stopped")); await stopped;
    assert.equal(broker.resolve(stoppedId, "allow-once"), false); assert.equal(count(), 1);
    console.log(JSON.stringify({ status: "passed", recordedSends: count(), externalWrites: 0, checks: ["native-wrapper", "approval-before-guard", "native-snapshot", "summary-matches-snapshot-after-earlier-hook", "later-hook-rewrite-blocked", "allow-once", "deny", "content-block", "abort", "runtime-stop", "stdio-bridge", "schema-parity"] }));
  } finally { broker.stop(); setBroker(null); setMode(false); reset(); await close(); }
}
