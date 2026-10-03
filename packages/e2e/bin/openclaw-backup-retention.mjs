#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { planBackupRetention, applyBackupRetention, runBackupRetention } from "../src/native-backup-retention.mjs";
import { runCommand } from "../src/process-runner.mjs";
let interrupted = false;
const onSignal = () => { interrupted = true; };
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, onSignal);
const execute = async (...args) => {
  if (interrupted) throw new Error("Retention interrupted");
  const result = await runCommand(...args);
  if (interrupted) throw new Error("Retention interrupted");
  return result;
};
const read = path => JSON.parse(readFileSync(path, "utf8"));
try {
  const [command, target, policy, manifest, ...extra] = process.argv.slice(2);
  if (!target || !policy || extra.length || !["plan", "apply", "run"].includes(command) ||
      command === "apply" && !manifest || command !== "apply" && manifest) {
    throw new Error("Usage: openclaw-backup-retention.mjs <plan|run> TARGET POLICY | apply TARGET POLICY MANIFEST");
  }
  const result = command === "plan" ? await planBackupRetention(read(target), read(policy), execute) :
    command === "run" ? await runBackupRetention(read(target), read(policy), execute) :
      await applyBackupRetention(read(target), read(policy), read(manifest), execute);
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
