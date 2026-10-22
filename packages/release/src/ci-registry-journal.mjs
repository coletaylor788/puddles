import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonical } from './files.mjs';

// Caller owns .registry.lock. Ownership survives deletion of candidate contents.
const LIMIT = 128 * 1024 * 1024, ENTRY_LIMIT = 1_000_000;
const settings = mode => mode === 'candidate' ? { lock: '.registry.lock', valid: value => /^[a-f0-9]{64}$/.test(value) } : mode === 'transfer' ? { lock: '.transfers.lock', valid: value => /^transfer-[a-zA-Z0-9][a-zA-Z0-9._-]{0,90}$/.test(value) } : (() => { throw Error('Unknown ownership journal mode'); })();
const databasePath = (root, mode = 'candidate') => join(root, settings(mode).lock, 'ownership.sqlite');
const present = path => { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
function validateDatabase(root, mode = 'candidate') {
  const database = databasePath(root, mode);
  for (const path of [database, database + '-journal']) {
    canonical(path);
    if (present(path)) {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.nlink !== 1) throw Error('Unknown candidate journal file');
    }
  }
  if (present(database + '-wal') || present(database + '-shm')) throw Error('Unsupported candidate journal sidecar');
}
function syncDirectory(path) { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
function identity(path) {
  const stat = lstatSync(path, { bigint: true });
  const type = stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'link' : stat.isFile() ? 'file' : null;
  if (!type) throw Error('Unsupported candidate retirement entry');
  return { type, dev: String(stat.dev), ino: String(stat.ino), birth: String(stat.birthtimeNs),
    ...(type !== 'directory' ? { size: String(stat.size), modified: String(stat.mtimeNs), mode: String(stat.mode), ...(type === 'link' ? { target: readlinkSync(path) } : {}) } : {}) };
}
function inventory(root) {
  const result = {}; let count = 0;
  function visit(path, relative) {
    if (++count > ENTRY_LIMIT) throw Error('Candidate retirement inventory exceeds bound');
    const value = identity(path); result[relative] = value;
    if (value.type === 'directory') for (const name of readdirSync(path)) visit(join(path, name), relative === '.' ? name : relative + '/' + name);
  }
  visit(root, '.'); return result;
}
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
export function assertCandidateAvailable(root, id) {
  validateDatabase(root);
  if (!existsSync(databasePath(root))) return;
  const db = new DatabaseSync(databasePath(root), { readOnly: true });
  try { if (db.prepare('SELECT id FROM ownership WHERE id = ?').get(id)) throw Error('Candidate publication or retirement is incomplete'); }
  finally { db.close(); }
}
export function registryJournal(root, fault = () => {}) { return directoryJournal(root, 'candidate', fault); }
export function transferJournal(root, fault = () => {}) { return directoryJournal(root, 'transfer', fault); }
function directoryJournal(root, mode, fault) {
  const scope = settings(mode);
  const valid = id => { if (!scope.valid(id)) throw Error('Invalid owned directory identifier'); };
  validateDatabase(root, mode);
  const path = databasePath(root, mode), db = new DatabaseSync(path);
  db.exec('PRAGMA page_size=4096; PRAGMA auto_vacuum=FULL; PRAGMA synchronous=FULL; PRAGMA journal_mode=DELETE; PRAGMA max_page_count=32768; CREATE TABLE IF NOT EXISTS ownership (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
  const registry = { path: root, identity: identity(root) };
  function rows() {
    return db.prepare('SELECT payload FROM ownership ORDER BY id').all().map(row => {
      const value = JSON.parse(row.payload);
      if (value.version !== 1 || !scope.valid(value.id) || !equal(value.registry, registry) ||
          !['allocating', 'retiring'].includes(value.kind)) throw Error('Candidate ownership journal binding changed');
      return value;
    });
  }
  function save(value) {
    value.registry = registry;
    const payload = JSON.stringify(value);
    const total = db.prepare('SELECT coalesce(sum(length(CAST(payload AS BLOB))), 0) AS bytes FROM ownership WHERE id != ?').get(value.id).bytes;
    if (Buffer.byteLength(payload) + total > LIMIT / 2) throw Error('Candidate ownership journal exceeds bound');
    db.exec('BEGIN IMMEDIATE');
    try { db.prepare('INSERT OR REPLACE INTO ownership VALUES (?, ?)').run(value.id, payload); fault('journal-before-commit', value); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    syncDirectory(join(root, scope.lock));
  }
  function clear(id) { db.prepare('DELETE FROM ownership WHERE id = ?').run(id); }
  function consumers(directory) { return present(join(directory, 'consumers')) && readdirSync(join(directory, 'consumers')).length > 0; }
  function recoverAllocation(value) {
    const directory = join(root, value.id);
    if (!present(directory)) { clear(value.id); return; }
    const current = identity(directory);
    if (current.type !== 'directory' || value.identity && !equal(value.identity, current)) throw Error('Candidate allocation identity changed');
    const names = readdirSync(directory), allowed = ['owner.json', '.owner-publishing.tmp'];
    if (names.some(name => !allowed.includes(name))) throw Error('Unknown candidate allocation entry');
    for (const name of names) {
      const file = join(directory, name), stat = lstatSync(file);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > Buffer.byteLength(value.owner)) throw Error('Candidate allocation marker changed');
      const bytes = readFileSync(file, 'utf8');
      if (name === 'owner.json' ? bytes !== value.owner : !value.owner.startsWith(bytes)) throw Error('Candidate allocation marker changed');
    }
    // Persist exact inode ownership before removing even these narrow entries.
    const retiring = { version: 1, kind: 'retiring', id: value.id, entries: inventory(directory) };
    save(retiring); retire(retiring);
  }
  function retire(value, protectedIds = []) {
    const directory = join(root, value.id);
    if (protectedIds.includes(value.id)) return false;
    if (!present(directory)) { clear(value.id); return false; }
    if (consumers(directory)) return false;
    const current = inventory(directory);
    for (const [name, item] of Object.entries(current)) if (!equal(value.entries[name], item)) throw Error('Candidate retirement identity or contents changed');
    // Metadata inventory is immutable. Missing entries are the only permitted
    // restart difference; directory sizes/mtime naturally change during unlink.
    const names = Object.keys(current).sort((a, b) => b.split('/').length - a.split('/').length || b.localeCompare(a));
    for (const name of names.filter(name => name !== '.')) {
      const file = join(directory, name);
      if (!equal(identity(file), value.entries[name])) throw Error('Candidate retirement entry changed');
      if (current[name].type === 'directory') rmdirSync(file); else unlinkSync(file);
      fault('retirement-entry-removed', { id: value.id, name });
    }
    if (!equal(identity(directory), value.entries['.'])) throw Error('Candidate retirement root changed');
    rmdirSync(directory); syncDirectory(root); fault('retirement-root-removed', value); clear(value.id); return true;
  }
  return {
    close: () => db.close(),
    pending: id => { valid(id); return rows().some(value => value.id === id); },
    recover(protectedIds = []) {
      const removed = [];
      for (const value of rows()) {
        if (protectedIds.includes(value.id)) continue;
        if (value.kind === 'allocating') recoverAllocation(value);
        else if (value.kind === 'retiring' && retire(value, protectedIds)) removed.push(value.id);
        else if (value.kind !== 'retiring') throw Error('Unknown candidate ownership journal');
      }
      return removed;
    },
    allocate(id, owner) {
      valid(id);
      const directory = join(root, id), value = { version: 1, id, kind: 'allocating', owner: JSON.stringify(owner, null, 2) + '\n' };
      save(value); fault('allocation-before-mkdir', value);
      mkdirSync(directory, { mode: 0o700 }); syncDirectory(root); fault('allocation-after-mkdir', value);
      value.identity = identity(directory); save(value);
      const temporary = join(directory, '.owner-publishing.tmp'), fd = openSync(temporary, 'wx', 0o600);
      try { writeFileSync(fd, value.owner); fsyncSync(fd); } finally { closeSync(fd); }
      fault('allocation-owner-written', value);
      renameSync(temporary, join(directory, 'owner.json')); syncDirectory(directory); fault('allocation-owner-published', value);
      clear(id);
    },
    retire(id) {
      valid(id);
      const directory = join(root, id);
      if (consumers(directory)) throw Error('Candidate still has consumers');
      const value = { version: 1, kind: 'retiring', id, entries: inventory(directory) };
      save(value); fault('retirement-registered', value); return retire(value);
    },
  };
}
