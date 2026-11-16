import { afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error executable module
import { applicationSuite as rawApplicationSuite, repository, runMappedTests as rawRunMappedTests } from '../src/application-suite.mjs';
const roots: string[] = [];
const scratchRoot = () => { const path = realpathSync(mkdtempSync(join(tmpdir(), 'application-suite-scratch-'))); roots.push(path); return path; };
const runMappedTests = (...args: unknown[]) => rawRunMappedTests(...args, 4);
const applicationSuite = (options: object, ...args: unknown[]) => rawApplicationSuite({scratch:scratchRoot(), ...options}, ...args);
const preparedPython = async ({env}: {env: Record<string,string>}) => ({env, pythonEnv: {...env,XDG_CACHE_HOME:'/owned/python-cache'}, interpreters: {'gmail-mcp':'fixture-gmail-python', 'rocket-money-mcp':'fixture-rocket-python'}});
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function source(files: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'application-suite-')); roots.push(root);
  for (const file of files) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), ''); }
  return root;
}
it('deduplicates public and companion regressions within each native project', async () => {
  const root = source(['old.test.ts', 'shared.test.ts', 'new.test.ts']);
  const calls: string[][] = [];
  const run = async (_: string, args: string[]) => { calls.push(args); return args.filter(x => x.endsWith('.test.ts')).join('\n'); };
  const result = await runMappedTests(root, [
    { patches: [{ tests: ['old.test.ts', 'shared.test.ts'] }], testProjects: { 'old.test.ts': 'unit', 'shared.test.ts': 'unit' } },
    { tests: ['shared.test.ts', 'new.test.ts'], testProjects: { 'shared.test.ts': ['unit'], 'new.test.ts': ['unit'] } },
  ], run);
  expect(result).toEqual({ projects: 1, tests: 3 });
  expect(calls).toHaveLength(2);
  expect(calls[1].filter(x => x.endsWith('.test.ts'))).toEqual(['old.test.ts', 'shared.test.ts', 'new.test.ts']);
});
it('retains separate modes and resolves project alternatives without per-file subprocesses', async () => {
  const root = source(['shared.test.ts', 'fallback.test.ts']);
  const calls: string[][] = [];
  const run = async (_: string, args: string[]) => {
    calls.push(args);
    return args.filter(x => x.endsWith('.test.ts') && (x !== 'fallback.test.ts' || args.includes('test/vitest/vitest.fallback.config.ts'))).join('\n');
  };
  expect(await runMappedTests(root, [
    { tests: ['shared.test.ts'], testProjects: { 'shared.test.ts': 'normal' } },
    { tests: ['shared.test.ts', 'fallback.test.ts'], testProjects: { 'shared.test.ts': ['isolated'], 'fallback.test.ts': ['normal', 'fallback'] } },
  ], run)).toEqual({ projects: 3, tests: 3 });
  expect(calls.filter(args => args[1] === 'run')).toHaveLength(3);
});
it('refuses an uncollected historical regression before running any project', async () => {
  const root = source(['old.test.ts']); const calls: string[][] = [];
  await expect(runMappedTests(root, [{ tests: ['old.test.ts'], testProjects: { 'old.test.ts': 'unit' } }], async (_: string, args: string[]) => { calls.push(args); return ''; })).rejects.toThrow('was not collected');
  expect(calls.every(args => args[1] === 'list')).toBe(true);
});
it('preserves native child projects while limiting execution to mapped regressions', async () => {
  const root = source(['serial.test.ts', 'parallel.test.ts', 'ordinary.test.ts']);
  const calls: string[][] = [];
  const result = await runMappedTests(root, [{ tests: ['serial.test.ts', 'parallel.test.ts', 'ordinary.test.ts'],
    testProjects: { 'serial.test.ts': 'gateway-server', 'parallel.test.ts': 'gateway-server', 'ordinary.test.ts': 'unit' } }],
  async (_: string, args: string[]) => {
    calls.push(args);
    return (args.includes('test/vitest/vitest.gateway-server.config.ts')
      ? `[gateway-server (gateway-server-native)] ${root}/serial.test.ts\n[gateway-server (gateway-server-parallel)] parallel.test.ts`
      : '[unit] ordinary.test.ts');
  });
  expect(result).toEqual({ projects: 2, tests: 3 });
  const runs = calls.filter(args => args[1] === 'run');
  expect(runs).toHaveLength(2);
  expect(runs[1].filter(arg => arg.endsWith('.test.ts'))).toEqual(['ordinary.test.ts']);
  expect(runs[0]).toEqual(['scripts/run-vitest.mjs', 'run', '--config', 'test/vitest/vitest.gateway-server.config.ts',
    'serial.test.ts', 'parallel.test.ts']);
});
it('refuses extra or reassigned files in native container discovery', async () => {
  const root = source(['owned.test.ts']);
  for (const unexpected of ['[gateway-server (parallel)] extra.test.ts', '[other] owned.test.ts']) {
    const calls: string[][] = [];
    await expect(runMappedTests(root, [{ tests: ['owned.test.ts'], testProjects: { 'owned.test.ts': 'gateway-server' } }],
      async (_: string, args: string[]) => {
        calls.push(args);
        return `[gateway-server (parallel)] owned.test.ts\n${unexpected}`;
      })).rejects.toThrow('Native container discovery differs');
    expect(calls.every(args => args[1] === 'list')).toBe(true);
  }
});
it('collects Vitest project-prefixed filenames with optional terminal color', async () => {
  const root = source(['old.test.ts', 'new.test.ts']);
  expect(await runMappedTests(root, [{ tests: ['old.test.ts', 'new.test.ts'], testProjects: { 'old.test.ts': 'unit', 'new.test.ts': 'unit' } }], async () =>
    `\u001b[32m[unit]\u001b[0m old.test.ts\n[unit] ${root}/new.test.ts\n`)).toEqual({ projects: 1, tests: 2 });
});
it('fails when a project fails and never converts failure into an empty pass', async () => {
  const root = source(['old.test.ts']);
  await expect(runMappedTests(root, [{ tests: ['old.test.ts'], testProjects: { 'old.test.ts': 'unit' } }], async (_: string, args: string[]) => {
    if (args[1] === 'run') throw new Error('behavior regression'); return 'old.test.ts';
  })).rejects.toThrow('behavior regression');
});

