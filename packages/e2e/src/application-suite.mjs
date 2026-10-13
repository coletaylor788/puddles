import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCommand } from './process-runner.mjs';

export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export function safeNode(version = process.versions.node) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor] = version.split('.').map(Number);
  return major === 24 && minor >= 16 || major === 26 && minor >= 1 || major > 26;
}
export function nativeRegressionTargets(suite) {
  return {
    tests: [...new Set([...(suite.patches ?? []).flatMap(patch => patch.tests), ...(suite.tests ?? [])])],
    candidateTests: [...new Set([...(suite.patches ?? []).flatMap(patch => patch.candidateTests ?? []), ...(suite.candidateTests ?? [])])],
  };
}
function relativeFile(path) {
  if (typeof path !== 'string' || isAbsolute(path) || path.split('/').includes('..')) throw new Error('Test paths must be relative to their source');
  return path;
}
const collected = (output, target) => output.split('\n').some(line => {
  const path = line.replace(/\x1b\[[0-9;]*m/g, '').trim().replace(/^\[[^\]]+\]\s+/, '');
  return path === target || path.endsWith('/' + target);
});

/** Resolve alternatives in batches; run a target only once per selected project. */
export async function runMappedTests(source, manifests, run, workers = 4) {
  if (!Number.isSafeInteger(workers) || workers < 1) throw new Error('Test workers must be a positive integer');
  const requests = new Map();
  for (const manifest of manifests) for (const target of nativeRegressionTargets(manifest).tests) {
    relativeFile(target);
    if (!existsSync(join(source, target))) throw new Error(`Mapped regression is missing: ${target}`);
    const value = manifest.testProjects[target];
    const projects = Array.isArray(value) ? value : [value];
    if (!projects.length || projects.some(project => !/^[a-z][a-z0-9-]*$/.test(project ?? ''))) throw new Error(`Mapped regression has no test project: ${target}`);
    requests.set(JSON.stringify([target, projects]), { target, projects, index: 0 });
  }
  const selected = new Map();
  let pending = [...requests.values()];
  const flags = ['--maxWorkers', String(workers)];
  while (pending.length) {
    const batches = new Map();
    for (const item of pending) {
      const project = item.projects[item.index];
      if (!project) throw new Error(`Mapped regression was not collected: ${item.target}`);
      if (!batches.has(project)) batches.set(project, []);
      batches.get(project).push(item);
    }
    pending = [];
    for (const [project, items] of batches) {
      const targets = [...new Set(items.map(item => item.target))];
      const config = `test/vitest/vitest.${project}.config.ts`;
      const output = await run(process.execPath, ['scripts/run-vitest.mjs', 'list', '--filesOnly', '--passWithNoTests', '--config', config, ...flags, ...targets], { cwd: source, capture: true });
      for (const item of items) {
        if (!collected(output, item.target)) { pending.push({ ...item, index: item.index + 1 }); continue; }
        if (!selected.has(project)) selected.set(project, new Set());
        selected.get(project).add(item.target);
      }
    }
  }
  const ordinary = new Map([...selected].filter(([project]) => project !== 'e2e'));
  if (ordinary.size) await runCombinedProjects(source, ordinary, run, flags);
  // The upstream e2e entrypoint deliberately runs distinct transport modes.
  if (selected.has('e2e')) await run(process.execPath, ['scripts/run-vitest.mjs', 'run', '--config', 'test/vitest/vitest.e2e.config.ts', ...flags, ...selected.get('e2e')], { cwd: source });
  return { projects: selected.size, tests: [...selected.values()].reduce((count, files) => count + files.size, 0) };
}

