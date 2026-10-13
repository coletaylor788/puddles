#!/usr/bin/env node
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import scenarios from '../scenarios/imessage.mjs';
import { cleanupNativeFixtures, runScenario } from '../src/native-fixture.mjs';
import { treeDigest } from '../src/native-state.mjs';
import { installSignalHandlers } from '../src/process-runner.mjs';

const artifact = realpathSync(process.env.OPENCLAW_CANDIDATE_DIR);
const plugin = join(artifact, 'plugins/communication-watcher');
if (!existsSync(join(plugin, 'scripts/configure.mjs'))) throw new Error('Built communication plugin is required for the full application gate');
const extension = process.env.E2E_APPLICATION_EXTENSION
  ? (await import(pathToFileURL(realpathSync(process.env.E2E_APPLICATION_EXTENSION)))).default : {};
const root = mkdtempSync(join(dirname(artifact), 'application-checks-'));
const before = treeDigest(artifact, { portable: true });
installSignalHandlers({ cleanup: cleanupNativeFixtures });
async function check(name, run) {
  const started = Date.now();
  try { return await run(); }
  finally { console.log(JSON.stringify({ check: name, durationMs: Date.now() - started })); }
}
try {
  const selected = [...scenarios, ...(extension.scenarios ?? [])];
  // Each scenario owns state, ports and children. Join a batch before cleanup.
  for (let index = 0; index < selected.length; index += 2) {
    const results = await Promise.allSettled(selected.slice(index, index + 2).map(scenario =>
      check(scenario.id, () => runScenario(artifact, scenario, { runDir: root, providerFixture: extension.providerFixture }))));
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Installed application scenarios failed');
  }
  if (treeDigest(artifact, { portable: true }) !== before) throw new Error('Installed checks changed the frozen application');
} finally {
  const failures = await cleanupNativeFixtures();
  if (failures.length) throw new AggregateError(failures, 'Application fixtures did not stop');
  rmSync(root, { recursive: true, force: true });
}
