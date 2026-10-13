#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  captureCurrentBackup,
  currentBackupRecovery,
  materializeCurrentBackup,
  planCurrentBackup,
  retireCurrentBackup,
  verifyCurrentBackup,
} from "../src/native-backup.mjs";

function readTarget(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function usage() {
  throw new Error(
    "Usage: openclaw-backup.mjs " +
    "<plan TARGET_JSON | capture TARGET_JSON [BACKUP_DIR] | current TARGET_JSON | " +
    "verify TARGET_JSON BACKUP_DIR | " +
    "materialize TARGET_JSON BACKUP_DIR DESTINATION | retire TARGET_JSON BACKUP_DIR>",
  );
}

try {
  const [command, targetPath, backupPath, destinationPath, ...extra] = process.argv.slice(2);
  if (!command || !targetPath || extra.length) usage();
  const target = readTarget(targetPath);
  let result;
  if (command === "plan" && !backupPath && !destinationPath) {
    result = planCurrentBackup(target);
  } else if (command === "current" && !backupPath && !destinationPath) {
    result = currentBackupRecovery(target);
  } else if (command === "capture" && !destinationPath) {
    result = await captureCurrentBackup(
      target,
      undefined,
      backupPath ? resolve(backupPath) : undefined,
    );
  } else if (command === "verify" && backupPath && !destinationPath) {
    result = verifyCurrentBackup(target, resolve(backupPath));
  } else if (command === "materialize" && backupPath && destinationPath) {
    result = await materializeCurrentBackup(
      target,
      resolve(backupPath),
      resolve(destinationPath),
    );
  } else if (command === "retire" && backupPath && !destinationPath) {
    result = retireCurrentBackup(target, resolve(backupPath));
  } else usage();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
