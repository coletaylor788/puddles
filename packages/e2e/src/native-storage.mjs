import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, statfsSync,
} from "node:fs";
import { hostname, homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { acquireLock, atomicJson, fileDigest, inside, jsonDigest, treeDigest } from "./native-state.mjs";

const schema = "puddles.development-storage/v1";
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const recordName = "storage.json";
const retired = entry => ["removed", "superseded"].includes(entry.status);

function id(value) {
  if (!idPattern.test(value ?? "")) throw new Error("Storage owner and entry IDs must be simple names");
  return value;
}

function canonical(path) {
  if (!isAbsolute(path) || resolve(path) !== path || realpathSync(path) !== path ||
      !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) {
    throw new Error("Storage root must be a canonical directory");
  }
  return path;
}

function child(root, name) {
  if (typeof name !== "string" || !name || isAbsolute(name) ||
      name.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Storage path must be a strict relative child");
  }
  const path = resolve(root, name);
  if (path === root || !inside(root, path)) throw new Error("Storage path escapes its root");
  let current = root;
  for (const part of name.split("/")) {
    current = join(current, part);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error("Storage path has a linked ancestor or root");
    }
  }
  return path;
}

function identity(path) {
  const stat = lstatSync(path);
  return { dev: stat.dev, ino: stat.ino };
}

function sameIdentity(path, expected) {
  if (jsonDigest(identity(path)) !== jsonDigest(expected)) throw new Error("Storage path identity changed");
}

function read(root) {
  canonical(root);
  const path = child(root, recordName);
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.schema !== schema || value.root !== root || value.host !== hostname() ||
      !idPattern.test(value.owner) || !Array.isArray(value.entries) || !Array.isArray(value.holds)) {
    throw new Error("Storage ownership record is invalid or belongs to another host");
  }
  sameIdentity(root, value.identity);
  return value;
}

function mutate(root, owner, action) {
  const release = acquireLock(canonical(root));
  try {
    const record = read(root);
    if (record.owner !== owner) throw new Error("Storage owner differs");
    const result = action(record);
    atomicJson(join(root, recordName), record);
    return result ?? record;
  } finally { release(); }
}

export function initializeStorage(root, owner) {
  canonical(root);
  id(owner);
  if (existsSync(join(root, recordName))) {
    const record = read(root);
    if (record.owner !== owner) throw new Error("Storage owner differs");
    return record;
  }
  const release = acquireLock(root);
  try {
    if (existsSync(join(root, recordName))) throw new Error("Storage was initialized concurrently");
    const record = { schema, root, owner, host: hostname(), identity: identity(root), entries: [], holds: [] };
    atomicJson(join(root, recordName), record);
    return record;
  } finally { release(); }
}

// Registration is explicit adoption by the task owner, never discovery by age/name.
export function registerScratch(root, owner, { id: entryId, path, evidence = [], purpose, kind = "scratch", group = entryId }) {
  id(entryId);
  id(group);
  if (!["scratch", "failed"].includes(kind)) throw new Error("Unknown scratch retention kind");
  if (typeof purpose !== "string" || !purpose.trim() || !Array.isArray(evidence) || !evidence.length) {
    throw new Error("Scratch needs a purpose and retained evidence paths");
  }
  return mutate(root, owner, record => {
    const absolute = child(root, path);
    if (!existsSync(absolute)) throw new Error("Scratch path is missing");
    if (record.entries.some(entry => entry.id === entryId || !retired(entry) && (
        inside(child(root, entry.path), absolute) || inside(absolute, child(root, entry.path))))) {
      throw new Error("Scratch entry overlaps a registered entry");
    }
    const reserved = [recordName, "lock", "storage-evidence", "storage-trash"];
    if (reserved.some(name => inside(absolute, join(root, name)) || inside(join(root, name), absolute))) {
      throw new Error("Scratch overlaps storage metadata");
    }
    for (const name of evidence) {
      const source = child(root, name);
      if (inside(absolute, source) || inside(source, absolute)) throw new Error("Evidence must be separate from scratch");
      if (!existsSync(source)) throw new Error("Evidence path is missing");
    }
    const entry = { id: entryId, path, purpose, kind, group, evidence, identity: identity(absolute), status: "active", createdAt: new Date().toISOString() };
    record.entries.push(entry);
    return entry;
  });
}

