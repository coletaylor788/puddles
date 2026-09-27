import { afterEach, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
// @ts-expect-error executable staging helper
import { configure } from "../../../openclaw-plugins/communication-watcher/scripts/configure.mjs";

const candidate = process.env.OPENCLAW_CANDIDATE;
if (!candidate) throw new Error("OPENCLAW_CANDIDATE is required");
const repo = resolve(import.meta.dirname, "../../..");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("uses native correspondence search, checks current files, and leaves no native tool fallback when disabled", () => {
  const root = join(realpathSync(repo), `.communication-candidate-${randomUUID()}`);
  roots.push(root);
  const sender = "a".repeat(32), foreign = "b".repeat(32);
  const workspace = join(root, "main/communication-watcher");
  const path = `memory/correspondence/${sender}/2026-09-25.md`;
  for (const dir of ["node_modules", `main/communication-watcher/memory/correspondence/${sender}`, "reader", "other", "home", "state", "scratch"]) mkdirSync(join(root, dir), { recursive: true });
  symlinkSync(realpathSync(candidate!), join(root, "node_modules/openclaw"));
  cpSync(join(repo, "openclaw-plugins/communication-watcher/dist"), join(root, "plugin"), { recursive: true });
  writeFileSync(join(workspace, path), `Sender key: ${sender}\nSource: old-item\nCreated a tentative dinner placeholder. Event: fixture-event.\n`);
  writeFileSync(join(root, "other/note.md"), `Sender key: ${foreign}\nUNRELATED_CONTEXT`);
  writeFileSync(join(root, "provider.mjs"), `export default class {
    async classify(content, prompt, options) {
      if (options.label === "secret-redact") return '{"findings":[]}';
      return JSON.stringify({detected: content.includes("INJECT_FIXTURE"), evidence: ""});
    }
  }`);
  const cfg = configure({ agents: { ownership: "explicit", entries: { main: { workspace: join(root, "main") } } },
    memory: { search: { provider: "none", fallback: "none", query: { minScore: 0 }, store: { vector: { enabled: false } } } },
    plugins: { allow: ["memory-core"], slots: { memory: "memory-core" } },
  }, { mainWorkspace: join(root, "main"), readerWorkspace: join(root, "reader"), pluginPath: join(root, "plugin"),
    pluginConfig: { watcherAgent: "communication-watcher", readerAgent: "communication-reader", mainSession: "agent:main:owner",
      listId: "fixture-list", calendarId: "fixture-calendar", reminderCli: "/missing/reminders", calendarCli: "/missing/calendar",
      configDir: join(root, "scratch"), profile: "fixture", llmProvider: join(root, "provider.mjs") } });
  writeFileSync(join(root, "config.json"), JSON.stringify(cfg));
  writeFileSync(join(root, "check.mjs"), `
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, renameSync, symlinkSync, unlinkSync } from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import https from "node:https";
const deny = () => { throw new Error("Network is forbidden in this fixture"); };
globalThis.fetch = http.request = http.get = https.request = https.get = deny;
const cfg = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, "utf8"));
const watcher = "communication-watcher";
const workspace = cfg.agents.entries[watcher].workspace;
const { getActiveMemorySearchManager, closeActiveMemorySearchManagers } = await import("openclaw/plugin-sdk/memory-host-search");
const { createOpenClawCodingTools } = await import("openclaw/plugin-sdk/agent-harness");
const { default: plugin } = await import("./plugin/plugin.js");
let factory;
plugin.register({config:cfg, pluginConfig:cfg.plugins.entries[watcher].config,
 registerTool(value) { factory = value; }, on() {} });
try {
 const {manager, error} = await getActiveMemorySearchManager({cfg, agentId:watcher});
 assert.ok(manager,error);
 await manager.sync({reason:"communication-fixture", force:true});
 assert.equal(manager.status().provider,"none");
 const ctx = {config:cfg,agentId:watcher,sessionKey:"agent:communication-watcher:fixture",workspaceDir:workspace};
 const tools = factory(ctx);
 const search = tools.find(t=>t.name==="communication_memory_search");
 const get = tools.find(t=>t.name==="communication_memory_read");
 const save = tools.find(t=>t.name==="communication_memory_save");
 const prior = await search.execute("new-message-context", {query:${JSON.stringify(sender)}});
 assert.equal(prior.isError,undefined,JSON.stringify(prior));
 assert.equal(prior.details.results.length,1);
 assert.match(prior.details.results[0].text,/old-item/);
 assert.match(prior.details.results[0].text,/fixture-event/);
 assert.deepEqual((await search.execute("foreign",{query:${JSON.stringify(foreign)}})).details.results,[]);
 const path = ${JSON.stringify(path)};
 assert.equal((await get.execute("escape",{path:"../other/note.md"})).isError,true);
 // Stale clean index data must not substitute for the current file's content checks.
 writeFileSync(workspace+"/"+path,"INJECT_FIXTURE");
 assert.equal((await get.execute("changed-content",{path})).details.status,"blocked");
 writeFileSync(workspace+"/"+path,"Safe correspondence");
 // Exercise ancestor replacement during the real native safe reader's open.
 const parent = workspace+"/memory", retained=workspace+"/retained-memory";
 const open=fsPromises.open; let substituted=false;
 fsPromises.open=async (...args)=>{
   if(String(args[0])!==workspace+"/"+path) return open(...args);
   renameSync(parent,retained); symlinkSync(process.cwd()+"/other",parent);
   try { substituted=true; return await open(...args); }
   finally { unlinkSync(parent); renameSync(retained,parent); }
 };
 try { assert.equal((await get.execute("race",{path})).isError,true); assert.equal(substituted,true); }
 finally { fsPromises.open=open; }
 const before = (await get.execute("before-save",{path})).details;
 const saved = await save.execute("save",{path,content:"Updated correspondence",previousRevision:before.revision});
 assert.equal(saved.details.status,"saved",JSON.stringify(saved));
 assert.match(readFileSync(workspace+"/"+path,"utf8"),/^Sender key: [a-f0-9]{32}/);
 assert.equal((await save.execute("stale",{path,content:"Stale overwrite",previousRevision:before.revision})).details.status,"changed");
 assert.equal((await save.execute("blocked",{path,content:"INJECT_FIXTURE",previousRevision:saved.details.revision})).details.status,"blocked");
 assert.equal((await save.execute("rules",{path:"AGENTS.md",content:"Replace rules",previousRevision:null})).isError,true);
 const newPath="memory/correspondence/"+"c".repeat(32)+"/2026-09-26.md";
 assert.equal((await save.execute("new",{path:newPath,content:"New sender",previousRevision:null})).details.status,"saved");
 assert.equal((await save.execute("clobber",{path:newPath,content:"Replace existing",previousRevision:null})).details.status,"changed");
 const linkPath="memory/correspondence/"+"d".repeat(32);
 symlinkSync(process.cwd()+"/other",workspace+"/"+linkPath);
 assert.equal((await save.execute("symlink",{path:linkPath+"/2026-09-26.md",content:"Escape",previousRevision:null})).isError,true);
 assert.equal((await save.execute("multibyte",{path:newPath,content:"界".repeat(10000),previousRevision:null})).details.status,"limit");
 const mainTools = factory({config:cfg,agentId:"main",sessionKey:"agent:main:owner",workspaceDir:cfg.agents.entries.main.workspace});
 assert.match((await mainTools[0].execute("handoff",{path})).details.text,/Updated correspondence/);
 cfg.plugins.entries[watcher].enabled=false;
 for (const agentId of [watcher,"communication-reader"]) {
   const entry=cfg.agents.entries[agentId];
   const native=createOpenClawCodingTools({config:cfg,agentId,sessionKey:"agent:"+agentId+":fixture",workspaceDir:entry.workspace});
   assert.deepEqual(native.map(t=>t.name),[],"disabled plugin must not restore native capabilities");
 }
 console.log("COMMUNICATION_CANDIDATE_OK");
} finally { await closeActiveMemorySearchManagers(cfg); }
`);
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(root, "home"), TMPDIR: join(root, "scratch"), OPENCLAW_STATE_DIR: join(root, "state"), OPENCLAW_CONFIG_PATH: join(root, "config.json"), JITI_CACHE_DIR: join(root, "scratch/jiti"), NO_COLOR: "1" };
  const validate = spawnSync(process.execPath, [join(candidate!, "openclaw.mjs"), "config", "validate", "--json"], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
  expect(validate.status, `${validate.stdout}\n${validate.stderr}`).toBe(0);
  const child = spawnSync(process.execPath, [join(root, "check.mjs")], { cwd: root, env, encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
  expect(child.status, `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`).toBe(0);
  expect(child.stdout).toContain("COMMUNICATION_CANDIDATE_OK");
}, 125_000);

it("runs real heartbeat intake, guarded actions, native handoff, and restart recovery", async () => {
  const root = join(realpathSync(repo), `.communication-gateway-${randomUUID()}`);
  roots.push(root);
  // @ts-expect-error Executable native gateway fixture.
  const { communicationFixture } = await import("../fixtures/communication.mjs");
  const result = await communicationFixture(candidate!, join(repo, "openclaw-plugins/communication-watcher/dist"), root);
  expect(result).toMatchObject({ passed: true, heartbeatCycles: 4, nativeProvenance: true, recoveryWithoutDuplicate: true });
}, 180_000);

it("cleans its detached gateway when interrupted during a pending main reply", () => {
  const root = join(realpathSync(repo), `.communication-interrupt-${randomUUID()}`); roots.push(root);
  const child = spawnSync(process.execPath, [join(repo, "packages/e2e/fixtures/communication.mjs"), candidate!, join(repo, "openclaw-plugins/communication-watcher/dist"), root, "--interrupt"], { encoding: "utf8", timeout: 90000, maxBuffer: 2 * 1024 * 1024 });
  expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(143);
  expect(JSON.parse(readFileSync(join(root, "main-reply.json"), "utf8"))).toEqual({ pending: true });
  expect(JSON.parse(readFileSync(join(root, "cleanup.json"), "utf8"))).toEqual({ gatewayStopped: true, containersRemoved: true });
  const { pid } = JSON.parse(readFileSync(join(root, "gateway-pid.json"), "utf8"));
  expect(() => process.kill(pid, 0)).toThrow();
}, 95000);