it('the full application gate tests prepared output without invoking a build or release package', async () => {
  const manifest = JSON.parse(readFileSync(join(repository, 'packages/e2e/openclaw-patch-suite.json'), 'utf8'));
  const root = source(['dist/ready', 'openclaw.mjs', ...new Set<string>([...manifest.tests, ...manifest.patches.flatMap((patch: { tests: string[] }) => patch.tests)])]);
  const calls: Array<{command: string; args: string[]; options: {env: Record<string, string>}}> = [];
  const result = await applicationSuite({source: root, artifact: root, workers: 4, env:{XDG_CACHE_HOME:'/maintained/cache'}}, async (command: string, args: string[], options: {env: Record<string, string>}) => {
    calls.push({command, args, options});
    return args.filter(arg => /\.test\.tsx?$/.test(arg)).join('\n');
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

it('rejects added or reassigned regressions in native project discovery', async () => {
  const root = source(['a.test.ts']);
  for (const collected of ['[unit] extra.test.ts', '[other] a.test.ts']) {
    const calls: string[][] = [];
    await expect(runMappedTests(root, [{tests: ['a.test.ts'], testProjects: {'a.test.ts': 'unit'}}], async (_: string, args: string[]) => {
      calls.push(args); return collected;
    })).rejects.toThrow('Native project discovery differs');
    expect(calls.every(args => args[1] === 'list')).toBe(true);
  }
});

it('joins each native project before starting another and stops admission on failure', async () => {
  const root = source(['a.test.ts', 'b.test.ts', 'c.test.ts']);
  const manifests = [{tests: ['a.test.ts', 'b.test.ts', 'c.test.ts'], testProjects: {
    'a.test.ts': 'unit', 'b.test.ts': 'infra', 'c.test.ts': 'e2e',
  }}];
  for (const failure of [false, true]) {
    let finishFirst!: () => void;
    const first = new Promise<void>(resolve => { finishFirst = resolve; });
    let startedFirst!: () => void;
    const started = new Promise<void>(resolve => { startedFirst = resolve; });
    const runs: string[][] = [];
    let active = 0;
    const operation = runMappedTests(root, manifests, async (_: string, args: string[]) => {
      if (args[1] === 'list') return args.filter(a => a.endsWith('.test.ts')).join('\n');
      expect(active++).toBe(0);
      runs.push(args);
      try {
        if (runs.length === 1) { startedFirst(); await first; }
        if (failure) throw new Error('native project failed after teardown');
        return '';
      } finally { active--; }
    });
    const outcome = operation.then((value: unknown) => ({value}), (error: unknown) => ({error}));
    await started;
    expect(runs).toHaveLength(1);
    finishFirst();
    const result = await outcome;
    expect(active).toBe(0);
    if (failure) {
      expect(result).toHaveProperty('error.message', 'native project failed after teardown');
      expect(runs).toHaveLength(1);
    } else {
      expect(result).toHaveProperty('value', {projects: 3, tests: 3});
      expect(runs.map(args => args[args.indexOf('--config') + 1])).toEqual([
        'test/vitest/vitest.unit.config.ts', 'test/vitest/vitest.infra.config.ts', 'test/vitest/vitest.e2e.config.ts',
      ]);
      expect(runs.every(args => !args.includes('--maxWorkers'))).toBe(true);
    }
  }
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
      return args.filter(arg => /\.test\.tsx?$/.test(arg)).join('\n');
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
