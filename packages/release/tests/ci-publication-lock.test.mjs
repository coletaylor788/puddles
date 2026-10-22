import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { lock, admissionLock } from '../src/files.mjs';
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
    const manifest = await publishCandidate(f.registry, f.source, f.inputs, f.policy, undefined,
      point => { if (point === 'publication-owner-ready') allocations++; });
    assert.ok(performance.now() - started >= 250, 'waited for the competing process');
    assert.equal(allocations, 1);
    assert.equal(loadCandidate(f.registry, manifest.id).manifest.id, manifest.id);
    assert.deepEqual(readdirSync(f.registry).filter(name => /^[a-f0-9]{64}$/.test(name)), [manifest.id]);
  } finally { await stop(); }
});

test('publication deadline leaves no allocation or partial candidate', async t => {
  const f = fixture(t), stop = await owner(f.path);
  try {
    const started = performance.now();
    await assert.rejects(publishCandidate(f.registry, f.source, f.inputs, f.policy, undefined, undefined,
      { timeoutMs: 150, deadline: performance.now() + 60_000 }), /Operation is already running/);
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 140 && elapsed < 2000, `clamped publication wait: ${elapsed}ms`);
    assert.deepEqual(readdirSync(f.registry), ['.registry.lock']);
    assert.equal(existsSync(join(f.path, 'ownership.sqlite')), false);
  } finally { await stop(); }
});

test('background admission returns promptly and permanent failures do not retry', async t => {
  const f = fixture(t), stop = await owner(f.path);
  try {
    const started = performance.now();
    await assert.rejects(admissionLock(f.path, { timeoutMs: 0 }), /Operation is already running/);
    assert.ok(performance.now() - started < 500);
  } finally { await stop(); }
  writeFileSync(join(f.path, 'lock.sqlite'), 'corrupt database');
  const started = performance.now();
  await assert.rejects(admissionLock(f.path, { timeoutMs: 5000 }), error => error.cause?.errcode === 26);
  assert.ok(performance.now() - started < 500, 'permanent SQLite failure is not contention');
  for (const timeoutMs of [-1, 330001, 0.5, NaN, Infinity, '100', null]) {
    const absent = join(f.root, 'invalid-async');
    await assert.rejects(admissionLock(absent, { timeoutMs }), /Invalid admission timeout/);
    assert.equal(existsSync(absent), false);
  }
});

test('SIGTERM interrupts yielded admission before publication and releases listeners', async t => {
  const f = fixture(t), stop = await owner(f.path);
  try {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import {publishCandidate} from ${JSON.stringify(new URL('../src/ci-candidate.mjs', import.meta.url).href)};
      const f=${JSON.stringify(f)};
      const pending=publishCandidate(f.registry,f.source,f.inputs,f.policy);
      console.log('waiting');
      try { await pending; process.exitCode=2; } catch(error) {
        if(error.message !== 'CI admission interrupted') throw error;
        if(process.listenerCount('SIGTERM')) throw Error('signal listener retained');
      }
    `], {stdio:['ignore','pipe','pipe']});
    const exited=once(child,'exit');
    await once(child.stdout,'data'); child.kill('SIGTERM');
    const [code,signal]=await exited;
    assert.equal(code,0); assert.equal(signal,null);
    assert.deepEqual(readdirSync(f.registry),['.registry.lock']);
  } finally { await stop(); }
  (await admissionLock(f.path,{timeoutMs:0}))();
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
