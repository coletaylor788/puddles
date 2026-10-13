import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicJson, canonical, copy, lock, readJson, separate, treeHash } from './files.mjs';
import { readQueue } from './queue.mjs';
import { validateConfiguration } from './controller.mjs';

export function installTool(dist, destination, config) {
  validateConfiguration(config); canonical(dist); canonical(destination);
  separate([dist, destination, config.root, config.backup.root, config.prod.runtime, config.test.runtime]);
  for (const entry of config.backup.paths) separate([destination, entry.path]);
  if (!existsSync(join(dist,'bin/puddles-release.mjs'))) throw new Error('Built release tool is missing');
  const staging=destination+'.incoming'; canonical(staging);
  const unlock=lock(join(config.root,'release.lock'));
  try {
    if(readQueue(config.root).active) throw new Error('Install release tooling between tickets');
    if(existsSync(destination) && readJson(join(destination,'installation.json')).kind!=='puddles-release') throw new Error('Destination is not an owned release installation');
    if(existsSync(staging)) throw new Error('An interrupted tool installation needs inspection');
    mkdirSync(dirname(destination),{recursive:true});copy(dist,staging);
    const digest=treeHash(dist);
    if(treeHash(staging)!==digest) throw new Error('Tool installation differs from tested output');
    atomicJson(join(staging,'installation.json'),{kind:'puddles-release',digest});
    rmSync(destination,{recursive:true,force:true});renameSync(staging,destination);
    return{status:'installed',digest,destination};
  } finally { unlock(); }
}
