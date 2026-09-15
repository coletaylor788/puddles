import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statfsSync } from "node:fs";
import { totalmem, homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireLock, atomicJson, externalDirectory, fileDigest, jsonDigest, stage,
  treeDigest, updateNativeRunStatus,
} from "./native-state.mjs";
import { fixtureEnv, isolatedContext, runScenario } from "./native-fixture.mjs";
import { additionalArtifacts, extensionPhase, loadExtension, preparedFiles } from "./native-extension.mjs";
import { installRuntime, packProviderRuntime, packRuntime } from "./native-package.mjs";
import { runCommand } from "./process-runner.mjs";
import scenarios from "../scenarios/imessage.mjs";
import { readMigrationManifest } from "./native-state-migration.mjs";
import { rehearseStateMigration } from "./native-state-migration-fixture.mjs";
import { createBuildReceipt, createSourceGate, verifyBuildReceipt } from "./native-release.mjs";
import { exportReleaseBundle } from "./native-release.mjs";
import { validateTarget, verifyRehearsalTarget } from "./native-activation.mjs";
import {
  acquireArtifactPoolLock, applyArtifactCleanup, artifactPoolRunId,
  findSuccessfulBuild, registerDiagnosticLogs, registerFailedReproduction, registerSuccessfulBuild,
  removeRetentionReference, retentionSpaceSummary, setRetentionReference,
} from "./native-retention.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "..", "..");
const patchDir = join(repoRoot, "docs", "openclaw-setup", "patches");
const suite = JSON.parse(readFileSync(join(packageDir, "openclaw-patch-suite.json"), "utf8"));
const dependencyCacheNames = [".cache", ".vite", ".vite-temp"];
const generatedRootCaches = [".experimental-vitest-cache", ".unrun"];
const sourceDependencyOptions = { exclude: [...dependencyCacheNames, ...generatedRootCaches], normalizePnpmWorkspaceState: true };
const repositoryDependencyOptions = { excludeNames: dependencyCacheNames, exclude: generatedRootCaches, normalizePnpmWorkspaceState: true };

export function safeNode(version = process.versions.node) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor] = version.split(".").map(Number);
  return major === 24 && minor >= 16 || major === 26 && minor >= 1 || major > 26;
}

export async function regressionEnvironment(directory, run, env = process.env) {
  const managedPython = join(directory, "servers/gmail-mcp/.venv/bin/python");
  const python = env.GMAIL_MCP_PYTHON ?? (existsSync(managedPython) ? managedPython : "python3");
  const identity = JSON.parse(await run(python, ["-c",
    "import json,sys,sysconfig,pytest,ruff; print(json.dumps({'executable':sys.executable,'version':sys.version,'libraries':list(set([sysconfig.get_path('purelib'),sysconfig.get_path('platlib')]))}))",
  ], { capture: true }));
  return {
    environment: jsonDigest(Object.entries(env).sort(([a], [b]) => a.localeCompare(b))),
    python: { executable: fileDigest(identity.executable), version: identity.version,
      libraries: identity.libraries.map((path) => treeDigest(path, { excludeNames: ["__pycache__", ".pytest_cache"] })) },
    dependencies: treeDigest(join(directory, "node_modules"), repositoryDependencyOptions),
  };
}

export async function removeOwnedWorktree(repository, path, git) {
  const records = (await git(repository, ["worktree", "list", "--porcelain", "-z"])).split("\0");
  if (records.includes(`worktree ${path}`)) {
    await git(repository, ["worktree", "remove", "--force", path]);
  } else if (existsSync(path)) {
    throw new Error("Owned source path exists without its expected worktree registration");
  }
}

