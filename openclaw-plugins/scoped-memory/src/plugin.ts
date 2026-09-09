import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { AnyAgentTool, OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/core";
import { resolveAgentWorkspaceDir, resolveMemorySearchConfig } from "openclaw/plugin-sdk/memory-core-host-engine-foundation";
import { getActiveMemorySearchManager, type ScopedMemoryManager } from "openclaw/plugin-sdk/memory-host-search";

const MAX_QUERY = 2_000;
const MAX_RESULTS = 10;
const MAX_LINES = 100;
const MAX_CHARS = 12_000;
const names = ["scoped_memory_search", "scoped_memory_get"];

class ScopedMemoryError extends Error {}

function fail(message: string): never { throw new ScopedMemoryError(message); }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("Expected a plain parameter object");
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Reflect.ownKeys(value).some((key) => typeof key !== "string" || !allowed.includes(key)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some((entry) => !("value" in entry))) {
    fail("Unknown or unsupported scoped memory parameter");
  }
}

function integer(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum) fail("Invalid scoped memory line or result limit");
  return value;
}

function allowedPath(path: unknown): path is string {
  if (typeof path !== "string" || path.length > 1_024 || path.includes("\\") || /[\x00-\x1f\x7f]/.test(path) ||
      path !== path.trim() || isAbsolute(path) || path.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith("."))) return false;
  return path === "MEMORY.md" || path === "USER.md" || (path.startsWith("memory/") && path.endsWith(".md"));
}

function fileIdentity(workspace: string, path: string) {
  if (!allowedPath(path)) fail("Path is outside scoped Markdown memory");
  let current = workspace;
  for (const part of path.split("/")) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || realpathSync(current) !== current) fail("Scoped memory does not follow symbolic links");
  }
  const stat = lstatSync(current);
  if (!stat.isFile() || stat.nlink !== 1) fail("Scoped memory requires a single-link regular file");
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
}

async function excerpt(manager: ScopedMemoryManager, workspace: string, path: string, from: number, lines: number) {
  const identity = fileIdentity(workspace, path);
  const result = await manager.readFile({ relPath: path, from, lines });
  if (fileIdentity(workspace, path) !== identity) fail("Scoped memory file changed during read");
  if (result.status !== "ok" || result.path !== path || typeof result.text !== "string" ||
      result.from !== from || !Number.isSafeInteger(result.lines) ||
      result.lines! < 0 || result.lines! > lines) {
    fail("Memory manager returned an invalid scoped excerpt");
  }
  // Reconstruct the public result. Backend diagnostics and indexed metadata are not an output contract.
  const text = result.text.split("\n").slice(0, result.lines).join("\n").slice(0, MAX_CHARS);
  const count = result.lines === 0 ? 0 : text.split("\n").length;
  return { path, text, from, lines: count, citation: `${path}#L${from}${count > 1 ? `-L${from + count - 1}` : ""}` };
}

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value };
}

function configuration(api: OpenClawPluginApi, ctx: OpenClawPluginToolContext) {
  return ctx.getRuntimeConfig ? ctx.getRuntimeConfig() : ctx.runtimeConfig ?? ctx.config ?? api.config;
}

