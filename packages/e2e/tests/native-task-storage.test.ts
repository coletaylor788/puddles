import { afterEach, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Executable JavaScript.
import { initializeDevelopmentTask, completeDevelopmentTask } from '../src/native-task-storage.mjs';
// @ts-expect-error Executable JavaScript.
import { initializeStorage, storageHold } from '../src/native-storage.mjs';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'task-completion-'))); roots.push(base);
  const developmentRoot = join(base, 'tasks'), production = join(base, 'production');
  mkdirSync(developmentRoot); mkdirSync(production);
  writeFileSync(join(production, 'live'), 'production sentinel');
  const root = join(developmentRoot, 'task');
  const scope = { developmentRoot, protectedPaths: [production] };
  initializeDevelopmentTask(root, 'owner', scope);
  return { root, scope, production, base };
}
it('removes a completed task including failed builds, receipts and evidence, and is idempotent', () => {
  const { root, production } = fixture();
  for (const name of ['build', 'storage-evidence', 'logs']) mkdirSync(join(root, name));
  writeFileSync(join(root, 'build/run-status.json'), JSON.stringify({ status: 'failed' }));
  writeFileSync(join(root, 'build/generated'), 'output');
  writeFileSync(join(root, 'receipt.json'), '{}');
  symlinkSync(production, join(root, 'external-link'));
  expect(completeDevelopmentTask(root, 'owner').status).toBe('completed');
  expect(existsSync(root)).toBe(false);
  expect(readFileSync(join(production, 'live'), 'utf8')).toBe('production sentinel');
  expect(completeDevelopmentTask(root, 'owner').status).toBe('absent');
});
it('refuses legacy roots, different owners, and a changed scope on reuse', () => {
  const f = fixture();
  expect(() => completeDevelopmentTask(f.root, 'other')).toThrow('ownership');
  expect(() => initializeDevelopmentTask(f.root, 'owner', { ...f.scope, protectedPaths: [f.base] })).toThrow('exclusions');
  const legacy = join(f.scope.developmentRoot, 'legacy'); mkdirSync(legacy);
  initializeStorage(legacy, 'owner');
  expect(() => completeDevelopmentTask(legacy, 'owner')).toThrow('exclusions');
  expect(() => initializeDevelopmentTask(legacy, 'owner', f.scope)).toThrow('scope');
  expect(existsSync(legacy)).toBe(true);
});
it('refuses a production ancestor, descendant or symlink alias as the development boundary', () => {
  const f = fixture();
  const alias = join(f.base, 'alias'); symlinkSync(f.production, alias);
  for (const developmentRoot of [f.base, f.production, alias]) {
    expect(() => initializeDevelopmentTask(join(developmentRoot, 'new'), 'owner', { developmentRoot, protectedPaths: [f.production] })).toThrow('exclusions');
  }
  expect(readdirSync(f.production)).toEqual(['live']);
});
it.each(['consumer', 'source', 'recovery', 'producer', 'reference', 'pending'])('blocks %s before deleting any task files', kind => {
  const { root, production } = fixture();
  writeFileSync(join(root, 'keep'), 'unchanged');
  if (kind === 'consumer') storageHold(root, 'owner', 'transfer', true);
  if (kind === 'source') mkdirSync(join(root, '.git'));
  if (kind === 'recovery') writeFileSync(join(root, 'recovery.json'), '{}');
  if (kind === 'producer') writeFileSync(join(root, 'run-status.json'), JSON.stringify({ status: 'passed', pid: process.pid }));
  if (kind === 'reference') {
    mkdirSync(join(root, 'pool')); mkdirSync(join(root, 'pool/references'));
    writeFileSync(join(root, 'pool/pool.json'), '{}');
    writeFileSync(join(root, 'pool/references/production.json'), JSON.stringify({ kind: 'deployed' }));
  }
  if (kind === 'pending') {
    mkdirSync(join(root, 'draft-controller'));
    writeFileSync(join(root, 'draft-controller/state.json'), JSON.stringify({ pending: {} }));
  }
  expect(() => completeDevelopmentTask(root, 'owner')).toThrow();
  expect(readFileSync(join(root, 'keep'), 'utf8')).toBe('unchanged');
  expect(readFileSync(join(production, 'live'), 'utf8')).toBe('production sentinel');
});
it('resumes interrupted deletion and refuses recreating a task while completion is pending', () => {
  const f = fixture();
  expect(() => completeDevelopmentTask(f.root, 'owner', () => { throw new Error('interrupted'); })).toThrow('interrupted');
  expect(existsSync(f.root)).toBe(false);
  expect(() => initializeDevelopmentTask(f.root, 'owner', f.scope)).toThrow('recovery');
  expect(completeDevelopmentTask(f.root, 'owner').status).toBe('completed');
  expect(readdirSync(f.scope.developmentRoot)).toEqual([]);
});
it('rechecks protected paths on journal recovery', () => {
  const f = fixture();
  expect(() => completeDevelopmentTask(f.root, 'owner', () => { throw new Error('interrupted'); })).toThrow();
  const journal = join(f.scope.developmentRoot, readdirSync(f.scope.developmentRoot).find(n => n.endsWith('.json'))!);
  const state = JSON.parse(readFileSync(journal, 'utf8'));
  state.scope.protectedPaths.push(f.scope.developmentRoot);
  writeFileSync(journal, JSON.stringify(state));
  expect(() => completeDevelopmentTask(f.root, 'owner')).toThrow('exclusions');
  expect(existsSync(state.trash)).toBe(true);
});
it('does not mutate an invalid or absent production target, including its parent', () => {
  const f = fixture();
  // A parent lock would fail here, so an absent completion must return before acquiring one.
  mkdirSync(join(f.production, 'lock'));
  expect(completeDevelopmentTask(join(f.production, 'absent'), 'owner').status).toBe('absent');
  const invalid = join(f.production, 'existing'); mkdirSync(invalid); writeFileSync(join(invalid, 'storage.json'), '{}');
  expect(() => completeDevelopmentTask(invalid, 'owner')).toThrow('exclusions');
  expect(readdirSync(f.production).sort()).toEqual(['existing', 'live', 'lock']);
});
