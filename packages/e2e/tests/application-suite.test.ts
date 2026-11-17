import { afterEach, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error executable module
import { applicationSuite as rawApplicationSuite, repository, runMappedTests as rawRunMappedTests, runCombinedProjects as rawRunCombinedProjects } from '../src/application-suite.mjs';
// @ts-expect-error executable module
import { applicationTestProject } from '../src/application-test-projects.mjs';
import { runCommand } from '../src/process-runner.mjs';
const roots: string[] = [];
const scratchRoot = () => { const path = realpathSync(mkdtempSync(join(tmpdir(), 'application-suite-scratch-'))); roots.push(path); return path; };
const runMappedTests = (...args: unknown[]) => rawRunMappedTests(...args, 4, scratchRoot());
const runCombinedProjects = (...args: unknown[]) => rawRunCombinedProjects(...args, scratchRoot());
const applicationSuite = (options: object, ...args: unknown[]) => rawApplicationSuite({scratch:scratchRoot(), ...options}, ...args);
const preparedPython = async ({env}: {env: Record<string,string>}) => ({env, pythonEnv: {...env,XDG_CACHE_HOME:'/owned/python-cache'}, interpreters: {'gmail-mcp':'fixture-gmail-python', 'rocket-money-mcp':'fixture-rocket-python'}});
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
  expect(calls[2].filter(x => x.endsWith('.test.ts'))).toEqual(['new.test.ts', 'old.test.ts', 'shared.test.ts']);
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
  const result = await applicationSuite({source: root, artifact: root, workers: 4, env:{XDG_CACHE_HOME:'/maintained/cache'}}, async (command: string, args: string[], options: {env: Record<string, string>}) => {
    calls.push({command, args, options});
    return combinedListing(args) ?? args.filter(arg => /\.test\.tsx?$/.test(arg)).join('\n');
  }, preparedPython);
  expect(result.status).toBe('passed');
  expect(calls.some(({args}) => args.includes('build') || args.some(arg => arg.includes('packages/release')))).toBe(false);
  expect(calls.some(({args}) => args.join(' ') === 'pnpm test')).toBe(true);
  expect(calls.some(({args}) => args.includes('pytest'))).toBe(true);
  expect(calls.filter(({args}) => args.includes('pytest') || args.includes('ruff')).every(({options}) => options.env.XDG_CACHE_HOME === '/owned/python-cache')).toBe(true);
  expect(calls.filter(({command}) => command === 'corepack').every(({options}) => options.env.XDG_CACHE_HOME === '/maintained/cache')).toBe(true);
  expect(calls.some(({args}) => args.some(arg => arg.endsWith('/bin/test-application.mjs')))).toBe(true);
  expect(calls.every(({options}) => options.env.OPENCLAW_CANDIDATE_DIR === root)).toBe(true);
  expect(calls.every(({options}) => options.env.OPENCLAW_VITEST_MAX_WORKERS === '4')).toBe(true);
  expect(calls.filter(({args}) => !args.includes('pytest') && !args.includes('ruff')).every(({options}) => options.env.OPENCLAW_VITEST_FS_MODULE_CACHE_ROOT.endsWith('/vitest-cache'))).toBe(true);
  const native = calls.filter(({args}) => args[0] === 'scripts/run-vitest.mjs');
  expect(native.filter(({args}) => args[1] === 'list').every(({options}) => options.env.OPENCLAW_VITEST_FS_MODULE_CACHE_PATH.endsWith('/vitest-discovery-cache'))).toBe(true);
  expect(native.filter(({args}) => args[1] === 'run').every(({options}) => options.env.OPENCLAW_VITEST_FS_MODULE_CACHE_PATH === '')).toBe(true);
});

it('rejects lost, added or reassigned regressions in combined discovery', async () => {
  const root = source(['a.test.ts']);
  for (const collected of ['', '[unit] extra.test.ts', '[other] a.test.ts']) {
    await expect(runCombinedProjects(root, new Map([['unit', new Set(['a.test.ts'])]]), async () => collected, [])).rejects.toThrow('differs from mapped regressions');
  }
});

it('bounds native process lifetime by project/file pairs without dropping duplicate modes', async () => {
  const files = Array.from({length: 65}, (_, index) => `case-${index}.test.ts`);
  const root = source(files);
  for (const count of [64, 65]) {
    const listings: string[] = [], runs: string[][] = [];
    await runCombinedProjects(root, new Map([['unit', new Set(files.slice(0, count))]]), async (_: string, args: string[]) => {
      const listing = combinedListing(args)!;
      if (args[1] === 'list') listings.push(listing);
      else { expect(listings).toHaveLength(count === 64 ? 1 : 2); runs.push(listing.split('\n')); }
      return listing;
    }, ['--maxWorkers', '4']);
    expect(runs.map(rows => rows.length)).toEqual(count === 64 ? [64] : [64, 1]);
    expect(runs.flat()).toEqual(files.slice(0, count).sort().map(file => `[unit] ${file}`));
  }
  const runs: string[][] = [];
  await runCombinedProjects(root, new Map([['unit', new Set(files)], ['isolated', new Set(files)]]), async (_: string, args: string[]) => {
    const listing = combinedListing(args)!;
    if (args[1] === 'run') runs.push(listing.split('\n'));
    return listing;
  }, ['--maxWorkers', '4']);
  expect(runs.map(rows => rows.length)).toEqual([64, 64, 2]);
  expect(runs.flat()).toEqual(['isolated', 'unit'].flatMap(mode => [...files].sort().map(file => `[${mode}] ${file}`)));
});

