import { cleanupNativeFixtures } from './native-fixture.mjs';
import { installSignalHandlers } from './process-runner.mjs';
// Preloaded in Node's test runner and each worker, including detached gateways.
installSignalHandlers({ cleanup: cleanupNativeFixtures });
