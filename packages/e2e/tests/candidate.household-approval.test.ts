import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("composes native question approval and scoped sends without background replies", () => {
  const candidate = process.env.OPENCLAW_CANDIDATE_DIR;
  expect(candidate, "OPENCLAW_CANDIDATE_DIR must name the composed application artifact").toBeTruthy();
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, "../scenarios/household-approval.mjs"), candidate!], { encoding: "utf8", timeout: 50000 });
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(JSON.parse(result.stdout.trim())).toMatchObject({ status: "passed", recordedQuestions: 5, externalWrites: 0 });
}, 55000);
