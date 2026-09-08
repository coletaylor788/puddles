import { afterEach, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isMap, isSeq, parseDocument } from "yaml";
import suiteConfig from "../vitest.config.js";
// @ts-expect-error The public CI helper runs directly in Node.
import { collectPublicDiagnostics, initializePublicRun } from "../bin/public-ci-diagnostics.mjs";
// @ts-expect-error The lifecycle modules run directly in Node.
import { stage } from "../src/native-state.mjs";
import { runCommand } from "../src/process-runner.mjs";

const roots: string[] = [];
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "public-ci-diagnostics-")));
  roots.push(root);
  const env = {
    GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "12345", GITHUB_RUN_ATTEMPT: "1",
    RUNNER_TEMP: root, E2E_RUN_DIR: join(root, "puddles-public-12345-1"),
    E2E_LOCAL_EXTENSION: "", GITHUB_STEP_SUMMARY: join(root, "summary.md"),
    TEST_SECRET: "synthetic-sensitive-credential",
  };
  return { root, env };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("bounds process-heavy suite concurrency without relaxing the default test deadline", () => {
  expect(suiteConfig.test?.maxWorkers).toBe(2);
  expect(suiteConfig.test).not.toHaveProperty("testTimeout");
});

it("retains a real failed command and exposes a bounded redacted job summary without raw state", async () => {
  const f = fixture();
  const run = initializePublicRun(f.env);
  mkdirSync(join(run, "logs"));
  mkdirSync(join(run, "context"));
  writeFileSync(join(run, "context", "local-config.json"), "must not be exported");
  await expect(stage(run, "regressions", { unexported: "internal input payload" }, () =>
    runCommand(process.execPath, ["-e", "console.error('Synthetic regression failure'); console.error(process.env.TEST_SECRET); console.error(Buffer.from(process.env.TEST_SECRET).toString('hex')); process.exit(3)"], {
      env: { ...process.env, TEST_SECRET: f.env.TEST_SECRET }, logPath: join(run, "logs", "0.log"), quiet: true,
    }))).rejects.toThrow("status 3");
  const stdout = await runCommand(process.execPath, [resolve(import.meta.dirname, "../bin/public-ci-diagnostics.mjs"), "collect"], {
    env: { ...process.env, ...f.env }, quiet: true, capture: true,
  });
  const result = { output: join(f.root, "puddles-public-diagnostics-12345-1"), summary: readFileSync(f.env.GITHUB_STEP_SUMMARY, "utf8") };
  expect(stdout).toContain("Synthetic regression failure");
  expect(stdout.length).toBeLessThan(6000);
  const log = readFileSync(join(result.output, "command-0.log"), "utf8");
  expect(log).toContain("Synthetic regression failure");
  expect(log).not.toContain(f.env.TEST_SECRET);
  expect(log).not.toContain(Buffer.from(f.env.TEST_SECRET).toString("hex"));
  expect(log).toContain("[redacted]");
  expect(JSON.parse(readFileSync(join(result.output, "stages.json"), "utf8"))).toEqual([
    expect.objectContaining({ name: "regressions", status: "failed" }),
  ]);
  expect(readFileSync(join(result.output, "stages.json"), "utf8")).not.toContain("internal input payload");
  expect(readFileSync(f.env.GITHUB_STEP_SUMMARY, "utf8")).toContain("Synthetic regression failure");
  expect(result.summary.length).toBeLessThan(5000);
  expect(readdirSync(result.output).sort()).toEqual(["command-0.log", "stages.json", "summary.md"]);
});

it("rejects local extensions, unrelated run paths, and unmarked or reused run directories", () => {
  const f = fixture();
  expect(() => initializePublicRun({ ...f.env, E2E_LOCAL_EXTENSION: "/local/extension.mjs" })).toThrow("extensions disabled");
  expect(() => initializePublicRun({ ...f.env, E2E_RUN_DIR: join(f.root, "unrelated") })).toThrow("does not match");
  mkdirSync(f.env.E2E_RUN_DIR);
  expect(() => collectPublicDiagnostics(f.env)).toThrow("Missing");
  expect(() => initializePublicRun(f.env)).toThrow("must be new");
  expect(readdirSync(f.env.E2E_RUN_DIR)).toEqual([]);
});

it("refuses diagnostic symlinks rather than exporting another run's content", () => {
  const f = fixture();
  const run = initializePublicRun(f.env);
  const other = join(f.root, "unrelated.log");
  writeFileSync(other, "unrelated content");
  mkdirSync(join(run, "logs"));
  symlinkSync(other, join(run, "logs/0.log"));
  expect(() => collectPublicDiagnostics(f.env)).toThrow("linked");
  expect(readFileSync(other, "utf8")).toBe("unrelated content");
});

