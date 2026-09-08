import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const counters = vi.hoisted(() => ({ prepare: 0, install: 0, build: 0, package: 0, runtimeCommands: 0, dependency: "first" }));
const registrations = vi.hoisted(() => new Set<string>());
vi.mock("../src/process-runner.mjs", () => ({
  runCommand: vi.fn(async (command: string, args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) => {
    const cwd = options.cwd!;
    if (command === "git") {
      if (args[0] === "worktree" && args[1] === "add") {
        const path = args[3];
        if (registrations.has(path)) throw new Error("Worktree already registered");
        registrations.add(path);
        mkdirSync(path, { recursive: true });
        for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "source.js"]) writeFileSync(join(path, name), name);
      } else if (args[0] === "worktree" && args[1] === "remove") {
        rmSync(args[3], { recursive: true, force: true });
        registrations.delete(args[3]);
      } else if (args[0] === "worktree" && args[1] === "move") {
        if (registrations.has(args[3])) throw new Error("Destination already registered");
        renameSync(args[2], args[3]);
        registrations.delete(args[2]);
        registrations.add(args[3]);
      } else if (args[0] === "worktree" && args[1] === "list") return [...registrations].map((path) => `worktree ${path}\0HEAD synthetic\0\0`).join("");
      else if (args[0] === "ls-files") return ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "source.js", "prepared"].filter((name) => existsSync(join(cwd, name))).join("\0");
      else if (args[0] === "rev-parse") return "synthetic-identity";
      return "";
    }
    if (command === "corepack" && args[1] === "install") {
      counters.install++;
      mkdirSync(join(cwd, "node_modules"), { recursive: true });
      writeFileSync(join(cwd, "node_modules/dependency"), counters.dependency);
    } else if (command === "corepack" && args[1] === "build") {
      counters.build++;
      mkdirSync(join(cwd, "dist"), { recursive: true });
      writeFileSync(join(cwd, "dist/entry.js"), "unchanged build");
    } else if (command === "fixture-prepare") {
      counters.prepare++;
      // Transactional preparation must never run over an already-patched tree.
      expect(existsSync(join(cwd, "prepared"))).toBe(false);
      writeFileSync(join(cwd, "prepared"), "same prepared source");
      const context = JSON.parse(readFileSync(options.env!.E2E_CONTEXT_PATH, "utf8"));
      writeFileSync(join(context.workspace, "prepared-output"), "same prepared output");
    } else if (command === "fixture-installed") {
      counters.runtimeCommands++;
    }
    return "synthetic-tool-version";
  }),
}));
vi.mock("../src/native-package.mjs", () => ({
  packRuntime: async (source: string, directory: string) => {
    counters.package++;
    const path = join(directory, "artifact");
    writeFileSync(path, readFileSync(join(source, "node_modules/dependency")));
    // @ts-expect-error JS lifecycle exports are tested at runtime.
    const { fileDigest } = await import("../src/native-state.mjs");
    return { path, sha256: fileDigest(path) };
  },
  installRuntime: async (artifact: { path: string }, prefix: string) => {
    const path = join(prefix, "runtime");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "installed"), readFileSync(artifact.path));
    return path;
  },
}));
vi.mock("../src/native-fixture.mjs", async (original) => ({
  ...await original<object>(),
  runScenario: async (_installed: string, scenario: { id: string }) => ({ id: scenario.id, passed: true }),
}));
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { nativePipeline, regressionEnvironment, removeOwnedWorktree } from "../src/native-pipeline.mjs";

const roots: string[] = [];
function root() { const path = mkdtempSync(join(tmpdir(), "native-pipeline-test-")); roots.push(path); return path; }
beforeEach(() => {
  Object.assign(counters, { prepare: 0, install: 0, build: 0, package: 0, runtimeCommands: 0, dependency: "first" });
  registrations.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});
