import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error executable module
import { applicationSuite, repository, runMappedTests, runCombinedProjects } from '../src/application-suite.mjs';
// @ts-expect-error executable module
import { applicationTestProject } from '../src/application-test-projects.mjs';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function combinedListing(args: string[]) {
  const config = args[args.indexOf('--config') + 1];
  if (!config?.endsWith('.mts')) return null;
  const selection = JSON.parse(readFileSync(config, 'utf8').match(/^const selection = (.+);$/m)![1]);
  return selection.flatMap((group: {project: string; files: string[]}) => group.files.map(file => `[${group.project}] ${file}`)).join('\n');
}
function source(files: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'application-suite-')); roots.push(root);
  for (const file of files) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), ''); }
  return root;
}
it('combines public and companion regressions into one discovery and run per project', async () => {
  const root = source(['old.test.ts', 'shared.test.ts', 'new.test.ts']);
  const calls: string[][] = [];
  const run = async (_: string, args: string[]) => { calls.push(args); return combinedListing(args) ?? args.filter(x => x.endsWith('.test.ts')).join('\n'); };
  const result = await runMappedTests(root, [
    { patches: [{ tests: ['old.test.ts', 'shared.test.ts'] }], testProjects: { 'old.test.ts': 'unit', 'shared.test.ts': 'unit' } },
    { tests: ['shared.test.ts', 'new.test.ts'], testProjects: { 'shared.test.ts': ['unit'], 'new.test.ts': ['unit'] } },
  ], run);
  expect(result).toEqual({ projects: 1, tests: 3 });
  expect(calls).toHaveLength(3);
  expect(calls[2].filter(x => x.endsWith('.test.ts'))).toEqual(['old.test.ts', 'shared.test.ts', 'new.test.ts']);
});
it('retains separate modes and resolves project alternatives without per-file subprocesses', async () => {
  const root = source(['shared.test.ts', 'fallback.test.ts']);
  const calls: string[][] = [];
  const run = async (_: string, args: string[]) => {
    calls.push(args);
    return combinedListing(args) ?? args.filter(x => x.endsWith('.test.ts') && (x !== 'fallback.test.ts' || args.includes('test/vitest/vitest.fallback.config.ts'))).join('\n');
  };
  expect(await runMappedTests(root, [
    { tests: ['shared.test.ts'], testProjects: { 'shared.test.ts': 'normal' } },
    { tests: ['shared.test.ts', 'fallback.test.ts'], testProjects: { 'shared.test.ts': ['isolated'], 'fallback.test.ts': ['normal', 'fallback'] } },
  ], run)).toEqual({ projects: 3, tests: 3 });
  expect(calls.filter(args => args[1] === 'run')).toHaveLength(1);
});
it('refuses an uncollected historical regression before running any project', async () => {
  const root = source(['old.test.ts']); const calls: string[][] = [];
  await expect(runMappedTests(root, [{ tests: ['old.test.ts'], testProjects: { 'old.test.ts': 'unit' } }], async (_: string, args: string[]) => { calls.push(args); return ''; })).rejects.toThrow('was not collected');
  expect(calls.every(args => args[1] === 'list')).toBe(true);
});
it('collects Vitest project-prefixed filenames with optional terminal color', async () => {
  const root = source(['old.test.ts', 'new.test.ts']);
  expect(await runMappedTests(root, [{ tests: ['old.test.ts', 'new.test.ts'], testProjects: { 'old.test.ts': 'unit', 'new.test.ts': 'unit' } }], async (_: string, args: string[]) => combinedListing(args) ??
    '\u001b[32m[unit]\u001b[0m old.test.ts\n[unit] /absolute/source/new.test.ts\n')).toEqual({ projects: 1, tests: 2 });
});
it('fails when a project fails and never converts failure into an empty pass', async () => {
  const root = source(['old.test.ts']);
  await expect(runMappedTests(root, [{ tests: ['old.test.ts'], testProjects: { 'old.test.ts': 'unit' } }], async (_: string, args: string[]) => {
    if (args[1] === 'run') throw new Error('behavior regression'); return combinedListing(args) ?? 'old.test.ts';
  })).rejects.toThrow('behavior regression');
});

