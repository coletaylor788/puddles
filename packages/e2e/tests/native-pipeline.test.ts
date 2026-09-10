import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

vi.setConfig({ testTimeout: 15_000 });

const counters = vi.hoisted(() => ({ prepare: 0, install: 0, build: 0, package: 0, additionalInstalls: 0, runtimeCommands: 0, dependency: "first", generatedCaches: false }));
const registrations = vi.hoisted(() => new Set<string>());
vi.mock("../src/native-state.mjs", async (original) => {
  const state = await original<{ treeDigest: (path: string, options?: unknown) => string }>();
  return {
    ...state,
    // Keep orchestration fixtures independent of the host's installed test tools.
    treeDigest: (path: string, options?: unknown) => path === join(import.meta.dirname, "../../../node_modules")
      ? "synthetic-repository-dependencies" : state.treeDigest(path, options),
  };
});
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
        const suite = JSON.parse(readFileSync(join(import.meta.dirname, "../openclaw-patch-suite.json"), "utf8"));
        for (const patch of suite.patches) {
          for (const target of patch.tests) {
            mkdirSync(dirname(join(path, target)), { recursive: true });
            writeFileSync(join(path, target), "synthetic mapped test");
          }
        }
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
      writeFileSync(join(cwd, "node_modules/.pnpm-workspace-state-v1.json"), JSON.stringify({
        lastValidatedTimestamp: counters.install * 1000, projects: {}, settings: { nodeLinker: "isolated" },
      }));
    } else if (command === "corepack" && args[1] === "build") {
      counters.build++;
      mkdirSync(join(cwd, "dist"), { recursive: true });
      writeFileSync(join(cwd, "dist/entry.js"), "unchanged build");
      if (counters.generatedCaches) {
        for (const name of [".experimental-vitest-cache", ".unrun"]) {
          mkdirSync(join(cwd, "node_modules", name), { recursive: true });
          writeFileSync(join(cwd, "node_modules", name, "generated"), "generated during build");
        }
      }
    } else if (command === "fixture-prepare") {
      counters.prepare++;
      // Transactional preparation must never run over an already-patched tree.
      expect(existsSync(join(cwd, "prepared"))).toBe(false);
      writeFileSync(join(cwd, "prepared"), "same prepared source");
      const context = JSON.parse(readFileSync(options.env!.E2E_CONTEXT_PATH, "utf8"));
      writeFileSync(join(context.workspace, "prepared-output"), "same prepared output");
    } else if (command === "fixture-installed") {
      counters.runtimeCommands++;
    } else if (command === "fixture-artifact") {
      const context = JSON.parse(readFileSync(options.env!.E2E_CONTEXT_PATH, "utf8"));
      const directory = join(context.workspace, "auxiliary");
      const expected = join(directory, "expected");
      mkdirSync(expected, { recursive: true });
      const bytes = readFileSync(args[0]);
      writeFileSync(join(expected, "installed"), bytes);
      const archive = join(directory, "runtime.tar.gz");
      writeFileSync(archive, bytes);
      // @ts-expect-error JS lifecycle exports are tested at runtime.
      const { fileDigest, treeDigest } = await import("../src/native-state.mjs");
      writeFileSync(join(directory, "artifact.json"), JSON.stringify({
        schemaVersion: 1, path: archive, sha256: fileDigest(archive), runtimeSha256: treeDigest(expected),
        platform: process.platform, arch: process.arch, node: process.version,
      }));
    } else if (command === "fixture-python" && args[0] === "-c") {
      return JSON.stringify({ executable: process.execPath, version: "synthetic",
        libraries: [join(process.env.E2E_RUN_DIR!, "source/node_modules")] });
    } else if (command === "corepack" && args.includes("--filesOnly")) {
      return args.slice(args.indexOf("--config") + 2).join("\n");
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
    if (prefix.includes("/installed-additional/")) counters.additionalInstalls++;
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
import { nativePipeline, regressionEnvironment, removeOwnedWorktree, safeNode } from "../src/native-pipeline.mjs";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { atomicJson, jsonDigest, treeDigest } from "../src/native-state.mjs";
import { runCommand } from "../src/process-runner.mjs";

const roots: string[] = [];
it.each(["22.23.2", "23.0.0", "24.15.99", "25.9.0", "26.0.99", "26.1.0-rc.1", "invalid"])(
  "rejects unsupported or prerelease Node %s before native work",
  (version) => expect(safeNode(version)).toBe(false),
);
it.each(["24.16.0", "24.17.0", "26.1.0", "26.2.0", "27.0.0"])(
  "accepts upstream-supported Node %s",
  (version) => expect(safeNode(version)).toBe(true),
);
function root() { const path = mkdtempSync(join(tmpdir(), "native-pipeline-test-")); roots.push(path); return path; }
beforeEach(() => {
  Object.assign(counters, { prepare: 0, install: 0, build: 0, package: 0, additionalInstalls: 0, runtimeCommands: 0, dependency: "first", generatedCaches: false });
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
  vi.stubEnv("E2E_STATE_MIGRATION_MANIFEST", "");
  return { directory, run };
}

it("binds migration bytes to cumulative and runtime proofs without rebuilding unchanged source", async () => {
  const { directory, run } = setup();
  const path = join(realpathSync(directory), "migration.json");
  const manifest = { schemaVersion: 1, configOperations: [
    { kind: "set", path: ["memory", "search", "provider"], expected: { exists: false }, value: "local" },
  ] };
  writeFileSync(path, JSON.stringify(manifest));
  vi.stubEnv("E2E_STATE_MIGRATION_MANIFEST", path);
  vi.stubEnv("GMAIL_MCP_PYTHON", "fixture-python");
  const first = await nativePipeline("ci", async () => {});
  for (const name of ["regressions", "runtime"]) {
    expect(JSON.parse(readFileSync(join(run, `stages/${name}.json`), "utf8")).inputs.stateMigration).toEqual(first.stateMigration);
  }
  manifest.configOperations[0].value = "none";
  writeFileSync(path, JSON.stringify(manifest));
  const second = await nativePipeline("ci", async () => {});
  expect(second.stateMigration.sha256).not.toBe(first.stateMigration.sha256);
  expect(second.proofs.regressions).not.toBe(first.proofs.regressions);
  expect(second.proofs.runtime).not.toBe(first.proofs.runtime);
  expect(counters.build).toBe(1);
});
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

it("reuses dependency, build, and package proofs across generated root caches but not real dependency changes", async () => {
  const { run } = setup();
  counters.generatedCaches = true;
  await nativePipeline("native", async () => {});
  const proofs = ["dependencies", "build", "package"].map((name) => join(run, "stages", `${name}.json`));
  const before = proofs.map((path) => readFileSync(path, "utf8"));
  for (const name of [".experimental-vitest-cache", ".unrun"]) {
    writeFileSync(join(run, "source/node_modules", name, "generated"), "changed by subsequent tests");
  }
  await nativePipeline("native", async () => {});
  expect(counters).toMatchObject({ install: 1, build: 1, package: 1 });
  expect(proofs.map((path) => readFileSync(path, "utf8"))).toEqual(before);
  counters.dependency = "repaired";
  writeFileSync(join(run, "source/node_modules/dependency"), "real dependency changed");
  await nativePipeline("native", async () => {});
  expect(counters).toMatchObject({ install: 2, build: 2, package: 2 });
  expect(readFileSync(join(run, "installed/runtime/installed"), "utf8")).toBe("repaired");
});

it("refreshes a legacy fingerprint policy once before accepting a timestamp-and-cache-only resume", async () => {
  const { run } = setup();
  await nativePipeline("native", async () => {});
  const modules = join(run, "source/node_modules");
  const dependencyProof = join(run, "stages/dependencies.json");
  const current = JSON.parse(readFileSync(dependencyProof, "utf8"));
  const { fingerprint, ...legacyInputs } = current.inputs;
  expect(fingerprint.normalizePnpmWorkspaceState).toBe(true);
  const legacyOptions = { exclude: [".cache", ".vite", ".vite-temp", ".experimental-vitest-cache", ".unrun"] };
  // Seed only this owned fixture with the output of the prior runner policy.
  atomicJson(dependencyProof, { ...current, inputs: legacyInputs, key: jsonDigest(legacyInputs),
    outputs: { [modules]: { sha256: treeDigest(modules, legacyOptions), options: legacyOptions } } });
  await nativePipeline("native", async () => {});
  expect(counters).toMatchObject({ install: 2, build: 1, package: 1 });
  const proofs = ["dependencies", "build", "package"].map((name) => join(run, "stages", `${name}.json`));
  const before = proofs.map((path) => readFileSync(path, "utf8"));
  const metadata = join(modules, ".pnpm-workspace-state-v1.json");
  const state = JSON.parse(readFileSync(metadata, "utf8"));
  writeFileSync(metadata, JSON.stringify({ ...state, lastValidatedTimestamp: 99_000 }));
  for (const name of [".experimental-vitest-cache", ".unrun"]) {
    mkdirSync(join(modules, name));
    writeFileSync(join(modules, name, "generated"), "new test cache");
  }
  await nativePipeline("native", async () => {});
  expect(counters).toMatchObject({ install: 2, build: 1, package: 1 });
  expect(proofs.map((path) => readFileSync(path, "utf8"))).toEqual(before);
  counters.dependency = "repaired";
  writeFileSync(join(modules, "dependency"), "changed real dependency");
  await nativePipeline("native", async () => {});
  expect(counters).toMatchObject({ install: 3, build: 2, package: 2 });
});

it("forces CI for the delegated repository gate even when the caller disables it", async () => {
  const { run: runDir } = setup();
  vi.stubEnv("CI", "false");
  vi.stubEnv("GMAIL_MCP_PYTHON", "fixture-python");
  const command = vi.mocked(runCommand);
  command.mockClear();
  let gateCalls = 0;
  await nativePipeline("ci", async (run: typeof runCommand) => {
    gateCalls++;
    await run("fixture-python", ["-m", "pytest", "tests/", "--ignore=tests/integration", "-q"], { cwd: runDir });
  });

  expect(gateCalls).toBe(1);
  const call = command.mock.calls.find(([name, args]) => name === "fixture-python" && args[0] === "-m");
  expect(call).toBeDefined();
  expect(call![1]).toContain("--ignore=tests/integration");
  expect(call![2]?.env?.CI).toBe("true");
  expect(call![2]?.cwd).toBe(runDir);
});

it("retains collection output and names the omitted public target without weakening the guard", async () => {
  setup();
  vi.stubEnv("GMAIL_MCP_PYTHON", "fixture-python");
  const command = vi.mocked(runCommand);
  const implementation = command.getMockImplementation()!;
  command.mockClear();
  command.mockImplementation(async (...args) => args[1].includes("--filesOnly") ? "" : implementation(...args));
  try {
    await expect(nativePipeline("ci", async () => {})).rejects.toThrow("src/plugin-sdk/file-lock.stale-contention.test.ts in plugin-sdk");
    const collection = command.mock.calls.find(([, args]) => args.includes("--filesOnly"));
    expect(collection?.[2]?.capture).toBe(true);
    expect(collection?.[2]?.logPath).toMatch(/\/logs\/[0-9]+\.log$/);
  } finally {
    command.mockImplementation(implementation);
  }
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
  for (const name of [".experimental-vitest-cache", ".unrun"]) {
    mkdirSync(join(directory, "node_modules", name));
    writeFileSync(join(directory, "node_modules", name, "generated"), "generated test cache");
    expect(await regressionEnvironment(directory, run, { GMAIL_MCP_PYTHON: python })).toEqual(first);
  }
  const metadata = join(directory, "node_modules/.pnpm-workspace-state-v1.json");
  writeFileSync(metadata, JSON.stringify({ lastValidatedTimestamp: 1, settings: { nodeLinker: "isolated" } }));
  const withMetadata = await regressionEnvironment(directory, run, { GMAIL_MCP_PYTHON: python });
  writeFileSync(metadata, JSON.stringify({ lastValidatedTimestamp: 2, settings: { nodeLinker: "isolated" } }));
  expect(await regressionEnvironment(directory, run, { GMAIL_MCP_PYTHON: python })).toEqual(withMetadata);
  writeFileSync(metadata, JSON.stringify({ lastValidatedTimestamp: 2, settings: { nodeLinker: "hoisted" } }));
  expect(await regressionEnvironment(directory, run, { GMAIL_MCP_PYTHON: python })).not.toEqual(withMetadata);
  rmSync(metadata);
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
  const nested = join(directory, "node_modules/real-package/.unrun");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "entry"), "real package file");
  const withNested = await regressionEnvironment(directory, run, { GMAIL_MCP_PYTHON: python });
  writeFileSync(join(nested, "entry"), "real package changed");
  expect(await regressionEnvironment(directory, run, { GMAIL_MCP_PYTHON: python })).not.toEqual(withNested);
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

it("seals and installs additional artifacts before rehearsal and invalidates only changed artifact proofs", async () => {
  const { directory, run } = setup();
  const input = join(directory, "auxiliary-input");
  writeFileSync(input, "first auxiliary bytes");
  const module = join(directory, "artifacts.mjs");
  writeFileSync(module, `export default ${JSON.stringify({
    schemaVersion: 1, inputs: [input],
    artifacts: [{ id: "auxiliary", manifest: "workspace/auxiliary/artifact.json" }],
    commands: [
      { id: "package", phase: "package", command: "fixture-artifact", args: [input], timeoutMs: 1000, outputs: ["workspace/auxiliary"] },
      { id: "installed", phase: "installed", command: "fixture-installed", args: [], timeoutMs: 1000 },
    ],
  })};`);
  vi.stubEnv("E2E_LOCAL_EXTENSION", module);
  const first = await nativePipeline("native", async () => {});
  await nativePipeline("native", async () => {});
  expect(first.additionalArtifacts[0].id).toBe("auxiliary");
  expect(first.proofs["install-additional-0"]).toBeDefined();
  expect(counters).toMatchObject({ build: 1, package: 1, additionalInstalls: 1, runtimeCommands: 1 });
  writeFileSync(input, "second auxiliary bytes");
  const second = await nativePipeline("native", async () => {});
  expect(second.additionalArtifacts[0].artifact.sha256).not.toBe(first.additionalArtifacts[0].artifact.sha256);
  expect(counters).toMatchObject({ build: 1, package: 1, additionalInstalls: 2, runtimeCommands: 2 });
  const context = JSON.parse(readFileSync(join(run, "context/context.json"), "utf8"));
  expect(readFileSync(join(context.additionalInstalledDirs.auxiliary, "installed"), "utf8")).toBe("second auxiliary bytes");
});