function setup() {
  const directory = root();
  const source = join(directory, "upstream");
  mkdirSync(join(source, ".git"), { recursive: true });
  const run = join(directory, "run");
  vi.stubEnv("OPENCLAW_SRC", source);
  vi.stubEnv("E2E_RUN_DIR", run);
  vi.stubEnv("E2E_LOCAL_EXTENSION", "");
  return { directory, run };
}
function extension(directory: string, name: string, phase = "package", inputs: string[] = [], outputs = true) {
  const path = join(directory, `${name}.mjs`);
  writeFileSync(path, `export default ${JSON.stringify({
    schemaVersion: 1, inputs,
    commands: [
      { id: "prepare", phase: "prepare", command: "fixture-prepare", args: [], timeoutMs: 1000, outputs: outputs ? ["workspace/prepared-output"] : [] },
      { id: name, phase, command: "fixture-later", args: [name], timeoutMs: 1000 },
    ],
  })};`);
  vi.stubEnv("E2E_LOCAL_EXTENSION", path);
}

it("repackages repaired dependency bytes even when rebuilt dist is identical", async () => {
  const { run } = setup();
  await nativePipeline("native", async () => {});
  await nativePipeline("native", async () => {});
  expect(counters).toMatchObject({ install: 1, build: 1, package: 1 });
  counters.dependency = "repaired";
  rmSync(join(run, "source/node_modules/dependency"));
  await nativePipeline("native", async () => {});
  expect(counters).toMatchObject({ install: 2, build: 2, package: 2 });
  expect(readFileSync(join(run, "installed/runtime/installed"), "utf8")).toBe("repaired");
});

it("keeps source/build for later phase edits and safely reconstructs transactional preparation", async () => {
  const { directory, run } = setup();
  extension(directory, "one");
  await nativePipeline("native", async () => {});
  extension(directory, "two");
  await nativePipeline("native", async () => {});
  expect(counters).toMatchObject({ prepare: 1, install: 1, build: 1, package: 1 });
  rmSync(join(run, "context/workspace/prepared-output"));
  await nativePipeline("native", async () => {});
  expect(counters).toMatchObject({ prepare: 2, install: 1, build: 1, package: 1 });
  const helper = join(directory, "prepare-input");
  writeFileSync(helper, "changed helper, same source result");
  extension(directory, "three", "installed", [helper]);
  await nativePipeline("native", async () => {});
  expect(counters).toMatchObject({ prepare: 3, install: 1, build: 1, package: 1 });
});

it("cannot reuse an empty-output prepare proof when source is missing or changed", async () => {
  const { directory, run } = setup();
  extension(directory, "empty", "package", [], false);
  await nativePipeline("native", async () => {});
  writeFileSync(join(run, "source/prepared"), "changed");
  await nativePipeline("native", async () => {});
  expect(counters.prepare).toBe(2);
  rmSync(join(run, "source"), { recursive: true });
  await nativePipeline("native", async () => {});
  expect(counters.prepare).toBe(3);
  expect(readFileSync(join(run, "source/prepared"), "utf8")).toBe("same prepared source");
});

it("binds regression reuse to effective environment, interpreter bytes and installed test dependencies", async () => {
  const directory = root();
  const python = join(directory, "python");
  const library = join(directory, "site-packages");
  const dependency = join(directory, "node_modules/tool");
  mkdirSync(library);
  mkdirSync(dirname(dependency));
  writeFileSync(python, "interpreter one");
  writeFileSync(join(library, "pytest.py"), "library one");
  writeFileSync(dependency, "test runner one");
  const selected: string[] = [];
  const run = async (command: string) => {
    selected.push(command);
    return JSON.stringify({ executable: python, version: "synthetic", libraries: [library] });
  };
  const first = await regressionEnvironment(directory, run, { GMAIL_MCP_PYTHON: python });
  expect(await regressionEnvironment(directory, run, { GMAIL_MCP_PYTHON: python })).toEqual(first);
  expect(await regressionEnvironment(directory, run, { GMAIL_MCP_PYTHON: `${python}-other` })).not.toEqual(first);
  expect(selected.at(-1)).toBe(`${python}-other`);
  writeFileSync(python, "interpreter two");
  expect(await regressionEnvironment(directory, run, { GMAIL_MCP_PYTHON: python })).not.toEqual(first);
  writeFileSync(python, "interpreter one");
  writeFileSync(dependency, "test runner two");
  expect(await regressionEnvironment(directory, run, { GMAIL_MCP_PYTHON: python })).not.toEqual(first);
  writeFileSync(dependency, "test runner one");
  writeFileSync(join(library, "pytest.py"), "library two");
  expect(await regressionEnvironment(directory, run, { GMAIL_MCP_PYTHON: python })).not.toEqual(first);
});

