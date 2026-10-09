import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("shares the owner's text and voice history in the installed main session", () => {
  const candidate = process.env.OPENCLAW_CANDIDATE;
  expect(candidate, "OPENCLAW_CANDIDATE is required").toBeTruthy();
  const result = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, "../scenarios/main-conversation.mjs"), candidate!],
    { encoding: "utf8", timeout: 45_000 },
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    status: "passed",
    modelCalls: 0,
    externalWrites: 0,
  });
}, 50_000);

it("refreshes the persistent harness from shared speech without replaying requests", () => {
  const candidate = process.env.OPENCLAW_CANDIDATE;
  expect(candidate, "OPENCLAW_CANDIDATE is required").toBeTruthy();
  const result = spawnSync(
    process.execPath,
    [resolve(import.meta.dirname, "../scenarios/shared-harness-context.mjs"), candidate!],
    { encoding: "utf8", timeout: 45_000 },
  );
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    status: "passed",
    modelCalls: 0,
    externalWrites: 0,
  });
}, 50_000);
