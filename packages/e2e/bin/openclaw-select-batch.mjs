#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { atomicJson } from "../src/native-state.mjs";
import { snapshotMergedBatch } from "../src/merged-batch.mjs";
try {
  const [spec, output, ...extra] = process.argv.slice(2);
  if (!output || extra.length) throw new Error("Usage: openclaw-select-batch.mjs SPEC_JSON OUTPUT_JSON");
  atomicJson(output, await snapshotMergedBatch(JSON.parse(readFileSync(spec, "utf8"))));
  console.log("Selected merged source pinned. Register this batch on the mini before TEST.");
} catch (error) { console.error(error.message); process.exitCode = 1; }
