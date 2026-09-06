import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PatchEntry = {
  name: string;
  tests: string[];
  candidateTests?: string[];
};

type PatchSuite = {
  openclawRef: string;
  testProjects: Record<string, string>;
  patches: PatchEntry[];
};

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "..", "..");
const patchDir = join(repoRoot, "docs", "openclaw-setup", "patches");
const suite = JSON.parse(
  readFileSync(join(packageDir, "openclaw-patch-suite.json"), "utf8"),
) as PatchSuite;

function deploymentPatchNames(): string[] {
  const script = readFileSync(join(patchDir, "apply-and-deploy.sh"), "utf8");
  const match = script.match(/PATCHES=\(\n([\s\S]*?)\n\)/);
  if (!match) {
    throw new Error("apply-and-deploy.sh has no readable PATCHES array");
  }
  return match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function changedTests(patchName: string): string[] {
  const patch = readFileSync(join(patchDir, `${patchName}.patch`), "utf8");
  return [...patch.matchAll(/^diff --git a\/(.+\.test\.ts) b\/\1$/gm)].map(
    (match) => match[1],
  );
}

describe("OpenClaw cumulative patch suite", () => {
  it("covers every deployed patch in deployment order", () => {
    expect(suite.patches.map((patch) => patch.name)).toEqual(deploymentPatchNames());
  });

  it("keeps at least one committed regression target for every patch", () => {
    for (const patch of suite.patches) {
      const allTests = [...patch.tests, ...(patch.candidateTests ?? [])];
      expect(allTests, patch.name).not.toHaveLength(0);
      expect(new Set(patch.tests).size, patch.name).toBe(patch.tests.length);
      expect(new Set(allTests).size, patch.name).toBe(allTests.length);
      for (const test of allTests) {
        expect(test, `${patch.name}: ${test}`).toMatch(/\.test\.ts$/);
      }
      for (const test of patch.candidateTests ?? []) {
        expect(() => readFileSync(join(packageDir, test), "utf8"), `${patch.name}: ${test}`).not.toThrow();
      }
    }
  });

  it("runs every test changed by a maintained patch", () => {
    for (const patch of suite.patches) {
      expect(patch.tests, patch.name).toEqual(
        expect.arrayContaining(changedTests(patch.name)),
      );
    }
  });

  it("maps every OpenClaw regression to one explicit Vitest project", () => {
    const tests = [...new Set(suite.patches.flatMap((patch) => patch.tests))];
    expect(Object.keys(suite.testProjects).sort()).toEqual(tests.sort());
    for (const project of Object.values(suite.testProjects)) {
      expect(project).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("runs each mapped project through its direct config", () => {
    const runner = readFileSync(
      join(packageDir, "bin", "openclaw-test-env.mjs"),
      "utf8",
    );
    expect(runner).toContain(
      "`test/vitest/vitest.${project}.config.ts`",
    );
    expect(runner).not.toContain('"--project",');
  });

  it("pins the upstream source revision used by the patch pool", () => {
    expect(suite.openclawRef).toMatch(/^[0-9a-f]{40}$/);
  });

  it("keeps the CI checkout synchronized with the patch-suite pin", () => {
    const workflow = readFileSync(
      join(repoRoot, ".github", "workflows", "integration.yml"),
      "utf8",
    );
    const match = workflow.match(
      /repository:\s*openclaw\/openclaw\s*\n\s*ref:\s*([0-9a-f]{40})/,
    );

    expect(match?.[1]).toBe(suite.openclawRef);
  });

  it("checks generated prompt snapshots after applying the patch stack", () => {
    const runner = readFileSync(
      join(packageDir, "bin", "openclaw-test-env.mjs"),
      "utf8",
    );
    const finalApply = runner.indexOf('await run("git", ["apply", patchFile]');
    const snapshotCheck = runner.indexOf(
      'await run("corepack", ["pnpm", "prompt:snapshots:check"]',
    );
    const mappedTests = runner.indexOf(
      "const tests = [...new Set(suite.patches.flatMap((patch) => patch.tests))]",
    );
    const build = runner.indexOf(
      'await run("corepack", ["pnpm", "build"]',
      snapshotCheck,
    );

    expect(finalApply).toBeGreaterThan(-1);
    expect(snapshotCheck).toBeGreaterThan(finalApply);
    expect(build).toBeGreaterThan(snapshotCheck);
    expect(mappedTests).toBeGreaterThan(build);
  });

  it("uses a SQLite WAL-reset-safe Node runtime in CI", () => {
    const workflow = readFileSync(
      join(repoRoot, ".github", "workflows", "integration.yml"),
      "utf8",
    );
    const match = workflow.match(/node-version:\s*"(\d+)\.(\d+)\.(\d+)"/);
    const version = match?.slice(1).map(Number);
    const isWalResetSafe = ([major, minor, patch]: number[]) => {
      if (major === 22) {
        return minor > 22 || (minor === 22 && patch >= 3);
      }
      if (major === 24) {
        return minor > 15 || (minor === 15 && patch >= 0);
      }
      if (major === 25) {
        return minor > 9 || (minor === 9 && patch >= 0);
      }
      return major >= 26;
    };

    expect(version).toBeDefined();
    expect(isWalResetSafe(version!)).toBe(true);
    for (const unsafe of [
      [22, 22, 2],
      [23, 11, 1],
      [24, 14, 1],
      [25, 8, 0],
    ]) {
      expect(isWalResetSafe(unsafe), unsafe.join(".")).toBe(false);
    }
    for (const safe of [
      [22, 22, 3],
      [24, 15, 0],
      [25, 9, 0],
      [26, 0, 0],
    ]) {
      expect(isWalResetSafe(safe), safe.join(".")).toBe(true);
    }
  });
});
