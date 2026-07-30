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

    expect(finalApply).toBeGreaterThan(-1);
    expect(snapshotCheck).toBeGreaterThan(finalApply);
    expect(mappedTests).toBeGreaterThan(snapshotCheck);
  });

  it("uses a SQLite WAL-reset-safe Node runtime in CI", () => {
    const workflow = readFileSync(
      join(repoRoot, ".github", "workflows", "integration.yml"),
      "utf8",
    );
    const match = workflow.match(/node-version:\s*"(\d+)\.(\d+)\.(\d+)"/);
    const version = match?.slice(1).map(Number);

    expect(version).toBeDefined();
    expect(version).toSatisfy(
      ([major, minor, patch]: number[]) =>
        major > 22 ||
        (major === 22 && (minor > 22 || (minor === 22 && patch >= 3))),
    );
  });
});
