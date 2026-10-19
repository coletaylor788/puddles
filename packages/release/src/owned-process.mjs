import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processIdentity } from './files.mjs';

const scopeVariable = 'PUDDLES_PROCESS_SCOPES';
function commitRecord(path, record) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(record)); fsyncSync(fd); } finally { closeSync(fd); }
  try {
    renameSync(temporary, path);
    const directory = openSync(dirname(path), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally { rmSync(temporary, { force: true }); }
}
const gate = fileURLToPath(new URL('./owned-process-gate.mjs', import.meta.url));
export function createProcessScope() {
  const scope = realpathSync(mkdtempSync(join(tmpdir(), 'puddles-processes-')));
  mkdirSync(join(scope, 'launches'));
  return scope;
}
function assertOpen(scope) {
  if (!existsSync(join(scope, 'launches')) || existsSync(join(scope, 'closing'))) {
    throw new Error('Process ownership scope is closed');
  }
}
export function closeProcessScope(scope) {
  writeFileSync(join(scope, 'closing'), '', { flag: 'a', mode: 0o600 });
}
export function inspectProcessScope(scope) {
  const records = [];
  let incomplete = false;
  for (const name of readdirSync(join(scope, 'launches')).filter(name => name.endsWith('.json'))) {
    try {
      const record = JSON.parse(readFileSync(join(scope, 'launches', name), 'utf8'));
      if (record.status !== 'registered' || !Number.isSafeInteger(record.pid) || record.pid <= 1 ||
        typeof record.start !== 'string' || !record.start) incomplete = true;
      else records.push(record);
    } catch { incomplete = true; }
  }
  return { records, incomplete };
}
export function processScopeRecords(scope) {
  const { records, incomplete } = inspectProcessScope(scope);
  if (incomplete) throw new Error('Process launch registration is incomplete; retain ownership scope');
  return records;
}
export function retireProcessScope(scope) {
  if (!existsSync(join(scope, 'closing'))) throw new Error('Process ownership scope must be closed before retirement');
  processScopeRecords(scope);
  rmSync(scope, { recursive: true });
}
// The gate has no workload until every surviving supervisor can discover its
// exact process identity. Nested owners register with every ancestor scope.
export function prepareOwnedProcess(command, args, options = {}, scopes = []) {
  const inherited = JSON.parse(process.env[scopeVariable] ?? '[]');
  if (!Array.isArray(inherited) || inherited.some(value => typeof value !== 'string')) throw new Error('Invalid inherited process scopes');
  const owners = [...new Set([...inherited, ...scopes])];
  for (const scope of owners) assertOpen(scope);
  const id = randomUUID();
  const paths = owners.map(scope => join(scope, 'launches', id + '.json'));
  // Never recreate a removed owner directory. Intents precede detached spawn.
  for (const path of paths) commitRecord(path, { status: 'pending' });
  for (const scope of owners) assertOpen(scope);
  const stdio = Array.isArray(options.stdio) ? options.stdio : Array(3).fill(options.stdio ?? 'pipe');
  if (stdio.length !== 3) throw new Error('Owned processes require exactly three standard streams');
  const targetEnv = { ...(options.env ?? process.env), [scopeVariable]: JSON.stringify(owners) };
  const gateEnv = { ...targetEnv };
  // Target preloads must run only after ownership is committed.
  delete gateEnv.NODE_OPTIONS;
  const child = spawn(process.execPath, [gate], { ...options, detached: true,
    env: gateEnv, stdio: [...stdio, 'pipe'] });
  child.on('error', () => {});
  const channel = child.stdio[3];
  // An early gate failure is reported through the normal child exit/error path.
  channel?.on('error', () => {});
  let released = false;
  const abort = () => { channel?.destroy(); };
  try {
    const start = child.pid && processIdentity(child.pid);
    if (!start) throw new Error('Owned process identity could not be captured');
    for (const scope of owners) assertOpen(scope);
    for (const path of paths) commitRecord(path, { status: 'registered', pid: child.pid, start });
    return { child, start, abort, release() {
      if (released) throw new Error('Owned process gate was already released');
      for (const scope of owners) assertOpen(scope);
      released = true;
      channel.end(JSON.stringify({ command, args, nodeOptions: targetEnv.NODE_OPTIONS }));
    } };
  } catch (error) { abort(); throw error; }
}
export function spawnOwnedProcess(command, args, options = {}) {
  const prepared = prepareOwnedProcess(command, args, options);
  try { prepared.release(); return prepared.child; }
  catch (error) { prepared.abort(); throw error; }
}
