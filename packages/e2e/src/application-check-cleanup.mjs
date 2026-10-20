import { beginCheckOutput, finishCheckOutput } from '../../release/src/check-output.mjs';
import { cleanupNativeFixtures } from './native-fixture.mjs';
import { installSignalHandlers, isHandlingSignal } from './process-runner.mjs';
let active = false;
export async function withApplicationCheckCleanup(root, run, options = {}) {
  if (active) throw new Error('Application check cleanup cannot run concurrently in one process');
  const previousScopes = process.env.PUDDLES_PROCESS_SCOPES;
  const inherited = JSON.parse(previousScopes ?? '[]');
  if (!Array.isArray(inherited) || inherited.some(scope => typeof scope !== 'string')) throw new Error('Invalid inherited process scopes');
  const output = beginCheckOutput(root, options);
  process.env.PUDDLES_PROCESS_SCOPES = JSON.stringify([...inherited, output.scope]);
  active = true;
  let preserveFailure = false;
  const restoreScopes = () => {
    if (previousScopes === undefined) delete process.env.PUDDLES_PROCESS_SCOPES;
    else process.env.PUDDLES_PROCESS_SCOPES = previousScopes;
    active = false;
  };
  const cleanup = async ({ joinSucceeded = true } = {}) => {
    if (!joinSucceeded) preserveFailure = true;
    const errors = await cleanupNativeFixtures();
    try {
      finishCheckOutput(output, { failed: preserveFailure, joinSucceeded, fixturesStopped: errors.length === 0, interrupted: isHandlingSignal() });
    } catch (error) { errors.push(error); }
    finally { restoreScopes(); }
    return errors;
  };
  const uninstallSignals = installSignalHandlers({ cleanup });
  try { return await run(); }
  catch (error) {
    if (!isHandlingSignal()) {
      // Failed checks leave protected diagnostics in this owned run directory.
      preserveFailure = true;
      throw error;
    }
    // The signal handler joins every child before cleanup and exits the process.
    return await new Promise(() => {});
  }
  finally {
    // Signal handling first joins the active process group, then removes state.
    if (!isHandlingSignal()) {
      try {
        const errors = await cleanup();
        if (errors.length) throw new AggregateError(errors, 'Application checks did not stop');
      } finally { uninstallSignals(); }
    }
  }
}
