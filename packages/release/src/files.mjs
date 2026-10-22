import { createHash, randomUUID } from 'node:crypto';
import { constants, chmodSync, closeSync, cpSync, existsSync, fsyncSync, lchmodSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
export const contains = (parent, child) => resolve(parent) === resolve(child) || resolve(child).startsWith(resolve(parent) + sep);
export function canonical(path) {
  if (!isAbsolute(path ?? '')) throw new Error('Expected an absolute path');
  const resolved = resolve(path);
  if (resolved !== path) throw new Error('Expected a normalized absolute path');
  let existing = resolved;
  while (!existsSync(existing)) existing = dirname(existing);
  if (realpathSync(existing) !== existing) throw new Error(`Linked path is not allowed: ${path}`);
  return resolved;
}
export function separate(paths) {
  const values = paths.map(canonical);
  for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
    if (contains(values[i], values[j]) || contains(values[j], values[i])) throw new Error('Owned paths overlap');
  }
  return values;
}
export function atomicJson(path, data) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(data, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
    const dir = openSync(dirname(path), 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  } finally { rmSync(temporary, { force: true }); }
}
export function treeHash(root) {
  const hash = createHash('sha256');
  function visit(path, name) {
    const stat = lstatSync(path);
    hash.update(JSON.stringify([name, stat.mode & 0o777]));
    if (stat.isSymbolicLink()) {
      const target = realpathSync(path);
      if (!contains(root, target)) throw new Error(`Artifact link escapes its root: ${name}`);
      hash.update('link:' + readlinkSync(path));
    } else if (stat.isDirectory()) {
      hash.update('directory');
      for (const item of readdirSync(path).sort()) visit(join(path, item), relative(root, join(path, item)));
    } else if (stat.isFile()) hash.update(readFileSync(path));
    else throw new Error(`Unsupported file in artifact: ${name}`);
  }
  visit(root, '.');
  return hash.digest('hex');
}
export function copy(source, destination) {
  separate([source, destination]);
  cpSync(source, destination, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE, errorOnExist: true, force: false });
  // macOS copy-on-write copies and symlink creation can apply the current
  // umask. Restore authored modes without following links or changing umask.
  function restoreModes(from, to) {
    const stat = lstatSync(from);
    if (stat.isSymbolicLink()) {
      if ((lstatSync(to).mode & 0o777) !== (stat.mode & 0o777)) {
        if (!lchmodSync) throw new Error('Cannot preserve symbolic link permissions');
        lchmodSync(to, stat.mode & 0o777);
      }
      return;
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(from)) restoreModes(join(from, name), join(to, name));
    }
    chmodSync(to, stat.mode & 0o777);
  }
  restoreModes(source, destination);
}
export function processIdentity(pid) {
  try { return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim() || null; }
  catch { return null; }
}
export function lock(directory, { timeoutMs = 0 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30_000) throw new Error('Invalid lock timeout');
  canonical(directory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // The kernel releases SQLite's lock when the process exits, including SIGKILL.
  // Keep this tiny file in place: deleting lock files creates competing owners.
  const database = new DatabaseSync(join(directory, 'lock.sqlite'));
  try { database.exec(`PRAGMA busy_timeout=${timeoutMs}; BEGIN EXCLUSIVE`); }
  catch (error) { database.close(); throw new Error('Operation is already running', { cause: error }); }
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    try { database.exec('ROLLBACK'); } finally { database.close(); }
  };
}
export function withLock(directory, action) {
  const unlock = lock(directory);
  try { return action(); } finally { unlock(); }
}

export const FOREGROUND_ADMISSION_MS = 330_000;
// Foreground callers wait for admission only. Yielding keeps termination and
// supervisor callbacks responsive; maintenance explicitly requests timeout zero.
export async function admissionLock(directory, { timeoutMs = FOREGROUND_ADMISSION_MS, deadline = performance.now() + timeoutMs } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > FOREGROUND_ADMISSION_MS || !Number.isFinite(deadline)) throw Error('Invalid admission timeout');
  deadline = Math.min(deadline, performance.now() + timeoutMs);
  let interrupted = false;
  const stop = () => { interrupted = true; };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  try {
    for (;;) {
      if (interrupted) throw Error('CI admission interrupted');
      try {
        const release = lock(directory);
        if (interrupted) { release(); throw Error('CI admission interrupted'); }
        return release;
      }
      catch (error) {
        if (error.cause?.code !== 'ERR_SQLITE_ERROR' || ![5, 6].includes(error.cause.errcode & 255) || performance.now() >= deadline || timeoutMs === 0) throw error;
        await delay(Math.max(1, Math.min(100, deadline - performance.now())));
      }
    }
  } finally { process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
}
