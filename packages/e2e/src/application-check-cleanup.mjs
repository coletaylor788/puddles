import { rmSync } from 'node:fs';
import { cleanupNativeFixtures } from './native-fixture.mjs';
import { installSignalHandlers, isHandlingSignal } from './process-runner.mjs';
export async function withApplicationCheckCleanup(root, run) {
  const cleanup = async () => {
    const errors = await cleanupNativeFixtures();
    if (!errors.length) rmSync(root, { recursive: true, force: true });
    return errors;
  };
  installSignalHandlers({ cleanup });
  try { return await run(); }
  catch (error) {
    if (!isHandlingSignal()) throw error;
    // The signal handler joins every child before cleanup and exits the process.
    return await new Promise(() => {});
  }
  finally {
    // Signal handling first joins the active process group, then removes state.
    if (!isHandlingSignal()) {
      const errors = await cleanup();
      if (errors.length) throw new AggregateError(errors, 'Application checks did not stop');
    }
  }
}
