import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureEnv, isolatedContext } from "./native-fixture.mjs";
import { runCommand } from "./process-runner.mjs";

export async function rehearseStateMigration(installedDir, sourceDir, runDir) {
  const results = [];
  for (const mode of ["root", "include", "conflict", "legacy"]) {
    const root = realpathSync(mkdtempSync(join(runDir, `fixture-state-migration-${mode}-`)));
    const context = isolatedContext(root);
    await runCommand(process.execPath, [
      join(dirname(fileURLToPath(import.meta.url)), "../fixtures/state-migration.mjs"),
      installedDir, root, mode,
      join(sourceDir, "test/fixtures/sqlite/openclaw-state-v2026.7.1-2.sqlite.gz"),
    ], {
      cwd: context.workspace,
      env: { ...fixtureEnv(context), FIXTURE_KEY: "synthetic-fixture-only", OPENCLAW_SERVICE_REPAIR_POLICY: "external" },
      timeoutMs: 45_000, quiet: true, logPath: join(root, "migration.log"),
    });
    results.push({ id: mode, passed: true });
    rmSync(root, { recursive: true });
  }
  return results;
}
