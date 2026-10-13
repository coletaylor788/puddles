#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { supervise } from '../src/supervisor.mjs';
import { atomicJson, readJson, treeHash } from '../src/files.mjs';
import { enqueue, cancel, readQueue } from '../src/queue.mjs';
import { deployDev, runNext, refreshBackup, validateConfiguration, validateTicket } from '../src/controller.mjs';
import { command } from '../src/commands.mjs';
import { initWorkspace, finalizeWorkspace } from '../src/finalize.mjs';
import { rebaseRepositories, mergeRepositories } from '../src/git.mjs';

try {
  const [action, file, argument] = process.argv.slice(2);
  if (!file) throw new Error('Usage: puddles-release <status|enqueue|cancel|run|dev|backup|rebase|merge> CONFIG [TICKET]');
  let result;
  if (action === 'workspace-init') result = initWorkspace(readJson(file));
  else if (action === 'finalize') result = await finalizeWorkspace(file, argument);
  else if (action === 'rebase' || action === 'merge') {
    const repositories = readJson(file);
    if (action === 'rebase') atomicJson(file, rebaseRepositories(repositories));
    else mergeRepositories(repositories);
    result = { status: action + '-passed' };
  } else {
    const config = validateConfiguration(readJson(file));
    mkdirSync(config.root, { recursive: true, mode: 0o700 });
    if (action === 'status') result = readQueue(config.root);
    else if (action === 'enqueue') result = enqueue(config.root, validateTicket(readJson(argument), config));
    else if (action === 'cancel') result = cancel(config.root, argument);
    else if (action === 'run' || action === 'recover' || action === 'backup') {
      if (process.env.PUDDLES_RELEASE_WORKER) result = await (action === 'backup' ? refreshBackup : runNext)(config, command, { recover: action === 'recover',
        worker: process.env.PUDDLES_RELEASE_WORKER, recoverOwner: process.env.PUDDLES_RELEASE_RECOVER_OWNER || undefined,
        toolHash: treeHash(fileURLToPath(new URL('../src/', import.meta.url))) });
      else { process.exitCode = await supervise(fileURLToPath(import.meta.url), file, config, action); result = { status: process.exitCode ? 'attention' : 'finished' }; }
    }
    else if (action === 'dev') {
      const { ticket, target } = readJson(argument);
      await deployDev(config, ticket, target); result = { status: 'dev-passed' };
    } else throw new Error('Unknown release operation');
  }
  console.log(JSON.stringify(result ?? { status: 'done' }));
  if (result?.status === 'failed' || result?.status === 'merge-pending') process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