export async function runCombinedProjects(source, selected, run, flags) {
  const directory = mkdtempSync(join(dirname(source), 'application-projects-'));
  const path = join(directory, 'vitest.config.mts');
  const selection = [...selected].map(([project, files]) => ({ project, files: [...files] }));
  const targets = [...new Set(selection.flatMap(group => group.files))];
  const imports = selection.map(({ project }, index) => `import p${index} from ${JSON.stringify(join(source, `test/vitest/vitest.${project}.config.ts`))};`).join('\n');
  const workers = Number(flags[flags.indexOf('--maxWorkers') + 1] ?? 4);
  writeFileSync(path, `import base from ${JSON.stringify(join(source, 'vitest.config.ts'))};\nimport {applicationTestProject} from ${JSON.stringify(join(repository, 'packages/e2e/src/application-test-projects.mjs'))};\n${imports}\nconst selection = ${JSON.stringify(selection)};\nconst configs = [${selection.map((_, index) => `p${index}`).join(',')}];\nexport default {...base,test:{...base.test,root:${JSON.stringify(source)},projects:configs.map((config,index)=>applicationTestProject(config,selection[index].files,${JSON.stringify(source)},${workers}))}};\n`);
  try {
    // Retain each existing project's runtime, isolation and setup. Verify the
    // combined collector selects exactly the same file/project pairs.
    const args = ['scripts/run-vitest.mjs', 'list', '--filesOnly', '--config', path, ...flags, ...targets];
    const output = await run(process.execPath, args, { cwd: source, capture: true });
    const expected = selection.flatMap(({ project, files }) => files.map(file => project + ':' + file)).sort();
    const actual = output.split('\n').flatMap(line => {
      const match = line.replace(/\x1b\[[0-9;]*m/g, '').trim().match(/^\[([^\]]+)\]\s+(.+)$/);
      return match ? [match[1] + ':' + match[2].replace(source + '/', '')] : [];
    }).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Combined project discovery differs from mapped regressions');
    await run(process.execPath, ['scripts/run-vitest.mjs', 'run', '--config', path, ...flags, ...targets], { cwd: source });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

export async function applicationSuite({ source, artifact, extensionPath, workers = 4, env = process.env }, execute = runCommand) {
  if (!safeNode()) throw new Error('Application checks require SQLite-safe Node 24.16+ or 26.1+');
  if (!isAbsolute(source ?? '') || !existsSync(join(source, 'dist'))) throw new Error('OPENCLAW_SRC must name the prepared, incrementally built feature source');
  if (!isAbsolute(artifact ?? '') || !existsSync(join(artifact, 'openclaw.mjs'))) throw new Error('OPENCLAW_CANDIDATE_DIR must name the complete built feature output');
  const suite = JSON.parse(readFileSync(join(repository, 'packages/e2e/openclaw-patch-suite.json'), 'utf8'));
  // Optional application-owned companion. No release-tool imports or auto-discovery.
  const extension = extensionPath ? (await import(pathToFileURL(realpathSync(extensionPath)).href)).default : {};
  const manifests = [suite, ...(extension.suites ?? [])];
  const testEnv = { ...env, OPENCLAW_SRC: source, OPENCLAW_CANDIDATE_DIR: artifact,
    OPENCLAW_COMBINED_CANDIDATE: source, OPENCLAW_CANDIDATE: source, OPENCLAW_VITEST_WORKER_CACHE: '1',
    OPENCLAW_VITEST_MAX_WORKERS: String(workers), OPENCLAW_E2E_USE_PREBUILT_DIST: '1' };
  const run = async (command, args, options = {}) => {
    const start = Date.now();
    try { return await execute(command, args, { cwd: repository, timeoutMs: 30 * 60_000, env: testEnv, ...options }); }
    finally { console.log(JSON.stringify({ check: [command, ...args].join(' '), durationMs: Date.now() - start })); }
  };
  // Build belongs to the feature's incremental loop. This command only tests its output.
  await run('corepack', ['pnpm', 'lint']);
  await run('corepack', ['pnpm', 'test']);
  const python = env.GMAIL_MCP_PYTHON ?? 'python3.11';
  for (const service of ['gmail-mcp', 'rocket-money-mcp']) {
    const cwd = join(repository, 'servers', service);
    await run(python, ['-m', 'pytest', 'tests/', '--ignore=tests/integration', '-q'], { cwd });
    await run(python, ['-m', 'ruff', 'check', 'src/', 'tests/', ...(service === 'rocket-money-mcp' ? ['../../packages/browser-auth/src'] : [])], { cwd });
  }
  await run('corepack', ['pnpm', 'prompt:snapshots:check'], { cwd: source });
  for (const project of new Set(manifests.flatMap(manifest => (manifest.patches ?? []).flatMap(patch => patch.typechecks ?? [])))) {
    relativeFile(project);
    await run(process.execPath, ['scripts/run-tsgo.mjs', '-p', project, '--incremental'], { cwd: source });
  }
  const mapped = await runMappedTests(source, manifests, run, workers);
  const candidateTests = nativeRegressionTargets(suite).candidateTests;
  if (candidateTests.length) {
    for (const file of candidateTests) relativeFile(file);
    await run('corepack', ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.candidate.config.ts', '--maxWorkers', String(workers), ...candidateTests], { cwd: join(repository, 'packages/e2e') });
  }
  await run(process.execPath, [join(repository, 'packages/e2e/bin/test-application.mjs')], {
    env: { ...testEnv, ...(extensionPath ? { E2E_APPLICATION_EXTENSION: extensionPath } : {}) },
  });
  for (const check of extension.checks ?? []) {
    if (!Array.isArray(check.args) || !isAbsolute(check.cwd ?? '')) throw new Error('Application companion checks require explicit commands and working directories');
    await run(check.command, check.args, { cwd: check.cwd, env: { ...testEnv, ...check.env } });
  }
  return { status: 'passed', ...mapped };
}
