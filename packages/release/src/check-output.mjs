import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { atomicJson, canonical, contains, lock, processIdentity, readJson, separate, treeHash } from './files.mjs';
import { closeProcessScope, createProcessScope, processScopeRecords, retireProcessScope } from './owned-process.mjs';

const schema = 'puddles.check-output/v1';
const present = path => lstatSync(path, { throwIfNoEntry: false }) !== undefined;
const identity = path => {
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('Check output must be an unlinked directory');
  return { dev: s.dev, ino: s.ino, birthtimeMs: s.birthtimeMs };
};
const same = (path, expected) => {
  if (JSON.stringify(identity(path)) !== JSON.stringify(expected)) throw new Error('Check output identity changed');
};
const digest = root => treeHash(root, { allowExternalLinks: true });
function inspect(root, fresh = false) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (['.git', 'lock', 'recovery.json', 'backup-references', '.puddles-workspace.json', 'run-status.json'].includes(entry.name)) {
      throw new Error('Check output contains source, ownership, or unresolved recovery state');
    }
    if (entry.isDirectory()) inspect(join(root, entry.name), fresh);
    else if (fresh) throw new Error('Register check output before writing any files or links');
  }
}
function processes() {
  const r = spawnSync('/bin/ps', ['-axo', 'pid=,stat=,lstart='], { encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0 || r.stderr.trim()) throw new Error('Cannot verify check process identities');
  return new Map(r.stdout.split('\n').filter(Boolean).flatMap(line => {
    const m = line.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/);
    if (!m) throw new Error('Invalid process identity inventory');
    return m[2].startsWith('Z') ? [] : [[Number(m[1]), m[3].trim()]];
  }));
}
function stopped(records) {
  const live = processes();
  for (const r of records) {
    if (!Number.isSafeInteger(r.pid) || r.pid <= 1 || typeof r.start !== 'string' || !r.start) throw new Error('Invalid check process identity');
    if (live.get(r.pid) === r.start) throw new Error('Check output still has an active process');
  }
}
function noConsumers(root) {
  if (contains(root, realpathSync(process.cwd()))) throw new Error('Run cleanup outside check output');
  const handles = spawnSync('/usr/sbin/lsof', ['-t', '+D', root], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  if (handles.error || ![0, 1].includes(handles.status) || handles.stderr.trim() || handles.stdout.trim()) {
    throw new Error('Check output has open handles or could not be inspected');
  }
  const r = spawnSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8', timeout: 10000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0 || r.stderr.trim()) throw new Error('Cannot inspect check output consumers');
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const reference = new RegExp(escaped + '(?:/|[\\s\\x22\\x27]|$)');
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const m = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!m) throw new Error('Invalid process command inventory');
    if (Number(m[1]) !== process.pid && reference.test(m[2])) throw new Error('A process command still references check output');
  }
}
function load(receipt) {
  canonical(receipt);
  if (lstatSync(receipt).isSymbolicLink() || !lstatSync(receipt).isFile()) throw new Error('Invalid check receipt file');
  const r = readJson(receipt);
  if (r.schema !== schema || r.host !== hostname() || !/^[a-f0-9-]{36}$/.test(r.runId ?? '') || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(r.owner ?? '')) throw new Error('Invalid check output ownership');
  if (!isAbsolute(r.root) || resolve(r.root) !== r.root || receipt !== r.root + '.check-output/receipt.json') throw new Error('Check receipt path differs from registered output');
  canonical(r.root); same(dirname(receipt), r.controlIdentity);
  if (r.trash !== join(dirname(r.root), '.' + basename(r.root) + '.retiring-' + r.runId)) throw new Error('Invalid check retirement destination');
  for (const p of r.protectedPaths) separate([r.root, r.trash, p]);
  return r;
}
export function beginCheckOutput(root, { owner = process.env.PUDDLES_RELEASE_ID, protectedPaths = [] } = {}) {
  if (!isAbsolute(root) || resolve(root) !== root || lstatSync(root, { throwIfNoEntry: false })?.isSymbolicLink()) throw new Error('Expected an absolute unlinked output directory');
  const parent = realpathSync(dirname(root)); root = join(parent, basename(root));
  if (!existsSync(root)) mkdirSync(root, { mode: 0o700 });
  inspect(root, true); const rootIdentity = identity(root), runId = randomUUID();
  owner ??= 'check-' + runId;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(owner)) throw new Error('Invalid check owner');
  const control = root + '.check-output', receipt = join(control, 'receipt.json');
  const trash = join(parent, '.' + basename(root) + '.retiring-' + runId);
  for (const p of protectedPaths) separate([root, control, trash, p]);
  mkdirSync(control, { mode: 0o700 });
  const scope = createProcessScope(), start = processIdentity(process.pid);
  if (!start) throw new Error('Cannot register check creator identity');
  const r = { schema, host: hostname(), runId, owner, root, identity: rootIdentity, controlIdentity: identity(control), trash,
    creator: { pid: process.pid, start }, scope, protectedPaths, status: 'running', createdAt: new Date().toISOString() };
  atomicJson(receipt, r);
  return { receipt, scope, owner, runId };
}
export function finishCheckOutput(handle, { failed = false, joinSucceeded = true, fixturesStopped = true, interrupted = false } = {}) {
  const unlock = lock(dirname(handle.receipt));
  try {
    const r = load(handle.receipt);
    if (r.runId !== handle.runId || r.owner !== handle.owner || r.status !== 'running' || r.creator.pid !== process.pid || r.creator.start !== processIdentity(process.pid)) throw new Error('Check completion ownership differs');
    try {
      if (!joinSucceeded || !fixturesStopped) throw new Error('Check cleanup or joining is uncertain');
      same(r.root, r.identity); closeProcessScope(r.scope);
      const records = processScopeRecords(r.scope); stopped(records); noConsumers(r.root);
      // Failed diagnostics remain held until an explicit retirement request.
      // Passing suites may contain synthetic recovery fixtures of their own.
      if (failed) inspect(r.root);
      Object.assign(r, { status: failed ? 'failed-retained' : 'cleanup-ready', outcome: failed ? 'failed' : interrupted ? 'interrupted' : 'passed', records, content: digest(r.root), completedAt: new Date().toISOString() });
      atomicJson(handle.receipt, r);
    } catch (error) {
      r.status = 'recovery-required'; atomicJson(handle.receipt, r); throw error;
    }
    retireProcessScope(r.scope);
  } finally { unlock(); }
  if (!failed) return retireCheckOutput({ ...handle, currentCreator: true });
  return { status: 'failed-retained', receipt: handle.receipt };
}
export function retireCheckOutput({ receipt, owner, runId, acknowledgeFailure = false, currentCreator = false }) {
  canonical(receipt);
  const unlock = lock(dirname(receipt));
  try {
    const r = load(receipt);
    if (r.owner !== owner || r.runId !== runId) throw new Error('Check retirement ownership differs');
    if (!['cleanup-ready', 'failed-retained', 'retiring', 'removed'].includes(r.status)) throw new Error('Check cleanup is not terminal; recovery is required');
    if (r.status === 'failed-retained' && acknowledgeFailure !== true) throw new Error('Acknowledge retained failed check diagnostics before retirement');
    const creatorCurrent = currentCreator && r.creator.pid === process.pid && r.creator.start === processIdentity(process.pid) && r.status === 'cleanup-ready';
    if (!creatorCurrent) stopped([r.creator]);
    stopped(r.records);
    if (existsSync(r.scope)) {
      closeProcessScope(r.scope); stopped(processScopeRecords(r.scope)); retireProcessScope(r.scope);
    }
    if (r.status === 'removed') {
      if (present(r.root) || present(r.trash)) throw new Error('Output reappeared after completed retirement');
      return { status: 'removed', receipt };
    }
    if (present(r.root)) {
      if (present(r.trash)) throw new Error('Both check output and retirement destination exist');
      same(r.root, r.identity); noConsumers(r.root);
      if (r.outcome === 'failed') inspect(r.root);
      if (digest(r.root) !== r.content) throw new Error('Check output changed after completion');
      r.status = 'retiring'; atomicJson(receipt, r);
      renameSync(r.root, r.trash);
    } else if (r.status !== 'retiring') throw new Error('Check output disappeared before retirement');
    if (present(r.trash)) {
      same(r.trash, r.identity); noConsumers(r.trash);
      if (r.outcome === 'failed') inspect(r.trash);
      // A previous attempt may have removed some files. The directory identity
      // and durable rename intent still bind the remainder to this one run.
      rmSync(r.trash, { recursive: true });
    }
    r.status = 'removed'; r.removedAt = new Date().toISOString(); atomicJson(receipt, r);
    return { status: 'removed', receipt };
  } finally { unlock(); }
}
