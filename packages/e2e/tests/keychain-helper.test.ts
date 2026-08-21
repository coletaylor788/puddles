import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const lifecycle = resolve(
  repoRoot,
  "tools",
  "keychain-helper",
  "tests",
  "run.sh",
);

describe("stable Keychain helper", () => {
  it(
    "passes the prompt-proof helper, setup, consumer, promotion, and rollback lifecycle",
    () => {
      const source = readFileSync(lifecycle, "utf8");
      expect(source).not.toMatch(
        /\bsecurity\s+(?:add|delete|find|lock|unlock)-/,
      );

      const result = spawnSync("/bin/sh", [lifecycle], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          PUDDLES_KEYCHAIN_HELPER_TESTING: "1",
        },
        timeout: 180_000,
      });

      expect({
        signal: result.signal,
        status: result.status,
        stderr: result.stderr,
      }).toEqual({
        signal: null,
        status: 0,
        stderr: expect.any(String),
      });
      expect(result.stdout).toContain(
        "keychain-helper synthetic lifecycle: PASS",
      );
    },
    190_000,
  );
});
