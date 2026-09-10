import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

const candidate = process.env.OPENCLAW_CANDIDATE;
if (!candidate) throw new Error("OPENCLAW_CANDIDATE is required for candidate-source tests");
const repo = realpathSync(resolve(import.meta.dirname, "../../.."));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("stopped-state operations through the actual candidate SDK", () => {
  it.each(["root", "include", "conflict", "legacy"])("preserves source ownership and targeted cron state (%s)", (mode) => {
    const root = join(repo, `.state-migration-candidate-${randomUUID()}`);
    roots.push(root);
    for (const name of ["home", "state", "scratch"]) mkdirSync(join(root, name), { recursive: true });
    const result = spawnSync(process.execPath, [
      join(repo, "packages/e2e/fixtures/state-migration.mjs"), realpathSync(candidate!), root, mode,
      join(candidate!, "test/fixtures/sqlite/openclaw-state-v2026.7.1-2.sqlite.gz"),
    ], {
      encoding: "utf8", timeout: 45_000,
      env: {
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(root, "home"),
        TMPDIR: join(root, "scratch"), OPENCLAW_STATE_DIR: join(root, "state"),
        OPENCLAW_CONFIG_PATH: join(root, "state/openclaw.json"), FIXTURE_KEY: "synthetic-fixture-only",
        OPENCLAW_SERVICE_REPAIR_POLICY: "external", NO_COLOR: "1",
      },
    });
    expect(result.error?.message ?? `${result.stdout}\n${result.stderr}`).not.toContain("Network is forbidden");
    expect(result.status, result.error?.message ?? `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 50_000);
});
