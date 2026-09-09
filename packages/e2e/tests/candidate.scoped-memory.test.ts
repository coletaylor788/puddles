import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

const candidate = process.env.OPENCLAW_CANDIDATE;
if (!candidate) throw new Error("OPENCLAW_CANDIDATE is required for candidate-source tests");
const repo = resolve(import.meta.dirname, "../../..");
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("scoped tools with the actual pinned memory manager", () => {
  it("reuses builtin FTS while excluding other agents, global extra paths and expanded corpus inputs", () => {
    const root = join(realpathSync(repo), `.scoped-memory-candidate-${randomUUID()}`);
    roots.push(root);
    for (const path of ["node_modules", "reader/memory", "other", "wiki", "home", "state", "scratch"]) mkdirSync(join(root, path), { recursive: true });
    symlinkSync(realpathSync(candidate!), join(root, "node_modules/openclaw"));
    copyFileSync(join(repo, "openclaw-plugins/scoped-memory/dist/plugin.js"), join(root, "plugin.mjs"));
    writeFileSync(join(root, "reader/MEMORY.md"), "quartzreader owns a synthetic blue compass.\nThe compass is local to this agent.");
    writeFileSync(join(root, "reader/USER.md"), "The user prefers lavender.");
    writeFileSync(join(root, "reader/DREAMS.md"), "quartzdream owns a synthetic dream.");
    writeFileSync(join(root, "reader/memory/note.md"), "quartzreader keeps a second synthetic note.");
    writeFileSync(join(root, "other/MEMORY.md"), "quartzforeign OTHER_AGENT_SECRET");
    writeFileSync(join(root, "other/DREAMS.md"), "quartzforeign OTHER_DREAM_SECRET");
    writeFileSync(join(root, "wiki/page.md"), "quartzforeign GLOBAL_WIKI_SECRET");
    const config = {
      agents: { ownership: "explicit", entries: {
        reader: { workspace: join(root, "reader") },
        other: { workspace: join(root, "other") },
        disabled: { workspace: join(root, "reader"), memory: { search: { enabled: false } } },
      } },
      memory: { search: { provider: "none", fallback: "none", sources: ["memory"],
        extraPaths: [join(root, "other"), join(root, "wiki")], query: { minScore: 0 }, store: { vector: { enabled: false } } } },
      plugins: { allow: ["memory-core"], slots: { memory: "memory-core" } },
    };
    writeFileSync(join(root, "config.json"), JSON.stringify(config));
    writeFileSync(join(root, "check.mjs"), `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
const noNetwork = () => { throw new Error("Network inference is forbidden in this fixture"); };
globalThis.fetch = noNetwork;
http.request = http.get = https.request = https.get = noNetwork;
const cfg = JSON.parse(readFileSync(process.env.OPENCLAW_CONFIG_PATH, "utf8"));
const { getActiveMemorySearchManager, closeActiveMemorySearchManagers } = await import("openclaw/plugin-sdk/memory-host-search");
const { default: plugin } = await import("./plugin.mjs");
let factory;
plugin.register({ config: cfg, pluginConfig: { allowedAgents: ["reader", "disabled"] },
  registerTool(value) { factory = value; } });
const ctx = { config: cfg, agentId: "reader", sessionKey: "agent:reader:fixture", workspaceDir: cfg.agents.entries.reader.workspace };
try {
  assert.deepEqual(factory({ ...ctx, agentId: "other", workspaceDir: cfg.agents.entries.other.workspace }), []);
  assert.deepEqual(factory({ ...ctx, agentId: undefined }), []);
  assert.deepEqual(factory({ ...ctx, agentId: "disabled" }), []);
  const { manager, error } = await getActiveMemorySearchManager({ cfg, agentId: "reader" });
  assert.ok(manager, error);
  await manager.sync({ reason: "scoped-memory-fixture", force: true });
  assert.equal(manager.status().provider, "none");
  const rawForeign = await manager.search("quartzforeign", { sources: ["memory"], minScore: 0, maxResults: 10 });
  assert.ok(rawForeign.some(hit => hit.snippet.includes("SECRET")), "fixture must index excluded global roots");
  const tools = factory(ctx);
  const search = tools.find(tool => tool.name === "scoped_memory_search");
  const get = tools.find(tool => tool.name === "scoped_memory_get");
  const own = await search.execute("own", { query: "quartzreader", minScore: 0, maxResults: 10 });
  assert.ok(own.details.results.some(hit => hit.snippet.includes("blue compass")));
  assert.ok(own.details.results.every(hit => hit.source === "memory" && !hit.path.startsWith("..")));
  const foreign = await search.execute("foreign", { query: "quartzforeign", minScore: 0, maxResults: 10 });
  assert.deepEqual(foreign.details.results, []);
  const read = await get.execute("read", { path: "MEMORY.md", from: 1, lines: 1 });
  assert.equal(read.details.text, "quartzreader owns a synthetic blue compass.");
  assert.equal(read.details.citation, "MEMORY.md#L1");
  const dream = await get.execute("dream", { path: "DREAMS.md", lines: 1 });
  assert.equal(dream.details.text, "quartzdream owns a synthetic dream.");
  assert.deepEqual((await search.execute("dream-search", { query: "quartzdream", minScore: 0 })).details.results, []);
  for (const corpus of ["wiki", "all"]) {
    await assert.rejects(search.execute("rewrite", { query: "quartzforeign", corpus }));
    await assert.rejects(get.execute("rewrite", { path: "MEMORY.md", corpus }));
  }
  for (const path of ["../other/MEMORY.md", "../other/DREAMS.md", cfg.agents.entries.other.workspace + "/DREAMS.md",
    cfg.agents.entries.other.workspace + "/MEMORY.md", "AGENTS.md", "wiki/page.md"]) {
    await assert.rejects(get.execute("escape", { path }));
  }
  assert.equal(JSON.stringify([own, foreign, read]).includes("SECRET"), false);
  console.log("SCOPED_MEMORY_CANDIDATE_OK");
} finally {
  await closeActiveMemorySearchManagers(cfg);
}
`);
    const child = spawnSync(process.execPath, [join(root, "check.mjs")], {
      cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(root, "home"),
        TMPDIR: join(root, "scratch"), OPENCLAW_STATE_DIR: join(root, "state"),
        OPENCLAW_CONFIG_PATH: join(root, "config.json"), JITI_CACHE_DIR: join(root, "scratch/jiti"),
        NO_COLOR: "1",
      },
    });
    expect(child.error?.message ?? child.stderr, child.stdout).not.toContain("Network inference is forbidden");
    expect(child.status, `${child.error?.message ?? ""}\n${child.stdout}\n${child.stderr}`).toBe(0);
    expect(child.stdout).toContain("SCOPED_MEMORY_CANDIDATE_OK");
  }, 65_000);
});
