import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readQueue } from './queue.mjs';

// A detached worker survives the calling terminal. A live supervisor recovers a
// crashed worker immediately, so service recovery does not wait for an agent.
export async function supervise(entrypoint, configPath, config, action = 'run') {
  let child;
  const worker = randomUUID();
  const interrupt = () => { try { child?.kill('SIGTERM'); } catch {} };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  const launch = (operation, recovering = false) => new Promise((resolve, reject) => {
    child = spawn(process.execPath, [entrypoint, operation, configPath], {
      detached: true, stdio: 'inherit', env: { ...process.env, PUDDLES_RELEASE_WORKER: worker, PUDDLES_RELEASE_RECOVER_OWNER: recovering ? worker : '' },
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  try {
    const result = await launch(action);
    const active = readQueue(config.root).active;
    if (active?.worker === worker && ['running', 'recovering', 'ready'].includes(active.status)) {
      // run knows whether an uncertain merge must be completed instead of restored.
      await launch('run', true);
      return 1;
    }
    return result.code ?? 1;
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
}
