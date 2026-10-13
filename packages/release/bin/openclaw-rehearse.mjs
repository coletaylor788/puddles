#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { activateNative } from "../src/native-activation.mjs";
import { verifyBuildReceipt } from "../src/native-release.mjs";

try {
  const [receiptPath, targetPath, recoveryDir, action, ...extra] = process.argv.slice(2);
  if (!receiptPath || !targetPath || extra.length ||
      action && action !== "--rollback" ||
      recoveryDir === "--rollback") {
    throw new Error("Usage: openclaw-rehearse.mjs BUILD_JSON TARGET_JSON [RECOVERY_DIR [--rollback]]");
  }
  const receipt = verifyBuildReceipt(JSON.parse(readFileSync(resolve(receiptPath), "utf8")));
  const target = JSON.parse(readFileSync(resolve(targetPath), "utf8"));
  const result = await activateNative(
    receipt,
    target,
    undefined,
    recoveryDir ? resolve(recoveryDir) : undefined,
    action === "--rollback" ? "rollback" : "recover",
    "rehearsal",
  );
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
