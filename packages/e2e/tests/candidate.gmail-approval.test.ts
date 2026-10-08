import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("runs guarded Gmail through the actual native approval wrapper and recording MCP bridge", () => {
  const candidate = process.env.OPENCLAW_CANDIDATE;
  expect(candidate, "OPENCLAW_CANDIDATE is required").toBeTruthy();
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, "../scenarios/gmail-approval.mjs"), candidate!], { encoding: "utf8", timeout: 50000 });
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(JSON.parse(result.stdout.trim())).toMatchObject({ status: "passed", recordedSends: 1, externalWrites: 0 });
}, 55000);
