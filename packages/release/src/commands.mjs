import { execFileSync, spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { processIdentity } from './files.mjs';

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
  const child = spawn(specification.command, specification.args, {
    cwd: specification.cwd, env: { ...process.env, ...specification.env, ...context },
    detached: true, stdio: 'inherit',
  });
  try { if (child.pid) observe({ pid: child.pid, start: processIdentity(child.pid) }); }
  catch (error) { await killAndWait(child.pid); throw error; }
  let expired = false;
  const terminate = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
  const timer = setTimeout(() => { expired = true; terminate(); }, specification.timeoutMs);
  const killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, specification.timeoutMs + 3000);
  let interruptTimer;
  const interrupt = () => { expired = true; terminate(); interruptTimer ??= setTimeout(() => killGroup(child.pid), 3000); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 && !expired ? resolve() : reject(new Error(`Command failed (${expired ? 'timeout/interruption' : signal ?? code}): ${specification.command}`)));
    });
  } finally {
    clearTimeout(timer); clearTimeout(killTimer); clearTimeout(interruptTimer);
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    // A command may not leave a detached writer behind when it reports completion.
    await killAndWait(child.pid);
    observe(null);
    console.log(JSON.stringify({ phase: context.PUDDLES_RELEASE_PHASE, durationMs: Date.now() - started }));
  }
}
function killGroup(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
function liveGroup(pid) {
  // Zombies cannot write and may await reaping by an unrelated parent.
  const rows = execFileSync('ps', ['-axo', 'pgid=,stat='], { encoding: 'utf8' });
  return rows.split('\n').some(row => {
    const [group, status] = row.trim().split(/\s+/);
    return Number(group) === pid && !status?.startsWith('Z');
  });
}
async function killAndWait(pid) {
  if (!pid) return;
  killGroup(pid);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!liveGroup(pid)) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Command process group has not stopped; recovery must wait');
}
export async function stopInterruptedChild(child) {
  if (!child) return;
  const identity = processIdentity(child.pid);
  if (identity && identity !== child.start) throw new Error('Interrupted child identity changed');
  await killAndWait(child.pid);
}