export function storageHold(root, owner, name, enabled) {
  id(name);
  return mutate(root, owner, record => {
    record.holds = enabled ? [...new Set([...record.holds, name])] : record.holds.filter(value => value !== name);
  });
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid recorded process identity");
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}

function inspectTree(path) {
  let bytes = 0;
  function walk(current) {
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) return; // rm never follows nested links.
    if (stat.isFile()) { bytes += stat.size; return; }
    if (!stat.isDirectory()) throw new Error("Scratch contains unsupported filesystem entries");
    const names = readdirSync(current);
    if (names.includes(".git")) throw new Error("Retire source with Git or the app worktree tools, not scratch cleanup");
    if (names.includes("lock") || names.includes("recovery.json") || names.includes("backup-references")) {
      throw new Error("Scratch contains a lock or recovery state");
    }
    if (names.includes("run-status.json")) {
      const status = JSON.parse(readFileSync(join(current, "run-status.json"), "utf8"));
      if (!["passed", "failed"].includes(status.status) || status.pid && processAlive(status.pid)) {
        throw new Error("Scratch contains a running or uncertain native run");
      }
    }
    for (const name of names) walk(join(current, name));
  }
  walk(path);
  return { bytes, sha256: lstatSync(path).isDirectory() ? treeDigest(path) : fileDigest(path) };
}

function assertQuiescent(root, record) {
  if (record.holds.length) throw new Error(`Storage has active consumers: ${record.holds.join(", ")}`);
  const path = join(root, "run-status.json");
  if (existsSync(path)) {
    const status = JSON.parse(readFileSync(path, "utf8"));
    if (!["passed", "failed"].includes(status.status) || status.pid && processAlive(status.pid)) {
      throw new Error("Native producer is running or lacks terminal ownership");
    }
  }
}

function evidenceIdentity(path) {
  return lstatSync(path).isDirectory() ? treeDigest(path, { portable: true }) : fileDigest(path);
}

function preserveEvidenceModes(source, destination) {
  const stat = lstatSync(source);
  // Never chmod through a copied link. Its target is validated by the digest.
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const name of readdirSync(source)) preserveEvidenceModes(join(source, name), join(destination, name));
  }
  chmodSync(destination, stat.mode & 0o777);
}

export function sealScratch(root, owner, entryId) {
  return mutate(root, owner, record => {
    assertQuiescent(root, record);
    const entry = record.entries.find(value => value.id === entryId);
    if (!entry || entry.status !== "active") throw new Error("Scratch is not active");
    const path = child(root, entry.path);
    sameIdentity(path, entry.identity);
    const content = inspectTree(path);
    const evidenceRoot = child(root, `storage-evidence/${entry.id}-${randomUUID()}`);
    mkdirSync(evidenceRoot, { recursive: true, mode: 0o700 });
    const evidence = [];
    try {
    for (const [index, name] of entry.evidence.entries()) {
      const source = child(root, name);
      const sha256 = evidenceIdentity(source);
      const destination = join(evidenceRoot, String(index));
      cpSync(source, destination, { recursive: lstatSync(source).isDirectory(), verbatimSymlinks: true });
      preserveEvidenceModes(source, destination);
      if (evidenceIdentity(destination) !== sha256) throw new Error(`Evidence copy verification failed: ${name}`);
      evidence.push({ source: name, path: relative(root, destination), sha256 });
    }
    } catch (error) {
      rmSync(evidenceRoot, { recursive: true, force: true });
      throw error;
    }
    Object.assign(entry, { status: "sealed", sealedAt: new Date().toISOString(), content, retainedEvidence: evidence });
    return entry;
  });
}

