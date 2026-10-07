#!/usr/bin/env node
import { resolve } from "node:path";
import { prepareFaceTimeNative, checkFaceTimeNative } from "../src/facetime-native-patches.mjs";
import { installSignalHandlers, isHandlingSignal } from "../src/process-runner.mjs";

let pending = Promise.resolve();
installSignalHandlers({ cleanup: async () => {
  // Stopping the child rejects the pending command. Join its finally/cleanup
  // before the signal handler exits the process.
  await pending.catch(() => {});
  return [];
} });
async function main() {
  const [destination, source, ...rest] = process.argv.slice(2);
  if (!destination || rest.length) throw new Error("Usage: facetime-native-patches.mjs NEW_OUTPUT_DIR [SOURCE_CHECKOUT]");
  const output = resolve(destination);
  const identity = await prepareFaceTimeNative(output, source ? resolve(source) : undefined);
  const checks = await checkFaceTimeNative(output);
  console.log(JSON.stringify({ ...identity, ...checks }, null, 2));
}
pending = main();
try {
  await pending;
} catch (error) {
  if (!isHandlingSignal()) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
