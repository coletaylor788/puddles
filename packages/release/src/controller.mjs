import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson, canonical, copy, lock, readJson, separate, treeHash } from './files.mjs';
import { command, stopInterruptedChild, validateCommand } from './commands.mjs';
import { replaceBackup, restoreBackup, validateBackup, verifyBackup } from './backup.mjs';
import { readQueue, updateQueue } from './queue.mjs';

const stages = ['rebase', 'build', 'applicationTests', 'test', 'backup', 'prod', 'merge', 'resumeIntake'];
export function validateConfiguration(config) {
  if (config.version !== 1) throw new Error('Unsupported release configuration');
  canonical(config.root);
  validateBackup(config.backup);
  for (const name of ['test', 'prod']) {
    const target = config[name];
    canonical(target.runtime);
    for (const key of ['stop', 'start', 'health', 'tests']) validateCommand(target[key]);
    if (target.prepare) validateCommand(target.prepare);
  }
  for (const key of ['quiesce', 'resumeIntake']) validateCommand(config.prod[key]);
  separate([config.root, config.backup.root, config.test.runtime, config.prod.runtime]);
  if (!config.backup.paths.some(entry => entry.path === config.prod.runtime)) throw new Error('Backup must include production runtime');
  for (const entry of config.backup.paths) separate([entry.path, config.test.runtime, config.root]);
  return config;
}
export function validateTicket(ticket, config) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(ticket.id ?? '')) throw new Error('Invalid ticket id');
  canonical(ticket.workspace); canonical(ticket.artifact);
  if (existsSync(join(ticket.workspace, '.finalizing'))) throw new Error('Feature workspace is finalizing');
  if (!ticket.artifact.startsWith(ticket.workspace + '/')) throw new Error('Artifact must belong to the feature workspace');
  separate([ticket.workspace, config.root, config.backup.root, config.test.runtime, config.prod.runtime]);
  for (const entry of config.backup.paths) separate([ticket.workspace, entry.path]);
  for (const name of ['rebase', 'build', 'applicationTests', 'merge']) validateCommand(ticket[name]);
  return ticket;
}
async function deploy(target, artifact, digest, run, phase) {
  if (treeHash(artifact) !== digest) throw new Error('Frozen feature output changed');
  await run(target.stop, phase + '-stop');
  if (target.prepare) await run(target.prepare, phase + '-prepare');
  rmSync(target.runtime, { recursive: true, force: true });
  copy(artifact, target.runtime);
  if (treeHash(target.runtime) !== digest) throw new Error('Installed output differs from tested artifact');
  await run(target.start, phase + '-start');
  await run(target.health, phase + '-health');
  await run(target.tests, phase + '-tests');
}
export async function deployDev(config, ticket, target, execute = command) {
  validateConfiguration(config); validateTicket(ticket, config);
  canonical(target.runtime);
  separate([target.runtime, ticket.workspace, config.root, config.test.runtime, config.prod.runtime, config.backup.root]);
  for (const entry of config.backup.paths) separate([target.runtime, entry.path]);
  for (const key of ['stop', 'start', 'health', 'tests']) validateCommand(target[key]);
  if (target.prepare) validateCommand(target.prepare);
  const unlock = lock(join(config.root, 'dev.lock'));
  try {
    await deploy(target, ticket.artifact, treeHash(ticket.artifact), (cmd, phase) => execute(cmd, { PUDDLES_RELEASE_PHASE: phase, PUDDLES_RELEASE_ARTIFACT: ticket.artifact }), 'dev');
  } finally { unlock(); }
}
export async function runNext(config, execute = command, options = {}) {
  validateConfiguration(config);
  mkdirSync(config.root, { recursive: true, mode: 0o700 });
  const configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  const unlock = lock(join(config.root, 'release.lock'));
  try {
    let active = updateQueue(config.root, state => {
      if (options.recoverOwner && state.active?.worker !== options.recoverOwner) throw new Error('Recovery worker does not own this release');
      if (!state.active && state.ready.length && !options.recover) {
        const ticket = state.ready.shift();
        validateTicket(ticket, config);
        state.active = { ...ticket, configHash, phase: 'rebase', completed: [], child: null };
      }
      return state.active;
    });
    if (!active) return { status: 'idle' };
    if (active.kind === 'standalone-backup') return await backupWithLock(config, execute, options);
    validateTicket(active, config);
    if (active.configHash !== configHash) throw new Error('Active release configuration changed');
    if (active.toolHash && active.toolHash !== options.toolHash) throw new Error('Active release tooling changed');
    const save = patch => {
      Object.assign(active, patch);
      updateQueue(config.root, state => {
        if (state.active?.id !== active.id) throw new Error('Release ownership changed');
        state.active = active;
      });
    };
    save({ worker: options.worker ?? null, toolHash: options.toolHash ?? null });
    const run = (spec, phase) => {
      save({ operation: phase });
      return execute(spec, { PUDDLES_RELEASE_PHASE: phase, PUDDLES_RELEASE_ARTIFACT: active.artifact,
        PUDDLES_RELEASE_WORKSPACE: active.workspace, PUDDLES_RELEASE_ID: active.id }, child => save({ child }));
    };
    const leave = () => updateQueue(config.root, state => { state.active = null; });
    const recover = async () => {
      await stopInterruptedChild(active.child);
      save({ child: null, status: 'recovering' });
      if (!active.recoveryRestored) {
        if (active.phase === 'prod' || active.completed.includes('prod')) {
          await restoreBackup(config.backup, config.prod, run);
        } else {
        // Backup interruption can leave unchanged PROD stopped. Its state was not replaced.
        if (active.phase === 'backup') {
          await run(config.prod.start, 'recover-backup-start');
          await run(config.prod.health, 'recover-backup-health');
        }
          if (active.phase === 'test') await run(config.test.stop, 'recover-test-stop');
        }
        save({ recoveryRestored: true });
      }
      if (active.completed.includes('quiesce') || active.phase === 'backup') {
        if (!active.recoveryIntakeResumed) {
          save({ intakeResuming: true, recoveryIntakeResuming: true });
          await run(config.prod.resumeIntake, 'recover-intake');
          save({ recoveryIntakeResumed: true });
        }
        await run(config.prod.health, 'recover-intake-health');
      }
      leave();
      return { status: 'failed', id: active.id, error: active.error ?? 'Interrupted release recovered; repair and rejoin at the back' };
    };
    if (options.recover) {
      if (active.intakeResuming && !active.recoveryIntakeResuming || active.completed.includes('resumeIntake')) throw new Error('Intake resumed; recovery must preserve new live writes');
      save({ error: 'Release withdrawn; restored before leaving the queue' });
      return await recover();
    }
    if (active.status === 'running' && ['merge', 'resumeIntake'].includes(active.phase)) {
      await stopInterruptedChild(active.child);
      save({ child: null, status: 'merge-pending' });
    }
    if (active.status === 'running' || active.status === 'recovering') {
      // A new process never repeats an uncertain deploy command. Recover its recorded phase.
      return await recover();
    }
    if (active.status === 'merge-pending') {
      // Production passed. Keep intake held and retain the ticket until merge succeeds.
      active.phase = 'merge';
    }
    try {
      for (const stage of stages) {
        if (active.completed.includes(stage)) continue;
        save({ phase: stage, status: 'running', error: null });
        if (['rebase', 'build', 'applicationTests', 'merge'].includes(stage)) {
          if (stage === 'applicationTests' && treeHash(active.artifact) !== active.digest) throw new Error('Artifact changed before application suite');
          await run(active[stage], stage);
          if (stage === 'build') save({ digest: treeHash(active.artifact) });
          if (stage === 'applicationTests' && treeHash(active.artifact) !== active.digest) throw new Error('Application tests changed the frozen artifact');
        } else if (stage === 'test') {
          await deploy(config.test, active.artifact, active.digest, run, 'test');
        } else if (stage === 'backup') {
          await run(config.prod.quiesce, 'quiesce');
          save({ completed: [...active.completed, 'quiesce'] });
          await replaceBackup(config.backup, config.prod, run);
        } else if (stage === 'prod') {
          verifyBackup(config.backup);
          await deploy(config.prod, active.artifact, active.digest, run, 'prod');
        } else if (stage === 'resumeIntake') {
          save({ intakeResuming: true });
          await run(config.prod.resumeIntake, 'resume-intake');
          await run(config.prod.health, 'resume-health');
        }
        save({ completed: [...active.completed, stage], status: 'ready' });
      }
      const result = { status: 'released', id: active.id, artifact: active.digest };
      // No append-only test report or deployment history. The conversation keeps results.
      atomicJson(join(config.root, 'current.json'), result);
      leave();
      return result;
    } catch (error) {
      save({ error: error.message });
      if (active.phase === 'merge' || active.phase === 'resumeIntake') {
        save({ status: 'merge-pending' });
        return { status: 'merge-pending', id: active.id, error: error.message };
      }
      return await recover();
    }
  } finally { unlock(); }
}

