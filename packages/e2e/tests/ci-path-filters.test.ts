import { readFileSync } from "node:fs";
import { matchesGlob, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const repoRoot = resolve(import.meta.dirname, "../../..");
describe.each(["integration", "codeql"])("%s automatic CI path selection", (name) => {
  const parsed = parseDocument(readFileSync(resolve(repoRoot, `.github/workflows/${name}.yml`), "utf8"));
  const workflow = parsed.toJS();
  it("parses the workflow and preserves main push and PR triggers", () => {
    expect(parsed.errors).toEqual([]);
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.pull_request).toBeTruthy();
  });

  for (const event of ["push", "pull_request"]) {
    const ignored: string[] = workflow.on[event]["paths-ignore"];
    const runs = (files: string[]) => files.some((file) => !ignored.some((pattern) => matchesGlob(file, pattern)));

    it(`${event} skips documentation and development instructions`, () => {
      expect(ignored.length).toBeGreaterThan(0);
      expect(runs([
        "README.md", "AGENTS.md", ".github/copilot-instructions.md",
        ".github/skills/safe-feature-development/SKILL.md",
        "docs/plans/example.md", "docs/plans/nested/design.md",
        "docs/openclaw-setup/01-setting-up-your-mac-mini.md",
        "docs/openclaw-setup/patches/example.md",
        "packages/e2e/README.md", "packages/mcp-hooks/docs/architecture.md",
        "servers/gmail-mcp/docs/tools.md", "openclaw-plugins/scoped-memory/README.md",
      ])).toBe(false);
    });

    it(`${event} runs for every runtime, test, dependency, or workflow input`, () => {
      for (const file of [
        "packages/mcp-hooks/src/index.ts", "packages/e2e/tests/example.test.ts",
        "docs/openclaw-setup/patches/example.patch", "docs/openclaw-setup/patches/apply-and-deploy.sh",
        "docs/openclaw-setup/patches/runtime.mjs", "pnpm-lock.yaml", "package.json",
        ".github/workflows/integration.yml", ".github/skills/example/scripts/check.py",
        "openclaw-skills/todoist-cli/SKILL.md",
        "docs/openclaw-setup/agent-instructions/reader-AGENTS.md",
        "packages/example/prompts/system.md", "unknown/path.md",
      ]) {
        expect(runs([file]), file).toBe(true);
        expect(runs(["README.md", "docs/plans/example.md", file]), file).toBe(true);
      }
    });
  }
});

it("keeps CodeQL coverage, weekly scans, and uploads after replacing default setup", () => {
  const workflow = parseDocument(readFileSync(resolve(repoRoot, ".github/workflows/codeql.yml"), "utf8")).toJS();
  expect(workflow.jobs.analyze.strategy.matrix.language).toEqual(["actions", "javascript-typescript", "python"]);
  expect(workflow.on.schedule).toHaveLength(1);
  expect(workflow.on.schedule[0].cron).toMatch(/^\d+ \d+ \* \* [0-6]$/);
  expect(workflow.on.workflow_dispatch).toBeNull();
  expect(workflow.jobs.analyze.permissions["security-events"]).toBe("write");
  const init = workflow.jobs.analyze.steps.find((step: any) => step.uses?.startsWith("github/codeql-action/init@"));
  expect(init.with["build-mode"]).toBe("none");
  expect(init.with.queries).toBeUndefined();
  const analyze = workflow.jobs.analyze.steps.find((step: any) => step.uses?.startsWith("github/codeql-action/analyze@"));
  expect(analyze).toBeTruthy();
  expect(analyze.with.upload).not.toBe(false);
});
