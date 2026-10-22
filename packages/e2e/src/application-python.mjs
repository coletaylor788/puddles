import { existsSync, mkdirSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export function selectApplicationPythonPaths(site, selected) {
  writeFileSync(join(site, 'puddles_application_test_environment.py'), `import sys
sys.dont_write_bytecode = True
paths = ${JSON.stringify(selected)}
sys.path[:] = [p for p in sys.path if p not in paths]
i = sys.path.index(${JSON.stringify(site)})
sys.path[i:i] = paths
`);
  writeFileSync(join(site, '00-puddles-application-test.pth'), 'import puddles_application_test_environment\n');
}

// The caller owns this scratch through its durable test operation. This module
// never allocates beside source, inside the artifact, or in a shared toolchain.
export async function prepareApplicationPython({ repository, artifact, scratch, env, run }) {
  if (!isAbsolute(scratch ?? '') || resolve(scratch) !== scratch || realpathSync(scratch) !== scratch ||
      [repository, artifact].some(root => scratch === root || scratch.startsWith(root + '/') || root.startsWith(scratch + '/')) || readdirSync(scratch).length) {
    throw new Error('Python checks require a separate empty owned scratch directory');
  }
  const base = env.GMAIL_MCP_PYTHON ?? 'python3.11';
  const clean = { ...env, PYTHONPATH: '', PYTHONHOME: '', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
    PIP_CONFIG_FILE: '/dev/null', PIP_DISABLE_PIP_VERSION_CHECK: '1', PIP_NO_CACHE_DIR: '1',
    TMPDIR: join(scratch, 'tmp'), TEMP: join(scratch, 'tmp'), TMP: join(scratch, 'tmp'),
    XDG_CACHE_HOME: join(scratch, 'cache'), PYTEST_ADDOPTS: '-o cache_dir=' + join(scratch, 'pytest-cache'), RUFF_CACHE_DIR: join(scratch, 'ruff-cache'), HYPOTHESIS_STORAGE_DIRECTORY: join(scratch, 'hypothesis') };
  mkdirSync(clean.TMPDIR); mkdirSync(clean.XDG_CACHE_HOME);
  // The packaged native wheels are built for CPython 3.11. This is independent
  // of the locked dev tools and must fail before installation on another ABI.
  await run(base, ['-I', '-B', '-c', 'import sys; assert sys.version_info[:2] == (3, 11), "Application Python checks require Python 3.11"'], { env: clean });
  const interpreters = {};
  for (const [service, plugin, module] of [['gmail-mcp', 'secure-gmail', 'gmail_mcp'], ['rocket-money-mcp', 'rocket-money', 'rocket_money_mcp']]) {
    const root = join(scratch, service), python = join(root, 'bin/python');
    const runtime = realpathSync(join(artifact, 'plugins', plugin, 'python/lib'));
    if (!runtime.startsWith(artifact + '/')) throw new Error('Python runtime escapes the frozen artifact');
    await run(base, ['-I', '-B', '-m', 'venv', root], { env: clean });
    await run(python, ['-I', '-B', '-m', 'pip', '--isolated', '--disable-pip-version-check', 'install', '--no-cache-dir', '--no-deps', '--only-binary=:all:', '--require-hashes', '--index-url', 'https://pypi.org/simple', '-r', join(repository, 'packages/e2e/python-test-tools.lock')], { env: clean });
    const site = join(root, 'lib/python3.11/site-packages');
    const packages = [join(repository, 'servers', service), ...(service === 'rocket-money-mcp' ? [join(repository, 'packages/browser-auth')] : [])];
    for (const source of packages) {
      if (!existsSync(join(source, 'pyproject.toml'))) throw new Error('Reviewed Python source is missing');
      await run(python, ['-I', '-B', '-m', 'pip', '--isolated', '--disable-pip-version-check', 'install', '--no-cache-dir', '--no-deps', '--no-build-isolation', '-e', source], { env: clean });
    }
    // A unique .pth hook runs even when the host stdlib owns sitecustomize.
    selectApplicationPythonPaths(site, [...packages.map(path => join(path, 'src')), runtime]);
    const expected = { [module]: join(packages[0], 'src', module, '__init__.py'),
      ...(service === 'rocket-money-mcp' ? { puddles_browser_auth: join(packages[1], 'src/puddles_browser_auth/__init__.py') } : {}) };
    await run(python, ['-I', '-c', `import sys; assert sys.dont_write_bytecode; import importlib, pathlib, json; expected=json.loads(${JSON.stringify(JSON.stringify(expected))}); actual={name:str(pathlib.Path(importlib.import_module(name).__file__).resolve()) for name in expected}; assert actual == expected, (actual, expected); import pytest, pytest_asyncio, hypothesis, ruff, pydantic; assert str(pathlib.Path(pydantic.__file__).resolve()).startswith(${JSON.stringify(runtime + '/')})`], { env: {} });
    interpreters[service] = python;
  }
  return { interpreters, pythonEnv: { ...clean, GMAIL_MCP_PYTHON: interpreters['gmail-mcp'] },
    // Keep the maintained Node/pnpm cache settings outside Python-only commands.
    env: { ...env, PYTHONPATH: '', PYTHONHOME: '', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
      TMPDIR: clean.TMPDIR, TEMP: clean.TEMP, TMP: clean.TMP, GMAIL_MCP_PYTHON: interpreters['gmail-mcp'] } };
}
