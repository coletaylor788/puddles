import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson, canonical, copy, readJson, separate, treeHash } from './files.mjs';

export function validateBackup(config) {
  canonical(config.root);
  if (!Array.isArray(config.paths) || !config.paths.length) throw new Error('Backup requires explicit paths');
  const names = new Set();
  for (const entry of config.paths) {
    if (!/^[a-z][a-z0-9-]*$/.test(entry.name) || names.has(entry.name)) throw new Error('Backup entry names must be unique');
    names.add(entry.name);
  }
  separate([config.root, ...config.paths.map(entry => entry.path)]);
}
export function verifyBackup(config) {
  validateBackup(config);
  const manifest = readJson(join(config.root, 'backup.json'));
  if (manifest.version !== 1 || manifest.status !== 'valid' || manifest.paths.length !== config.paths.length) throw new Error('No verified recovery backup');
  for (const [index, entry] of config.paths.entries()) {
    const saved = manifest.paths[index];
    if (saved.name !== entry.name || saved.path !== entry.path || treeHash(join(config.root, entry.name)) !== saved.sha256) throw new Error('Recovery backup changed');
  }
  return manifest;
}
export async function replaceBackup(config, service, run) {
  validateBackup(config);
  await run(service.health, 'backup-health');
  // Stop all application writers before capturing SQLite, configuration, or files.
  try {
    await run(service.stop, 'backup-stop');
    mkdirSync(config.root, { recursive: true, mode: 0o700 });
    atomicJson(join(config.root, 'backup.json'), { version: 1, status: 'invalid' });
    // The accepted policy intentionally discards the previous generation first.
    rmSync(config.root, { recursive: true });
    mkdirSync(config.root, { recursive: true, mode: 0o700 });
    atomicJson(join(config.root, 'backup.json'), { version: 1, status: 'capturing' });
    const paths = [];
    for (const entry of config.paths) {
      copy(entry.path, join(config.root, entry.name));
      const sha256 = treeHash(join(config.root, entry.name));
      if (sha256 !== treeHash(entry.path)) throw new Error('Backup does not match stopped production');
      paths.push({ ...entry, sha256 });
    }
    atomicJson(join(config.root, 'backup.json'), { version: 1, status: 'valid', paths });
    return verifyBackup(config);
  } finally {
    // Capture failure must never leave the unchanged production service stopped.
    await run(service.start, 'backup-restart');
    await run(service.health, 'backup-restarted-health');
  }
}
export async function restoreBackup(config, service, run) {
  verifyBackup(config);
  await run(service.stop, 'restore-stop');
  for (const entry of config.paths) {
    rmSync(entry.path, { recursive: true, force: true });
    copy(join(config.root, entry.name), entry.path);
  }
  await run(service.start, 'restore-start');
  await run(service.health, 'restore-health');
}