it('the full application gate tests prepared output without invoking a build or release package', async () => {
  const manifest = JSON.parse(readFileSync(join(repository, 'packages/e2e/openclaw-patch-suite.json'), 'utf8'));
  const root = source(['dist/ready', 'openclaw.mjs', ...new Set<string>([...manifest.tests, ...manifest.patches.flatMap((patch: { tests: string[] }) => patch.tests)])]);
  const calls: Array<{command: string; args: string[]; options: {env: Record<string, string>}}> = [];
  const result = await applicationSuite({source: root, artifact: root, workers: 4}, async (command: string, args: string[], options: {env: Record<string, string>}) => {
    calls.push({command, args, options});
    return combinedListing(args) ?? args.filter(arg => /\.test\.tsx?$/.test(arg)).join('\n');
  });
  expect(result.status).toBe('passed');
  expect(calls.some(({args}) => args.includes('build') || args.some(arg => arg.includes('packages/release')))).toBe(false);
  expect(calls.some(({args}) => args.join(' ') === 'pnpm test')).toBe(true);
  expect(calls.some(({args}) => args.includes('pytest'))).toBe(true);
  expect(calls.some(({args}) => args.some(arg => arg.endsWith('/bin/test-application.mjs')))).toBe(true);
  expect(calls.every(({options}) => options.env.OPENCLAW_CANDIDATE_DIR === root)).toBe(true);
  expect(calls.every(({options}) => options.env.OPENCLAW_VITEST_MAX_WORKERS === '4')).toBe(true);
});

it('rejects lost, added or reassigned regressions in combined discovery', async () => {
  const root = source(['a.test.ts']);
  for (const collected of ['', '[unit] extra.test.ts', '[other] a.test.ts']) {
    await expect(runCombinedProjects(root, new Map([['unit', new Set(['a.test.ts'])]]), async () => collected, [])).rejects.toThrow('differs from mapped regressions');
  }
});

it('shares workers across independent projects while retaining serial and isolation requirements', () => {
  const original = { test: { pool: 'forks', isolate: true, runner: 'owned-runner',
    setupFiles: ['owned-setup'], sequence: { groupOrder: 19, seed: 27 } } };
  const first = applicationTestProject(original, ['a.test.ts'], '/source', 4);
  const second = applicationTestProject({test: {sequence: {groupOrder: 70}}}, ['b.test.ts'], '/source', 4);
  expect(first.test.sequence.groupOrder).toBe(second.test.sequence.groupOrder);
  expect(first.test).toMatchObject({ pool: 'forks', isolate: true, runner: 'owned-runner',
    setupFiles: ['owned-setup'], maxWorkers: 4, include: ['/source/a.test.ts'], sequence: {seed: 27} });
  for (const requirement of [{fileParallelism: false}, {maxWorkers: 1}]) {
    const serial = applicationTestProject({test: requirement}, ['c.test.ts'], '/source', 4);
    expect(serial.test.maxWorkers).toBe(1);
    expect(serial.test.sequence.groupOrder).not.toBe(first.test.sequence.groupOrder);
  }
  expect(original.test.sequence.groupOrder).toBe(19);
});

it('honors bounded companion check deadlines without changing other checks', async () => {
  const manifest = JSON.parse(readFileSync(join(repository, 'packages/e2e/openclaw-patch-suite.json'), 'utf8'));
  const root = source(['dist/ready', 'openclaw.mjs', ...new Set<string>([...manifest.tests, ...manifest.patches.flatMap((patch: { tests: string[] }) => patch.tests)])]);
  for (const timeoutMs of [4_500_000, 0, -1, 1.5, 6 * 60 * 60_000 + 1]) {
    const extensionPath = join(root, `extension-${timeoutMs}.mjs`);
    writeFileSync(extensionPath, `export default ${JSON.stringify({ checks: [
      { command: 'synthetic-default', args: [], cwd: root },
      { command: 'synthetic-sequential', args: [], cwd: root, timeoutMs },
    ] })}`);
    const calls: Array<{ command: string; timeoutMs: number }> = [];
    const result = applicationSuite({ source: root, artifact: root, extensionPath }, async (command: string, args: string[], options: { timeoutMs: number }) => {
      calls.push({ command, timeoutMs: options.timeoutMs });
      return combinedListing(args) ?? args.filter(arg => /\.test\.tsx?$/.test(arg)).join('\n');
    });
    if (timeoutMs === 4_500_000) {
      await result;
      expect(calls.find(call => call.command === 'synthetic-sequential')?.timeoutMs).toBe(timeoutMs);
    } else {
      await expect(result).rejects.toThrow('timeout');
      expect(calls.some(call => call.command === 'synthetic-sequential')).toBe(false);
    }
    expect(calls.filter(call => call.command !== 'synthetic-sequential').every(call => call.timeoutMs === 30 * 60_000)).toBe(true);
  }
});