function factory(api: OpenClawPluginApi, allowed: ReadonlySet<string>, ctx: OpenClawPluginToolContext): AnyAgentTool[] {
  const agentId = ctx.agentId;
  const sessionKey = ctx.sessionKey;
  if (!agentId || !allowed.has(agentId) || typeof sessionKey !== "string" || !sessionKey ||
      !ctx.workspaceDir || !isAbsolute(ctx.workspaceDir)) return [];
  const cfg = configuration(api, ctx);
  if (!cfg || !resolveMemorySearchConfig(cfg, agentId)) return [];
  const workspace = realpathSync(resolveAgentWorkspaceDir(cfg, agentId));
  if (realpathSync(ctx.workspaceDir) !== workspace || !lstatSync(workspace).isDirectory()) return [];

  async function run(action: (manager: ScopedMemoryManager) => Promise<unknown>) {
    try {
      const current = configuration(api, ctx);
      if (!current || !resolveMemorySearchConfig(current, agentId!) ||
          realpathSync(resolveAgentWorkspaceDir(current, agentId!)) !== workspace) fail("Scoped memory is disabled or its workspace changed");
      const { manager } = await getActiveMemorySearchManager({ cfg: current, agentId: agentId! });
      if (!manager) fail("Scoped memory manager is unavailable");
      const status = manager.status();
      if (status.backend !== "builtin" || !status.workspaceDir || realpathSync(status.workspaceDir) !== workspace) fail("Memory manager workspace does not match the caller");
      const value = await action(manager);
      const final = configuration(api, ctx);
      if (!final || !resolveMemorySearchConfig(final, agentId!) ||
          realpathSync(resolveAgentWorkspaceDir(final, agentId!)) !== workspace) fail("Scoped memory authorization changed during execution");
      return result(value);
    } catch (error) {
      if (error instanceof ScopedMemoryError) throw error;
      // Manager errors can contain snippets, paths or provider payloads from excluded roots.
      throw new ScopedMemoryError("Scoped memory operation failed");
    }
  }

  return [
    {
      name: names[0], label: "Scoped memory search",
      description: "Search only this agent's own MEMORY.md, USER.md and Markdown files under memory/.",
      parameters: { type: "object", required: ["query"], additionalProperties: false, properties: {
        query: { type: "string", minLength: 1, maxLength: MAX_QUERY },
        maxResults: { type: "integer", minimum: 1, maximum: MAX_RESULTS },
        minScore: { type: "number", minimum: 0, maximum: 1 },
      } } as AnyAgentTool["parameters"],
      async execute(_id, input, signal) {
        const args = record(input);
        keys(args, ["query", "maxResults", "minScore"]);
        if (typeof args.query !== "string" || !args.query.trim() || args.query.length > MAX_QUERY) fail("Invalid scoped memory query");
        const query = args.query;
        const maxResults = integer(args.maxResults, 6, MAX_RESULTS);
        const minScore = args.minScore;
        if (minScore !== undefined && (typeof minScore !== "number" || !Number.isFinite(minScore) || minScore < 0 || minScore > 1)) fail("Invalid scoped memory score");
        return run(async (manager) => {
          const hits = await manager.search(query, { maxResults, ...(minScore === undefined ? {} : { minScore: minScore as number }),
            sources: ["memory"], sessionKey, signal });
          if (!Array.isArray(hits)) fail("Memory manager returned invalid search results");
          const results = [];
          for (const hit of hits.slice(0, maxResults)) {
            if (hit.source !== "memory" || !allowedPath(hit.path)) continue;
            if (!Number.isSafeInteger(hit.startLine) || hit.startLine < 1 || !Number.isSafeInteger(hit.endLine) || hit.endLine < hit.startLine) fail("Memory manager returned invalid line ranges");
            const value = await excerpt(manager, workspace, hit.path, hit.startLine, Math.min(MAX_LINES, hit.endLine - hit.startLine + 1));
            results.push({ path: value.path, startLine: value.from, endLine: value.from + Math.max(0, value.lines - 1),
              snippet: value.text, source: "memory", citation: value.citation });
          }
          return { results };
        });
      },
    },
    {
      name: names[1], label: "Scoped memory read",
      description: "Read a bounded excerpt from this agent's own Markdown memory. No other workspace files are accessible.",
      parameters: { type: "object", required: ["path"], additionalProperties: false, properties: {
        path: { type: "string", maxLength: 1_024 },
        from: { type: "integer", minimum: 1 }, lines: { type: "integer", minimum: 1, maximum: MAX_LINES },
      } } as AnyAgentTool["parameters"],
      async execute(_id, input) {
        const args = record(input);
        keys(args, ["path", "from", "lines"]);
        if (!allowedPath(args.path)) fail("Path is outside scoped Markdown memory");
        const path = args.path;
        const from = integer(args.from, 1, Number.MAX_SAFE_INTEGER);
        const lines = integer(args.lines, 40, MAX_LINES);
        return run((manager) => excerpt(manager, workspace, path, from, lines));
      },
    },
  ];
}

export default {
  id: "scoped-memory",
  name: "Scoped Memory",
  register(api: OpenClawPluginApi) {
    const config = record(api.pluginConfig ?? {});
    keys(config, ["allowedAgents"]);
    const agents = config.allowedAgents ?? [];
    if (!Array.isArray(agents) || agents.some((id) => typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(id))) fail("Invalid scoped memory allowedAgents");
    const allowed = new Set<string>(agents);
    api.registerTool((ctx) => {
      try { return factory(api, allowed, ctx); }
      catch { throw new ScopedMemoryError("Scoped memory tool configuration is unavailable"); }
    }, { names, optional: true });
  },
};
