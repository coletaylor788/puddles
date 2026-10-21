#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readJson, lock } from '../src/files.mjs';
import { command } from '../src/commands.mjs';
import { identifier, loadCandidate, requireGate, digest } from '../src/ci-candidate.mjs';
import { requestCI, executeCI, cancelCI, cancelRequestCI, deliverEvents, collectCI, runRecords, reconcileCI, validateCI } from '../src/ci-run.mjs';
import { inspectSources, mergeSources } from '../src/ci-source.mjs';

const [action, configPath, ...args] = process.argv.slice(2);
if (!configPath) throw new Error('Usage: puddles-ci ACTION CONFIG [ARGS]');
const config = validateCI(readJson(configPath));
mkdirSync(config.runs, { recursive: true, mode: 0o700 });
const result = value => console.log(JSON.stringify(value));
if (action === 'request' || action === 'cancel-request') {
  const [id, candidate, mode, githubRun, owner] = args;
  result((action === 'request' ? requestCI : cancelRequestCI)(config, { id, candidate, mode, githubRun, owner }));
} else if (action === 'work') result(await executeCI(config, args[0]));
else if (action === 'cancel') { cancelCI(config, args[0]); result({ requested: true }); }
else if (action === 'status') result(args[0] ? readJson(join(config.runs, identifier(args[0]) + '.json')) : runRecords(config));
else if (action === 'wait') {
  const id = identifier(args[0]);
  const deadline = Date.now() + Number(config.waitTimeoutMs ?? 5 * 60 * 60_000);
  while (Date.now() < deadline) {
    const state = readJson(join(config.runs, id + '.json'));
    if (['passed', 'failed', 'cancelled', 'needs-refresh', 'recovery-required', 'cleanup-required'].includes(state.status)) {
      result({ id, status: state.status, phase: state.phase, error: state.error });
      process.exitCode = state.status === 'passed' ? 0 : 1; break;
    }
    await delay(2000);
  }
  if (process.exitCode === undefined) {
    const state = readJson(join(config.runs, id + '.json'));
    if (state.status !== 'passed') { result({ id, status: 'wait-expired', retained: true }); process.exitCode = 1; }
  }
} else if (['preflight', 'merge'].includes(action)) {
  const id = args[0] ?? process.env.PUDDLES_CI_CANDIDATE;
  const { manifest } = loadCandidate(config.registry, id);
  if (action === 'preflight') requireGate(config.registry, id, 'dev', { targetDigest: digest(config.dev) });
  try { result(await (action === 'merge' ? mergeSources(manifest) : inspectSources(manifest))); }
  catch (error) { console.error(error.message); process.exitCode = error.message.startsWith('needs-refresh') ? 78 : 1; }
} else if (action === 'collect') result(collectCI(config));
else if (action === 'deliver') await deliverEvents(config);
else if (action === 'service') {
  // launchd supervises this process. On restart executeCI reconciles the recorded
  // child and transaction before admitting another owner. GitHub holds scheduling.
  const release = lock(join(config.runs, '.service.lock'));
  const busy = new Map(); let stopping = false;
  process.on('SIGTERM', () => { stopping = true; });
  process.on('SIGINT', () => { stopping = true; });
  const report = error => console.error(JSON.stringify({ service: 'ci', error: error.message }));
  try {
    while (!stopping) {
      try { reconcileCI(config); } catch (error) { report(error); }
      if (config.reconcile) {
        try { await command(config.reconcile, { PUDDLES_CI_RUNS: config.runs }); } catch (error) { report(error); }
      }
      for (const mode of ['dev', 'prod']) {
        if (busy.has(mode)) continue;
        const ownerPath = join(config.runs, `.${mode}-owner.json`);
        const owner = existsSync(ownerPath) ? readJson(ownerPath).id : null;
        const records = runRecords(config).filter(state => state.mode === mode);
        const next = owner ? records.find(state => state.id === owner) : records.find(state => state.status === 'admitted');
        // Uncertain merges require an explicit work/reconcile request. Cleanup
        // and interrupted application work recover automatically.
        if (!next || !['admitted', 'running', 'cleaning', 'cleanup-required'].includes(next.status)) continue;
        const pending = executeCI(config, next.id).catch(report).finally(() => busy.delete(mode));
        busy.set(mode, pending);
      }
      try { await deliverEvents(config); } catch (error) { report(error); }
      try { collectCI(config); } catch (error) { report(error); }
      await delay(Math.max(1000, Math.min(config.serviceIntervalMs ?? 10_000, 60_000)));
    }
    await Promise.allSettled(busy.values());
  } finally { release(); }
} else throw new Error('Unknown CI action');
