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
    ${action === 'publish' ? 'await publishCandidate(f.registry, f.source, f.inputs, f.policy, undefined, fault)' : 'collectCandidates(f.registry, {maxAgeMs:0}, Date.now(), fault)'};
  `], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.signal, 'SIGKILL', result.stderr);
}
for (const point of ['journal-before-commit', 'allocation-before-mkdir', 'allocation-after-mkdir', 'allocation-owner-written', 'allocation-owner-published', 'publication-owner-ready']) {
  test('publication SIGKILL recovers at ' + point, async t => {
    const f = fixture(t); killed(f, 'publish', point);
    collectCandidates(f.registry, { maxAgeMs: 0 });
    assert.deepEqual(readdirSync(f.registry).filter(name => /^[a-f0-9]{64}$/.test(name)), []);
    const manifest = await publishCandidate(f.registry, f.source, f.inputs, f.policy);
    assert.equal(loadCandidate(f.registry, manifest.id).manifest.id, manifest.id);
  });
}
for (const point of ['journal-before-commit', 'retirement-registered', 'retirement-entry-removed', 'retirement-root-removed']) {
  test('retirement SIGKILL recovers at ' + point, async t => {
    const f = fixture(t), manifest = await publishCandidate(f.registry, f.source, f.inputs, f.policy);
    killed(f, 'collect', point);
    const removed = collectCandidates(f.registry, { maxAgeMs: 0 });
    if (point === 'retirement-root-removed') assert.deepEqual(removed, [], 'absence alone is not a new retirement confirmation');
    assert.equal(existsSync(join(f.registry, manifest.id)), false);
    // Journal database shrinks after deletion rather than accumulating receipts.
    assert.ok(readFileSync(join(f.registry, '.registry.lock/ownership.sqlite')).length < 64 * 1024);
  });
}
test('retirement resumes after owner removal while payload still exists and refuses new consumers', async t => {
  const f = fixture(t), manifest = await publishCandidate(f.registry, f.source, f.inputs, f.policy);
  killed(f, 'collect', 'retirement-registered', "unlinkSync(f.registry + '/' + value.id + '/owner.json');");
  assert.ok(existsSync(join(f.registry, manifest.id, 'artifact/payload')));
  assert.throws(() => loadCandidate(f.registry, manifest.id), /incomplete/);
  await assert.rejects(async () => await pinCandidate(f.registry, manifest.id, 'late'), /incomplete/);
  await assert.rejects(async () => await publishCandidate(f.registry, f.source, f.inputs, f.policy), /incomplete/);
  assert.deepEqual(collectCandidates(f.registry, { maxAgeMs: 0, protectedIds: [manifest.id] }), []);
  assert.ok(existsSync(join(f.registry, manifest.id)));
  assert.deepEqual(collectCandidates(f.registry, { maxAgeMs: 0 }), [manifest.id]);
});
test('retirement refuses changed identities, additional contents and later consumer files', async t => {
  for (const mutation of ['replace', 'extra', 'consumer']) await t.test(mutation, async t => {
    const f = fixture(t), manifest = await publishCandidate(f.registry, f.source, f.inputs, f.policy), directory = join(f.registry, manifest.id);
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
  for (const mutation of ['extra', 'marker']) await t.test(mutation, async t => {
    const f = fixture(t); killed(f, 'publish', 'allocation-after-mkdir');
    const directory = join(f.registry, readdirSync(f.registry).find(name => /^[a-f0-9]{64}$/.test(name)));
    writeFileSync(join(directory, mutation === 'extra' ? 'foreign' : '.owner-publishing.tmp'), 'not owned');
    assert.throws(() => collectCandidates(f.registry, { maxAgeMs: 0 }), /allocation/);
    assert.ok(existsSync(directory));
  });
});
test('publication exception cleanup is journaled and resumes after SIGKILL', async t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { publishCandidate } from ${JSON.stringify(module)};
    const f = ${JSON.stringify(f)};
    await publishCandidate(f.registry, f.source, f.inputs, f.policy, undefined, (point) => {
      if (point === 'publication-owner-ready') throw Error('copy failure');
      if (point === 'retirement-registered') process.kill(process.pid, 'SIGKILL');
    });
  `], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.signal, 'SIGKILL', result.stderr);
  assert.equal(collectCandidates(f.registry, { maxAgeMs: 0 }).length, 1);
});
test('ordinary pinned candidates and unowned directories are not adopted', async t => {
  const f = fixture(t), manifest = await publishCandidate(f.registry, f.source, f.inputs, f.policy);
  await pinCandidate(f.registry, manifest.id, 'active');
  assert.deepEqual(collectCandidates(f.registry, { maxAgeMs: 0 }), []);
  const unknown = join(f.registry, 'f'.repeat(64)); mkdirSync(unknown);
  assert.throws(() => collectCandidates(f.registry, { maxAgeMs: 0 }), /ENOENT/);
  assert.ok(existsSync(unknown));
});


test('journal database and rollback sidecar reject links without changing external bytes', async t => {
  for (const suffix of ['', '-journal']) await t.test(suffix || 'database', async t => {
    const f = fixture(t), manifest = await publishCandidate(f.registry, f.source, f.inputs, f.policy);
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

for (const point of ['allocation-before-mkdir', 'allocation-after-mkdir', 'allocation-owner-written', 'allocation-owner-published', 'retirement-registered', 'retirement-entry-removed', 'retirement-root-removed']) {
  test('incoming journal resumes SIGKILL at ' + point, async t => {
    const f = fixture(t), root = join(f.root, 'incoming'); mkdirSync(root);
    const journalModule = new URL('../src/ci-registry-journal.mjs', import.meta.url).href;
    const filesModule = new URL('../src/files.mjs', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module','-e', `
      import {transferJournal} from ${JSON.stringify(journalModule)};
      import {lock} from ${JSON.stringify(filesModule)};
      import {writeFileSync} from 'node:fs';
      const root=${JSON.stringify(root)}; const release=lock(root+'/.transfers.lock');
      const journal=transferJournal(root,(point)=>{if(point===${JSON.stringify(point)})process.kill(process.pid,'SIGKILL');});
      journal.allocate('transfer-fixture',{version:1,transfer:'transfer-fixture',createdAt:0,expectedBytes:100});
      writeFileSync(root+'/transfer-fixture/payload','partial transfer');
      journal.retire('transfer-fixture');
    `], {encoding:'utf8',timeout:10000});
    assert.equal(result.signal,'SIGKILL',result.stderr);
    const {transferJournal}=await import(journalModule), {lock}=await import(filesModule);
    const release=lock(join(root,'.transfers.lock')), journal=transferJournal(root);
    try {
      journal.recover();
      assert.equal(existsSync(join(root,'transfer-fixture')),false);
      for(const id of ['../foreign','a'.repeat(64),'transfer-','transfer-a/b'])
        assert.throws(()=>journal.allocate(id,{}),/identifier/);
      journal.allocate('transfer-next',{version:1,transfer:'transfer-next',createdAt:0,expectedBytes:1});
      journal.retire('transfer-next');
    } finally {journal.close();release();}
  });
}
