#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { atomicJson } from "../src/native-state.mjs";
import { createMergeEligibility } from "../src/merge-eligibility.mjs";

try {
  const [build, sourceGate, dev, output, ...extra] = process.argv.slice(2);
  if (!output || extra.length) throw new Error("Usage: openclaw-merge-eligibility.mjs BUILD_JSON SOURCE_GATE_JSON DEV_PROOF_JSON OUTPUT_JSON");
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  atomicJson(output, createMergeEligibility(read(build), read(sourceGate), read(dev)));
  console.log("Pre-merge eligibility recorded. Production still requires physical TEST.");
} catch (error) { console.error(error.message); process.exitCode = 1; }
