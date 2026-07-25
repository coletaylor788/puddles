import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");

function walk(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (["dist", "node_modules"].includes(entry.name)) {
      return [];
    }
    const path = join(root, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

describe("test discovery", () => {
  it("does not retain credentialed suites outside default test discovery", () => {
    const files = [
      ...walk(join(repoRoot, "openclaw-plugins")),
      ...walk(join(repoRoot, "packages")),
    ];
    const separateConfigs = files.filter(
      (path) => basename(path) === "vitest.integration.config.ts",
    );
    expect(separateConfigs).toEqual([]);

    const excludedIntegrationSuites = files
      .filter((path) => basename(path) === "vitest.config.ts")
      .filter((path) =>
        /exclude\s*:\s*\[[^\]]*integration/s.test(readFileSync(path, "utf8")),
      );
    expect(excludedIntegrationSuites).toEqual([]);
  });
});
