import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const candidateValue = process.env.OPENCLAW_CANDIDATE;
if (!candidateValue) throw new Error("OPENCLAW_CANDIDATE is required for candidate-source tests");
const candidate: string = candidateValue;

function buildProfile(name: string) {
  const moduleUrl = pathToFileURL(join(candidate, "scripts/build-all.mts")).href;
  const script = [
    `const value = await import(${JSON.stringify(moduleUrl)});`,
    `console.log(JSON.stringify(value.resolveBuildAllSteps(${JSON.stringify(name)}).map((step) => ({ label: step.label, env: step.env ?? {} }))));`,
  ].join("");
  return JSON.parse(execFileSync(process.execPath, [
    "--import", join(candidate, "scripts/tsx.mjs"), "--input-type=module", "-e", script,
  ], { cwd: candidate, encoding: "utf8" }));
}

describe("ordinary development loop contract", () => {
  it("keeps semantic checks incremental and separates runtime builds from declarations", () => {
    const manifest = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8"));
    expect(manifest.scripts["tsgo:core"]).toContain("--incremental");
    expect(manifest.scripts["tsgo:extensions"]).toContain("--incremental");
    expect(manifest.scripts["test:extension"]).toContain("test-extension.mts");

    const runtime = buildProfile("qaRuntime");
    expect(runtime.map((step: { label: string }) => step.label)).toEqual([
      "plugins:assets:build",
      "tsdown",
      "external-plugins:local-dist",
      "check-cli-bootstrap-imports",
      "plugins:assets:copy",
      "runtime-postbuild",
      "build-stamp",
      "runtime-postbuild-stamp",
    ]);
    expect(runtime.find((step: { label: string }) => step.label === "tsdown").env)
      .toMatchObject({ OPENCLAW_RUN_NODE_SKIP_DTS_BUILD: "1" });
    expect(runtime.map((step: { label: string }) => step.label)).not.toContain("ui:build");
    expect(runtime.map((step: { label: string }) => step.label)).not.toContain("write-unified-entry-dts");
  });

  it("keeps installed DEV output distinct from source-checkout overlay state", () => {
    const manifest = JSON.parse(readFileSync(join(candidate, "package.json"), "utf8"));
    expect(manifest.files).toContain("dist/");
    expect(manifest.files).not.toContain("dist-runtime/");
  });
});
