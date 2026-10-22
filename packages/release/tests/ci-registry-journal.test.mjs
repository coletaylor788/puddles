import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectCandidates, loadCandidate, pinCandidate, publishCandidate } from '../src/ci-candidate.mjs';

const module = fileURLToPath(new URL('../src/ci-candidate.mjs', import.meta.url));
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'candidate-journal-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = join(root, 'registry'), source = join(root, 'source'); mkdirSync(source);
  writeFileSync(join(source, 'payload'), 'frozen content');
  const inputs = { repositories: [{ repository: 'example/app', head: '1'.repeat(40), base: '2'.repeat(40), tree: '3'.repeat(40), pullRequest: 1 }] };
  const policy = { maxBytes: 1024 * 1024, reserveBytes: 0 };
  return { root, registry, source, inputs, policy };
}
function killed(f, action, point, before = '') {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { publishCandidate, collectCandidates } from ${JSON.stringify(module)};
    import { unlinkSync } from 'node:fs';
    const f = ${JSON.stringify(f)};
    const fault = (point, value) => {
      if (point === ${JSON.stringify(point)}) { ${before} process.kill(process.pid, 'SIGKILL'); }
    };
    ${action === 'publish' ? 'publishCandidate(f.registry, f.source, f.inputs, f.policy, undefined, fault)' : 'collectCandidates(f.registry, {maxAgeMs:0}, Date.now(), fault)'};
  `], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.signal, 'SIGKILL', result.stderr);
}
for (const point of ['journal-before-commit', 'allocation-before-mkdir', 'allocation-after-mkdir', 'allocation-owner-written', 'allocation-owner-published', 'publication-owner-ready']) {
  test('publication SIGKILL recovers at ' + point, t => {
    const f = fixture(t); killed(f, 'publish', point);
    collectCandidates(f.registry, { maxAgeMs: 0 });
    assert.deepEqual(readdirSync(f.registry).filter(name => /^[a-f0-9]{64}$/.test(name)), []);
    const manifest = publishCandidate(f.registry, f.source, f.inputs, f.policy);
    assert.equal(loadCandidate(f.registry, manifest.id).manifest.id, manifest.id);
  });
}
for (const point of ['journal-before-commit', 'retirement-registered', 'retirement-entry-removed', 'retirement-root-removed']) {
  test('retirement SIGKILL recovers at ' + point, t => {
    const f = fixture(t), manifest = publishCandidate(f.registry, f.source, f.inputs, f.policy);
    killed(f, 'collect', point);
    const removed = collectCandidates(f.registry, { maxAgeMs: 0 });
    if (point === 'retirement-root-removed') assert.deepEqual(removed, [], 'absence alone is not a new retirement confirmation');
    assert.equal(existsSync(join(f.registry, manifest.id)), false);
    // Journal database shrinks after deletion rather than accumulating receipts.
    assert.ok(readFileSync(join(f.registry, '.registry.lock/ownership.sqlite')).length < 64 * 1024);
  });
}
test('retirement resumes after owner removal while payload still exists and refuses new consumers', t => {
  const f = fixture(t), manifest = publishCandidate(f.registry, f.source, f.inputs, f.policy);
  killed(f, 'collect', 'retirement-registered', "unlinkSync(f.registry + '/' + value.id + '/owner.json');");
  assert.ok(existsSync(join(f.registry, manifest.id, 'artifact/payload')));
  assert.throws(() => loadCandidate(f.registry, manifest.id), /incomplete/);
  assert.throws(() => pinCandidate(f.registry, manifest.id, 'late'), /incomplete/);
  assert.throws(() => publishCandidate(f.registry, f.source, f.inputs, f.policy), /incomplete/);
  assert.deepEqual(collectCandidates(f.registry, { maxAgeMs: 0, protectedIds: [manifest.id] }), []);
  assert.ok(existsSync(join(f.registry, manifest.id)));
  assert.deepEqual(collectCandidates(f.registry, { maxAgeMs: 0 }), [manifest.id]);
});
test('retirement refuses changed identities, additional contents and later consumer files', async t => {
  for (const mutation of ['replace', 'extra', 'consumer']) await t.test(mutation, t => {
    const f = fixture(t), manifest = publishCandidate(f.registry, f.source, f.inputs, f.policy), directory = join(f.registry, manifest.id);
    killed(f, 'collect', 'retirement-registered');
    if (mutation === 'replace') { unlinkSync(join(directory, 'artifact/payload')); writeFileSync(join(directory, 'artifact/payload'), 'replacement'); }
    if (mutation === 'extra') writeFileSync(join(directory, 'foreign'), 'retain');
    if (mutation === 'consumer') { mkdirSync(join(directory, 'consumers')); writeFileSync(join(directory, 'consumers/foreign.json'), '{}'); }
    if (mutation === 'consumer') assert.deepEqual(collectCandidates(f.registry, { maxAgeMs: 0 }), []);
    else assert.throws(() => collectCandidates(f.registry, { maxAgeMs: 0 }), /changed/);
    assert.ok(existsSync(join(directory, 'owner.json')));
  });
});
test('allocation recovery holds unexpected paths and partial marker changes', async t => {
  for (const mutation of ['extra', 'marker']) await t.test(mutation, t => {
    const f = fixture(t); killed(f, 'publish', 'allocation-after-mkdir');
    const directory = join(f.registry, readdirSync(f.registry).find(name => /^[a-f0-9]{64}$/.test(name)));
    writeFileSync(join(directory, mutation === 'extra' ? 'foreign' : '.owner-publishing.tmp'), 'not owned');
    assert.throws(() => collectCandidates(f.registry, { maxAgeMs: 0 }), /allocation/);
    assert.ok(existsSync(directory));
  });
});
test('publication exception cleanup is journaled and resumes after SIGKILL', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { publishCandidate } from ${JSON.stringify(module)};
    const f = ${JSON.stringify(f)};
    publishCandidate(f.registry, f.source, f.inputs, f.policy, undefined, (point) => {
      if (point === 'publication-owner-ready') throw Error('copy failure');
      if (point === 'retirement-registered') process.kill(process.pid, 'SIGKILL');
    });
  `], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.signal, 'SIGKILL', result.stderr);
  assert.equal(collectCandidates(f.registry, { maxAgeMs: 0 }).length, 1);
});
test('ordinary pinned candidates and unowned directories are not adopted', t => {
  const f = fixture(t), manifest = publishCandidate(f.registry, f.source, f.inputs, f.policy);
  pinCandidate(f.registry, manifest.id, 'active');
  assert.deepEqual(collectCandidates(f.registry, { maxAgeMs: 0 }), []);
  const unknown = join(f.registry, 'f'.repeat(64)); mkdirSync(unknown);
  assert.throws(() => collectCandidates(f.registry, { maxAgeMs: 0 }), /ENOENT/);
  assert.ok(existsSync(unknown));
});


test('journal database and rollback sidecar reject links without changing external bytes', async t => {
  for (const suffix of ['', '-journal']) await t.test(suffix || 'database', t => {
    const f = fixture(t), manifest = publishCandidate(f.registry, f.source, f.inputs, f.policy);
    const database = join(f.registry, '.registry.lock/ownership.sqlite'), outside = join(f.root, 'outside.sqlite');
    const original = readFileSync(database); writeFileSync(outside, original);
    if (!suffix) unlinkSync(database);
    symlinkSync(outside, database + suffix);
    assert.throws(() => collectCandidates(f.registry, { maxAgeMs: 0 }), /Linked|journal/);
    assert.throws(() => loadCandidate(f.registry, manifest.id), /Linked|journal/);
    assert.deepEqual(readFileSync(outside), original);
    assert.ok(existsSync(join(f.registry, manifest.id, 'owner.json')));
  });
});