it("clears only exact owned missing-worktree registrations using real Git", async () => {
  const directory = realpathSync(root());
  const repository = join(directory, "repository");
  const git = async (cwd: string, args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
  await git(directory, ["init", "--quiet", repository]);
  await git(repository, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "--quiet", "-m", "Synthetic fixture"]);
  const unrelated = join(directory, "unrelated");
  await git(repository, ["worktree", "add", "--detach", unrelated]);
  rmSync(unrelated, { recursive: true });
  for (const name of ["source", "preparing-source"]) {
    const path = join(directory, name);
    await git(repository, ["worktree", "add", "--detach", path]);
    rmSync(path, { recursive: true });
    expect(await git(repository, ["worktree", "list", "--porcelain", "-z"])).toContain(`worktree ${path}\0`);
    await removeOwnedWorktree(repository, path, git);
    expect(await git(repository, ["worktree", "list", "--porcelain", "-z"])).not.toContain(`worktree ${path}\0`);
    await git(repository, ["worktree", "add", "--detach", path]);
    expect(existsSync(path)).toBe(true);
  }
  expect(await git(repository, ["worktree", "list", "--porcelain", "-z"])).toContain(`worktree ${unrelated}\0`);
});

it("rehearses resolved installed commands and scenarios even when extension file bytes do not change", async () => {
  const { directory, run } = setup();
  const module = join(directory, "resolved.mjs");
  writeFileSync(module, `export default {
    schemaVersion:1,
    get commands() { return [{id:"installed",phase:"installed",command:"fixture-installed",
      args:[process.env.E2E_TEST_SELECTION],env:{SELECTED:process.env.E2E_TEST_SELECTION},timeoutMs:1000}]; },
    get scenarios() { return [{id:"resolved-"+process.env.E2E_TEST_SCENARIO,steps:[]}]; }
  };`);
  vi.stubEnv("E2E_LOCAL_EXTENSION", module);
  vi.stubEnv("E2E_TEST_SELECTION", "first");
  vi.stubEnv("E2E_TEST_SCENARIO", "first");
  await nativePipeline("native", async () => {});
  await nativePipeline("native", async () => {});
  expect(counters.runtimeCommands).toBe(1);
  const firstInputs = JSON.parse(readFileSync(join(run, "stages/runtime.json"), "utf8")).inputs;
  vi.stubEnv("E2E_TEST_SELECTION", "second");
  await nativePipeline("native", async () => {});
  expect(counters.runtimeCommands).toBe(2);
  vi.stubEnv("E2E_TEST_SCENARIO", "second");
  await nativePipeline("native", async () => {});
  expect(counters.runtimeCommands).toBe(3);
  expect(counters).toMatchObject({ install: 1, build: 1, package: 1 });
  const proof = JSON.parse(readFileSync(join(run, "stages/runtime.json"), "utf8"));
  expect(proof.result.scenarios.at(-1).id).toBe("resolved-second");
  expect(proof.inputs.installedCommands).not.toBe(firstInputs.installedCommands);
  expect(proof.inputs.scenarios).not.toBe(firstInputs.scenarios);
  expect(proof.inputs.environment).toBe(firstInputs.environment);
  expect(JSON.stringify(proof.inputs)).not.toContain("SELECTED");
});
