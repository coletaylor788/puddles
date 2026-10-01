import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statfsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { acquireLock, atomicJson, inside, jsonDigest } from './native-state.mjs';
import { initializeStorage } from './native-storage.mjs';
import { planArtifactCleanup } from './native-retention.mjs';

// This is the task closeout API of the storage controller. Legacy roots cannot
// opt into whole-directory deletion: the scope is established before any work.
const schema = 'puddles.development-task/v1';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const identity = path => { const s = lstatSync(path); return { dev: s.dev, ino: s.ino }; };
const same = (a, b) => jsonDigest(a) === jsonDigest(b);
const overlap = (a, b) => inside(a, b) || inside(b, a);
function physical(path) {
  path = resolve(path);
  if (existsSync(path)) return realpathSync(path);
  return join(physical(dirname(path)), basename(path));
}
function boundary(root, scope) {
  if (scope?.schema !== schema || scope.root !== root || !Array.isArray(scope.protectedPaths) || !scope.protectedPaths.length ||
      dirname(root) !== scope.developmentRoot || physical(scope.developmentRoot) !== scope.developmentRoot ||
      scope.protectedPaths.some(path => typeof path !== 'string' || !path.startsWith('/') || overlap(scope.developmentRoot, physical(path)))) {
    throw new Error('Task requires a separate development root and explicit production/active-path exclusions');
  }
}
function paths(root) {
  const key = jsonDigest(root).slice(0, 24);
  return { journal: join(dirname(root), `.completion-${key}.json`), trash: join(dirname(root), `.completion-${key}`) };
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid producer PID');
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
function inspect(root, current = root) {
  const stat = lstatSync(current);
  if (stat.isSymbolicLink()) return; // Remove links, never their targets.
  if (stat.isFile()) return;
  if (!stat.isDirectory()) throw new Error('Task contains an unsupported filesystem entry');
  const names = readdirSync(current);
  if (names.includes('.git')) throw new Error('Retire source through Git or the app before task completion');
  if (names.some(name => ['recovery.json', 'backup-references', 'retention-lock'].includes(name))) throw new Error('Task contains recovery or locked artifact state');
  if (current !== root && names.includes('lock')) throw new Error('Task contains an active producer lock');
  if (names.includes('run-status.json')) {
    const status = read(join(current, 'run-status.json'));
    if (!['passed', 'failed'].includes(status.status) || status.pid && alive(status.pid)) throw new Error('Task contains a running or uncertain producer');
  }
  if (names.includes('storage.json')) {
    const storage = read(join(current, 'storage.json'));
    if (!Array.isArray(storage.holds) || storage.holds.length) throw new Error('Task has active consumers');
  }
  if (names.includes('state.json') && basename(current) === 'draft-controller') {
    const state = read(join(current, 'state.json'));
    if (state.pending || state.ready || state.obsolete?.length) throw new Error('Finish draft consumers before task completion');
  }
  if (names.includes('pool.json') && existsSync(join(current, 'references')) && readdirSync(join(current, 'references')).length) {
    const references = readdirSync(join(current, 'references')).map(name => read(join(current, 'references', name)));
    if (current !== join(root, 'draft-controller/log-pool') ||
        references.some(value => !['paused', 'active', 'failed-debug'].includes(value.kind))) {
      throw new Error('Task has active artifact or production/recovery references');
    }
    const plan = planArtifactCleanup(current);
    if ([...plan.retained, ...plan.remove].some(value => value.kind !== 'diagnostic-log')) throw new Error('Task log pool contains non-diagnostic artifacts');
  }
  for (const name of names) if (current !== root || name !== 'lock') inspect(root, join(current, name));
}

export function initializeDevelopmentTask(root, owner, { developmentRoot, protectedPaths }) {
  root = resolve(root);
  const scope = { schema, root, developmentRoot: realpathSync(developmentRoot), protectedPaths };
  boundary(root, scope);
  const unlock = acquireLock(scope.developmentRoot);
  try {
    if (existsSync(paths(root).journal) || existsSync(paths(root).trash)) throw new Error('Task completion needs recovery');
    if (existsSync(root)) {
      if (realpathSync(root) !== root || !lstatSync(root).isDirectory()) throw new Error('Task root must not be a link');
      if (existsSync(join(root, 'storage.json'))) {
        const prior = read(join(root, 'storage.json'));
        if (!prior.taskScope || !same(prior.taskScope, scope) || prior.owner !== owner) throw new Error('Existing task scope or owner differs');
        return prior;
      }
      if (readdirSync(root).length) throw new Error('Legacy data needs individual retirement, not whole-task adoption');
    } else mkdirSync(root, { mode: 0o700 });
    const record = initializeStorage(root, owner);
    record.taskScope = scope;
    atomicJson(join(root, 'storage.json'), record);
    return record;
  } finally { unlock(); }
}

// The caller acknowledges the feature is finished and all consumers have joined.
// Worktree retirement remains a separate Git/app operation. This never retires
// a production reference or interprets a recovery marker as disposable.
export function validateDevelopmentTask(root, owner) {
  root = resolve(root);
  const { journal, trash } = paths(root);
  if (existsSync(journal)) {
    if (realpathSync(journal) !== journal || !lstatSync(journal).isFile()) throw new Error('Completion journal must be a regular owned file');
    const pending = read(journal);
    boundary(root, pending.scope);
    if (pending.root !== root || pending.trash !== trash || pending.owner !== owner) throw new Error('Completion journal ownership differs');
    return { status: 'pending' };
  }
  if (!existsSync(root)) return { status: 'absent' };
  if (realpathSync(root) !== root) throw new Error('Task root must not be a link');
  const record = read(join(root, 'storage.json'));
  boundary(root, record.taskScope);
  if (record.owner !== owner || !same(identity(root), record.identity)) throw new Error('Task ownership differs');
  return { status: 'active' };
}

export function completeDevelopmentTask(root, owner, remove = rmSync) {
  root = resolve(root);
  // An absent or invalid target must not even create a lock in its parent.
  if (validateDevelopmentTask(root, owner).status === 'absent') return { status: 'absent' };
  const { journal, trash } = paths(root);
  const unlock = acquireLock(dirname(root));
  let releaseTask;
  try {
    validateDevelopmentTask(root, owner);
    if (!existsSync(journal)) {
      if (!existsSync(root)) return { status: 'absent' };
      if (realpathSync(root) !== root) throw new Error('Task root must not be a link');
      const record = read(join(root, 'storage.json'));
      boundary(root, record.taskScope);
      if (record.owner !== owner || !same(identity(root), record.identity)) throw new Error('Task ownership differs');
      if (existsSync(trash)) throw new Error('Unexpected completion trash');
      releaseTask = acquireLock(root);
      inspect(root);
      const disk = statfsSync(root);
      atomicJson(journal, { root, trash, owner, identity: record.identity, scope: record.taskScope,
        freeBytesBefore: disk.bavail * disk.bsize });
    }
    const pending = read(journal);
    boundary(root, pending.scope);
    if (pending.root !== root || pending.trash !== trash || pending.owner !== owner) throw new Error('Completion journal ownership differs');
    if (existsSync(root)) {
      if (existsSync(trash) || realpathSync(root) !== root || !same(identity(root), pending.identity)) throw new Error('Task changed during completion');
      if (!releaseTask) releaseTask = acquireLock(root);
      inspect(root);
      renameSync(root, trash);
      releaseTask = undefined; // The owned lock moves with the task.
    }
    if (existsSync(trash)) {
      if (realpathSync(trash) !== trash || !same(identity(trash), pending.identity)) throw new Error('Completion trash identity differs');
      const lockOwner = join(trash, 'lock/owner.json');
      if (existsSync(lockOwner)) {
        const pid = read(lockOwner).pid;
        if (pid !== process.pid && alive(pid)) throw new Error('Completion producer is still running');
      }
      remove(trash, { recursive: true });
    }
    rmSync(journal);
    const disk = statfsSync(dirname(root));
    return { status: 'completed', freeBytesBefore: pending.freeBytesBefore, freeBytesAfter: disk.bavail * disk.bsize };
  } finally { releaseTask?.(); unlock(); }
}
