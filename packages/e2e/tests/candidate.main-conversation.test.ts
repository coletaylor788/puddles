import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// This scenario loads the supported SDK from the packaged runtime.
// Source-only callers retain the legacy candidate path.
const candidate = process.env.OPENCLAW_CANDIDATE_DIR ?? process.env.OPENCLAW_CANDIDATE;

it("preserves owner routing and recorded transcript updates in the installed main session", () => {
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