function verifySealed(root, entry, path = child(root, entry.path)) {
  sameIdentity(path, entry.identity);
  if (jsonDigest(inspectTree(path)) !== jsonDigest(entry.content)) throw new Error("Scratch changed since sealing");
  for (const evidence of entry.retainedEvidence ?? []) {
    if (evidenceIdentity(child(root, evidence.path)) !== evidence.sha256) throw new Error("Retained evidence changed");
  }
  if (!entry.retainedEvidence?.length) throw new Error("No retained evidence");
}

// The producer calls this with both locks held, before touching status or outputs.
// Old evidence remains, but its deletion authority must not follow a new build.
export function resumeFailedScratch(root, owner, buildRoot) {
  canonical(root);
  canonical(buildRoot);
  if (root === buildRoot || !inside(root, buildRoot)) throw new Error("Retry must be inside its task storage root");
  for (const path of [root, buildRoot]) {
    if (JSON.parse(readFileSync(join(path, "lock", "owner.json"), "utf8")).pid !== process.pid) {
      throw new Error("Retry requires its producer locks");
    }
  }
  if (!existsSync(join(root, recordName))) return;
  const record = read(root);
  if (record.owner !== owner) throw new Error("Storage owner differs");
  assertQuiescent(root, record);
  assertQuiescent(buildRoot, { holds: [] });
  const prefix = relative(root, buildRoot);
  const entries = record.entries.filter(entry => !retired(entry) && (
    entry.path === prefix || entry.path.startsWith(`${prefix}/`) || prefix.startsWith(`${entry.path}/`)));
  for (const entry of entries) {
    if (!entry.path.startsWith(`${prefix}/`) || entry.kind !== "failed" ||
        entry.status !== "sealed") throw new Error("Retry overlaps protected scratch; finish owner finalization first");
    verifySealed(root, entry);
  }
  for (const entry of entries) {
    entry.supersededStatus = entry.status;
    entry.status = "superseded";
    entry.supersededAt = new Date().toISOString();
  }
  atomicJson(join(root, recordName), record);
}

function retainedFailure(record, entry, now) {
  if (entry.kind !== "failed" || entry.status !== "sealed") return false;
  const newest = record.entries.filter(value => value.kind === "failed" && value.status === "sealed")
    .sort((a, b) => b.sealedAt.localeCompare(a.sealedAt) || b.id.localeCompare(a.id))[0];
  return (newest?.group ?? newest?.id) === (entry.group ?? entry.id) && now.getTime() - Date.parse(entry.sealedAt) < 7 * 86400_000;
}

// This function does not acquire a lock, create directories, or replay journals.
export function planStorageCleanup(root, now = new Date()) {
  const record = read(root);
  const blocked = [...record.holds];
  if (existsSync(join(root, "lock"))) blocked.push("producer-or-cleanup-lock");
  try { assertQuiescent(root, record); } catch (error) { blocked.push(error.message); }
  const remove = [];
  const keep = [];
  for (const entry of record.entries) {
    if (retired(entry)) continue;
    if (entry.status !== "sealed" || blocked.length || retainedFailure(record, entry, now)) {
      keep.push({ id: entry.id, path: entry.path, reason: entry.status === "sealed" ? blocked.join(", ") : entry.status });
      continue;
    }
    verifySealed(root, entry);
    remove.push({ id: entry.id, path: entry.path, bytes: entry.content.bytes });
  }
  return { root, owner: record.owner, blocked, remove, keep,
    removableLogicalBytes: remove.reduce((sum, entry) => sum + entry.bytes, 0) };
}