async function backupWithLock(config, execute, options) {
  const configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  let active = readQueue(config.root).active;
  const recovering = Boolean(active);
  if (active && active.kind !== 'standalone-backup') throw new Error('An active release owns the recovery backup');
  if (options.recoverOwner && active?.worker !== options.recoverOwner) throw new Error('Recovery worker does not own this backup');
  if (active && (active.configHash !== configHash || active.toolHash && active.toolHash !== options.toolHash)) throw new Error('Active backup configuration or tooling changed');
  active ??= { id: 'standalone-backup', kind: 'standalone-backup', phase: 'backup', configHash, child: null };
  const save = patch => {
    Object.assign(active, patch);
    updateQueue(config.root, state => { state.active = active; });
  };
  save({ status: recovering ? 'recovering' : 'running', worker: options.worker ?? null, toolHash: options.toolHash ?? null });
  const run = (spec, phase) => execute(spec, { PUDDLES_RELEASE_PHASE: phase }, child => save({ child }));
  if (recovering) {
    await stopInterruptedChild(active.child);
    save({ child: null });
    await run(config.prod.start, 'recover-backup-start');
    await run(config.prod.health, 'recover-backup-health');
  } else {
    await replaceBackup(config.backup, config.prod, run);
  }
  updateQueue(config.root, state => { state.active = null; });
  return { status: recovering ? 'failed' : 'backup-passed', ...(recovering ? { error: 'Interrupted backup recovered; capture again before deployment' } : {}) };
}

export async function refreshBackup(config, execute = command, options = {}) {
  validateConfiguration(config);
  const unlock = lock(join(config.root, 'release.lock'));
  try {
    return await backupWithLock(config, execute, options);
  } finally { unlock(); }
}
