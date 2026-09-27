import { lstatSync, realpathSync, type Stats } from "node:fs";
import { join, isAbsolute } from "node:path";
import { root } from "openclaw/plugin-sdk/file-access-runtime";
import { getActiveMemorySearchManager } from "openclaw/plugin-sdk/memory-host-search";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { BoundaryError, string, type Guard } from "./guards.js";

export function notePath(value: unknown): string {
  const path = string(value, 160);
  if (!/^memory\/correspondence\/[a-f0-9]{32}\/\d{4}-\d{2}-\d{2}\.md$/.test(path)) throw new BoundaryError("denied");
  return path;
}
export function safeNote(workspace: string, path: string, mayCreate = false) {
  if (!isAbsolute(workspace) || realpathSync(workspace) !== workspace) throw new BoundaryError("denied");
  let current = workspace;
  for (const part of notePath(path).split("/")) {
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1)) || realpathSync(current) !== current) throw new BoundaryError("denied");
    } catch (e) {
      if (mayCreate && (e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
  }
}
export async function readNote(workspace: string, path: string, guard: Guard) {
  safeNote(workspace, path);
  const identity = (stat: Stats) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const before = lstatSync(join(workspace, path));
  if (before.size > 16000) throw new BoundaryError("limit");
  const opened = await (await root(workspace, { symlinks: "reject", hardlinks: "reject" })).read(path);
  safeNote(workspace, path);
  if (identity(before) !== identity(opened.stat) || identity(before) !== identity(lstatSync(join(workspace, path)))) throw new BoundaryError("changed");
  if (opened.buffer.length > 16000) throw new BoundaryError("limit");
  return { path, text: await guard(opened.buffer.toString("utf8")), untrusted: true };
}
export async function searchNotes(config: OpenClawConfig, watcher: string, workspace: string, session: string, query: string, guard: Guard) {
  const { manager } = await getActiveMemorySearchManager({ cfg: config, agentId: watcher });
  if (!manager || manager.status().backend !== "builtin" || manager.status().workspaceDir !== workspace) throw new BoundaryError("unavailable");
  const hits = await manager.search(query, { sources: ["memory"], maxResults: 5, sessionKey: session });
  const results: Awaited<ReturnType<typeof readNote>>[] = [];
  for (const hit of hits) {
    if (hit.source !== "memory") continue;
    try { notePath(hit.path); } catch { continue; }
    // Do not return index snippets or paths outside correspondence. Reread the current file through the same guards.
    if (!results.some(v => v.path === hit.path)) results.push(await readNote(workspace, hit.path, guard));
  }
  return { results };
}