export function applyStorageCleanup(root, owner, now = new Date()) {
  const release = acquireLock(canonical(root));
  const free = () => { const s = statfsSync(root); return s.bavail * s.bsize; };
  try {
    const record = read(root);
    if (record.owner !== owner) throw new Error("Storage owner differs");
    assertQuiescent(root, record);
    const before = free();
    const removed = [];
    for (const entry of record.entries) {
      if (!["sealed", "removing"].includes(entry.status) || retainedFailure(record, entry, now)) continue;
      const original = child(root, entry.path);
      const trash = child(root, `storage-trash/${entry.id}`);
      if (entry.status === "sealed") {
        verifySealed(root, entry, original);
        if (existsSync(trash)) throw new Error("Unexpected storage trash entry");
        entry.status = "removing";
        atomicJson(join(root, recordName), record);
      }
      if (existsSync(original)) {
        if (existsSync(trash)) throw new Error("Scratch and trash both exist");
        verifySealed(root, entry, original);
        mkdirSync(dirname(trash), { recursive: true, mode: 0o700 });
        renameSync(original, trash);
      }
      if (existsSync(trash)) {
        // A partial removal is resumed by inode, but only after evidence revalidation.
        sameIdentity(trash, entry.identity);
        for (const evidence of entry.retainedEvidence) {
          if (evidenceIdentity(child(root, evidence.path)) !== evidence.sha256) throw new Error("Retained evidence changed");
        }
        rmSync(trash, { recursive: true });
      }
      entry.status = "removed";
      entry.removedAt = new Date().toISOString();
      atomicJson(join(root, recordName), record);
      removed.push(entry.id);
    }
    return { removed, freeBytesBefore: before, freeBytesAfter: free() };
  } finally { release(); }
}

export function reserveStorage(directory, owner, bytes, floor = 8 * 1024 ** 3) {
  canonical(directory);
  id(owner);
  if (![bytes, floor].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("Invalid storage reservation");
  const release = acquireLock(directory);
  try {
    const path = child(directory, "reservations.json");
    const record = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { host: hostname(), reservations: [] };
    if (record.host !== hostname() || !Array.isArray(record.reservations) ||
        record.reservations.some(item => !Number.isSafeInteger(item.bytes) || item.bytes < 0)) throw new Error("Invalid storage reservations");
    if (record.reservations.some(item => item.owner === owner)) throw new Error("Owner already has a reservation");
    const reserved = record.reservations.reduce((sum, item) => sum + item.bytes, 0);
    const disk = statfsSync(directory);
    if (disk.bavail * disk.bsize < bytes + reserved + floor) throw new Error("Insufficient unreserved disk capacity");
    const reservation = { owner, bytes, pid: process.pid, createdAt: new Date().toISOString(), token: randomUUID() };
    record.reservations.push(reservation);
    atomicJson(path, record);
    return reservation;
  } finally { release(); }
}

export function releaseStorage(directory, token) {
  canonical(directory);
  const release = acquireLock(directory);
  try {
    const path = child(directory, "reservations.json");
    const record = JSON.parse(readFileSync(path, "utf8"));
    if (record.host !== hostname() || !record.reservations.some(item => item.token === token)) throw new Error("Reservation ownership differs");
    record.reservations = record.reservations.filter(item => item.token !== token);
    atomicJson(path, record);
  } finally { release(); }
}


export function assertTerminalNativeStorage(root) {
  canonical(root);
  if (existsSync(join(root, "lock"))) throw new Error("Native producer lock remains active");
  assertQuiescent(root, { holds: [] });
}

// Peak copy estimates deliberately count independent bytes, including APFS clones.
export function storageLogicalBytes(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) throw new Error("Cannot estimate unsupported storage input");
  return readdirSync(path).reduce((sum, name) => sum + storageLogicalBytes(join(path, name)), 0);
}

export function reserveStageStorage(owner, destination, bytes, floor = Number(process.env.E2E_REQUIRED_FREE_BYTES ?? 8 * 1024 ** 3)) {
  const root = resolve(process.env.E2E_CAPACITY_ROOT ?? join(homedir(), ".puddles/development-capacity"));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (lstatSync(root).dev !== lstatSync(destination).dev) throw new Error("Capacity record and stage must share a filesystem");
  return { root, ...reserveStorage(root, owner, bytes, floor) };
}
