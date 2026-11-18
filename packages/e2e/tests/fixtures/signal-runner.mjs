import { readFileSync, writeFileSync } from "node:fs";
import { runApplicationLanes } from "../../src/application-suite.mjs";
import {
  installSignalHandlers,
  runCommand,
  isHandlingSignal,
} from "../../src/process-runner.mjs";

const marker = process.env.E2E_SIGNAL_MARKER;
const lanes = Number(process.env.E2E_SIGNAL_LANES ?? 1);
if (!marker) {
  throw new Error("E2E_SIGNAL_MARKER is required");
}

installSignalHandlers({
  cleanup: async () => {
    for (let index = 0; index < lanes; index++) {
      const pid = Number(readFileSync(`${marker}.${index}.pid`, 'utf8'));
      try { process.kill(pid, 0); }
      catch (error) { if (error.code === 'ESRCH') continue; throw error; }
      throw new Error('Cleanup ran while a lane child was alive');
    }
    writeFileSync(marker, "cleaned\n");
    return [];
  },
  graceMs: 1_000,
});

const run = index => runCommand(process.execPath, ["-e",
  `require('node:fs').writeFileSync(${JSON.stringify(marker)} + '.${index}.pid', String(process.pid));
   process.on('SIGTERM', () => { ${lanes === 1 ? 'process.exit(0)' : ''} });
   console.log('child-ready'); setInterval(() => {}, 1000);`,
]);
try {
  if (lanes === 2) await runApplicationLanes(() => run(0), () => run(1));
  else await run(0);
} catch (error) {
  if (!isHandlingSignal()) throw error;
}
