#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { activateNative, verifyIntegratedCandidate } from "../src/native-activation.mjs";

try {
  const [receiptPath, targetPath, recoveryDir] = process.argv.slice(2);
  if (!receiptPath || !targetPath) throw new Error("Usage: openclaw-activate.mjs CANDIDATE_JSON TARGET_JSON [RECOVERY_DIR]");
  const target = JSON.parse(readFileSync(targetPath, "utf8"));
  const receipt = recoveryDir
    ? JSON.parse(readFileSync(receiptPath, "utf8"))
    : await verifyIntegratedCandidate(receiptPath, target);
  const result = await activateNative(receipt, target, undefined, recoveryDir);
  console.log(`Activation ${result.status}. Protected recovery state: ${result.recoveryDir}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
