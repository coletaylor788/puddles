import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export function skillDigest(root) {
  const hash = createHash('sha256');
  function visit(path, name) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Link skill directories must not contain symlinks');
    if (stat.isDirectory()) for (const child of readdirSync(path).sort()) visit(join(path, child), name + '/' + child);
    else if (stat.isFile()) hash.update(name + '\0').update(readFileSync(path)).update('\0');
    else throw new Error('Unsupported Link skill entry');
  }
  visit(root, ''); return hash.digest('hex');
}

export function linkSkillTargets(config, runtime) {
  return [['main', 'link-financial-insights'], ['browser-agent', 'link-payments']].map(([agent, skill]) => {
    const workspace = config.agents?.entries?.[agent]?.workspace;
    if (!isAbsolute(workspace ?? '') || !isAbsolute(runtime ?? '')) throw new Error('Explicit agent workspace and runtime required');
    return { workspace, source: join(runtime, 'tools/link-cli/puddles-skills', skill), destination: join(workspace, 'skills', skill) };
  });
}

// CI calls this after backup with writers stopped. Unknown authored skills are
// never overwritten. An upgrade needs a reviewed predecessor selection.
export function installLinkSkills(config, runtime) {
  const targets = linkSkillTargets(config, runtime);
  for (const target of targets) {
    if (realpathSync(target.workspace) !== target.workspace) throw new Error('Link workspace is not canonical');
    const parent = join(target.workspace, 'skills');
    if (existsSync(parent) && realpathSync(parent) !== parent) throw new Error('Link skills parent is not canonical');
    target.digest = skillDigest(target.source);
    if (existsSync(target.destination) && skillDigest(target.destination) !== target.digest) throw new Error('Existing Link skill requires explicit reconciliation');
  }
  for (const target of targets) {
    if (!existsSync(target.destination)) {
      mkdirSync(join(target.workspace, 'skills'), { recursive: true });
      cpSync(target.source, target.destination, { recursive: true, errorOnExist: true, force: false });
    }
    if (skillDigest(target.destination) !== target.digest) throw new Error('Installed Link skill differs from artifact');
  }
  return targets.map(({ destination, digest }) => ({ path: destination, sha256: digest }));
}
