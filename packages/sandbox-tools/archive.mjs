import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Read only named archive members. Never extract an image into the host tree.
export function archiveImage(archive, { untagged = false, execute = execFileSync } = {}) {
  const member = name => execute('/usr/bin/tar', ['-xOf', archive, name], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const manifests = JSON.parse(member('manifest.json').toString());
  if (!Array.isArray(manifests) || manifests.length !== 1) throw new Error('Sandbox archive must contain exactly one image');
  const manifest = manifests[0];
  if (typeof manifest.Config !== 'string' || !/^[a-zA-Z0-9/._-]+$/.test(manifest.Config) || manifest.Config.startsWith('/') || manifest.Config.split('/').includes('..')) throw new Error('Invalid archive config member');
  if (untagged && (manifest.RepoTags?.length ?? 0) !== 0) throw new Error('CI image archive must not introduce tags');
  const config = member(manifest.Config);
  JSON.parse(config.toString());
  return 'sha256:' + createHash('sha256').update(config).digest('hex');
}
