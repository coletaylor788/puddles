import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("preserves native Talk conversation, steering, completion, and explicit failures", () => {
  const candidate = process.env.OPENCLAW_CANDIDATE;
  expect(candidate, "OPENCLAW_CANDIDATE is required").toBeTruthy();
  const result = spawnSync(process.execPath, [
    resolve(import.meta.dirname, "../scenarios/talk-concurrency.mjs"), candidate!,
  ], { encoding: "utf8", timeout: 40_000 });
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "passed", modelCalls: 0, externalWrites: 0 });
}, 45_000);
