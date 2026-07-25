import { writeFileSync } from "node:fs";
import {
  installSignalHandlers,
  runCommand,
} from "../../src/process-runner.mjs";

const marker = process.env.E2E_SIGNAL_MARKER;
if (!marker) {
  throw new Error("E2E_SIGNAL_MARKER is required");
}

installSignalHandlers({
  cleanup: async () => {
    writeFileSync(marker, "cleaned\n");
    return [];
  },
  graceMs: 1_000,
});

await runCommand(process.execPath, [
  "-e",
  "console.log('child-ready'); process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000);",
]);
