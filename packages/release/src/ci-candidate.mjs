import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { assertCandidateAvailable, registryJournal } from './ci-registry-journal.mjs';
import { atomicJson, canonical, copy, lock, readJson, separate, treeHash } from './files.mjs';

export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function identifier(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value ?? '')) throw new Error('Invalid CI identifier');
  return value;
}
export function validateCandidate(value) {
  if (value.version !== 1 || !/^[a-f0-9]{64}$/.test(value.artifactDigest ?? '') ||
      !/^[a-f0-9]{64}$/.test(value.inputsDigest ?? '') || !Array.isArray(value.repositories) || !value.repositories.length) {
    throw new Error('Invalid candidate manifest');
  }
  identifier(value.id);
  if (value.inputs?.controlsDigest !== undefined && !/^[a-f0-9]{64}$/.test(value.inputs.controlsDigest)) throw new Error('Invalid application controls digest');
  if (!value.inputs || digest(value.inputs) !== value.inputsDigest ||
      digest(value.inputs.repositories) !== digest(value.repositories) ||
      digest({ artifactDigest: value.artifactDigest, inputsDigest: value.inputsDigest }) !== value.id) throw new Error('Frozen candidate identity changed');
  const names = new Set();
  for (const repo of value.repositories) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.repository ?? '') || names.has(repo.repository) ||
        !['head', 'base', 'tree'].every(key => /^[a-f0-9]{40}$/.test(repo[key] ?? '')) ||
        repo.pullRequest !== undefined && (!Number.isSafeInteger(repo.pullRequest) || repo.pullRequest < 1)) throw new Error('Invalid candidate source');
    names.add(repo.repository);
  }
  return value;
}
export function bytes(root) {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) return 0;
  return stat.isDirectory() ? readdirSync(root).reduce((n, name) => n + bytes(join(root, name)), 0) : stat.size;
}
export function capacity(root, { maxBytes, reserveBytes }, additional = 0) {
  if (![maxBytes, reserveBytes, additional].every(n => Number.isSafeInteger(n) && n >= 0) || maxBytes === 0) throw new Error('Explicit CI storage budget required');
  const used = existsSync(root) ? bytes(root) : 0;
  const disk = statfsSync(root);
  if (used + additional > maxBytes || disk.bavail * disk.bsize < reserveBytes + additional) throw new Error('CI storage capacity unavailable');
  return { used, available: disk.bavail * disk.bsize };
}
export function publishCandidate(root, source, inputs, policy, controls, fault = () => {}) {
  separate([root, source, ...(controls ? [controls] : [])]);
  if (controls) inputs = { ...inputs, controlsDigest: treeHash(controls) };
  else if (inputs.controlsDigest !== undefined) throw new Error('Frozen application controls are missing');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  // Maintenance may briefly own this lock after the build finishes. Wait only
  // for admission; never replay publication or the completed build.
  const unlock = lock(join(root, '.registry.lock'), { timeoutMs: 30_000 });
  let staging, journal;
  try {
    journal = registryJournal(root, fault);
    const artifactDigest = treeHash(source);
    const inputsDigest = digest(inputs);
    const id = digest({ artifactDigest, inputsDigest });
    const destination = join(root, id);
    assertCandidateAvailable(root, id);
    if (existsSync(destination)) return loadCandidate(root, id).manifest;
    capacity(root, policy, bytes(source) + (controls ? bytes(controls) : 0));
    journal.allocate(id, { version: 1, id, createdAt: Date.now(), state: 'publishing' });
    staging = destination;
    fault('publication-owner-ready', { id });
    copy(source, join(staging, 'artifact'));
    if (controls) {
      copy(controls, join(staging, 'controls'));
      if (treeHash(controls) !== inputs.controlsDigest || treeHash(join(staging, 'controls')) !== inputs.controlsDigest) throw new Error('Application controls changed during publication');
    }
    if (treeHash(source) !== artifactDigest || treeHash(join(staging, 'artifact')) !== artifactDigest) throw new Error('Build changed during publication');
    const manifest = validateCandidate({ version: 1, id, artifactDigest, inputsDigest, inputs, repositories: inputs.repositories, createdAt: Date.now() });
    atomicJson(join(staging, 'manifest.json'), manifest);
    atomicJson(join(staging, 'owner.json'), { version: 1, id, createdAt: manifest.createdAt, state: 'published' });
    return manifest;
  } catch (error) {
    if (staging) journal.retire(staging.slice(root.length + 1));
    throw error;
  } finally { journal?.close(); unlock(); }
}
export function loadCandidate(root, id) {
  canonical(root); identifier(id);
  assertCandidateAvailable(root, id);
  const directory = canonical(join(root, id));
  const manifest = validateCandidate(readJson(join(directory, 'manifest.json')));
  if (manifest.id !== id || readJson(join(directory, 'owner.json')).state !== 'published' ||
      treeHash(join(directory, 'artifact')) !== manifest.artifactDigest) throw new Error('Frozen candidate changed');
  const controls = manifest.inputs.controlsDigest ? join(directory, 'controls') : undefined;
  if (controls && treeHash(controls) !== manifest.inputs.controlsDigest) throw new Error('Frozen application controls changed');
  return { manifest, directory, artifact: join(directory, 'artifact'), ...(controls ? { controls } : {}) };
}
export function pinCandidate(root, id, consumer) {
  identifier(consumer);
  const unlock = lock(join(root, '.registry.lock'));
  try {
    const value = loadCandidate(root, id);
    atomicJson(join(value.directory, 'consumers', consumer + '.json'), { consumer, id });
    return value;
  } finally { unlock(); }
}
export function unpinCandidate(root, id, consumer) {
  identifier(id); identifier(consumer); canonical(root);
  const unlock = lock(join(root, '.registry.lock'));
  try { rmSync(join(root, id, 'consumers', consumer + '.json'), { force: true }); }
  finally { unlock(); }
}
export function recordGate(root, id, name, evidence) {
  identifier(name);
  const unlock = lock(join(root, '.registry.lock'));
  try {
    const { manifest, directory } = loadCandidate(root, id);
    atomicJson(join(directory, 'gates', name + '.json'), { ...evidence, candidate: id,
      artifactDigest: manifest.artifactDigest, inputsDigest: manifest.inputsDigest });
  } finally { unlock(); }
}
export function requireGate(root, id, name, expected) {
  identifier(name);
  const { manifest, directory } = loadCandidate(root, id);
  const evidence = readJson(join(directory, 'gates', name + '.json'));
  if (evidence.candidate !== id || evidence.artifactDigest !== manifest.artifactDigest ||
      evidence.inputsDigest !== manifest.inputsDigest || evidence.status !== 'passed' ||
      Object.entries(expected).some(([key, value]) => evidence[key] !== value)) throw new Error('Required candidate gate is missing or stale');
  return evidence;
}
export function collectCandidates(root, { maxAgeMs, protectedIds = [] }, now = Date.now(), fault = () => {}) {
  canonical(root);
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) throw new Error('Invalid candidate retention');
  const unlock = lock(join(root, '.registry.lock'));
  let journal;
  try {
    journal = registryJournal(root, fault);
    const removed = journal.recover(protectedIds);
    for (const id of readdirSync(root)) {
      if (!/^[a-f0-9]{64}$/.test(id) || protectedIds.includes(id) || journal.pending(id)) continue;
      const directory = canonical(join(root, id));
      const owner = readJson(join(directory, 'owner.json'));
      if (owner.id !== id || !Number.isSafeInteger(owner.createdAt)) throw new Error('Unknown candidate ownership');
      const consumers = join(directory, 'consumers');
      if (existsSync(consumers) && readdirSync(consumers).length || now - owner.createdAt < maxAgeMs) continue;
      journal.retire(id); removed.push(id);
    }
    return removed;
  } finally { journal?.close(); unlock(); }
}
