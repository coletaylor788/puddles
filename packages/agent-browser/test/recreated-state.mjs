import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureBrowser, stopBrowser, containerName, dockerCommand } from '../launch.mjs';

// Docker Desktop can retain stale paths after CI replaces an ancestor of a
// populated profile. Check actual host data, not just successful container start.
export async function qualifyRecreatedState(spec, scratch) {
  const root = realpathSync(mkdtempSync(join(scratch, 'browser-recreated-')));
  const state = join(root, 'state');
  const probe = { ...spec, stateDir: join(state, 'controller'),
    profile: join(state, 'profiles/browser'), downloads: join(state, 'workspace/downloads'), headless: true };
  try {
    for (let generation = 0; generation < 2; generation++) {
      const markers = [randomUUID(), randomUUID()];
      for (const [index, path] of [probe.profile, probe.downloads].entries()) {
        mkdirSync(path, { recursive: true, mode: 0o700 });
        writeFileSync(join(path, 'host-marker.txt'), markers[index] + '\n', { flag: 'wx', mode: 0o600 });
      }
      await ensureBrowser(probe);
      assert.equal(dockerCommand(probe, ['exec', containerName(probe), 'cat',
        '/profile/host-marker.txt', '/downloads/host-marker.txt']), markers.join('\n'),
      'Recreated browser binds must expose the current host files');
      stopBrowser(probe);
      rmSync(state, { recursive: true });
    }
  } finally {
    stopBrowser(probe);
    rmSync(root, { recursive: true });
  }
}
