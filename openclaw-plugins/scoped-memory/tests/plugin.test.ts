import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const host = vi.hoisted(() => ({ get: vi.fn(), settings: vi.fn(), workspace: vi.fn() }));
vi.mock("openclaw/plugin-sdk/memory-host-search", () => ({ getActiveMemorySearchManager: host.get }));
vi.mock("openclaw/plugin-sdk/memory-core-host-engine-foundation", () => ({
  resolveMemorySearchConfig: host.settings, resolveAgentWorkspaceDir: host.workspace,
}));
import plugin from "../src/plugin.js";

const roots: string[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  host.settings.mockImplementation((cfg, id) => {
    const agent = cfg.agents.list.find((entry: any) => entry.id === id);
    return (agent?.memory?.search?.enabled ?? cfg.memory?.search?.enabled ?? true) ? { enabled: true } : null;
  });
  host.workspace.mockImplementation((cfg, id) => cfg.agents.list.find((entry: any) => entry.id === id)?.workspace);
});
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(config: any = { allowedAgents: ["reader"] }) {
  const root = join(realpathSync(process.cwd()), `.scoped-memory-${randomUUID()}`);
  const workspace = join(root, "reader");
  const other = join(root, "other");
  mkdirSync(join(workspace, "memory"), { recursive: true });
  mkdirSync(other);
  roots.push(root);
  writeFileSync(join(workspace, "MEMORY.md"), "own first\nown second\nown third");
  writeFileSync(join(workspace, "USER.md"), "own profile");
  writeFileSync(join(workspace, "memory/note.md"), "own nested note");
  writeFileSync(join(other, "MEMORY.md"), "OTHER_AGENT_SECRET");
  const cfg: any = { agents: { list: [{ id: "reader", workspace }, { id: "other", workspace: other }] }, memory: { search: {} } };
  const context: any = { agentId: "reader", sessionKey: "agent:reader:test", workspaceDir: workspace, config: cfg };
  const manager = {
    status: vi.fn(() => ({ backend: "builtin", workspaceDir: workspace, custom: { secret: "STATUS_SECRET" } })),
    search: vi.fn(async () => [{ source: "memory", path: "MEMORY.md", startLine: 1, endLine: 2, score: 0.9, snippet: "STALE_INDEX_SECRET", citation: "EXTERNAL_CITATION_SECRET" }]),
    readFile: vi.fn(async ({ relPath, from, lines }: any) => {
      const selected = readFileSync(join(workspace, relPath), "utf8").split("\n").slice(from - 1, from - 1 + lines);
      return { status: "ok", path: relPath, from, lines: selected.length, text: selected.join("\n"), custom: "READ_METADATA_SECRET" };
    }),
  };
  host.get.mockResolvedValue({ manager });
  let factory: any;
  const api: any = { config: cfg, pluginConfig: config, registerTool: vi.fn((value) => { factory = value; }) };
  plugin.register(api);
  const tools = () => factory(context);
  const execute = (name: string, args: any) => tools().find((tool: any) => tool.name === name)!.execute("call", args);
  return { root, workspace, other, cfg, context, manager, api, tools, execute };
}

