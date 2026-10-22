import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { atomicJson, lock, readJson, separate } from './files.mjs';
import { command, stopInterruptedChild, validateCommand } from './commands.mjs';
import { deployDev, runNext, validateConfiguration } from './controller.mjs';
import { cancel as cancelTicket, enqueue, readQueue } from './queue.mjs';
import { identifier, loadCandidate, pinCandidate, unpinCandidate, digest, capacity, collectCandidates, recordGate, requireGate } from './ci-candidate.mjs';

export function validateCI(config) {
  if (config.version !== 1) throw new Error('Unsupported CI configuration');
  separate([config.registry, config.runs]);
  const controller = validateConfiguration(config.controller);
  separate([config.registry, config.runs, controller.root, controller.backup.root, controller.test.runtime, controller.prod.runtime, config.dev.runtime]);
  for (const item of controller.backup.paths) separate([config.registry, config.runs, config.dev.runtime, item.path]);
  for (const key of ['preflight', 'applicationTests', 'merge', 'devCleanup', 'testCleanup']) validateCommand(config[key]);
  if (config.notify) validateCommand(config.notify);
  if (config.reconcile) validateCommand(config.reconcile);
  return config;
}
const terminal = new Set(['passed', 'failed', 'cancelled', 'needs-refresh']);
function requestIdentity(config, { id, candidate, mode, githubRun, owner }) {
  validateCI(config); identifier(id); identifier(candidate);
  if (!['dev', 'prod'].includes(mode) || !/^[0-9]+:[0-9]+$/.test(githubRun ?? '') || typeof owner !== 'string' || !owner) throw new Error('CI request requires mode, workflow identity, and owner');
  return { version: 1, id, candidate, mode, githubRun, owner, configDigest: digest(config) };
}
export function requestCI(config, value) {
  const request = requestIdentity(config, value), { id, candidate } = request;
  mkdirSync(config.runs, { recursive: true, mode: 0o700 });
  const unlock = lock(join(config.runs, '.requests.lock'));
  try {
    const path = join(config.runs, id + '.json');
    if (existsSync(path)) {
      const existing = readJson(path);
      if (existing.requestDigest !== digest(request)) throw new Error('CI request identity was reused');
      if (existing.status === 'registering') {
        pinCandidate(config.registry, candidate, id);
        atomicJson(path, { ...existing, status: 'admitted' });
        return readJson(path);
      }
      return existing;
    }
    capacity(config.runs, { maxBytes: config.maxRecordBytes ?? 100 * 1024 * 1024, reserveBytes: config.reserveBytes ?? 0 }, 64 * 1024);
    if (runRecords(config).length >= (config.maxRunRecords ?? 500)) throw new Error('CI record limit reached; reconcile delivery and cleanup');
    const value = { ...request, requestDigest: digest(request), status: 'registering', phase: 'pending', child: null, createdAt: Date.now(), events: [] };
    atomicJson(path, value);
    pinCandidate(config.registry, candidate, id);
    atomicJson(path, { ...value, status: 'admitted' });
    return readJson(path);
  } finally { unlock(); }
}
// GitHub may cancel before the runner admits a request. Register the exact
// terminal identity under the admission mutex so a late submit cannot deploy it.
export function cancelRequestCI(config, value) {
  const request = requestIdentity(config, value), { id } = request;
  mkdirSync(config.runs, { recursive: true, mode: 0o700 });
  const unlock = lock(join(config.runs, '.requests.lock'));
  try {
    const path = join(config.runs, id + '.json');
    if (existsSync(path)) {
      const state = readJson(path);
      if (state.requestDigest !== digest(request)) throw new Error('Cancellation does not match admitted request');
      if (!terminal.has(state.status)) cancelCI(config, id);
      return state;
    }
    capacity(config.runs, { maxBytes: config.maxRecordBytes ?? 100 * 1024 * 1024, reserveBytes: config.reserveBytes ?? 0 }, 64 * 1024);
    if (runRecords(config).length >= (config.maxRunRecords ?? 500)) throw new Error('CI record limit reached; reconcile delivery and cleanup');
    const at = Date.now(), state = { ...request, requestDigest: digest(request), status: 'cancelled', phase: 'complete', child: null,
      createdAt: at, completedAt: at, events: [{ id: id + ':0', status: 'cancelled', at }] };
    atomicJson(path, state); return state;
  } finally { unlock(); }
}
export function cancelCI(config, id) {
  identifier(id);
  if (!existsSync(join(config.runs, id + '.json'))) throw new Error('Unknown CI run');
  atomicJson(join(config.runs, id + '.cancel.json'), { id });
}
export async function executeCI(config, id, execute = command) {
  validateCI(config); identifier(id);
  const admission = lock(join(config.runs, '.requests.lock'));
  let unlock;
  try { unlock = lock(join(config.runs, `.${id}.lock`)); } finally { admission(); }
  const path = join(config.runs, id + '.json');
  let state = readJson(path);
  const save = patch => { state = { ...state, ...patch, updatedAt: Date.now() }; atomicJson(path, state); };
  const event = (status, patch = {}) => save({ ...patch, events: state.events.at(-1)?.status === status ? state.events :
    [...state.events, { id: `${id}:${state.events.length}`, status, at: Date.now() }] });
  const run = (spec, phase) => {
    save({ phase });
    return execute(spec, { PUDDLES_CI_RUN: id, PUDDLES_CI_MODE: state.mode, PUDDLES_CI_CANDIDATE: state.candidate,
      PUDDLES_CI_REGISTRY: config.registry, PUDDLES_CI_RUNS: config.runs, PUDDLES_RELEASE_PHASE: phase,
      PUDDLES_RELEASE_ID: id, PUDDLES_RELEASE_WORKSPACE: join(config.registry, state.candidate),
      PUDDLES_RELEASE_ARTIFACT: join(config.registry, state.candidate, 'artifact') }, child => save({ child }));
  };
  let lane, owned = false;
  const ownerPath = join(config.runs, `.${state.mode}-owner.json`);
  try {
    if (state.configDigest !== digest(config)) throw new Error('Active CI configuration changed; retain recovery configuration');
    if (terminal.has(state.status)) return state;
    if (state.status === 'registering') return state;
    lane = lock(join(config.runs, `.${state.mode}-lane.lock`));
    if (existsSync(ownerPath)) {
      const previous = readJson(ownerPath);
      if (previous.id !== id) {
        const previousState = readJson(join(config.runs, identifier(previous.id) + '.json'));
        if (!terminal.has(previousState.status)) return state;
      }
    }
    atomicJson(ownerPath, { id });
    owned = true;
    const cancel = existsSync(join(config.runs, id + '.cancel.json'));
    // Restart never repeats an uncertain phase. Reconcile owned children first.
    const interrupted = state.status !== 'admitted';
    if (interrupted) await stopInterruptedChild(state.child, () => save({ child: null }));
    if (state.status === 'admitted') event('started', { status: 'running' });
    const common = { PUDDLES_CI_RUN: id, PUDDLES_CI_CANDIDATE: state.candidate, PUDDLES_CI_REGISTRY: config.registry,
      PUDDLES_CI_RUNS: config.runs };
    let outcome = state.outcome;
    try {
      if (outcome) {
        // A prior terminal application result only needs its unfinished cleanup.
      } else if (state.mode === 'prod' && existsSync(join(config.controller.root, 'current.json')) &&
          readJson(join(config.controller.root, 'current.json')).id === id && !readQueue(config.controller.root).active) {
        outcome = 'passed';
      } else if (state.mode === 'dev') {
        if (interrupted || cancel) throw new Error(cancel ? 'cancelled' : 'DEV interrupted');
        const candidate = loadCandidate(config.registry, state.candidate);
        await deployDev(config.controller, {
          id, workspace: candidate.directory, artifact: candidate.artifact, frozenDigest: candidate.manifest.artifactDigest,
          preflight: config.preflight, applicationTests: config.applicationTests, merge: config.merge,
        }, config.dev, (spec, env) => {
          if (existsSync(join(config.runs, id + '.cancel.json'))) throw new Error('cancelled');
          return execute(spec, { ...env, ...common }, child => save({ child }));
        });
        if (existsSync(join(config.runs, id + '.cancel.json'))) throw new Error('cancelled');
        outcome = 'passed';
      } else {
        const queue = readQueue(config.controller.root);
        if (queue.active && queue.active.id !== id || queue.ready.some(ticket => ticket.id !== id)) throw new Error('Another transaction owns the controller');
        if (!interrupted && !cancel && !queue.active && !queue.ready.length) {
          const candidate = loadCandidate(config.registry, state.candidate);
          requireGate(config.registry, state.candidate, 'dev', { targetDigest: digest(config.dev) });
          await run(config.preflight, 'submission-preflight');
          enqueue(config.controller.root, { id, workspace: candidate.directory, artifact: candidate.artifact,
            frozenDigest: candidate.manifest.artifactDigest,
            preflight: { ...config.preflight, env: { ...config.preflight.env, ...common } },
            applicationTests: { ...config.applicationTests, env: { ...config.applicationTests.env, ...common } },
            merge: { ...config.merge, env: { ...config.merge.env, ...common } } });
        }
        if (cancel && !queue.active) {
          if (queue.ready.some(ticket => ticket.id === id)) cancelTicket(config.controller.root, id);
          throw new Error('cancelled');
        }
        const mergeStarted = queue.active && (['merge', 'resumeIntake'].includes(queue.active.phase) || queue.active.completed.includes('merge'));
        if (cancel && mergeStarted) {
          event('recovery-required', { status: 'recovery-required', error: 'Cancellation after merge started requires source reconciliation; lane retained' });
          return state;
        }
        const guardedExecute = (spec, env, observe) => {
          const phase = env.PUDDLES_RELEASE_PHASE;
          if (existsSync(join(config.runs, id + '.cancel.json')) &&
              !/^(restore-|recover-|backup-restart)/.test(phase) && phase !== 'resume-intake' && phase !== 'resume-health') throw new Error('cancelled');
          return execute(spec, { ...env, ...common }, observe);
        };
        const result = await runNext(config.controller, guardedExecute, { recover: cancel, toolHash: config.toolDigest });
        if (result.status === 'merge-pending') {
          // Do not restore a partially merged pair blindly or release its lane.
          save({ status: 'recovery-required', error: result.error }); event('recovery-required'); return state;
        }
        if (result.status !== 'released') throw Object.assign(new Error(result.error ?? (cancel ? 'cancelled' : 'Interrupted release recovered')), { exitCode: result.errorCode });
        outcome = 'passed';
      }
    } catch (error) {
      if (readQueue(config.controller.root).active?.id === id) {
        save({ status: 'recovery-required', error: error.message }); event('recovery-required'); return state;
      }
      outcome = error.exitCode === 78 || error.message.startsWith('needs-refresh') ? 'needs-refresh' : error.message === 'cancelled' ? 'cancelled' : 'failed';
      save({ error: error.message });
    }
    // Cleanup is a durable phase, separate from application success. Recovery must
    // retry it without rerunning tests or rolling back a completed deployment.
    save({ status: 'cleaning', outcome });
    await run(state.mode === 'dev' ? config.dev.stop : config.controller.test.stop, 'cleanup-stop');
    await run(state.mode === 'dev' ? config.devCleanup : config.testCleanup, 'cleanup');
    if (state.mode === 'dev' && outcome === 'passed') recordGate(config.registry, state.candidate, 'dev', {
      status: 'passed', run: id, targetDigest: digest(config.dev), completedAt: Date.now(),
    });
    unpinCandidate(config.registry, state.candidate, id);
    event(outcome, { status: outcome, phase: 'complete', child: null, completedAt: Date.now() });
    rmSync(ownerPath);
    return state;
  } catch (error) {
    if (owned) event('recovery-required', { status: state.status === 'cleaning' ? 'cleanup-required' : 'recovery-required', error: error.message });
    throw error;
  } finally { lane?.(); unlock(); }
}