export async function nativePipeline(command, repositoryGates) {
  if (!safeNode()) throw new Error("Use OpenClaw's supported Node version (24.16.0+ on 24.x, or 26.1.0+). Older releases can truncate SQLite text.");
  const source = resolve(process.env.OPENCLAW_SRC ?? join(homedir(), "git", "openclaw"));
  if (!existsSync(join(source, ".git"))) throw new Error("OPENCLAW_SRC must be a source checkout");
  const runDir = externalDirectory(process.env.E2E_RUN_DIR ?? mkdtempSync(join(tmpdir(), "puddles-native-")), [repoRoot, source]);
  const unlock = acquireLock(runDir);
  const artifactPool = process.env.E2E_ARTIFACT_POOL
    ? resolve(process.env.E2E_ARTIFACT_POOL)
    : null;
  const retentionReference = artifactPool ? artifactPoolRunId(runDir) : null;
  updateNativeRunStatus(runDir, { command, status: "running", pid: process.pid, startedAt: new Date().toISOString(), failure: null });
  mkdirSync(join(runDir, "logs"), { recursive: true, mode: 0o700 });
  let sequence = 0;
  const run = (executable, args, options = {}) => runCommand(executable, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, CI: "true" },
    timeoutMs: options.timeoutMs ?? 10 * 60_000,
    logPath: options.capture ? undefined : join(runDir, "logs", `${sequence++}.log`),
    quiet: true, ...options,
  });
  const git = (cwd, args) => run("git", args, { cwd, capture: true });
  const withRetentionLock = (action) => {
    if (!artifactPool) return undefined;
    const release = acquireArtifactPoolLock(artifactPool);
    try { return action(); } finally { release(); }
  };
  const completeRetention = async (buildReceipt) => {
    if (!artifactPool) return;
    const reused = withRetentionLock(() => {
      const retained = findSuccessfulBuild(artifactPool, buildReceipt.buildId);
      if (!retained) return false;
      setRetentionReference(artifactPool, {
        id: "current",
        kind: "current",
        objectIds: [retained.metadata.id],
      });
      registerDiagnosticLogs(artifactPool, runDir);
      removeRetentionReference(artifactPool, retentionReference);
      applyArtifactCleanup(artifactPool);
      return true;
    });
    if (reused) return;
    const bundle = join(runDir, "retained-build-bundle.tar.gz");
    if (existsSync(bundle)) rmSync(bundle);
    await exportReleaseBundle(
      join(runDir, "build.json"),
      bundle,
      buildReceipt.composition?.extensionSha256 === "none" ? "public" : "local",
      run,
    );
    withRetentionLock(() => {
      if (!findSuccessfulBuild(artifactPool, buildReceipt.buildId)) {
        registerSuccessfulBuild(artifactPool, runDir, bundle, buildReceipt.buildId);
      }
      registerDiagnosticLogs(artifactPool, runDir);
      removeRetentionReference(artifactPool, retentionReference);
      applyArtifactCleanup(artifactPool);
    });
  };
  try {
    if (artifactPool) {
      withRetentionLock(() => {
        applyArtifactCleanup(artifactPool);
        setRetentionReference(artifactPool, {
          id: retentionReference,
          kind: "active",
          objectIds: [],
        });
      });
    }
    // Cheap prerequisites precede any build or accumulated gate.
    await git(source, ["cat-file", "-e", `${suite.openclawRef}^{commit}`]);
    if (command === "ci") {
      const changes = (await git(repoRoot, ["status", "--porcelain", "--untracked-files=all"])).trim();
      if (changes) throw new Error("Commit the final candidate before the cumulative release gate");
    }
    const manager = (await run("corepack", ["pnpm", "--version"], { capture: true })).trim();
    const npm = (await run("npm", ["--version"], { capture: true })).trim();
    await run("tar", ["--version"], { capture: true });
    if (command === "ci") {
      const managedPython = join(repoRoot, "servers/gmail-mcp/.venv/bin/python");
      const python = process.env.GMAIL_MCP_PYTHON ?? (existsSync(managedPython) ? managedPython : "python3");
      await run(python, ["-c", "import pytest, ruff"], { capture: true });
      await run("corepack", ["pnpm", "--filter", "e2e", "exec", "vitest", "--version"], { capture: true });
    }
    const requiredDisk = process.env.E2E_REQUIRED_FREE_BYTES
      ? Number(process.env.E2E_REQUIRED_FREE_BYTES)
      : 8 * 1024 ** 3;
    if (!Number.isSafeInteger(requiredDisk) || requiredDisk < 0) {
      throw new Error("E2E_REQUIRED_FREE_BYTES must be a nonnegative integer");
    }
    const disk = statfsSync(runDir);
    if (disk.bavail * disk.bsize < requiredDisk) {
      const retention = artifactPool ? withRetentionLock(() =>
        retentionSpaceSummary(artifactPool, requiredDisk)) : null;
      throw new Error(
        `Native candidate disk reserve is insufficient: required=${requiredDisk} ` +
        `free=${disk.bavail * disk.bsize}` +
        (retention ? ` retained=${retention.retainedBytes} protected=${retention.protectedBytes} removable=${retention.removableBytes}` : ""),
      );
    }
    if (totalmem() < 8 * 1024 ** 3) throw new Error("Native candidate needs a host with at least 8 GiB memory");
    const extension = await loadExtension(process.env.E2E_LOCAL_EXTENSION);
    const migrationPath = process.env.E2E_STATE_MIGRATION_MANIFEST;
    const stateMigration = migrationPath ? { sha256: fileDigest(migrationPath) } : null;
    if (migrationPath) readMigrationManifest(migrationPath, stateMigration.sha256);
    const context = isolatedContext(join(runDir, "context"));
    if (migrationPath) context.stateMigration = { manifestPath: migrationPath, ...stateMigration };
    const candidate = join(runDir, "source");
    context.sourceDir = candidate;
    const tools = { node: process.version, nodeBinary: fileDigest(process.execPath), platform: process.platform, arch: process.arch, manager, npm };
    const patches = suite.patches.map((patch) => [patch.name, fileDigest(join(patchDir, `${patch.name}.patch`))]);
    const sourceKey = jsonDigest({ ref: suite.openclawRef, patches, prepare: extension.phaseHashes.prepare });
    const tracked = async (directory, excluded = []) => {
      const files = (await git(directory, ["ls-files", "-co", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
      return jsonDigest([...new Set(files)].sort().filter((path) => !excluded.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))).map((path) => {
        const absolute = join(directory, path);
        if (!existsSync(absolute)) return [path, "deleted"];
        const stat = lstatSync(absolute);
        return [path, stat.mode & 0o777, stat.isSymbolicLink() ? readlinkSync(absolute) : stat.isDirectory() ? treeDigest(absolute) : fileDigest(absolute)];
      }));
    };
    const prepared = await stage(runDir, "prepare", { sourceKey, tools }, async () => {
      // Preparation always receives clean source. Compare its result before
      // discarding existing dependencies or build outputs.
      const fresh = join(runDir, "preparing-source");
      await removeOwnedWorktree(source, fresh, git);
      await git(source, ["worktree", "add", "--detach", fresh, suite.openclawRef]);
      for (const patch of suite.patches) {
        const patchFile = join(patchDir, `${patch.name}.patch`);
        await run("git", ["apply", "--check", patchFile], { cwd: fresh });
        await run("git", ["apply", patchFile], { cwd: fresh });
      }
      const outputs = await extensionPhase(extension, "prepare", { ...context, sourceDir: fresh });
      const sourceInputs = await tracked(fresh);
      if (existsSync(candidate) && await tracked(candidate) === sourceInputs) {
        await removeOwnedWorktree(source, fresh, git);
      } else {
        await removeOwnedWorktree(source, candidate, git);
        await git(source, ["worktree", "move", fresh, candidate]);
      }
      return { outputs, sourceInputs };
    }, (result) => result.outputs, async (result) => existsSync(candidate) && await tracked(candidate) === result.sourceInputs);
    const prepareOutputs = prepared.outputs;
    const candidateInputs = await tracked(candidate);
    const buildInputs = await tracked(candidate, ["docs", "README.md", "CHANGELOG.md"]);
    const harness = treeDigest(packageDir, { exclude: ["node_modules", "dist"] });
    const buildEnv = {
      PATH: `${dirname(process.execPath)}:${process.env.PATH}`, HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR, COREPACK_HOME: process.env.COREPACK_HOME,
      CI: "true", NODE_OPTIONS: "--max-old-space-size=8192",
    };
    const buildEnvironment = jsonDigest(buildEnv);
    tools.sourceManager = (await run("corepack", ["pnpm", "--version"], { cwd: candidate, capture: true, env: buildEnv })).trim();
    const dependencies = jsonDigest({
      lock: fileDigest(join(candidate, "pnpm-lock.yaml")), workspace: fileDigest(join(candidate, "pnpm-workspace.yaml")),
      manifest: fileDigest(join(candidate, "package.json")), tools, buildEnvironment,
      patches: existsSync(join(candidate, "patches")) ? treeDigest(join(candidate, "patches")) : null,
    });
    await stage(runDir, "dependencies", { dependencies, installed: true, fingerprint: sourceDependencyOptions }, async () => {
      await run("corepack", ["pnpm", "install", "--frozen-lockfile"], { cwd: candidate, env: buildEnv, timeoutMs: 15 * 60_000 });
      return { installed: true };
    }, () => ({ [join(candidate, "node_modules")]: { sha256: treeDigest(join(candidate, "node_modules"), sourceDependencyOptions), options: sourceDependencyOptions } }));
    const installedDependencies = treeDigest(join(candidate, "node_modules"), sourceDependencyOptions);
    const buildStageInputs = { buildInputs, dependencies, installedDependencies, tools, buildEnvironment, prepareOutputs };
    await stage(runDir, "build", buildStageInputs, async () => {
      await run("corepack", ["pnpm", "build"], { cwd: candidate, env: buildEnv, timeoutMs: 30 * 60_000 });
      return { built: true };
    }, () => ({ [join(candidate, "dist")]: treeDigest(join(candidate, "dist")) }));
    if (command === "ci" || command === "patches" || command === "source-gate") {
      const repoInputs = await tracked(repoRoot);
      const execution = command === "ci" || command === "source-gate" ? await regressionEnvironment(repoRoot, run) : {
        environment: jsonDigest(Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b))),
        dependencies: treeDigest(join(repoRoot, "node_modules"), repositoryDependencyOptions),
      };
      await stage(runDir, "regressions", { candidateInputs, repoInputs, installedDependencies, tools, harness, execution, prepareOutputs, extension: extension.phaseHashes.gate, command, stateMigration }, async () => {
        if (command === "ci" || command === "source-gate") await repositoryGates(run);
        await run("corepack", ["pnpm", "prompt:snapshots:check"], { cwd: candidate, env: buildEnv });
        const tests = [...new Set(suite.patches.flatMap((patch) => patch.tests))];
        const groups = new Map();
        for (const test of tests) {
          if (!existsSync(join(candidate, test))) throw new Error("Mapped OpenClaw test missing");
          const project = suite.testProjects[test];
          if (!project) throw new Error("Mapped OpenClaw test project missing");
          groups.set(project, [...(groups.get(project) ?? []), test]);
        }
        for (const [project, targets] of groups) {
          const collected = await run("corepack", ["pnpm", "exec", "vitest", "list", "--filesOnly", "--config", `test/vitest/vitest.${project}.config.ts`, ...targets], { cwd: candidate, env: buildEnv, capture: true, logPath: join(runDir, "logs", `${sequence++}.log`) });
          for (const target of targets) {
            if (!collected.split("\n").some((line) => line.trim() === target || line.trim().endsWith(`/${target}`) || line.trim().endsWith(` ${target}`))) throw new Error(`Mapped regression was not collected: ${target} in ${project}`);
          }
          await run("corepack", ["pnpm", "exec", "vitest", "run", "--config", `test/vitest/vitest.${project}.config.ts`, ...targets], { cwd: candidate, env: buildEnv });
        }
        const candidateTests = [...new Set(suite.patches.flatMap((patch) => patch.candidateTests ?? []))];
        await run("corepack", ["pnpm", "--filter", "e2e", "exec", "vitest", "run", "--config", "vitest.candidate.config.ts", ...candidateTests], { env: { ...buildEnv, OPENCLAW_CANDIDATE: candidate } });
        const outputs = await extensionPhase(extension, "gate", context);
        return { accumulated: true, outputs };
      }, (result) => result.outputs);
    }
    const artifacts = join(runDir, "artifacts");
    mkdirSync(artifacts, { recursive: true, mode: 0o700 });
    const extensionOutputs = await stage(runDir, "extension-package", {
      candidateInputs, installedDependencies, tools, prepareOutputs,
      extension: extension.phaseHashes.package, artifacts: extension.artifacts,
      preparedFiles: extension.preparedFiles,
    }, async () => extensionPhase(extension, "package", context), (outputs) => outputs);
    const extensionArtifacts = additionalArtifacts(extension, context, extensionOutputs);
    const preparedFileRecords = await stage(runDir, "prepared-files", {
      candidateInputs, tools, extension: extension.phaseHashes.package,
      selected: extension.preparedFiles, extensionOutputs,
    }, async () => preparedFiles(extension, context, extensionOutputs), (records) =>
      Object.fromEntries(records.map((record) => [
        record.path,
        record.type === "file" ? record.sha256 : { sha256: record.sha256, options: { portable: true } },
      ])));
    context.preparedFiles = preparedFileRecords;
    if (extensionArtifacts.some(({ id }) => id === "llama-cpp-provider")) {
      throw new Error("The patched llama.cpp provider is owned by the public candidate");
    }
    const publicHead = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
    const providerDirectory = join(artifacts, "llama-cpp-provider");
    const providerProvenance = {
      publicHead,
      buildInputsSha256: jsonDigest(buildStageInputs),
      buildCommandSha256: jsonDigest({
        command: "corepack",
        args: ["pnpm", "build"],
        cwd: "candidate-source",
        environment: buildEnvironment,
      }),
      tools,
    };
    const provider = await stage(runDir, "provider-package", {
      candidateInputs,
      source: treeDigest(join(candidate, "extensions", "llama-cpp")),
      build: treeDigest(join(candidate, "dist", "extensions", "llama-cpp"), {
        portable: true,
        excludeNames: ["node_modules"],
      }),
      provenance: providerProvenance,
      packaging: fileDigest(join(packageDir, "src", "native-package.mjs")),
    }, () => packProviderRuntime(candidate, providerDirectory, providerProvenance, run), (result) => ({
      [result.artifact.path]: result.artifact.sha256,
      [result.provenance.path]: result.provenance.sha256,
    }));
    const attestedExtensionArtifacts = extensionArtifacts.map((record) => ({
      ...record,
      attestation: {
        schema: "puddles.openclaw-extension-artifact/v1",
        sourceSha256: candidateInputs,
        packageInputsSha256: extension.phaseHashes.package,
        toolchainSha256: jsonDigest(tools),
        artifactSha256: record.artifact.sha256,
        runtimeSha256: record.artifact.runtimeSha256,
      },
    }));
    const extras = [provider, ...attestedExtensionArtifacts];
    context.additionalArtifacts = extras;
    const artifact = await stage(runDir, "package", { candidateInputs, installedDependencies, build: treeDigest(join(candidate, "dist")), tools, packaging: fileDigest(join(packageDir, "src", "native-package.mjs")) }, () => packRuntime(candidate, artifacts, run), (result) => ({ [result.path]: result.sha256 }));
    context.artifact = artifact;
    const repository = {
      head: publicHead,
      tree: (await git(repoRoot, ["rev-parse", "HEAD^{tree}"])).trim(),
    };
    const buildProofs = {};
    for (const name of ["prepare", "dependencies", "build", "extension-package", "provider-package", "prepared-files", "package"]) {
      const path = join(runDir, "stages", `${name}.json`);
      if (existsSync(path)) buildProofs[name] = JSON.parse(readFileSync(path, "utf8")).key;
    }
    const buildReceipt = createBuildReceipt({
      repository,
      source: {
        ref: suite.openclawRef,
        sha256: candidateInputs,
        buildInputsSha256: buildInputs,
        patchesSha256: jsonDigest(patches),
        extensionSha256: extension.hash,
      },
      composition: { extensionSha256: extension.hash },
      artifact,
      additionalArtifacts: extras,
      preparedFiles: preparedFileRecords,
      tools,
      proofs: buildProofs,
      ...(stateMigration ? { stateMigration } : {}),
    });
    atomicJson(join(runDir, "build.json"), buildReceipt);
    if (command === "build") {
      await completeRetention(buildReceipt);
      updateNativeRunStatus(runDir, { command, status: "passed", finishedAt: new Date().toISOString() });
      console.log(`Native build: passed. Non-production bundle input: ${join(runDir, "build.json")}`);
      return buildReceipt;
    }
    if (command === "source-gate") {
      const sourceGate = createSourceGate(buildReceipt, runDir, {
        patches: suite.patches.map((patch) => ({
          name: patch.name,
          tests: patch.tests,
          candidateTests: patch.candidateTests ?? [],
        })),
        extension: extension.phaseHashes.gate,
      });
      atomicJson(join(runDir, "source-gate.json"), sourceGate);
      await completeRetention(buildReceipt);
      updateNativeRunStatus(runDir, { command, status: "passed", finishedAt: new Date().toISOString() });
      console.log(`Native source gate: passed. Evidence: ${join(runDir, "source-gate.json")}`);
      return sourceGate;
    }
    const prefix = join(runDir, "installed");
    const installer = fileDigest(join(packageDir, "src", "native-package.mjs"));
    const installedDir = await stage(runDir, "install", { artifact, tools, installer }, async () => {
      if (existsSync(prefix)) rmSync(prefix, { recursive: true });
      const installed = await installRuntime(artifact, prefix, run);
      await run(process.execPath, [join(installed, "openclaw.mjs"), "--version"], { env: fixtureEnv(context), cwd: context.workspace });
      return installed;
    }, (result) => ({ [result]: treeDigest(result, { portable: true }) }));
    context.installedDir = installedDir;
    context.additionalInstalledDirs = {};
    const extraProofs = [];
    for (const [index, extraRecord] of extras.entries()) {
      const { id, artifact: extra, provenance } = extraRecord;
      const name = `install-additional-${index}`;
      const extraPrefix = join(runDir, "installed-additional", id);
      const directory = await stage(runDir, name, { id, artifact: extra, provenance: provenance ?? null, tools, installer }, async () => {
        if (existsSync(extraPrefix)) rmSync(extraPrefix, { recursive: true });
        return installRuntime(extra, extraPrefix, run);
      }, (result) => ({ [result]: treeDigest(result, { portable: true }) }));
      context.additionalInstalledDirs[id] = directory;
      extraProofs.push(name);
    }
    const runtimeBefore = treeDigest(installedDir, { portable: true });
    const additionalBefore = Object.fromEntries(Object.entries(context.additionalInstalledDirs).map(([id, directory]) => [id, treeDigest(directory, { portable: true })]));
    const runtimeScenarios = [...scenarios, ...extension.scenarios];
    const result = await stage(runDir, "runtime", {
      artifact, additionalArtifacts: extras, preparedFiles: preparedFileRecords,
      tools, harness, extension: extension.hash, extensionOutputs,
      installedCommands: extension.phaseHashes.installed,
      scenarios: jsonDigest(runtimeScenarios), environment: jsonDigest(fixtureEnv(context)),
      stateMigration,
    }, async () => {
      const outputs = await extensionPhase(extension, "installed", context);
      const migrationFixtures = await rehearseStateMigration(installedDir, candidate, runDir);
      const results = [];
      for (const scenario of runtimeScenarios) {
        results.push(await runScenario(installedDir, scenario, { runDir }));
      }
      if (runtimeBefore !== treeDigest(installedDir, { portable: true })) throw new Error("Rehearsal changed the installed artifact");
      for (const [id, directory] of Object.entries(context.additionalInstalledDirs)) {
        if (additionalBefore[id] !== treeDigest(directory, { portable: true })) throw new Error("Rehearsal changed an additional installed artifact");
      }
      return { scenarios: results, migrationFixtures, outputs };
    }, (result) => result.outputs);
    if (command === "ci" && (await git(repoRoot, ["status", "--porcelain", "--untracked-files=all"])).trim()) throw new Error("Candidate changed during cumulative validation");
    if (migrationPath) readMigrationManifest(migrationPath, stateMigration.sha256);
    const proofs = {};
    for (const name of ["build", "provider-package", "prepared-files", "regressions", "runtime", "install", ...extraProofs]) {
      const path = join(runDir, "stages", `${name}.json`);
      if (existsSync(path)) proofs[name] = JSON.parse(readFileSync(path, "utf8")).key;
    }
    const receipt = {
      schemaVersion: 1, status: "passed", accumulated: command === "ci",
      repository,
      source: { ref: suite.openclawRef, sha256: candidateInputs }, artifact, installedDir,
      additionalArtifacts: extras, preparedFiles: preparedFileRecords,
      scenarios: result.scenarios.length, tools, proofs,
      ...(stateMigration ? { stateMigration } : {}),
    };
    atomicJson(join(runDir, "candidate.json"), receipt);
    if (command === "ci") {
      atomicJson(join(runDir, "source-gate.json"), createSourceGate(
        buildReceipt,
        runDir,
        {
          patches: suite.patches.map((patch) => ({
            name: patch.name,
            tests: patch.tests,
            candidateTests: patch.candidateTests ?? [],
          })),
          extension: extension.phaseHashes.gate,
        },
      ));
    }
    await completeRetention(buildReceipt);
    console.log(`Native ${command}: passed (${result.scenarios.length} scenarios). Local state: ${runDir}`);
    updateNativeRunStatus(runDir, { command, status: "passed", finishedAt: new Date().toISOString() });
    return receipt;
  } catch (error) {
    updateNativeRunStatus(runDir, {
      command,
      status: "failed",
      finishedAt: new Date().toISOString(),
      failure: { code: error.code ?? null, message: String(error.message ?? error).slice(0, 1000) },
    });
    if (artifactPool) {
      try {
        withRetentionLock(() => {
          registerFailedReproduction(artifactPool, runDir);
          registerDiagnosticLogs(artifactPool, runDir);
          removeRetentionReference(artifactPool, retentionReference);
          applyArtifactCleanup(artifactPool);
        });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Native pipeline and artifact retention failed");
      }
    }
    throw error;
  } finally {
    unlock();
  }
}