describe("scoped memory authority", () => {
  it.each([{}, { allowedAgents: [] }, { allowedAgents: ["other"] }])("has no tools without explicit matching configuration %j", (config) => {
    const f = fixture(config);
    expect(f.tools()).toEqual([]);
    expect(host.get).not.toHaveBeenCalled();
  });

  it.each(["agentId", "sessionKey", "workspaceDir"])("requires trusted %s", (field) => {
    const f = fixture();
    delete f.context[field];
    expect(f.tools()).toEqual([]);
  });

  it("does not derive identity from session text, request bindings, or default agent", () => {
    const f = fixture();
    f.context.agentId = "other";
    f.context.toolBindings = { agentId: "reader" };
    expect(f.tools()).toEqual([]);
    f.context.agentId = "reader";
    f.context.workspaceDir = f.other;
    expect(f.tools()).toEqual([]);
  });

  it("honors effective memory disablement and rechecks long-lived tools", async () => {
    const f = fixture();
    const tool = f.tools()[0];
    f.cfg.memory.search.enabled = false;
    expect(f.tools()).toEqual([]);
    await expect(tool.execute("call", { query: "own" })).rejects.toThrow("disabled");
    expect(host.get).not.toHaveBeenCalled();
    f.cfg.agents.list[0].memory = { search: { enabled: true } };
    expect(f.tools()).toHaveLength(2);
    f.cfg.agents.list[0].memory.search.enabled = false;
    expect(f.tools()).toEqual([]);
  });

  it("captures identity before hooks can rewrite caller-owned parameters", async () => {
    const f = fixture();
    const tool = f.tools()[0];
    f.context.agentId = "other";
    f.context.sessionKey = "agent:other:test";
    await tool.execute("call", { query: "own" });
    expect(host.get).toHaveBeenCalledWith({ cfg: f.cfg, agentId: "reader" });
    expect(f.manager.search).toHaveBeenCalledWith("own", expect.objectContaining({ sources: ["memory"], sessionKey: "agent:reader:test" }));
  });

  it.each(["corpus", "agentId", "agent_id", "sources", "source", "root", "workspaceDir", "relPath", "sessionKey", "onPartialResults", "onDebug"])("rejects final hook-injected %s in both tools", async (key) => {
    const f = fixture();
    await expect(f.execute("scoped_memory_search", { query: "own", [key]: "all" })).rejects.toThrow("parameter");
    await expect(f.execute("scoped_memory_get", { path: "MEMORY.md", [key]: "all" })).rejects.toThrow("parameter");
    expect(host.get).not.toHaveBeenCalled();
  });

  it("rejects aliased, accessor and inherited parameter objects without invoking their accessors", async () => {
    const f = fixture();
    const getter = vi.fn(() => "all");
    await expect(f.execute("scoped_memory_search", Object.defineProperty({ query: "own" }, "corpus", { get: getter }))).rejects.toThrow();
    expect(getter).not.toHaveBeenCalled();
    await expect(f.execute("scoped_memory_search", Object.assign(Object.create({ corpus: "all" }), { query: "own" }))).rejects.toThrow();
  });

  it.each([{ maxResults: 11 }, { maxResults: 0 }, { minScore: NaN }, { minScore: 2 }, { query: "" }, { query: "x".repeat(2001) }])("bounds search input %j", async (args) => {
    const f = fixture();
    await expect(f.execute("scoped_memory_search", { query: "own", ...args })).rejects.toThrow();
    expect(host.get).not.toHaveBeenCalled();
  });

  it("returns reread own excerpts and reconstructed citations, without raw metadata", async () => {
    const f = fixture();
    const result = await f.execute("scoped_memory_search", { query: "own", maxResults: 2, minScore: 0.2 });
    expect(result.details).toEqual({ results: [{ path: "MEMORY.md", startLine: 1, endLine: 2,
      snippet: "own first\nown second", source: "memory", citation: "MEMORY.md#L1-L2" }] });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(f.manager.search.mock.calls[0][1]).toEqual({ sources: ["memory"], sessionKey: "agent:reader:test", maxResults: 2, minScore: 0.2, signal: undefined });
    const read = await f.execute("scoped_memory_get", { path: "MEMORY.md", from: 2, lines: 1 });
    expect(read.details).toEqual({ path: "MEMORY.md", from: 2, lines: 1, text: "own second", citation: "MEMORY.md#L2" });
    expect((await f.execute("scoped_memory_get", { path: "USER.md" })).details.text).toBe("own profile");
    expect((await f.execute("scoped_memory_get", { path: "memory/note.md" })).details.text).toBe("own nested note");
  });

  it("filters sessions, wiki and external extraPaths even when globally indexed", async () => {
    const f = fixture();
    f.cfg.memory.search.extraPaths = [f.other];
    f.manager.search.mockResolvedValue([
      { path: "../other/MEMORY.md", source: "memory", snippet: "OTHER_AGENT_SECRET" },
      { path: "wiki/page.md", source: "memory", snippet: "WIKI_SECRET" },
      { path: "MEMORY.md", source: "sessions", snippet: "SESSION_SECRET" },
      { path: join(f.other, "MEMORY.md"), source: "memory", snippet: "ABSOLUTE_SECRET" },
    ] as any);
    expect((await f.execute("scoped_memory_search", { query: "own" })).details).toEqual({ results: [] });
    expect(f.manager.readFile).not.toHaveBeenCalled();
  });

  it("does not count manager continuation metadata as source lines", async () => {
    const f = fixture();
    f.manager.readFile.mockResolvedValue({ status: "ok", path: "MEMORY.md", from: 1, lines: 1,
      text: "own first\n\n[More content available. METADATA_SECRET]", truncated: true } as any);
    expect((await f.execute("scoped_memory_get", { path: "MEMORY.md", lines: 100 })).details)
      .toEqual({ path: "MEMORY.md", from: 1, lines: 1, text: "own first", citation: "MEMORY.md#L1" });
  });

  it("preserves the source line count for a blank line", async () => {
    const f = fixture();
    f.manager.readFile.mockResolvedValue({ status: "ok", path: "MEMORY.md", from: 1, lines: 1, text: "" } as any);
    expect((await f.execute("scoped_memory_get", { path: "MEMORY.md" })).details.lines).toBe(1);
  });

  it.each(["../other/MEMORY.md", "/etc/passwd", "memory/../USER.md", "memory//note.md", "./MEMORY.md", "memory\\note.md",
    "AGENTS.md", "DREAMS.md", "memory/data.json", "memory/.hidden.md", "memory/note.md\u0000"])("rejects path %s before reading", async (path) => {
    const f = fixture();
    await expect(f.execute("scoped_memory_get", { path })).rejects.toThrow("Path");
    expect(f.manager.readFile).not.toHaveBeenCalled();
  });

  it.each(["file", "parent", "hardlink"])("rejects %s escapes before manager reads", async (kind) => {
    const f = fixture();
    let path = "memory/escape.md";
    if (kind === "file") symlinkSync(join(f.other, "MEMORY.md"), join(f.workspace, path));
    if (kind === "hardlink") linkSync(join(f.other, "MEMORY.md"), join(f.workspace, path));
    if (kind === "parent") {
      symlinkSync(f.other, join(f.workspace, "memory/linked"));
      path = "memory/linked/MEMORY.md";
    }
    await expect(f.execute("scoped_memory_get", { path })).rejects.toThrow();
    expect(f.manager.readFile).not.toHaveBeenCalled();
  });

  it("rejects a file changed during the asynchronous manager read", async () => {
    const f = fixture();
    f.manager.readFile.mockImplementation(async ({ relPath }: any) => {
      rmSync(join(f.workspace, relPath));
      symlinkSync(join(f.other, "MEMORY.md"), join(f.workspace, relPath));
      return { status: "ok", path: relPath, text: "OTHER_AGENT_SECRET", from: 1 };
    });
    await expect(f.execute("scoped_memory_get", { path: "MEMORY.md" })).rejects.toThrow();
  });

  it.each(["lookup", "status", "search", "read"])("surfaces explicit %s failure without backend secrets or partial data", async (stage) => {
    const f = fixture();
    if (stage === "lookup") host.get.mockResolvedValue({ manager: null, error: "PRIVATE_LOOKUP_SECRET" });
    if (stage === "status") f.manager.status.mockImplementation(() => { throw new Error("PRIVATE_STATUS_SECRET"); });
    if (stage === "search") f.manager.search.mockImplementation(async () => { throw new Error("PRIVATE_SEARCH_SECRET"); });
    if (stage === "read") f.manager.readFile.mockImplementation(async () => { throw new Error("PRIVATE_READ_SECRET"); });
    const error = await f.execute("scoped_memory_search", { query: "own" }).catch((error: Error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("SECRET");
    expect(error.cause).toBeUndefined();
  });

  it("rejects wrong manager ownership and response paths before returning content", async () => {
    const f = fixture();
    f.manager.status.mockReturnValue({ backend: "builtin", workspaceDir: f.other } as any);
    await expect(f.execute("scoped_memory_get", { path: "MEMORY.md" })).rejects.toThrow("workspace");
    expect(f.manager.readFile).not.toHaveBeenCalled();
    f.manager.status.mockReturnValue({ backend: "builtin", workspaceDir: f.workspace } as any);
    f.manager.readFile.mockResolvedValue({ status: "ok", path: "../other/MEMORY.md", text: "OTHER_AGENT_SECRET", from: 1 } as any);
    await expect(f.execute("scoped_memory_get", { path: "MEMORY.md" })).rejects.toThrow("invalid scoped excerpt");
  });
});