export async function deliverEvents(config, execute = command) {
  if (!config.notify) return;
  const unlock = lock(join(config.runs, '.delivery.lock'));
  try {
    for (const state of runRecords(config)) {
      for (const event of state.events ?? []) {
        const acknowledgement = join(config.runs, '.delivered', event.id.replaceAll(':', '-') + '.json');
        if (existsSync(acknowledgement)) continue;
        await execute(config.notify, { PUDDLES_CI_EVENT: JSON.stringify({ ...event, run: state.id, candidate: state.candidate,
          owner: state.owner, mode: state.mode, githubRun: state.githubRun }) });
        atomicJson(acknowledgement, { event: event.id, deliveredAt: Date.now() });
      }
    }
  } finally { unlock(); }
}

export function runRecords(config) {
  if (!existsSync(config.runs)) return [];
  return readdirSync(config.runs).filter(name => /^[a-zA-Z0-9][\w.-]*\.json$/.test(name) && !name.endsWith('.cancel.json'))
    .map(file => readJson(join(config.runs, file))).filter(state => state.version === 1 && state.requestDigest);
}
export function reconcileCI(config) {
  for (const state of runRecords(config)) {
    if (state.status === 'registering') requestCI(config, state);
  }
  for (const mode of ['dev', 'prod']) {
    let release;
    try { release = lock(join(config.runs, `.${mode}-lane.lock`)); } catch { continue; }
    try {
      const ownerPath = join(config.runs, `.${mode}-owner.json`);
      if (!existsSync(ownerPath)) continue;
      const owner = readJson(ownerPath);
      const state = readJson(join(config.runs, identifier(owner.id) + '.json'));
      if (terminal.has(state.status)) rmSync(ownerPath);
    } finally { release(); }
  }
}
export function collectCI(config, now = Date.now()) {
  const unlock = lock(join(config.runs, '.requests.lock'));
  const removed = [];
  try {
    for (const state of runRecords(config)) {
      if (!terminal.has(state.status) || now - state.completedAt < (config.recordAgeMs ?? 7 * 86400_000)) continue;
      if (state.events.some(event => !existsSync(join(config.runs, '.delivered', event.id.replaceAll(':', '-') + '.json')))) continue;
      let release;
      try { release = lock(join(config.runs, `.${state.id}.lock`)); } catch { continue; }
      const ownerPath = join(config.runs, `.${state.mode}-owner.json`);
      if (existsSync(ownerPath) && readJson(ownerPath).id === state.id) { release(); continue; }
      // These files are written by this service and only retire after delivery and teardown.
      for (const event of state.events) rmSync(join(config.runs, '.delivered', event.id.replaceAll(':', '-') + '.json'), { force: true });
      rmSync(join(config.runs, state.id + '.cancel.json'), { force: true });
      rmSync(join(config.runs, state.id + '.json'));
      // Per-run lock files are deliberately retained while records exist. A run
      // cannot be replayed after the GitHub attempt's retention window closes.
      release();
      rmSync(join(config.runs, `.${state.id}.lock`), { recursive: true, force: true });
      removed.push(state.id);
    }
    return { runs: removed, candidates: collectCandidates(config.registry, { maxAgeMs: config.candidateAgeMs ?? 86400_000 }) };
  } finally { unlock(); }
}