it("caps exported log bytes and includes only known public fixture diagnostics", () => {
  const f = fixture();
  const run = initializePublicRun(f.env);
  mkdirSync(join(run, "logs"));
  writeFileSync(join(run, "logs/0.log"), "old line\n".repeat(20_000) + "latest public failure\n");
  const publicFixture = join(run, "fixture-ordinary-conversation-Ab1234");
  mkdirSync(publicFixture);
  writeFileSync(join(publicFixture, "failure.log"), "Public fixture failure");
  writeFileSync(join(publicFixture, "openclaw.json"), "unexported fixture configuration");
  mkdirSync(join(run, "fixture-unselected-Ab1234"));
  writeFileSync(join(run, "fixture-unselected-Ab1234/failure.log"), "unselected content");
  const result = collectPublicDiagnostics(f.env);
  expect(statSync(join(result.output, "command-0.log")).size).toBeLessThanOrEqual(64 * 1024);
  expect(readFileSync(join(result.output, "command-0.log"), "utf8")).toContain("latest public failure");
  expect(result.summary).toContain("Public fixture failure");
  expect(readdirSync(result.output).some((name) => /unselected|openclaw\.json/.test(name))).toBe(false);
});

it("does not write a job summary outside runner temporary storage", () => {
  const f = fixture();
  initializePublicRun(f.env);
  expect(() => collectPublicDiagnostics({ ...f.env, GITHUB_STEP_SUMMARY: "/outside/summary.md" })).toThrow();
  expect(existsSync(join(f.root, "puddles-public-diagnostics-12345-1"))).toBe(false);
});

it("initializes and persists the public run path at step runtime, not job context evaluation", async () => {
  const f = fixture();
  const repository = resolve(import.meta.dirname, "../../..");
  const workflow = parseDocument(readFileSync(join(repository, ".github/workflows/integration.yml"), "utf8"));
  expect(workflow.errors).toEqual([]);
  const jobEnvironment = workflow.getIn(["jobs", "cumulative", "env"]);
  if (!isMap(jobEnvironment)) throw new Error("Missing cumulative job environment");
  expect(jobEnvironment.toJSON()).toEqual({ E2E_LOCAL_EXTENSION: "" });
  const steps = workflow.getIn(["jobs", "cumulative", "steps"]);
  if (!isSeq(steps)) throw new Error("Missing cumulative job steps");
  const initialization = steps.items.find((step) => isMap(step) && step.get("name") === "Initialize public run evidence");
  if (!isMap(initialization)) throw new Error("Missing public initialization step");
  const body = initialization.get("run");
  if (typeof body !== "string") throw new Error("Missing public initialization script");
  const environmentFile = join(f.root, "job-environment");
  await runCommand("bash", ["-e", "-c", body], {
    cwd: repository, env: { ...process.env, ...f.env, E2E_RUN_DIR: "/invalid-inherited-run", GITHUB_ENV: environmentFile },
    quiet: true,
  });
  expect(readFileSync(environmentFile, "utf8")).toBe(`E2E_RUN_DIR=${f.env.E2E_RUN_DIR}\n`);
  expect(JSON.parse(readFileSync(join(f.env.E2E_RUN_DIR, "public-ci.json"), "utf8"))).toEqual({
    scope: "public-ci", run: f.env.GITHUB_RUN_ID, attempt: f.env.GITHUB_RUN_ATTEMPT,
  });
});

it("wires failure-only upload to sanitized projections, never the raw run directory", () => {
  const workflow = readFileSync(resolve(import.meta.dirname, "../../../.github/workflows/integration.yml"), "utf8");
  expect(workflow).toContain('E2E_LOCAL_EXTENSION: ""');
  expect(workflow).toContain('export E2E_RUN_DIR="$RUNNER_TEMP/puddles-public-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"');
  expect(workflow).toContain("node packages/e2e/bin/public-ci-diagnostics.mjs init");
  expect(workflow).toContain("node packages/e2e/bin/openclaw-test-env.mjs ci");
  expect(workflow).toContain("if: failure() && steps.cumulative.outcome == 'failure'");
  expect(workflow).toContain("if: failure() && steps.public-diagnostics.outcome == 'success'");
  expect(workflow).toContain("uses: actions/upload-artifact@v4");
  expect(workflow).toContain("path: ${{ runner.temp }}/puddles-public-diagnostics-${{ github.run_id }}-${{ github.run_attempt }}");
  expect(workflow).not.toMatch(/path:\s*\$\{\{\s*env\.E2E_RUN_DIR/);
});
