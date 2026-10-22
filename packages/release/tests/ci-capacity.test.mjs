import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statfsSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { capacity, publishCandidate, storageFootprint } from '../src/ci-candidate.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ci-capacity-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'existing'), '12345678');
  return root;
}

test('capacity distinguishes logical quota from temporary physical peak', t => {
  const root = fixture(t), policy = { maxBytes: 10, reserveBytes: 0 };
  assert.equal(capacity(root, policy, 2, { physicalAdditional: 8192, phase: 'transfer-prepare' }).used, 8);
  assert.throws(() => capacity(root, policy, 3, { physicalAdditional: 8192, phase: 'transfer-prepare' }), error => {
    assert.equal(error.code, 'CI_STORAGE_CAPACITY');
    assert.equal(error.details.used, 8); assert.equal(error.details.additional, 3);
    assert.equal(error.details.maxBytes, 10); assert.equal(error.details.physicalAdditional, 8192);
    assert.equal(error.details.phase, 'transfer-prepare');
    assert.ok(!error.message.includes(root));
    return true;
  });
  assert.deepEqual(readdirSync(root), ['existing']);
});

test('physical admission refuses a peak larger than the volume without changing reserve or allocating', t => {
  const root = fixture(t), disk = statfsSync(root), physicalAdditional = disk.blocks * disk.bsize + 1;
  assert.throws(() => capacity(root, { maxBytes: 10, reserveBytes: 4096 }, 2, { physicalAdditional, phase: 'transfer-prepare' }), error => {
    assert.equal(error.code, 'CI_STORAGE_CAPACITY');
    assert.equal(error.details.reserveBytes, 4096);
    assert.equal(error.details.requiredAvailable, physicalAdditional + 4096);
    assert.ok(error.details.available < error.details.requiredAvailable);
    assert.deepEqual(JSON.parse(error.message.slice(error.message.indexOf('{'))), error.details);
    return true;
  });
  assert.deepEqual(readdirSync(root), ['existing']);
});

test('capacity cannot understate physical reservation, overflow the budget, or log arbitrary phase text', t => {
  const root = fixture(t), policy = { maxBytes: 10, reserveBytes: 1 };
  for (const options of [{ physicalAdditional: 1 }, { physicalAdditional: Number.MAX_SAFE_INTEGER }, { physicalAdditional: -1 }, { phase: '/private/path' }]) {
    assert.throws(() => capacity(root, policy, 2, options), /Explicit CI storage budget required/);
  }
  assert.equal(capacity(root, policy, 2).used, 8);
});

test('footprint includes empty directories and links without following external trees', t => {
  const root = fixture(t); mkdirSync(join(root, 'empty')); symlinkSync(tmpdir(), join(root, 'external'));
  const small = storageFootprint(root, 4096), large = storageFootprint(root, 65536);
  assert.equal(small.logicalBytes, 8); assert.equal(small.entries, 4);
  assert.ok(small.physicalBytes > small.logicalBytes);
  assert.ok(large.physicalBytes > small.physicalBytes);
  assert.throws(() => storageFootprint(root, Number.MAX_SAFE_INTEGER), /exceeds bound/);
});

test('publication checks physical allocation before creating a candidate', async t => {
  const root = fixture(t), registry = join(root, 'registry'), source = join(root, 'source');
  mkdirSync(source); writeFileSync(join(source, 'app'), 'payload');
  await assert.rejects(publishCandidate(registry, source, { repositories: [] }, { maxBytes: 1, reserveBytes: 0 }), error => {
    assert.equal(error.details.phase, 'publication'); assert.equal(error.details.additional, 7);
    assert.ok(error.details.physicalAdditional > error.details.additional);
    return true;
  });
  assert.equal(readdirSync(registry).filter(name => /^[a-f0-9]{64}$/.test(name)).length, 0);
});
