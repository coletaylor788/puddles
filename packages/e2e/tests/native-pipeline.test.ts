import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
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
  runCommand: vi.fn(async (command: string, args: string[], options: { cwd?: string; env?: Record<string, string>; logPath?: string } = {}) => {
    const cwd = options.cwd!;
    if (options.logPath) {
      mkdirSync(dirname(options.logPath), { recursive: true });
      writeFileSync(options.logPath, `synthetic ${command} log`);
    }
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
      else if (args[0] === "rev-parse") return "a".repeat(40);
      return "";
    }
    if (command === "corepack" && args[1] === "--version") return "12.3.4";
    if (command === "corepack" && args[1] === "store") {
      return join(options.env!.PNPM_CONFIG_STORE_DIR, "v11");
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
      mkdirSync(join(cwd, "extensions/llama-cpp"), { recursive: true });
      writeFileSync(join(cwd, "extensions/llama-cpp/package.json"), "{}");
      mkdirSync(join(cwd, "dist/extensions/llama-cpp"), { recursive: true });
      writeFileSync(join(cwd, "dist/extensions/llama-cpp/index.js"), "provider");
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
    } else if (command === "fixture-fail") {
      throw new Error("synthetic installed failure");
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
    } else if (command === "fixture-prepared-file") {
      const context = JSON.parse(readFileSync(options.env!.E2E_CONTEXT_PATH, "utf8"));
      const directory = join(context.workspace, "prepared-file");
      mkdirSync(directory, { recursive: true });
      const path = join(directory, "model.gguf");
      writeFileSync(path, readFileSync(args[0]));
      // @ts-expect-error JS lifecycle exports are tested at runtime.
      const { fileDigest } = await import("../src/native-state.mjs");
      writeFileSync(join(directory, "manifest.json"), JSON.stringify({
        schemaVersion: 1, type: "file", path, sha256: fileDigest(path),
      }));
      const server = join(directory, "server");
      rmSync(server, { recursive: true, force: true });
      mkdirSync(server);
      writeFileSync(join(server, "libserver.1.dylib"), readFileSync(args[0]));
      symlinkSync("libserver.1.dylib", join(server, "libserver.dylib"));
      // @ts-expect-error JS lifecycle exports are tested at runtime.
      const { treeDigest } = await import("../src/native-state.mjs");
      writeFileSync(join(directory, "server-manifest.json"), JSON.stringify({
        schemaVersion: 1, type: "directory", path: server, sha256: treeDigest(server, { portable: true }),
      }));
    } else if (command === "fixture-python" && args[0] === "-c") {
      return JSON.stringify({ executable: process.execPath, version: "synthetic",
        libraries: [join(process.env.E2E_RUN_DIR!, "source/node_modules")] });
    } else if (command === "corepack" && args.includes("--filesOnly")) {
      return args.slice(args.indexOf("--config") + 2).join("\n");
    } else if (command === "tar") {
      return execFileSync(command, args, { encoding: "utf8" });
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
    return {
      schemaVersion: 1,
      path,
      sha256: fileDigest(path),
      runtimeSha256: "f".repeat(64),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
    };
  },
  installRuntime: async (artifact: { path: string }, prefix: string) => {
    if (prefix.includes("/installed-additional/")) counters.additionalInstalls++;
    const path = join(prefix, "runtime");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "installed"), readFileSync(artifact.path));
    return path;
  },
  packProviderRuntime: async (_source: string, directory: string, provenance: {
    publicHead: string; buildInputsSha256: string; buildCommandSha256: string;
  }) => {
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "provider-artifact");
    const provenancePath = join(directory, "provider-provenance.json");
    writeFileSync(path, "provider");
    writeFileSync(provenancePath, "provenance");
    // @ts-expect-error JS lifecycle exports are tested at runtime.
    const { fileDigest } = await import("../src/native-state.mjs");
    return {
      id: "llama-cpp-provider",
      artifact: { path, sha256: fileDigest(path), runtimeSha256: "b".repeat(64),
        schemaVersion: 1, platform: process.platform, arch: process.arch, node: process.version },
      provenance: { path: provenancePath, sha256: fileDigest(provenancePath),
        schema: "puddles.openclaw-provider-artifact/v1", ...provenance,
        sourceSha256: "d".repeat(64) },
    };
  },
}));
vi.mock("../src/native-fixture.mjs", async (original) => ({
  ...await original<object>(),
  runScenario: async (_installed: string, scenario: { id: string }) => ({ id: scenario.id, passed: true }),
}));
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { nativePipeline, nativeTargetPipeline, regressionEnvironment, removeOwnedWorktree, resolveBuildTimeoutMs, safeNode } from "../src/native-pipeline.mjs";
// @ts-expect-error JS release modules are tested at runtime.
import { certifyRelease, createTargetProof, importReleaseBundle } from "../src/native-release.mjs";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { createRehearsalTarget } from "../src/native-target.mjs";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { atomicJson, jsonDigest, treeDigest } from "../src/native-state.mjs";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { findRetainedSourceGate, initializeArtifactPool, planArtifactCleanup } from "../src/native-retention.mjs";
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
it("keeps release builds at 30 minutes and validates the bounded draft override", () => {
  expect(resolveBuildTimeoutMs("ci", {})).toBe(30 * 60_000);
  expect(resolveBuildTimeoutMs("build", { E2E_DEV_BUILD_TIMEOUT_MS: "3600000" })).toBe(60 * 60_000);
  expect(() => resolveBuildTimeoutMs("ci", { E2E_DEV_BUILD_TIMEOUT_MS: "3600000" })).toThrow("draft build");
  expect(() => resolveBuildTimeoutMs("build", { E2E_DEV_BUILD_TIMEOUT_MS: "1799999" })).toThrow("between");
  expect(() => resolveBuildTimeoutMs("build", { E2E_DEV_BUILD_TIMEOUT_MS: "7200001" })).toThrow("between");
  expect(() => resolveBuildTimeoutMs("build", { E2E_DEV_BUILD_TIMEOUT_MS: "unbounded" })).toThrow("positive integer");
});
function root() { const path = mkdtempSync(join(tmpdir(), "native-pipeline-test-")); roots.push(path); return path; }
beforeEach(() => {
  vi.stubEnv("PNPM_CONFIG_STORE_DIR", join(tmpdir(), "puddles-native-pnpm-store"));
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

it("runs automatic retention before and after a real build command without invalidating no-op proofs", async () => {
  const { directory, run } = setup();
  const pool = join(directory, "pool");
  initializeArtifactPool(pool);
  vi.stubEnv("E2E_ARTIFACT_POOL", pool);
  vi.stubEnv("GMAIL_MCP_PYTHON", "fixture-python");
  await nativePipeline("build", async () => {});
  expect(readdirSync(join(pool, "objects")).filter((name) => name.startsWith("success-"))).toHaveLength(1);
  expect(JSON.parse(readFileSync(join(pool, "references/current.json"), "utf8")).objectIds).toHaveLength(1);
  const proofs = ["prepare", "dependencies", "build", "package"].map((name) =>
    readFileSync(join(run, "stages", `${name}.json`), "utf8"));
  await nativePipeline("build", async () => {});
  expect(readdirSync(join(pool, "objects")).filter((name) => name.startsWith("success-"))).toHaveLength(1);
  expect(["prepare", "dependencies", "build", "package"].map((name) =>
    readFileSync(join(run, "stages", `${name}.json`), "utf8"))).toEqual(proofs);
  expect(planArtifactCleanup(pool).remove).toEqual([]);
});

it("passes the bounded draft timeout to the real build invocation and its proof", async () => {
  const { run } = setup();
  vi.stubEnv("E2E_DEV_BUILD_TIMEOUT_MS", "3600000");
  const command = vi.mocked(runCommand);
  command.mockClear();
  await nativePipeline("build", async () => {});
  const build = command.mock.calls.find(([name, args]) =>
    name === "corepack" && args[0] === "pnpm" && args[1] === "build");
  expect(build?.[2]?.timeoutMs).toBe(3600000);
  expect(build?.[2]?.env).not.toHaveProperty("E2E_DEV_BUILD_TIMEOUT_MS");
  const proof = JSON.parse(readFileSync(join(run, "stages/build.json"), "utf8"));
  expect(proof.inputs).not.toHaveProperty("executionPolicy");
  expect(proof.result).toEqual({ built: true, timeoutMs: 3600000 });
  vi.stubEnv("E2E_DEV_BUILD_TIMEOUT_MS", "7200000");
  await nativePipeline("build", async () => {});
  expect(counters.build).toBe(1);
  expect(JSON.parse(readFileSync(join(run, "stages/build.json"), "utf8")).result)
    .toEqual({ built: true, timeoutMs: 3600000 });
});

it("rejects an invalid draft timeout before preparing source", async () => {
  setup();
  vi.stubEnv("E2E_DEV_BUILD_TIMEOUT_MS", "forever");
  await expect(nativePipeline("build", async () => {})).rejects.toThrow("positive integer");
  expect(registrations.size).toBe(0);
  expect(counters.build).toBe(0);
});

it("resumes a timed-out draft build with a larger bounded policy", async () => {
  const { run } = setup();
  const command = vi.mocked(runCommand);
  const implementation = command.getMockImplementation()!;
  command.mockClear();
  command.mockImplementation(async (...args) => {
    if (args[0] === "corepack" && args[1][0] === "pnpm" && args[1][1] === "build" &&
        args[2]?.timeoutMs === 30 * 60_000) {
      throw new Error("Command exceeded 1800000ms and was terminated");
    }
    return implementation(...args);
  });
  try {
    await expect(nativePipeline("build", async () => {})).rejects.toThrow("1800000ms");
    vi.stubEnv("E2E_DEV_BUILD_TIMEOUT_MS", "3600000");
    vi.stubEnv("E2E_RESUME_FAILED", "1");
    await nativePipeline("build", async () => {});
    const buildTimeouts = command.mock.calls
      .filter(([name, args]) => name === "corepack" && args[0] === "pnpm" && args[1] === "build")
      .map(([, , options]) => options?.timeoutMs);
    expect(buildTimeouts).toEqual([1800000, 3600000]);
    const proof = JSON.parse(readFileSync(join(run, "stages/build.json"), "utf8"));
    expect(proof.invalidation).toBe("explicit-resume");
    expect(proof.result.timeoutMs).toBe(3600000);
  } finally {
    command.mockImplementation(implementation);
  }
});

it("retains genuine source evidence for certification after disposable build state is removed", async () => {
  const { directory, run } = setup();
  const pool = join(directory, "pool");
  initializeArtifactPool(pool);
  vi.stubEnv("E2E_ARTIFACT_POOL", pool);
  vi.stubEnv("GMAIL_MCP_PYTHON", "fixture-python");
  const migrationPath = join(realpathSync(directory), "migration.json");
  const migration = {
    schemaVersion: 1,
    configOperations: [
      { kind: "set", path: ["memory", "search", "provider"], expected: { exists: false }, value: "first" },
    ],
  };
  writeFileSync(migrationPath, JSON.stringify(migration));
  vi.stubEnv("E2E_STATE_MIGRATION_MANIFEST", migrationPath);
  await nativePipeline("ci", async () => {});

  const build = JSON.parse(readFileSync(join(run, "build.json"), "utf8"));
  const sourceGate = findRetainedSourceGate(pool, build.buildId);
  expect(sourceGate).not.toBeNull();
  const retainedSource = JSON.parse(readFileSync(sourceGate!.sourceGatePath, "utf8"));
  const regression = JSON.parse(readFileSync(sourceGate!.regressionPath, "utf8"));
  expect(retainedSource.stages.regressions).toBe(regression.key);
  vi.stubEnv("E2E_SOURCE_GATE_REVISION", "changed");
  await nativePipeline("ci", async () => {});
  const changedSourceGate = findRetainedSourceGate(pool, build.buildId);
  expect(changedSourceGate!.metadata.id).not.toBe(sourceGate!.metadata.id);
  expect(counters.build).toBe(1);

  const writeRecovery = (name: string, status: "healthy" | "rolled-back") => {
    const path = join(directory, name);
    mkdirSync(path);
    writeFileSync(join(path, "recovery.json"), JSON.stringify({
      schemaVersion: 1,
      status,
      transaction: name,
      target: "9".repeat(64),
      artifact: build.artifact.sha256,
    }));
    if (status === "rolled-back") {
      writeFileSync(join(path, "failure.json"), JSON.stringify({ message: "injected failure" }));
    }
    return path;
  };
  const targetProof = createTargetProof(
    build,
    run,
    writeRecovery("healthy", "healthy"),
    writeRecovery("rollback", "rolled-back"),
  );
  migration.configOperations[0].value = "second";
  writeFileSync(migrationPath, JSON.stringify(migration));
  await nativePipeline("ci", async () => {});
  const nextBuild = JSON.parse(readFileSync(join(run, "build.json"), "utf8"));
  expect(nextBuild.buildId).not.toBe(build.buildId);
  expect(findRetainedSourceGate(pool, build.buildId)).not.toBeNull();
  expect(findRetainedSourceGate(pool, nextBuild.buildId)).not.toBeNull();
  expect(counters.build).toBe(1);
  const retainedBundle = join(
    pool,
    "objects",
    `success-${build.buildId.slice(0, 48)}`,
    "bundle.tar.gz",
  );
  rmSync(run, { recursive: true });

  const imported = await importReleaseBundle(retainedBundle, join(directory, "imported"));
  const recoveredSource = findRetainedSourceGate(pool, build.buildId);
  expect(recoveredSource).not.toBeNull();
  expect(() => certifyRelease(
    imported.receipt,
    JSON.parse(readFileSync(recoveredSource!.sourceGatePath, "utf8")),
    targetProof,
  )).not.toThrow();
  expect(JSON.parse(readFileSync(join(pool, "references/current.json"), "utf8")).objectIds)
    .toContain(recoveredSource!.metadata.id);
});

it("preserves the primary pipeline error when terminal retention also fails", async () => {
  const { directory } = setup();
  const pool = join(directory, "pool");
  initializeArtifactPool(pool);
  vi.stubEnv("E2E_ARTIFACT_POOL", pool);
  vi.stubEnv("GMAIL_MCP_PYTHON", "fixture-python");
  let error: unknown;
  try {
    await nativePipeline("ci", async () => {
      mkdirSync(join(pool, "objects/unregistered"));
      throw new Error("primary repository gate failure");
    });
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof AggregateError)) throw error;
  expect((error as AggregateError).errors.map((entry) => entry.message)).toEqual(expect.arrayContaining([
    "primary repository gate failure",
    expect.stringContaining("ownership"),
  ]));
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
  command.mockImplementation(async (...args) => {
    if (!args[1].includes("--filesOnly")) {
      return implementation(...args);
    }
    return args[1]
      .filter((arg) => arg.endsWith(".test.ts") && arg !== "src/plugin-sdk/file-lock.stale-contention.test.ts")
      .join("\n");
  });
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

it("binds the explicit rehearsal target into artifact-only installed context", async () => {
  const { directory, run } = setup();
  const pool = join(directory, "pool");
  initializeArtifactPool(pool);
  vi.stubEnv("E2E_ARTIFACT_POOL", pool);
  await nativePipeline("build", async () => {});
  const buildPath = join(run, "build.json");
  const build = JSON.parse(readFileSync(buildPath, "utf8"));
  const targetRoot = join(directory, "deployment-target");
  const installDir = join(targetRoot, "installed");
  const stateDir = join(targetRoot, "state");
  const backupRoot = join(targetRoot, "backups");
  const plistPath = join(targetRoot, "gateway.plist");
  for (const path of [installDir, stateDir, backupRoot]) mkdirSync(path, { recursive: true });
  writeFileSync(plistPath, "fixture service");
  const targetPath = join(targetRoot, "target.json");
  const target = {
    schemaVersion: 1,
    purpose: "rehearsal",
    isolation: {
      schema: "puddles.openclaw-rehearsal-target/v1",
      root: realpathSync(targetRoot),
    },
    host: hostname(),
    installDir,
    stateDir,
    plistPath,
    backupRoot,
    label: "puddles.rehearsal.gateway",
    port: 18799,
    additionalInstalls: build.additionalArtifacts.map(({ id }: { id: string }) => ({
      id,
      path: `managed/${id}`,
    })),
    preparedFiles: [],
  };
  writeFileSync(targetPath, JSON.stringify(target));
  const module = join(directory, "target-adapter.mjs");
  writeFileSync(module, `export default {
    schemaVersion: 1,
    commands: [{id:"installed",phase:"installed",command:"fixture-installed",args:[],timeoutMs:1000}]
  };`);
  const targetRun = join(directory, "target-run");
  vi.stubEnv("E2E_RUN_DIR", targetRun);
  vi.stubEnv("E2E_LOCAL_EXTENSION", module);
  const proof = await nativeTargetPipeline(buildPath, targetPath);
  const context = JSON.parse(readFileSync(join(targetRun, "context/context.json"), "utf8"));
  expect(proof).toMatchObject({ buildId: build.buildId, targetSha256: context.deploymentTarget.sha256 });
  expect(context).not.toHaveProperty("sourceDir");
  expect(context.deploymentTarget).toMatchObject({
    path: targetPath,
    purpose: "rehearsal",
    isolation: target.isolation,
    host: target.host,
    installDir,
    stateDir,
    plistPath,
    backupRoot,
    label: target.label,
    port: target.port,
    additionalInstalls: target.additionalInstalls,
    preparedFiles: [],
    browser: null,
    nodeMigration: null,
    stateMigration: null,
  });
  expect(readdirSync(join(pool, "objects")).some((name) => name.startsWith("target-"))).toBe(true);
  expect(readdirSync(join(pool, "objects")).some((name) => name.startsWith("log-"))).toBe(true);
});

it("retains a failed target reproduction and its diagnostics", async () => {
  const { directory, run } = setup();
  const pool = join(directory, "pool");
  initializeArtifactPool(pool);
  vi.stubEnv("E2E_ARTIFACT_POOL", pool);
  await nativePipeline("build", async () => {});
  const buildPath = join(run, "build.json");
  const build = JSON.parse(readFileSync(buildPath, "utf8"));
  const targetRoot = join(directory, "deployment-target");
  const targetManifest = join(directory, "manifest", "target.json");
  mkdirSync(dirname(targetManifest));
  const seedRoot = join(directory, "target-seed");
  for (const path of ["installed", "state"]) mkdirSync(join(seedRoot, path), { recursive: true });
  mkdirSync(join(seedRoot, "state", "private"), { mode: 0o700 });
  writeFileSync(join(seedRoot, "installed/previous"), "previous runtime");
  writeFileSync(join(seedRoot, "state/private/config"), "previous state");
  chmodSync(join(seedRoot, "state", "private"), 0o700);
  writeFileSync(join(seedRoot, "gateway.plist"), "fixture service");
  const seedPath = join(directory, "target-seed.json");
  writeFileSync(seedPath, JSON.stringify({
    schema: "puddles.openclaw-rehearsal-seed/v1",
    installDir: join(seedRoot, "installed"),
    stateDir: join(seedRoot, "state"),
    plistPath: join(seedRoot, "gateway.plist"),
  }));
  writeFileSync(targetManifest, JSON.stringify({
    schemaVersion: 1,
    purpose: "rehearsal",
    isolation: { schema: "puddles.openclaw-rehearsal-target/v1", root: targetRoot },
    host: hostname(),
    installDir: join(targetRoot, "installed"),
    stateDir: join(targetRoot, "state"),
    plistPath: join(targetRoot, "gateway.plist"),
    backupRoot: join(targetRoot, "backups"),
    label: "puddles.rehearsal.gateway",
    port: 18799,
    additionalInstalls: build.additionalArtifacts.map(({ id }: { id: string }) => ({
      id,
      path: `managed/${id}`,
    })),
    preparedFiles: [],
  }));
  const module = join(directory, "target-adapter.mjs");
  writeFileSync(module, `export default {
    schemaVersion: 1,
    commands: [{id:"installed",phase:"installed",command:"fixture-fail",args:[],timeoutMs:1000}]
  };`);
  vi.stubEnv("E2E_RUN_DIR", join(directory, "target-run"));
  vi.stubEnv("E2E_LOCAL_EXTENSION", module);
  await expect(nativeTargetPipeline(buildPath, targetManifest, seedPath)).rejects.toThrow("synthetic installed failure");
  expect(readFileSync(join(targetRoot, "installed/previous"), "utf8")).toBe("previous runtime");
  expect(readFileSync(join(targetRoot, "state/private/config"), "utf8")).toBe("previous state");
  expect(statSync(join(targetRoot, "state/private")).mode & 0o777).toBe(0o700);
  expect(existsSync(join(targetRoot, ".puddles-rehearsal-seed.json"))).toBe(true);
  const objects = readdirSync(join(pool, "objects"));
  expect(objects.some((name) => name.startsWith("failure-"))).toBe(true);
  expect(objects.some((name) => name.startsWith("log-"))).toBe(true);
  expect(JSON.parse(readFileSync(join(pool, "references/failed-debug.json"), "utf8")).objectIds).toHaveLength(1);
});

it("refuses to create a rehearsal target with a destination outside its root", () => {
  const directory = mkdtempSync(join(tmpdir(), "native-target-create-test-"));
  const seedRoot = join(directory, "seed");
  for (const path of ["installed", "state"]) mkdirSync(join(seedRoot, path), { recursive: true });
  writeFileSync(join(seedRoot, "gateway.plist"), "fixture service");
  const seedPath = join(directory, "seed.json");
  writeFileSync(seedPath, JSON.stringify({
    schema: "puddles.openclaw-rehearsal-seed/v1",
    installDir: join(seedRoot, "installed"),
    stateDir: join(seedRoot, "state"),
    plistPath: join(seedRoot, "gateway.plist"),
  }));
  const targetRoot = join(directory, "target");
  expect(() => createRehearsalTarget({
    schemaVersion: 1,
    purpose: "rehearsal",
    isolation: { schema: "puddles.openclaw-rehearsal-target/v1", root: targetRoot },
    installDir: join(targetRoot, "installed"),
    stateDir: join(directory, "outside"),
    plistPath: join(targetRoot, "gateway.plist"),
    backupRoot: join(targetRoot, "backups"),
  }, seedPath)).toThrow("state directory");
  expect(existsSync(targetRoot)).toBe(false);
  symlinkSync(seedRoot, join(seedRoot, "state", "outside-link"));
  expect(() => createRehearsalTarget({
    schemaVersion: 1,
    purpose: "rehearsal",
    isolation: { schema: "puddles.openclaw-rehearsal-target/v1", root: targetRoot },
    installDir: join(targetRoot, "installed"),
    stateDir: join(targetRoot, "state"),
    plistPath: join(targetRoot, "gateway.plist"),
    backupRoot: join(targetRoot, "backups"),
  }, seedPath)).toThrow("link outside");
  expect(existsSync(targetRoot)).toBe(false);
  rmSync(directory, { recursive: true, force: true });
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
  expect(first.additionalArtifacts.map(({ id }: { id: string }) => id)).toEqual(["llama-cpp-provider", "auxiliary"]);
  expect(first.proofs["install-additional-1"]).toBeDefined();
  expect(counters).toMatchObject({ build: 1, package: 1, additionalInstalls: 2, runtimeCommands: 1 });
  writeFileSync(input, "second auxiliary bytes");
  const second = await nativePipeline("native", async () => {});
  expect(second.additionalArtifacts[1].artifact.sha256).not.toBe(first.additionalArtifacts[1].artifact.sha256);
  expect(counters).toMatchObject({ build: 1, package: 1, additionalInstalls: 3, runtimeCommands: 2 });
  const context = JSON.parse(readFileSync(join(run, "context/context.json"), "utf8"));
  expect(readFileSync(join(context.additionalInstalledDirs.auxiliary, "installed"), "utf8")).toBe("second auxiliary bytes");
});

it("seals prepared files into their own proof and invalidates runtime rehearsal when their bytes change", async () => {
  const { directory, run } = setup();
  const input = join(directory, "model-input");
  writeFileSync(input, "first model bytes");
  const module = join(directory, "prepared-files.mjs");
  writeFileSync(module, `export default ${JSON.stringify({
    schemaVersion: 1, inputs: [input],
    preparedFiles: [
      { id: "embedding-model", manifest: "workspace/prepared-file/manifest.json" },
      { id: "embedding-server", manifest: "workspace/prepared-file/server-manifest.json" },
    ],
    commands: [
      { id: "package", phase: "package", command: "fixture-prepared-file", args: [input], timeoutMs: 1000, outputs: ["workspace/prepared-file"] },
      { id: "installed", phase: "installed", command: "fixture-installed", args: [], timeoutMs: 1000 },
    ],
  })};`);
  vi.stubEnv("E2E_LOCAL_EXTENSION", module);
  const first = await nativePipeline("native", async () => {});
  expect(first.preparedFiles.map(({ id }: { id: string }) => id)).toEqual(["embedding-model", "embedding-server"]);
  expect(first.proofs["prepared-files"]).toBeDefined();
  const proof = JSON.parse(readFileSync(join(run, "stages/prepared-files.json"), "utf8"));
  expect(proof.result[0]).toMatchObject({ id: "embedding-model", type: "file" });
  expect(proof.result[1]).toMatchObject({ id: "embedding-server", type: "directory" });
  const runs = counters.runtimeCommands;
  writeFileSync(input, "second model bytes");
  const second = await nativePipeline("native", async () => {});
  expect(second.preparedFiles[0].sha256).not.toBe(first.preparedFiles[0].sha256);
  expect(counters.runtimeCommands).toBe(runs + 1);
});