it('fails the gate and cleans generated configs when a native batch fails', async () => {
  const files = Array.from({length: 130}, (_, index) => `case-${index}.test.ts`);
  const root = source(files), scratch = scratchRoot(); let runs = 0;
  await expect(rawRunCombinedProjects(root, new Map([['unit', new Set(files)]]), async (_: string, args: string[]) => {
    if (args[1] === 'run' && ++runs === 2) throw new Error('native batch failed');
    return combinedListing(args);
  }, ['--maxWorkers', '4'], scratch)).rejects.toThrow('native batch failed');
  expect(runs).toBe(2);
  expect(existsSync(join(scratch, 'combined-projects'))).toBe(false);
});

it('rejects a missing mode in a later batch before running the first batch', async () => {
  const files = Array.from({length: 65}, (_, index) => `case-${index}.test.ts`);
  const root = source(files); let lists = 0, runs = 0;
  await expect(runCombinedProjects(root, new Map([['unit', new Set(files)]]), async (_: string, args: string[]) => {
    if (args[1] === 'run') runs++;
    return ++lists === 2 ? '' : combinedListing(args);
  }, [])).rejects.toThrow('differs from mapped regressions');
  expect(runs).toBe(0);
});

it('executes every same-file project mode once across fresh native processes', async () => {
  const files = Array.from({length: 33}, (_, index) => `case-${index}.test.ts`);
  const root = realpathSync(source(files)), scratch = scratchRoot(), result = join(root, 'results.jsonl');
  const modules = fileURLToPath(new URL('../node_modules/', import.meta.url));
  symlinkSync(modules, join(root, 'node_modules'));
  mkdirSync(join(root, 'scripts')); mkdirSync(join(root, 'test/vitest'), {recursive: true});
  writeFileSync(join(root, 'vitest.config.ts'), `export default {root:${JSON.stringify(root)},test:{}};`);
  writeFileSync(join(root, 'scripts/run-vitest.mjs'), `import ${JSON.stringify(join(modules, 'vitest/vitest.mjs'))};`);
  for (const project of ['normal', 'serial']) {
    writeFileSync(join(root, `test/vitest/vitest.${project}.config.ts`), `export default {test:{name:${JSON.stringify(project)},pool:'forks',isolate:true,${project === 'serial' ? 'fileParallelism:false,' : ''}env:{PROBE_MODE:${JSON.stringify(project)}}}};`);
  }
  for (const file of files) writeFileSync(join(root, file), `import {test} from 'vitest';import {appendFileSync} from 'node:fs';test('marker',()=>appendFileSync(${JSON.stringify(result)},JSON.stringify({pair:process.env.PROBE_MODE+':'+${JSON.stringify(file)},parent:process.ppid})+'\\n'));`);
  await rawRunCombinedProjects(root, new Map(['normal', 'serial'].map(mode => [mode, new Set(files)])),
    (command: string, args: string[], options: object) => runCommand(command, args, {...options, capture: true, quiet: true, timeoutMs: 60_000}),
    ['--maxWorkers', '2'], scratch);
  const rows = readFileSync(result, 'utf8').trim().split('\n').map(line => JSON.parse(line) as {pair: string; parent: number});
  expect(rows.map(row => row.pair).sort()).toEqual(['normal', 'serial'].flatMap(mode => files.map(file => mode + ':' + file)).sort());
  expect(new Set(rows.map(row => row.parent)).size).toBe(2);
}, 120_000);

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
    }, preparedPython);
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


it('keeps combined configs deterministic inside owned scratch and cleans on failure', async () => {
  const root = source(['a.test.ts']), scratch = scratchRoot();
  const paths: string[] = [];
  for (const fail of [false, true, false]) {
    const operation = rawRunCombinedProjects(root, new Map([['unit', new Set(['a.test.ts'])]]), async (_: string, args: string[]) => {
      const path = args[args.indexOf('--config') + 1]; paths.push(path);
      expect(path).toBe(join(scratch, 'combined-projects/vitest.config.mts'));
      if (fail && args[1] === 'run') throw new Error('owned failure');
      return combinedListing(args);
    }, [], scratch);
    if (fail) await expect(operation).rejects.toThrow('owned failure'); else await operation;
    expect(existsSync(join(scratch, 'combined-projects'))).toBe(false);
  }
  expect(new Set(paths).size).toBe(1);
});
