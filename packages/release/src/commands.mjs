import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { processIdentity } from './files.mjs';
import { closeProcessScope, createProcessScope, prepareOwnedProcess, inspectProcessScope, retireProcessScope } from './owned-process.mjs';

export function validateCommand(command) {
  if (!command || !isAbsolute(command.command ?? '') || !Array.isArray(command.args) ||
      command.args.some(arg => typeof arg !== 'string') || !isAbsolute(command.cwd ?? '') ||
      !Number.isSafeInteger(command.timeoutMs) || command.timeoutMs < 1 || command.timeoutMs > 6 * 60 * 60_000 ||
      command.env && Object.values(command.env).some(value => typeof value !== 'string')) {
    throw new Error('Command requires an absolute executable, cwd, args, and bounded timeoutMs');
  }
  return command;
}
export async function command(specification, context = {}, observe = () => {}) {
  validateCommand(specification);
  const started = Date.now();
  const scope = createProcessScope();
  let prepared;
  try { prepared = prepareOwnedProcess(specification.command, specification.args, {
    cwd: specification.cwd, env: { ...process.env, ...specification.env, ...context }, stdio: 'inherit',
  }, [scope]); } catch (error) {
    error.message += `; retained process scope: ${scope}`;
    throw error;
  }
  const { child } = prepared;
  try { if (child.pid) observe({ pid: child.pid, start: prepared.start, scope }); }
  catch (error) { prepared.abort(); await killAndWait(child.pid, new Map(), scope); throw error; }
  let expired = false;
  // Detached test runners leave the phase group. Capture their identities before
  // signaling can make their intermediate parents exit and lose that ancestry.
  const descendants = new Map();
  let rejectSignal;
  const signalFailure = new Promise((_, reject) => { rejectSignal = reject; });
  const terminate = () => {
    try { retainDescendants(child.pid, descendants, scope); }
    catch (error) { rejectSignal(error); }
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch (error) { if (error.code !== 'ESRCH') rejectSignal(error); }
  };
  const timer = setTimeout(() => { expired = true; terminate(); }, specification.timeoutMs);
  const killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, specification.timeoutMs + 3000);
  let interruptTimer;
  const interrupt = () => { expired = true; terminate(); interruptTimer ??= setTimeout(() => killGroup(child.pid), 3000); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    await Promise.race([signalFailure, new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 && !expired ? resolve() : reject(Object.assign(new Error(`Command failed (${expired ? 'timeout/interruption' : signal ?? code}): ${specification.command}`), { exitCode: code })));
      try { prepared.release(); } catch (error) { prepared.abort(); reject(error); }
    })]);
  } finally {
    clearTimeout(timer); clearTimeout(killTimer); clearTimeout(interruptTimer);
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    // A command may not leave a detached writer behind when it reports completion.
    await killAndWait(child.pid, descendants, scope);
    observe(null);
    retireProcessScope(scope);
    console.log(JSON.stringify({ phase: context.PUDDLES_RELEASE_PHASE, durationMs: Date.now() - started }));
  }
}
function killGroup(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH' && (error.code !== 'EPERM' || liveGroup(pid))) throw error; }
}
function liveGroup(pid) {
  // Zombies cannot write and may await reaping by an unrelated parent.
  const rows = execFileSync('ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8', timeout: 5000 });
  return rows.split('\n').some(row => {
    const [group, status] = row.trim().split(/\s+/);
    return Number(group) === pid && !status?.startsWith('Z');
  });
}
function processRows() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,lstart='], {
    encoding: 'utf8', timeout: 5000,
  }).split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]),
      zombie: match[4].startsWith('Z'), start: match[5] }] : [];
  });
}
function retainDescendants(pid, owned, scope) {
  const registration = scope ? inspectProcessScope(scope) : { records: [], incomplete: false };
  const rows = processRows();
  // A stale record for a reused PID must not overwrite its current identity.
  for (const row of rows) if (registration.records.some(record => record.pid === row.pid && record.start === row.start)) owned.set(row.pid, row.start);
  // An already retained PID must still have its original start identity before
  // it can establish ownership of newly observed children.
  const parents = new Set(rows.filter(row => row.pid === pid || row.group === pid ||
    owned.get(row.pid) === row.start).map(row => row.pid));
  let changed;
  do {
    changed = false;
    for (const row of rows) if (parents.has(row.parent) && !parents.has(row.pid)) {
      parents.add(row.pid); changed = true;
    }
  } while (changed);
  for (const row of rows) if (parents.has(row.pid) && !owned.has(row.pid)) owned.set(row.pid, row.start);
  return { processes: rows.filter(row => !row.zombie && owned.get(row.pid) === row.start), incomplete: registration.incomplete };
}
async function killAndWait(pid, owned = new Map(), scope) {
  if (!pid) return;
  if (scope) closeProcessScope(scope);
  let registrationError;
  try { retainDescendants(pid, owned, scope); } catch (error) { registrationError = error; }
  killGroup(pid);
  if (registrationError) throw registrationError;
  for (let attempt = 0; attempt < 100; attempt++) {
    const { processes: remaining, incomplete } = retainDescendants(pid, owned, scope);
    for (const row of remaining) {
      try { process.kill(row.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (!remaining.length && !liveGroup(pid)) {
      if (incomplete) throw new Error('Process launch registration is incomplete; retain ownership scope');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Command descendants have not stopped; recovery must wait');
}
export async function stopInterruptedChild(child, acknowledge = () => {}) {
  if (!child) { await acknowledge(); return; }
  const identity = processIdentity(child.pid);
  if (identity && identity !== child.start) throw new Error('Interrupted child identity changed');
  await killAndWait(child.pid, new Map(), child.scope);
  // Clear the durable child receipt before removing its ownership records.
  await acknowledge();
  if (child.scope) retireProcessScope(child.scope);
}
