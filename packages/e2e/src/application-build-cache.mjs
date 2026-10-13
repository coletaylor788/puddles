import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { treeDigest } from './native-state.mjs';

// Git's ignored output is excluded. Every authored input, including uncommitted
// edits and new files, participates so an incremental reuse cannot hide changes.
export function applicationSourceInputs(source) {
  const files = execFileSync('git', ['-c', 'core.fsmonitor=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: source, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).split('\0').filter(Boolean);
  const hash = createHash('sha256').update(process.version);
  for (const file of [...new Set(files)].sort()) {
    hash.update(file).update('\0');
    const path = join(source, file);
    if (!existsSync(path)) { hash.update('missing\0'); continue; }
    const stat = lstatSync(path);
    hash.update(String(stat.mode)).update('\0');
    hash.update(stat.isSymbolicLink() ? readlinkSync(path) : readFileSync(path)).update('\0');
  }
  return hash.digest('hex');
}
export async function buildApplicationCore(source, owner, save, build) {
  const inputs = applicationSourceInputs(source), dist = join(source, 'dist');
  // Compiler output may link to the shared dependency store. Portability is
  // checked after materializing the complete application, not in this cache.
  if (owner.coreInputs === inputs && existsSync(dist) && owner.coreOutput === treeDigest(dist, { excludeNames: ["control-ui"] })) return 'reused';
  await build();
  if (applicationSourceInputs(source) !== inputs) throw new Error("Application source changed during build");
  save({ coreInputs: inputs, coreOutput: treeDigest(dist, { excludeNames: ["control-ui"] }) });
  return 'built';
}
