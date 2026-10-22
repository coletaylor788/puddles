import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Read only named archive members. Never extract an image into the host tree.
export function archiveImage(archive, { untagged = false, containerd = false, execute = execFileSync } = {}) {
  const member = name => execute('/usr/bin/tar', ['-xOf', archive, name], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const manifests = JSON.parse(member('manifest.json').toString());
  if (!Array.isArray(manifests) || manifests.length !== 1) throw new Error('Sandbox archive must contain exactly one image');
  const manifest = manifests[0];
  if (typeof manifest.Config !== 'string' || !/^[a-zA-Z0-9/._-]+$/.test(manifest.Config) || manifest.Config.startsWith('/') || manifest.Config.split('/').includes('..')) throw new Error('Invalid archive config member');
  if (untagged && (manifest.RepoTags?.length ?? 0) !== 0) throw new Error('CI image archive must not introduce tags');
  const config = member(manifest.Config);
  JSON.parse(config.toString());
  const configDigest = 'sha256:' + createHash('sha256').update(config).digest('hex');
  if (!containerd) return configDigest;
  const layout = JSON.parse(member('oci-layout')), index = JSON.parse(member('index.json'));
  if (layout.imageLayoutVersion !== '1.0.0' || index.schemaVersion !== 2 || !Array.isArray(index.manifests) || index.manifests.length !== 1) throw new Error('CI requires one OCI index image');
  const descriptor = index.manifests[0];
  if (!/^sha256:[a-f0-9]{64}$/.test(descriptor.digest ?? '') || [index,descriptor].some(value=>Object.keys(value.annotations??{}).some(key=>['org.opencontainers.image.ref.name','io.containerd.image.name'].includes(key)))) throw new Error('CI archive must have one unnamed manifest');
  const image = member('blobs/sha256/'+descriptor.digest.slice(7));
  if ('sha256:'+createHash('sha256').update(image).digest('hex') !== descriptor.digest || JSON.parse(image).config?.digest !== configDigest) throw new Error('CI manifest/config identity differs');
  return descriptor.digest;
}
