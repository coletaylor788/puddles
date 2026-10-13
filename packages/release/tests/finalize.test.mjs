import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { enqueue, cancel } from '../src/queue.mjs';
import { initWorkspace, finalizeWorkspace } from '../src/finalize.mjs';
import { processIdentity } from '../src/files.mjs';
function fixture(t, generated = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'release-finalize-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (cwd, args) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const origin = join(root, 'origin.git'), primary = join(root, 'primary'), developmentRoot = join(root, 'workspaces'), workspace = join(developmentRoot, 'feature');
  mkdirSync(primary); mkdirSync(workspace, { recursive: true });
  git(root, ['init', '--bare', origin]); git(primary, ['init']); git(primary, ['commit', '--allow-empty', '-m', 'fixture']);
  git(primary, ['remote', 'add', 'origin', origin]); git(primary, ['push', 'origin', 'HEAD']);
  const checkout = join(workspace, 'source'); git(primary, ['worktree', 'add', '-b', 'feature', checkout]);
  const spec = { version: 1, owner: 'feature', root: workspace, developmentRoot, releaseRoot: join(root, 'release'), protectedPaths: [primary, origin, join(root, 'prod'), join(root, 'backup')], worktrees: [{ path: checkout, kind: 'git' }] };
  if (generated) spec.worktrees.push({ path: join(workspace, "generated-source"), kind: "generated" });
  initWorkspace(spec);
  mkdirSync(join(workspace, 'build')); writeFileSync(join(workspace, 'build/output'), 'disposable');
  return { root, primary, checkout, workspace, git, spec };
}
test('finalize retires published worktrees and output while retaining other owners', async t => {
  const f = fixture(t); const foreign = join(f.root, 'workspaces/other'); mkdirSync(foreign); writeFileSync(join(foreign, 'data'), 'keep');
  assert.equal((await finalizeWorkspace(f.workspace, 'feature')).status, 'finalized');
  assert.ok(!existsSync(f.workspace)); assert.equal(readFileSync(join(foreign, 'data'), 'utf8'), 'keep');
  assert.ok(!f.git(f.primary, ['worktree', 'list']).includes(f.checkout));
});
test('unpublished edits and commits survive finalization', async t => {
  const f = fixture(t); writeFileSync(join(f.checkout, 'feature.txt'), 'unpublished');
  await assert.rejects(finalizeWorkspace(f.workspace, 'feature'), /unpublished edits/);
  assert.ok(!existsSync(join(f.workspace, '.finalizing')));
  f.git(f.checkout, ['add', '.']); f.git(f.checkout, ['commit', '-m', 'feature']);
  await assert.rejects(finalizeWorkspace(f.workspace, 'feature'), /Publish commits/);
  assert.equal(readFileSync(join(f.checkout, 'feature.txt'), 'utf8'), 'unpublished');
  f.git(f.checkout, ['push', 'origin', 'HEAD']);
  assert.equal((await finalizeWorkspace(f.workspace, 'feature')).status, 'finalized');
});
test('ownership and protected paths are checked before any removal', async t => {
  const f = fixture(t);
  await assert.rejects(finalizeWorkspace(f.workspace, '../other'), /Invalid workspace owner/);
  await assert.rejects(finalizeWorkspace(f.workspace, 'other'), /owner does not match/);
  assert.throws(() => initWorkspace({ ...f.spec, protectedPaths: [f.checkout] }), /overlap/);
  assert.ok(existsSync(f.checkout));
});
test('primary checkouts and app-managed worktrees require their own preservation path', async t => {
  const f = fixture(t);
  f.git(f.primary, ['worktree', 'remove', f.checkout]);
  mkdirSync(f.checkout); f.git(f.checkout, ['init']);
  await assert.rejects(finalizeWorkspace(f.workspace, 'feature'), /primary checkout/);
  assert.ok(existsSync(f.checkout));
});

test('queued consumers and unregistered source prevent finalization', async t => {
  const f = fixture(t);
  enqueue(f.spec.releaseRoot, { id: 'queued', workspace: f.workspace });
  await assert.rejects(finalizeWorkspace(f.workspace, 'feature'), /still uses/);
  cancel(f.spec.releaseRoot, 'queued');
  const other = join(f.workspace, 'other-source'); mkdirSync(other); f.git(other, ['init']);
  await assert.rejects(finalizeWorkspace(f.workspace, 'feature'), /Unregistered source/);
  assert.ok(existsSync(other));
});

test('finalization leaves an active consumer process running', async t => {
  const f = fixture(t);
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: f.workspace, stdio: 'ignore' });
  t.after(() => child.kill());
  await new Promise(resolve => child.once('spawn', resolve));
  const start = processIdentity(child.pid);
  writeFileSync(join(f.workspace, '.puddles-workspace.json'), JSON.stringify({ ...f.spec,
    processes: [{ pid: child.pid, start, commandRoot: f.workspace }] }));
  enqueue(f.spec.releaseRoot, { id: 'queued', workspace: f.workspace });
  await assert.rejects(finalizeWorkspace(f.workspace, 'feature'), /still uses/);
  assert.equal(processIdentity(child.pid), start);
});

test('finalization resumes after partial deletion removes the workspace marker', async t => {
  const f=fixture(t);
  writeFileSync(join(f.root,'workspaces/.finalizing-feature.json'),JSON.stringify(f.spec));
  rmSync(join(f.workspace,'.puddles-workspace.json'));
  assert.equal((await finalizeWorkspace(f.workspace,'feature')).status,'finalized');
  assert.ok(!existsSync(f.workspace));
  assert.ok(!existsSync(join(f.root,'workspaces/.finalizing-feature.json')));
});

test('generated source is reserved before creation and retires without publishing build patches', async t => {
  const f=fixture(t,true), path=join(f.workspace,'generated-source');
  f.git(f.primary,['worktree','add','--detach',path]);
  writeFileSync(join(path,'generated.patch-output'),'reproducible build input');
  assert.equal((await finalizeWorkspace(f.workspace,'feature')).status,'finalized');
  assert.ok(!f.git(f.primary,['worktree','list']).includes(path));
  assert.ok(existsSync(f.primary));
});
test('existing unpublished source cannot be relabeled as generated during registration', t => {
  const f=fixture(t);rmSync(join(f.workspace,'.puddles-workspace.json'));
  assert.throws(()=>initWorkspace({...f.spec,worktrees:[{path:f.checkout,kind:'generated'}]}),/before creating/);
  assert.ok(existsSync(f.checkout));
});
