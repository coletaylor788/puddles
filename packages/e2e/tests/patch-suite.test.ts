import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { safeNode } from "../src/native-pipeline.mjs";

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

  it("selects the standard macOS ARM runner with the measured low-memory profile", () => {
    const workflow = readFileSync(join(repoRoot, ".github/workflows/integration.yml"), "utf8");
    const runner = readFileSync(join(packageDir, "src/native-pipeline.mjs"), "utf8");
    expect(workflow).toMatch(/runs-on:\s*macos-15\b/);
    expect(workflow).toContain("E2E_RESOURCE_PROFILE: hosted-arm");
    expect(workflow).toContain('E2E_RESOURCE_MEASURE: "1"');
    expect(runner).toContain("resolveResourceProfile()");
    expect(runner).not.toMatch(/\[[^\]]*"E2E_RESOURCE_PROFILE"[^\]]*\]/);
    expect(runner).toMatch(/\[[^\]]*"E2E_RESOURCE_MEASURE"[^\]]*\]/);
    expect(runner).toMatch(/stage\(runDir,\s*"regressions",\s*\{[^}]*buildEnvironment/s);
    const timeout = Number(workflow.match(/timeout-minutes:\s*(\d+)/)?.[1]);
    expect(timeout).toBeGreaterThan(90);
    expect(timeout).toBeLessThanOrEqual(360);
    expect(workflow).toContain("node packages/e2e/bin/openclaw-test-env.mjs ci");
  });

  it("checks generated prompt snapshots after applying the patch stack", () => {
    const runner = readFileSync(
      join(packageDir, "src", "native-pipeline.mjs"),
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

  it("maps exact Vitest projects and proves collection before running old regressions", () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, "openclaw-patch-suite.json"), "utf8"));
    expect(manifest.testProjects["src/agents/tools/yield-gather-state.test.ts"]).toBe("unit-fast");
    expect(manifest.testProjects["packages/memory-host-sdk/src/host/backend-config.test.ts"]).toBe("unit-fast-isolated");
    expect(manifest.testProjects["src/agents/subagents/spawn/acp-spawn.test.ts"]).toBe("agents-support");
    expect(manifest.testProjects["src/agents/subagents/spawn/subagent-spawn.test.ts"]).toBe("agents-support");
    expect(manifest.testProjects["src/config/dead-config-keys.test.ts"]).toBe("runtime-config");
    for (const test of suite.patches.flatMap((patch) => patch.tests)) {
      expect(manifest.testProjects[test], test).toMatch(/^[a-z-]+$/);
    }
    const runner = readFileSync(join(packageDir, "src/native-pipeline.mjs"), "utf8");
    expect(runner).toContain('"list", "--filesOnly"');
    expect(runner).toContain("Mapped regression was not collected");
    expect(runner).toContain("...scenarios, ...extension.scenarios");
    expect(readFileSync(join(packageDir, "scenarios/imessage.mjs"), "utf8")).toContain("no-output");
  });

  it("uses an upstream-supported SQLite-safe Node runtime and explicit Corepack in CI", () => {
    const workflow = readFileSync(
      join(repoRoot, ".github", "workflows", "integration.yml"),
      "utf8",
    );
    const match = workflow.match(/node-version:\s*"(\d+)\.(\d+)\.(\d+)"/);
    expect(match).not.toBeNull();
    expect(safeNode(match!.slice(1).join("."))).toBe(true);
    expect(workflow).toContain("npm install --global corepack@0.36.0");
  });
});
