#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  acquireArtifactPoolLock,
  applyArtifactCleanup,
  findSuccessfulBuild,
  initializeArtifactPool,
  planArtifactCleanup,
  registerDiagnosticLogs,
  registerFailedReproduction,
  registerRetainedObject,
  registerSuccessfulBuild,
  removeRetentionReference,
  retentionSpaceSummary,
  setRetentionReference,
} from "../src/native-retention.mjs";

function json(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function usage() {
  throw new Error(
    "Usage: openclaw-artifact-retention.mjs " +
    "<init POOL | dry-run POOL | apply POOL | status POOL REQUIRED_BYTES | find-build POOL BUILD_ID | " +
    "register POOL SPEC_JSON | success POOL RUN_DIR BUNDLE BUILD_ID | " +
    "failure POOL RUN_DIR | logs POOL RUN_DIR | reference POOL SPEC_JSON | unreference POOL ID>",
  );
}

let unlock;
try {
  const [command, poolArg, ...args] = process.argv.slice(2);
  if (!command || !poolArg) usage();
  const pool = resolve(poolArg);
  if (command === "init" && !args.length) {
    console.log(initializeArtifactPool(pool));
  } else {
    unlock = acquireArtifactPoolLock(pool);
    let result;
    if (command === "dry-run" && !args.length) result = planArtifactCleanup(pool);
    else if (command === "apply" && !args.length) result = applyArtifactCleanup(pool);
    else if (command === "status" && args.length === 1) {
      const required = Number(args[0]);
      result = retentionSpaceSummary(pool, required);
    } else if (command === "find-build" && args.length === 1) {
      result = findSuccessfulBuild(pool, args[0]);
    } else if (command === "register" && args.length === 1) {
      result = registerRetainedObject(pool, json(args[0]));
    } else if (command === "success" && args.length === 3) {
      result = registerSuccessfulBuild(pool, resolve(args[0]), resolve(args[1]), args[2]);
    } else if (command === "failure" && args.length === 1) {
      result = registerFailedReproduction(pool, resolve(args[0]));
    } else if (command === "logs" && args.length === 1) {
      result = registerDiagnosticLogs(pool, resolve(args[0]));
    } else if (command === "reference" && args.length === 1) {
      result = setRetentionReference(pool, json(args[0]));
    } else if (command === "unreference" && args.length === 1) {
      removeRetentionReference(pool, args[0]);
      result = { removed: args[0] };
    } else usage();
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  unlock?.();
}
