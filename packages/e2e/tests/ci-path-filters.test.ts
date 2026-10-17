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
        "packages/e2e/DEVELOPMENT_STORAGE.md", "packages/e2e/DEPLOYMENT_COORDINATION.md",
        "servers/gmail-mcp/docs/tools.md", "openclaw-plugins/scoped-memory/README.md",
      ])).toBe(false);
    });

    it(`${event} runs for every runtime, test, dependency, or workflow input`, () => {
      for (const file of [
        "packages/mcp-hooks/src/index.ts", "packages/e2e/tests/example.test.ts",
        "docs/openclaw-setup/patches/example.patch",
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


it("runs application checks on feature events and the full prepared suite on dispatch", () => {
  const workflow = parseDocument(readFileSync(resolve(repoRoot, ".github/workflows/integration.yml"), "utf8")).toJS();
  expect(workflow.on.workflow_dispatch).toBeNull();
  expect(workflow.jobs.repository.if).toBe("github.event_name != 'workflow_dispatch'");
  expect(workflow.jobs.cumulative.if).toBe("github.event_name == 'workflow_dispatch' && github.ref == format('refs/heads/{0}', github.event.repository.default_branch)");
  expect(workflow.jobs.repository.env.E2E_RESOURCE_PROFILE).toBe("hosted-arm");
  const steps = workflow.jobs.repository.steps;
  const commands = steps.map((step: any) => step.run ?? "").join("\n");
  expect(commands).toContain("corepack pnpm build\ncorepack pnpm lint\ncorepack pnpm test");
  expect(commands).toContain("python -m pytest tests/ --ignore=tests/integration -q");
  expect(commands).toContain("python -m ruff check src/ tests/");
  expect(steps.some((step: any) => step.with?.repository)).toBe(false);
  expect(commands).not.toContain("openclaw-test-env.mjs ci");
  expect(workflow.jobs.cumulative.steps.find((step: any) => step.name === "Check out Puddles").with.ref)
    .toBe("${{ github.event.pull_request.head.sha || github.sha }}");
  expect(workflow.jobs.cumulative.steps.some((step: any) => step.run === "node packages/e2e/bin/openclaw-test-env.mjs ci")).toBe(true);
});

it("selects independent application and release jobs", () => {
  const app = parseDocument(readFileSync(resolve(repoRoot, '.github/workflows/integration.yml'), 'utf8')).toJS();
  const release = parseDocument(readFileSync(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8')).toJS();
  for (const event of ['push', 'pull_request']) {
    const appRuns = (files: string[]) => files.some(file => !app.on[event]['paths-ignore'].some((glob: string) => matchesGlob(file, glob)));
    const releaseRuns = (files: string[]) => files.some(file => release.on[event].paths.some((glob: string) => matchesGlob(file, glob)));
    expect(appRuns(['packages/release/src/backup.mjs'])).toBe(false);
    expect(releaseRuns(['packages/release/src/backup.mjs'])).toBe(true);
    expect(appRuns(['openclaw-plugins/secure-gmail/src/index.ts'])).toBe(true);
    expect(releaseRuns(['openclaw-plugins/secure-gmail/src/index.ts'])).toBe(false);
    expect(appRuns(['packages/release/src/backup.mjs', 'packages/mcp-hooks/src/index.ts'])).toBe(true);
    expect(releaseRuns(['packages/release/src/backup.mjs', 'packages/mcp-hooks/src/index.ts'])).toBe(true);
  }
  const steps = release.jobs.release.steps.map((step: any) => step.run ?? '').join('\n');
  expect(release.jobs.release.defaults.run['working-directory']).toBe('packages/release');
  expect(steps).not.toContain('openclaw-test-env');
  expect(steps).toContain('corepack pnpm test');
});

it('tests the packaged sandbox image on a Docker-capable runner for every integration event', () => {
  const workflow = parseDocument(readFileSync(resolve(repoRoot, '.github/workflows/integration.yml'), 'utf8')).toJS();
  const job = workflow.jobs['sandbox-media'];
  expect(job['runs-on']).toBe('ubuntu-24.04-arm');
  expect(job.if).toBeUndefined();
  const commands = job.steps.filter((step: any) => step.run).map((step: any) => step.run);
  expect(commands).toEqual([
    'node packages/sandbox-tools/build.mjs "$RUNNER_TEMP/sandbox-application"',
    'node packages/sandbox-tools/installed.mjs test "$RUNNER_TEMP/sandbox-application"',
  ]);
});
