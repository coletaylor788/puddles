import { opendir } from "node:fs/promises";
import { lstatSync, realpathSync, type Stats } from "node:fs";
import { createHash } from "node:crypto";
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
  const opened = await (await root(workspace, { symlinks: "reject", hardlinks: "reject" })).read(path, { maxBytes: 16000 });
  safeNote(workspace, path);
  if (identity(before) !== identity(opened.stat) || identity(before) !== identity(lstatSync(join(workspace, path)))) throw new BoundaryError("changed");
  if (opened.buffer.length > 16000) throw new BoundaryError("limit");
  return { path, text: await guard(opened.buffer.toString("utf8")), revision: revision(opened.buffer), untrusted: true };
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

const revision = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");
const saving = new Set<string>();
/** Guarded native Markdown writes. Ownership remains coordinated with main through the note. */
export async function saveNote(workspace: string, path: string, content: string, previous: string | null, guard: Guard, pending = true) {
  notePath(path);
  if (previous !== null && !/^[a-f0-9]{64}$/.test(previous)) throw new BoundaryError("invalid");
  safeNote(workspace, path, true);
  const key = join(workspace, path);
  if (saving.has(key)) throw new BoundaryError("limit");
  saving.add(key);
  try {
    const checked = await guard(string(content, 15800));
    const body = checked.replace(/^Sender key: [a-f0-9]{32}\n/, "").replace(/^Watcher pending: (yes|no)\n/, "");
    const saved = `Sender key: ${path.split("/")[2]}\nWatcher pending: ${pending ? "yes" : "no"}\n${body}`;
    if (Buffer.byteLength(saved, "utf8") > 16000) throw new BoundaryError("limit");
    safeNote(workspace, path, true);
    const fs = await root(workspace, { symlinks: "reject", hardlinks: "reject" });
    let current: string | null = null;
    try { current = revision((await fs.read(path, { maxBytes: 16000 })).buffer); }
    catch (e) {
      // The native API reports missing paths as ENOENT or its typed not-found error.
      if ((e as { code?: string }).code !== "ENOENT" && (e as { code?: string }).code !== "not-found") throw e;
    }
    if (current !== previous) throw new BoundaryError("changed");
    await fs.write(path, saved, { mkdir: true });
    safeNote(workspace, path);
    const verified = await fs.read(path, { maxBytes: 16000 });
    if (revision(verified.buffer) !== revision(saved)) throw new BoundaryError("changed");
    return { status: "saved", path, revision: revision(saved) };
  } finally { saving.delete(key); }
}

/** Deterministic, paginated discovery across senders; never relies on semantic top-k recall.
 * Only the pending flag is inspected before the complete selected note passes guards. */
export async function pendingNotes(workspace: string, after: string | undefined, guard: Guard) {
  if (after !== undefined) notePath(after);
  if (realpathSync(workspace) !== workspace) throw new BoundaryError("denied");
  const base = join(workspace, "memory", "correspondence");
  for (const path of [join(workspace, "memory"), base]) {
    try {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path) throw new BoundaryError("denied");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return { results: [], failures: [], next: null };
      throw e;
    }
  }
  const paths: string[] = [];
  let entries = 0;
  for await (const sender of await opendir(base)) {
    if (++entries > 10000) throw new BoundaryError("limit");
    if (!/^[a-f0-9]{32}$/.test(sender.name)) continue;
    if (!sender.isDirectory() || sender.isSymbolicLink()) throw new BoundaryError("denied");
    const senderRoot = join(base, sender.name);
    if (realpathSync(senderRoot) !== senderRoot) throw new BoundaryError("denied");
    for await (const file of await opendir(senderRoot)) {
      if (++entries > 10000) throw new BoundaryError("limit");
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) continue;
      const path = notePath(`memory/correspondence/${sender.name}/${file.name}`);
      if (after === undefined || path > after) paths.push(path);
    }
  }
  paths.sort();
  const fs = await root(workspace, { symlinks: "reject", hardlinks: "reject" });
  const results: Awaited<ReturnType<typeof readNote>>[] = [];
  const failures: { path: string; status: string }[] = [];
  let scanned = 0, bytes = 0;
  for (const path of paths) {
    try {
      safeNote(workspace, path);
      if (lstatSync(join(workspace, path)).size > 16000) throw new BoundaryError("limit");
      const raw = await fs.read(path, { maxBytes: 16000 });
      const closed = /^Sender key: [a-f0-9]{32}\nWatcher pending: no\n/.test(raw.buffer.toString("utf8"));
      if (!closed) {
        if (results.length && bytes + raw.buffer.length > 16000) return { results, failures, next: paths[scanned - 1] };
        results.push(await readNote(workspace, path, guard));
        bytes += raw.buffer.length;
      }
    } catch (error) {
      // A damaged or rejected note remains visible as a safe status, without
      // stranding later correspondence or leaking provider/error text.
      failures.push({ path, status: error instanceof BoundaryError ? error.code : "unavailable" });
    }
    scanned++;
    if (results.length + failures.length === 5 || scanned === 100) break;
  }
  return { results, failures, next: scanned < paths.length ? paths[scanned - 1] : null };
}
