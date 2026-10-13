import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { atomicJson, canonical, contains, lock, processIdentity, readJson, separate } from './files.mjs';

import { updateQueue } from './queue.mjs';

const marker = '.puddles-workspace.json';
function git(path, args) { return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', path, ...args], { encoding: 'utf8' }).trim(); }
export function initWorkspace(spec) {
  if (spec.version !== 1 || !/^[a-zA-Z0-9._-]+$/.test(spec.owner ?? '')) throw new Error('Workspace needs an owner');
  canonical(spec.root); canonical(spec.developmentRoot); canonical(spec.releaseRoot);
  separate([spec.root, spec.releaseRoot]);
  if (dirname(spec.root) !== spec.developmentRoot) throw new Error('Workspace must be a direct child of its development root');
  if (!Array.isArray(spec.protectedPaths) || !spec.protectedPaths.length) throw new Error('Declare deployment, backup, and cache boundaries');
  for (const path of spec.protectedPaths) separate([spec.root, path]);
  const existing = existsSync(join(spec.root, marker)) ? readJson(join(spec.root, marker)) : null;
  if (existing && JSON.stringify(existing) !== JSON.stringify(spec)) throw new Error('Workspace is already registered with different ownership');
  for (const worktree of spec.worktrees ?? []) {
    canonical(worktree.path);
    if (!contains(spec.root, worktree.path)) throw new Error('Worktrees must belong to the workspace');
    if (!['git', 'managed', 'generated'].includes(worktree.kind)) throw new Error('Unknown worktree kind');
    if (worktree.kind === 'generated' && !existing && existsSync(worktree.path)) throw new Error('Register generated source before creating it');
  }
  mkdirSync(spec.root, { recursive: true, mode: 0o700 });
  const path = join(spec.root, marker);
  if (existsSync(path) && JSON.stringify(readJson(path)) !== JSON.stringify(spec)) throw new Error('Workspace is already registered with different ownership');
  atomicJson(path, spec);
  return spec;
}
export async function finalizeWorkspace(root, owner) {
  canonical(root);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(owner ?? '')) throw new Error('Invalid workspace owner');
  const journal = join(dirname(root), `.finalizing-${owner}.json`);
  const spec = readJson(existsSync(join(root, marker)) ? join(root, marker) : journal);
  if (spec.owner !== owner || spec.root !== root) throw new Error('Workspace owner does not match');
  if (contains(root, process.cwd())) throw new Error('Run finalize from outside its workspace');
  for (const path of spec.protectedPaths) separate([root, path]);
  const unlock = lock(join(dirname(root), '.finalize.lock'));
  try {
    // Reserve cleanup before stopping processes so a release cannot start using
    // this workspace between the consumer check and teardown.
    updateQueue(spec.releaseRoot, state => {
      if ([state.active, ...state.ready].some(ticket => typeof ticket?.workspace === 'string' && contains(root, ticket.workspace))) throw new Error('A queued or active release still uses this workspace');
      if (existsSync(root)) writeFileSync(join(root, '.finalizing'), owner, { mode: 0o600 });
    });
    for (const child of spec.processes ?? []) {
      if (processIdentity(child.pid) !== child.start) continue;
      if (!child.commandRoot || !contains(root, child.commandRoot)) throw new Error('Process is not owned by this workspace');
      process.kill(child.pid, 'SIGTERM');
      for (let i = 0; i < 30 && processIdentity(child.pid) === child.start; i++) await new Promise(r => setTimeout(r, 100));
      if (processIdentity(child.pid) === child.start) throw new Error('Workspace process has not stopped');
    }
    // Check every checkout before retiring any. Never remove unpublished source.
    for (const worktree of spec.worktrees ?? []) {
      if (!existsSync(worktree.path)) continue;
      if (worktree.kind === 'managed') throw new Error(`Archive the managed worktree with the app first: ${worktree.path}`);
      if (worktree.kind === 'generated') continue;
      const common = resolve(worktree.path, git(worktree.path, ['rev-parse', '--git-common-dir']));
      const gitDir = resolve(worktree.path, git(worktree.path, ['rev-parse', '--git-dir']));
      if (common === gitDir) throw new Error('Finalization cannot remove a primary checkout');
      if (contains(root, common)) throw new Error('Authored repository metadata must remain outside the workspace');
      if (git(worktree.path, ['status', '--porcelain'])) throw new Error('Preserve unpublished edits before finalizing');
      if (git(worktree.path, ['rev-list', 'HEAD', '--not', '--remotes=origin'])) throw new Error('Publish commits before finalizing');
    }
    const registered = new Set((spec.worktrees ?? []).map(item => item.path));
    function inspect(path) {
      if (existsSync(join(path, '.git'))) {
        if (!registered.has(path)) throw new Error('Unregistered source checkout must be preserved before finalization');
        return;
      }
      if (path !== root && existsSync(join(path, marker))) throw new Error('Another workspace is nested inside this workspace');
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.isDirectory() && !['node_modules', '.git'].includes(entry.name)) inspect(join(path, entry.name));
      }
    }
    if (existsSync(root)) inspect(root);
    atomicJson(journal, spec);
    for (const worktree of spec.worktrees ?? []) {
      if (!existsSync(worktree.path)) continue;
      if (worktree.kind === 'generated') {
        // A generated clone owns its Git metadata; a generated linked worktree
        // must also retire its registration in the shared source cache.
        if (existsSync(join(worktree.path, '.git'))) {
          const common = resolve(worktree.path, git(worktree.path, ['rev-parse', '--git-common-dir']));
          const gitDir = resolve(worktree.path, git(worktree.path, ['rev-parse', '--git-dir']));
          if (common !== gitDir) git(worktree.path, ['worktree', 'remove', '--force', worktree.path]);
        }
      } else git(worktree.path, ['worktree', 'remove', '--force', worktree.path]);
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(journal, { force: true });
    return { status: 'finalized', owner };
  } finally {
    if (!existsSync(journal) && existsSync(root)) rmSync(join(root, '.finalizing'), { force: true });
    unlock();
  }
}
