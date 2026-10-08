#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { atomicJson } from "../src/native-state.mjs";
import { certifyRelease, createTargetProof, promoteRelease } from "../src/native-release.mjs";
import {
  acquireArtifactPoolLock,
  applyArtifactCleanup,
  registerTargetProof,
} from "../src/native-retention.mjs";

function read(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

try {
  const [command, buildPath, sourcePath, targetPath, inputOrOutput, output, ...extra] = process.argv.slice(2);
  if (extra.length || !buildPath || !sourcePath || !targetPath || !inputOrOutput) {
    throw new Error("Usage: openclaw-release.mjs <target-proof BUILD RUN_DIR SUCCESS_RECOVERY ROLLBACK_RECOVERY OUTPUT | certify BUILD SOURCE_GATE TARGET_PROOF OUTPUT | promote BUILD SOURCE_GATE TARGET_PROOF CERTIFICATION OUTPUT>");
  }
  const build = read(buildPath);
  if (command === "target-proof" && output) {
    const outputPath = resolve(output);
    atomicJson(outputPath, createTargetProof(
      build,
      resolve(sourcePath),
      resolve(targetPath),
      resolve(inputOrOutput),
    ));
    if (process.env.E2E_ARTIFACT_POOL) {
      const pool = resolve(process.env.E2E_ARTIFACT_POOL);
      const unlock = acquireArtifactPoolLock(pool);
      try {
        registerTargetProof(
          pool,
          resolve(sourcePath),
          resolve(targetPath),
          resolve(inputOrOutput),
          outputPath,
          build.buildId,
        );
        applyArtifactCleanup(pool);
      } finally {
        unlock();
      }
    }
  } else if (command === "certify" && !output) {
    const sourceGate = read(sourcePath);
    const targetProof = read(targetPath);
    atomicJson(resolve(inputOrOutput), certifyRelease(build, sourceGate, targetProof));
  } else if (command === "promote" && output) {
    const sourceGate = read(sourcePath);
    const targetProof = read(targetPath);
    atomicJson(resolve(output), promoteRelease(build, sourceGate, targetProof, read(inputOrOutput)));
  } else {
    throw new Error("Usage: openclaw-release.mjs <target-proof BUILD RUN_DIR SUCCESS_RECOVERY ROLLBACK_RECOVERY OUTPUT | certify BUILD SOURCE_GATE TARGET_PROOF OUTPUT | promote BUILD SOURCE_GATE TARGET_PROOF CERTIFICATION OUTPUT>");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
