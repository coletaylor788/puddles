import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
const runtime = realpathSync(resolve(process.argv[2]));
const repo = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
if (process.argv[3] !== "--child") {
  const root = mkdtempSync(join(tmpdir(), "household-approval-fixture-"));
  try {
    mkdirSync(join(root, "node_modules"));
    symlinkSync(runtime, join(root, "node_modules/openclaw"));
    const bundle = process.argv.includes("--development-bundle")
      ? join(repo, "openclaw-plugins/approved-session-send/dist/plugin.js")
      : join(runtime, "plugins/approved-session-send/plugin.js");
    mkdirSync(join(root, "plugin"));
    for (const name of ["plugin.js", "package.json", "openclaw.plugin.json"]) copyFileSync(join(dirname(bundle), name), join(root, "plugin", name));
    writeFileSync(join(root, "config.json"), "{}");
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), runtime, "--child"], {
      cwd: root, encoding: "utf8", timeout: 45_000,
      env: { PATH: process.env.PATH, HOME: root, TMPDIR: root, OPENCLAW_STATE_DIR: root, OPENCLAW_CONFIG_PATH: join(root, "config.json"), NO_COLOR: "1" },
    });
    assert.equal(result.status, 0, `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`);
    process.stdout.write(result.stdout);
  } finally { rmSync(root, { recursive: true, force: true }); }
} else {
  const root = process.cwd();
  assert.ok(root.includes("household-approval-fixture-"));
  const deny = () => { throw new Error("Live network forbidden in household approval fixture"); };
  globalThis.fetch = http.request = http.get = https.request = https.get = deny;
  const dist = join(runtime, "dist");
  const modules = readdirSync(dist).filter(n => n.endsWith(".mjs")).map(n => [join(dist, n), readFileSync(join(dist, n), "utf8")]);
  async function native(name) {
    for (const [path, source] of modules) {
      const alias = source.match(new RegExp(`\\b${name} as ([\\w$]+)`))?.[1];
      if (alias) return (await import(pathToFileURL(path)))[alias];
    }
    throw new Error("Missing native export: " + name);
  }
  const [wrap, initialize, reset, setMode, setBroker, Broker, createSend, upsert, replace, loadRegistry, disposeRegistry, setConfig, withRegistry, withGeneration] = await Promise.all([
    "wrapToolWithBeforeToolCallHook", "initializeGlobalHookRunner", "resetGlobalHookRunner", "setEmbeddedMode",
    "setEmbeddedPluginApprovalBroker", "EmbeddedPluginApprovalBroker", "createSessionsSendTool", "upsertSessionEntryCore", "replaceSessionEntry",
    "loadAndActivateRootPluginRegistry", "disposePluginRegistryInstances", "setRuntimeConfigSnapshot",
    "withPluginRuntimeRegistryScope", "withPluginRuntimeGenerationRegistryScope",
  ].map(native));
  const { createSessionVisibilityChecker } = await import(pathToFileURL(join(dist, "plugin-sdk/session-visibility.js")));
  const accessRequests = [];
  let afterGrant;
  const resolveAccess = createSessionVisibilityChecker.resolveScopedAccessAsync;
  createSessionVisibilityChecker.resolveScopedAccessAsync = async request => {
    const result = await resolveAccess(request); accessRequests.push({ request, result });
    if (result && afterGrant) { const change = afterGrant; afterGrant = undefined; await change(); }
    return result;
  };
  const requesterKey = "agent:household:ios-fixture";
  const targetKey = "agent:main:main";
  const settings = { requesterAgentId: "household", targetSessionKey: targetKey };
  const cfg = { agents: { ownership: "explicit", defaults: { sandbox: { sessionToolsVisibility: "all" } }, entries: {
    household: { workspace: join(root, "household") }, main: { workspace: join(root, "main") }, other: { workspace: join(root, "other") },
  } }, session: { store: join(root, "agents/{agentId}/sessions.json"), dmScope: "per-channel-peer" },
    tools: { sessions: { visibility: "all" }, agentToAgent: { enabled: true, allow: ["main", "other"] } },
    plugins: { allow: ["approved-session-send"], load: { paths: [join(root, "plugin")] }, entries: { "approved-session-send": { enabled: true, config: settings } } } };
  writeFileSync(join(root, "config.json"), JSON.stringify(cfg));
  const scope = key => ({ agentId: key.split(":")[1], sessionKey: key, storePath: cfg.session.store.replace("{agentId}", key.split(":")[1]) });
  await upsert(scope(requesterKey), { sessionId: "household-session", updatedAt: 1 });
  await upsert(scope(targetKey), { sessionId: "main-session", updatedAt: 1 });
  setConfig(cfg);
  process.argv[1] = join(runtime, "openclaw.mjs");
  const registry = loadRegistry({ config: cfg, workspaceDir: root, onlyPluginIds: ["approved-session-send"],
    cache: false, throwOnLoadError: true, allowProcessHomeSessionCatalogs: false,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  assert.deepEqual(registry.plugins.filter(p => p.status === "loaded").map(p => p.id), ["approved-session-send"]);
  assert.deepEqual(registry.diagnostics.filter(d => d.level === "error"), []);
  const inRegistry = (selected, run) => withGeneration(selected, () => withRegistry(selected, run));
  await inRegistry(registry, async () => {
  const cleanup = () => disposeRegistry(registry);
  const hooks = registry.typedHooks;
  hooks.push({ pluginId: "earlier", hookName: "before_tool_call", priority: 200,
    handler: event => ({ params: { ...event.params, message: "earlier hook replacement" } }) });
  hooks.push({ pluginId: "later", hookName: "before_tool_call", priority: 0,
    handler: () => ({ params: { message: "later hook replacement" } }) });
  initialize({ plugins: ["approved-session-send", "earlier", "later"].map(id => ({ id, status: "loaded" })), hooks: [], typedHooks: hooks });
  const broker = new Broker(); setMode(true); setBroker(broker);
  const calls = [];
  const replies = new Map();
  let outcome = "ok";
  const callGateway = async request => {
    calls.push(request);
    if (request.method === "sessions.resolve") {
      assert.equal(request.params.key, targetKey);
      return { key: targetKey, agentId: "main", sessionId: "main-session" };
    }
    if (request.method === "agent") {
      const runId = `main-run-${calls.length}`;
      replies.set(runId, request.params.message.includes("second concurrent") ? "Second answer."
        : request.params.message.includes("first concurrent") ? "First answer." : "Dinner is at seven.");
      return { status: "accepted", runId, acceptedAt: 1 };
    }
    if (request.method === "agent.wait") return outcome === "timeout" ? { status: "timeout" }
      : outcome === "error" ? { status: "error", error: "synthetic target failure" }
      : { status: "ok", terminalReply: { disposition: "visible", text: replies.get(request.params.runId) } };
    throw new Error("Unapproved background or history operation: " + request.method);
  };
  const raw = createSend({ config: cfg, agentId: "household", agentSessionKey: requesterKey, agentChannel: "webchat", callGateway });
  const ctx = { config: cfg, agentId: "household", sessionKey: requesterKey, sessionId: "household-session", runId: "household-run" };
  const tool = wrap(raw, ctx, { emitDiagnostics: false });
  const args = () => ({ sessionKey: targetKey, message: "What time is dinner?", timeoutSeconds: 60 });
  async function pending() {
    for (let i = 0; i < 100; i++) { const value = broker.listPending()[0]; if (value) return value; await new Promise(r => setTimeout(r, 10)); }
    throw new Error("Native approval was not requested");
  }
  async function approve(call) {
    const result = call.catch(error => ({ error: String(error) }));
    const approval = await pending();
    assert.equal(broker.resolve(approval.id, "allow-always"), false);
    assert.equal(broker.resolve(approval.id, "allow-once"), true);
    return result;
  }
  const sends = () => calls.filter(call => call.method === "agent");
  try {
    for (const selected of [
      { plugins: [], hooks: [], typedHooks: [] },
      { plugins: [{ id: "approved-session-send", status: "loaded" }], hooks: [], typedHooks: [] },
      { plugins: [{ id: "other", status: "loaded" }], hooks: [], typedHooks: [{ pluginId: "other", hookName: "before_tool_call", handler: () => undefined }] },
    ]) {
      await inRegistry(selected, async () => {
        assert.equal(createSessionVisibilityChecker.resolveScopedAccess({ action: "send", requesterSessionKey: requesterKey, targetSessionKey: targetKey }), undefined);
        const omitted = await tool.execute("omitted-generation", args());
        assert.equal(omitted.details.status, "forbidden");
        assert.equal(broker.listPending().length, 0);
        assert.equal(sends().length, 0);
      });
    }
    assert.deepEqual(calls.map(call => call.method), ["sessions.resolve", "sessions.resolve", "sessions.resolve"]);
    calls.length = 0;
    assert.deepEqual(createSessionVisibilityChecker.resolveScopedAccess({ action: "send", requesterSessionKey: requesterKey, targetSessionKey: targetKey }), { expectedSessionId: "main-session" });
    for (const action of ["history", "search", "status"]) assert.equal(createSessionVisibilityChecker.resolveScopedAccess({ action, requesterSessionKey: requesterKey, targetSessionKey: targetKey }), undefined);
    const original = args();
    const running = tool.execute("first", original).catch(error => ({ error: String(error) }));
    const approval = await pending(); assert.equal(sends().length, 0);
    assert.ok(approval.request.description.includes(original.message));
    original.message = "New human question must not replace the approved one";
    assert.equal(broker.resolve(approval.id, "allow-once"), true);
    const result = await running;
    assert.equal(result.details?.reply, "Dinner is at seven.", JSON.stringify({ result, accessRequests }));
    assert.deepEqual(result.details.delivery, { status: "skipped", mode: "announce" });
    assert.equal(sends().length, 1); assert.ok(sends()[0].params.message.endsWith("\n" + args().message));
    assert.equal(sends()[0].params.message.includes("replacement"), false);
    assert.equal(sends()[0].params.inputProvenance.sourceSessionKey, requesterKey);
    assert.equal(broker.resolve(approval.id, "allow-once"), false);
    await new Promise(r => setTimeout(r, 30));
    assert.deepEqual(calls.map(call => call.method), ["sessions.resolve", "agent", "agent.wait"]);
    const denied = tool.execute("follow-up", args()).catch(() => {});
    const denial = await pending(); assert.notEqual(denial.id, approval.id);
    broker.resolve(denial.id, "deny"); await denied; assert.equal(sends().length, 1);
    const abort = new AbortController();
    const cancelled = tool.execute("cancel", args(), abort.signal).catch(() => {});
    const cancelledId = (await pending()).id; abort.abort(); await cancelled;
    assert.equal(broker.resolve(cancelledId, "allow-once"), false); assert.equal(sends().length, 1);
    const spoof = wrap(raw, { ...ctx, agentId: "other" }, { emitDiagnostics: false });
    await spoof.execute("spoof", args()).catch(() => {});
    assert.equal(sends().length, 1); assert.equal(broker.listPending().length, 0);
    for (const value of ["timeout", "error"]) {
      outcome = value;
      const before = calls.length;
      const reply = await approve(tool.execute(value, args()));
      assert.equal(reply.details?.status, value === "timeout" ? "accepted" : "error", JSON.stringify(reply));
      assert.equal(reply.details?.reply, undefined);
      await new Promise(r => setTimeout(r, 30));
      assert.deepEqual(calls.slice(before).map(call => call.method), ["sessions.resolve", "agent", "agent.wait"]);
    }
    outcome = "ok";
    const firstConcurrent = tool.execute("concurrent-first", { ...args(), message: "first concurrent question" });
    const firstApproval = await pending();
    const secondConcurrent = tool.execute("concurrent-second", { ...args(), message: "second concurrent question" });
    for (let i = 0; i < 100 && broker.listPending().length !== 2; i++) await new Promise(r => setTimeout(r, 10));
    const secondApproval = broker.listPending().find(item => item.id !== firstApproval.id);
    assert.ok(secondApproval);
    assert.ok(firstApproval.request.description.includes("first concurrent question"));
    assert.ok(secondApproval.request.description.includes("second concurrent question"));
    broker.resolve(secondApproval.id, "allow-once");
    assert.equal((await secondConcurrent).details.reply, "Second answer.");
    assert.equal(broker.listPending().length, 1);
    broker.resolve(firstApproval.id, "allow-once");
    assert.equal((await firstConcurrent).details.reply, "First answer.");
    for (const entry of [
      { sessionId: "replacement-session", updatedAt: 2 },
      { sessionId: "main-session", updatedAt: 2, archivedAt: 2 },
    ]) {
      const before = sends().length;
      afterGrant = () => upsert(scope(targetKey), entry);
      const changed = await approve(tool.execute("changed-target", args()));
      assert.match(changed.error ?? JSON.stringify(changed), /changed after access was granted/);
      assert.equal(sends().length, before);
      await replace(scope(targetKey), { sessionId: "main-session", updatedAt: 3 });
    }
    const disabled = tool.execute("disabled-pending", args());
    const disabledApproval = await pending();
    cfg.plugins.entries["approved-session-send"].enabled = false;
    setConfig(cfg);
    broker.resolve(disabledApproval.id, "allow-once");
    assert.equal((await disabled).details.status, "forbidden");
    cfg.plugins.entries["approved-session-send"].enabled = true;
    setConfig(cfg);
    const stopped = tool.execute("runtime-stop", args()).catch(() => {});
    const stoppedId = (await pending()).id; broker.stop(new Error("Fixture stopped")); await stopped;
    assert.equal(broker.resolve(stoppedId, "allow-once"), false);
    const before = sends().length;
    await cleanup();
    const fallback = await raw.execute("absent-provider", args());
    assert.equal(fallback.details.status, "forbidden", JSON.stringify(fallback));
    assert.equal(sends().length, before);
    console.log(JSON.stringify({ status: "passed", recordedQuestions: sends().length, externalWrites: 0,
      checks: ["native-approval-wrapper", "native-scoped-sdk", "native-send-executor", "native-session-store", "final-argument-snapshot", "fresh-followup-approval", "deny", "abort", "caller-spoof-denied", "terminal-reply", "no-background-delivery", "timeout", "target-error", "concurrent-approvals-and-replies", "target-replacement-and-archive", "config-disabled-while-pending", "runtime-stop", "unscoped-fallback-denied"] }));
  } finally { await cleanup(); broker.stop(); setBroker(null); setMode(false); reset(); }
  });
}
