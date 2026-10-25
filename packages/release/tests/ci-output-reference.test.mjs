import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerBuildReference, publishCandidate, releaseCandidatePayload, loadCandidate, bytes, recordGate, requireGate, pinCandidate, unpinCandidate, collectCandidates } from '../src/ci-candidate.mjs';
import { atomicJson, readJson } from '../src/files.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ci-output-ref-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, 'application'), controls = join(root, 'generated-controls'), registry = join(root, 'registry');
  mkdirSync(output); mkdirSync(controls); writeFileSync(join(output, 'app'), Buffer.alloc(2 * 1024 * 1024, 1)); writeFileSync(join(controls, 'test.mjs'), 'fixture');
  const inputs = { repositories: [{ repository: 'owner/repo', head: 'a'.repeat(40), base: 'a'.repeat(40), tree: 'b'.repeat(40) }] };
  const policy = { maxBytes: 32 * 1024 * 1024, reserveBytes: 0 };
  return { root, output, controls, registry, inputs, policy };
}
test('four independent outputs register under a metadata budget without payload copies', async t => {
  const f = fixture(t), ids = [];
  for (let i = 0; i < 4; i++) {
    const output = join(f.root, 'worktree-' + i); mkdirSync(output); writeFileSync(join(output, 'app'), Buffer.alloc(2 * 1024 * 1024, i));
    const manifest = await registerBuildReference(f.registry, output, f.inputs, { ...f.policy, maxBytes: 1024 * 1024 }, f.controls);
    ids.push(manifest.id); assert.equal(loadCandidate(f.registry, manifest.id).artifact, output);
    assert.equal(existsSync(join(f.registry, manifest.id, 'artifact')), false);
  }
  assert.equal(new Set(ids).size, 4); assert.ok(bytes(f.registry) < 1024 * 1024);
  collectCandidates(f.registry, { maxAgeMs: 0 }, Date.now() + 1000);
  for (let i = 0; i < 4; i++) assert.equal(readFileSync(join(f.root, 'worktree-' + i, 'app')).length, 2 * 1024 * 1024);
});
test('target payload release preserves DEV gate, rejects ordinary use, and rehydrates for PROD', async t => {
  const f = fixture(t), m = await publishCandidate(f.registry, f.output, f.inputs, f.policy, f.controls);
  await recordGate(f.registry, m.id, 'dev', { status: 'passed', run: 'gh-1-1', targetDigest: 'fixture' });
  await pinCandidate(f.registry, m.id, 'active');
  assert.throws(() => releaseCandidatePayload(f.registry, m.id), /still in use/);
  await unpinCandidate(f.registry, m.id, 'active');
  releaseCandidatePayload(f.registry, m.id);
  assert.equal(existsSync(join(f.registry, m.id, 'artifact')), false);
  assert.throws(() => loadCandidate(f.registry, m.id), /payload was released/);
  assert.equal(requireGate(f.registry, m.id, 'dev', { targetDigest: 'fixture' }).run, 'gh-1-1');
  await pinCandidate(f.registry, m.id, 'prod-submission');
  assert.equal(loadCandidate(f.registry, m.id, { metadataOnly: true }).payloadReleased, true);
  assert.equal((await publishCandidate(f.registry, f.output, f.inputs, f.policy, f.controls)).id, m.id);
  assert.equal(loadCandidate(f.registry, m.id).payloadReleased, undefined);
  assert.equal(requireGate(f.registry, m.id, 'dev', { targetDigest: 'fixture' }).status, 'passed');
});
test('interrupted payload release and rehydration remain recoverable and capacity is charged', async t => {
  const f = fixture(t), m = await publishCandidate(f.registry, f.output, f.inputs, f.policy, f.controls);
  const ownerPath = join(f.registry, m.id, 'owner.json');
  atomicJson(ownerPath, { ...readJson(ownerPath), payloadReleased: true });
  assert.throws(() => loadCandidate(f.registry, m.id), /released/);
  releaseCandidatePayload(f.registry, m.id); releaseCandidatePayload(f.registry, m.id);
  await assert.rejects(publishCandidate(f.registry, f.output, f.inputs, { ...f.policy, maxBytes: 1024 }, f.controls), e => e.code === 'CI_STORAGE_CAPACITY');
  assert.throws(() => loadCandidate(f.registry, m.id), /released/);
  await publishCandidate(f.registry, f.output, f.inputs, f.policy, f.controls);
  assert.equal(existsSync(loadCandidate(f.registry, m.id).controls), true);
});

test('identical candidate bytes cannot silently reuse a different owner output', async t => {
  const f = fixture(t), m = await registerBuildReference(f.registry, f.output, f.inputs, f.policy, f.controls);
  const other = join(f.root, 'replacement-worktree'); mkdirSync(other); writeFileSync(join(other, 'app'), readFileSync(join(f.output, 'app')));
  await assert.rejects(registerBuildReference(f.registry, other, f.inputs, f.policy, f.controls), /different output workspace/);
  assert.equal(loadCandidate(f.registry, m.id).artifact, f.output);
});