export async function nativeTargetPipeline(receiptPath, targetPath) {
  const receipt = verifyBuildReceipt(JSON.parse(readFileSync(receiptPath, "utf8")));
  if (receipt.artifact.platform !== process.platform ||
      receipt.artifact.arch !== process.arch ||
      receipt.artifact.node !== process.version) {
    throw new Error("Imported build platform or Node differs from this target");
  }
  if (!targetPath) throw new Error("Artifact target requires an explicit rehearsal target");
  const target = JSON.parse(readFileSync(targetPath, "utf8"));
  validateTarget(target);
  verifyRehearsalTarget(target);
  if ((receipt.stateMigration?.sha256 ?? null) !== (target.stateMigration?.sha256 ?? null)) {
    throw new Error("Target migration differs from the imported build");
  }
  if (target.stateMigration) {
    readMigrationManifest(target.stateMigration.manifestPath, target.stateMigration.sha256);
  }
  const expectedAdditional = (receipt.additionalArtifacts ?? []).map(({ id }) => id).sort();
  const mappedAdditional = (target.additionalInstalls ?? []).map(({ id }) => id).sort();
  const expectedPrepared = (receipt.preparedFiles ?? []).map(({ id }) => id).sort();
  const mappedPrepared = (target.preparedFiles ?? []).map(({ id }) => id).sort();
  if (jsonDigest(expectedAdditional) !== jsonDigest(mappedAdditional) ||
      jsonDigest(expectedPrepared) !== jsonDigest(mappedPrepared)) {
    throw new Error("Rehearsal target must map every imported artifact and prepared file exactly once");
  }
  const targetSha256 = fileDigest(targetPath);
  const runDir = externalDirectory(
    process.env.E2E_RUN_DIR ?? mkdtempSync(join(tmpdir(), "puddles-native-target-")),
    [repoRoot, dirname(receiptPath), dirname(targetPath)],
  );
  const unlock = acquireLock(runDir);
  updateNativeRunStatus(runDir, { command: "target", status: "running", pid: process.pid, startedAt: new Date().toISOString(), failure: null });
  mkdirSync(join(runDir, "logs"), { recursive: true, mode: 0o700 });
  let sequence = 0;
  const run = (executable, args, options = {}) => runCommand(executable, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, CI: "true" },
    timeoutMs: options.timeoutMs ?? 10 * 60_000,
    logPath: options.capture ? undefined : join(runDir, "logs", `${sequence++}.log`),
    quiet: true, ...options,
  });
  try {
    const extension = await loadExtension(process.env.E2E_LOCAL_EXTENSION);
    if (extension.commands.some((command) => command.phase !== "installed")) {
      throw new Error("Artifact target adapters may declare installed commands only");
    }
    const context = isolatedContext(join(runDir, "context"));
    context.mode = "artifact-target";
    context.adapter = { sha256: extension.hash };
    context.source = receipt.source;
    context.repository = receipt.repository;
    context.toolchain = receipt.tools;
    context.artifact = receipt.artifact;
    context.additionalArtifacts = receipt.additionalArtifacts ?? [];
    context.preparedFiles = receipt.preparedFiles ?? [];
    context.deploymentTarget = {
      path: targetPath,
      sha256: targetSha256,
      purpose: target.purpose,
      isolation: {
        schema: target.isolation.schema,
        root: resolve(target.isolation.root),
      },
      host: target.host,
      installDir: target.installDir,
      stateDir: target.stateDir,
      plistPath: target.plistPath,
      backupRoot: target.backupRoot,
      label: target.label,
      port: target.port,
      additionalInstalls: target.additionalInstalls ?? [],
      preparedFiles: target.preparedFiles ?? [],
      browser: target.browser ?? null,
      nodeMigration: target.nodeMigration ?? null,
      stateMigration: target.stateMigration ?? null,
    };
    if (target.stateMigration) context.stateMigration = target.stateMigration;
    context.sourceDir = undefined;
    const installer = fileDigest(join(packageDir, "src", "native-package.mjs"));
    const prefix = join(runDir, "installed");
    const installedDir = await stage(runDir, "install", {
      buildId: receipt.buildId,
      targetSha256,
      artifact: receipt.artifact,
      tools: receipt.tools,
      installer,
    }, async () => {
      if (existsSync(prefix)) rmSync(prefix, { recursive: true });
      const installed = await installRuntime(receipt.artifact, prefix, run);
      await run(process.execPath, [join(installed, "openclaw.mjs"), "--version"], {
        env: fixtureEnv(context),
        cwd: context.workspace,
      });
      return installed;
    }, (result) => ({ [result]: treeDigest(result, { portable: true }) }));
    context.installedDir = installedDir;
    context.additionalInstalledDirs = {};
    const installProofs = {};
    for (const [index, record] of (receipt.additionalArtifacts ?? []).entries()) {
      const name = `install-additional-${index}`;
      const prefix = join(runDir, "installed-additional", record.id);
      context.additionalInstalledDirs[record.id] = await stage(runDir, name, {
        buildId: receipt.buildId,
        id: record.id,
        artifact: record.artifact,
        provenance: record.provenance ?? null,
        tools: receipt.tools,
        installer,
      }, async () => {
        if (existsSync(prefix)) rmSync(prefix, { recursive: true });
        return installRuntime(record.artifact, prefix, run);
      }, (result) => ({ [result]: treeDigest(result, { portable: true }) }));
      installProofs[name] = JSON.parse(readFileSync(join(runDir, "stages", `${name}.json`), "utf8")).key;
    }
    const runtimeScenarios = [...scenarios, ...extension.scenarios];
    const runtime = await stage(runDir, "runtime", {
      buildId: receipt.buildId,
      targetSha256,
      artifact: receipt.artifact,
      additionalArtifacts: receipt.additionalArtifacts ?? [],
      preparedFiles: receipt.preparedFiles ?? [],
      adapter: extension.hash,
      installedCommands: extension.phaseHashes.installed,
      scenarios: jsonDigest(runtimeScenarios),
      environment: jsonDigest(fixtureEnv(context)),
      stateMigration: receipt.stateMigration ?? null,
    }, async () => {
      const before = treeDigest(installedDir, { portable: true });
      const additionalBefore = Object.fromEntries(
        Object.entries(context.additionalInstalledDirs).map(([id, path]) => [id, treeDigest(path, { portable: true })]),
      );
      const outputs = await extensionPhase(extension, "installed", context);
      const results = [];
      for (const scenario of runtimeScenarios) results.push(await runScenario(installedDir, scenario, { runDir }));
      if (treeDigest(installedDir, { portable: true }) !== before) {
        throw new Error("Target rehearsal changed the imported runtime");
      }
      for (const [id, path] of Object.entries(context.additionalInstalledDirs)) {
        if (treeDigest(path, { portable: true }) !== additionalBefore[id]) {
          throw new Error("Target rehearsal changed an imported additional runtime");
        }
      }
      return { scenarios: results, outputs };
    }, (result) => result.outputs);
    const stages = {
      install: JSON.parse(readFileSync(join(runDir, "stages", "install.json"), "utf8")).key,
      runtime: JSON.parse(readFileSync(join(runDir, "stages", "runtime.json"), "utf8")).key,
      ...installProofs,
    };
    const result = {
      schema: "puddles.openclaw-installed-proof/v1",
      schemaVersion: 1,
      status: "passed",
      buildId: receipt.buildId,
      targetSha256,
      stages,
      scenarios: runtime.scenarios.length,
      adapterSha256: extension.hash,
      adapterInputs: extension.inputs?.map(fileDigest) ?? [],
    };
    atomicJson(join(runDir, "installed-proof.json"), result);
    console.log(`Native target: passed (${runtime.scenarios.length} scenarios). Evidence: ${join(runDir, "installed-proof.json")}`);
    updateNativeRunStatus(runDir, { command: "target", status: "passed", finishedAt: new Date().toISOString() });
    return result;
  } catch (error) {
    updateNativeRunStatus(runDir, {
      command: "target",
      status: "failed",
      finishedAt: new Date().toISOString(),
      failure: { code: error.code ?? null, message: String(error.message ?? error).slice(0, 1000) },
    });
    throw error;
  } finally {
    unlock();
  }
}
