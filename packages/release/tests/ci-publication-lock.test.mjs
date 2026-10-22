import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { lock } from '../src/files.mjs';
import { loadCandidate, publishCandidate } from '../src/ci-candidate.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'publication-lock-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = join(root, 'registry'), source = join(root, 'source');
  mkdirSync(source); mkdirSync(registry); writeFileSync(join(source, 'payload'), 'frozen build');
  return { root, registry, source, path: join(registry, '.registry.lock'),
    inputs: { repositories: [{ repository: 'example/app', head: '1'.repeat(40), base: '2'.repeat(40), tree: '3'.repeat(40) }] },
    policy: { maxBytes: 1024 * 1024, reserveBytes: 0 } };
}
async function owner(path, releaseAfter) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {lock} from ${JSON.stringify(new URL('../src/files.mjs', import.meta.url).href)};
    const release = lock(${JSON.stringify(path)});
    process.once('SIGTERM', release);
    console.log('locked');
    ${releaseAfter === undefined ? 'setInterval(() => {}, 1000);' : `setTimeout(() => { release(); }, ${releaseAfter});`}
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = once(child, 'exit');
  await once(child.stdout, 'data');
  return async () => { child.kill('SIGKILL'); await exited; };
}

test('publication waits for a real maintenance owner then publishes exactly once', async t => {
  const f = fixture(t), stop = await owner(f.path, 400);
  let allocations = 0;
  try {
    const started = performance.now();
    const manifest = publishCandidate(f.registry, f.source, f.inputs, f.policy, undefined,
      point => { if (point === 'publication-owner-ready') allocations++; });
    assert.ok(performance.now() - started >= 250, 'waited for the competing process');
    assert.equal(allocations, 1);
    assert.equal(loadCandidate(f.registry, manifest.id).manifest.id, manifest.id);
    assert.deepEqual(readdirSync(f.registry).filter(name => /^[a-f0-9]{64}$/.test(name)), [manifest.id]);
  } finally { await stop(); }
});

test('publication deadline leaves no allocation or partial candidate', { timeout: 40_000 }, async t => {
  const f = fixture(t), stop = await owner(f.path);
  try {
    const started = performance.now();
    assert.throws(() => publishCandidate(f.registry, f.source, f.inputs, f.policy), /Operation is already running/);
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 29_000 && elapsed < 35_000, `bounded publication wait: ${elapsed}ms`);
    assert.deepEqual(readdirSync(f.registry), ['.registry.lock']);
    assert.ok(readdirSync(f.path).every(name => ['lock.sqlite', 'lock.sqlite-journal'].includes(name)),
      'only the competing owner lock database and its rollback journal exist before admission');
    assert.equal(existsSync(join(f.path, 'ownership.sqlite')), false);
  } finally { await stop(); }
});

test('ordinary locks remain nonblocking and configured deadlines are bounded', async t => {
  const f = fixture(t), stop = await owner(f.path);
  try {
    const started = performance.now();
    assert.throws(() => lock(f.path), /Operation is already running/);
    assert.ok(performance.now() - started < 1000);
    const waiting = performance.now();
    assert.throws(() => lock(f.path, { timeoutMs: 100 }), /Operation is already running/);
    assert.ok(performance.now() - waiting >= 80);
  } finally { await stop(); }
  lock(f.path, { timeoutMs: 0 })();
  for (const timeoutMs of [-1, 30_001, 0.5, NaN, Infinity, '100', null]) {
    const absent = join(f.root, 'invalid');
    assert.throws(() => lock(absent, { timeoutMs }), /Invalid lock timeout/);
    assert.equal(existsSync(absent), false, 'invalid timeout cannot create a lock directory');
  }
});
