import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statfsSync } from "node:fs";
import { totalmem, homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireLock, atomicJson, externalDirectory, fileDigest, jsonDigest, stage, treeDigest } from "./native-state.mjs";
import { fixtureEnv, isolatedContext, runScenario } from "./native-fixture.mjs";
import { additionalArtifacts, extensionPhase, loadExtension } from "./native-extension.mjs";
import { installRuntime, packRuntime } from "./native-package.mjs";
import { runCommand } from "./process-runner.mjs";
import scenarios from "../scenarios/imessage.mjs";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageDir, "..", "..");
const patchDir = join(repoRoot, "docs", "openclaw-setup", "patches");
const suite = JSON.parse(readFileSync(join(packageDir, "openclaw-patch-suite.json"), "utf8"));

function safeNode() {
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  return major === 22 && (minor > 22 || minor === 22 && patch >= 3) ||
    major === 24 && minor >= 15 || major === 25 && minor >= 9 || major >= 26;
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
    dependencies: treeDigest(join(directory, "node_modules"), { excludeNames: [".cache", ".vite", ".vite-temp"] }),
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
  if (!safeNode()) throw new Error("Use OpenClaw's supported Node version (22.22.3+, 24.15+, or 25.9+ on supported major lines)");
  const source = resolve(process.env.OPENCLAW_SRC ?? join(homedir(), "git", "openclaw"));
  if (!existsSync(join(source, ".git"))) throw new Error("OPENCLAW_SRC must be a source checkout");
  const runDir = externalDirectory(process.env.E2E_RUN_DIR ?? mkdtempSync(join(tmpdir(), "puddles-native-")), [repoRoot, source]);
  const unlock = acquireLock(runDir);
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
  try {
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
    const disk = statfsSync(runDir);
    if (disk.bavail * disk.bsize < 8 * 1024 ** 3) throw new Error("Native candidate needs at least 8 GiB free disk");
    if (totalmem() < 8 * 1024 ** 3) throw new Error("Native candidate needs a host with at least 8 GiB memory");
    const extension = await loadExtension(process.env.E2E_LOCAL_EXTENSION);
    const context = isolatedContext(join(runDir, "context"));
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
    await stage(runDir, "dependencies", { dependencies, installed: true }, async () => {
      await run("corepack", ["pnpm", "install", "--frozen-lockfile"], { cwd: candidate, env: buildEnv, timeoutMs: 15 * 60_000 });
      return { installed: true };
    }, () => ({ [join(candidate, "node_modules")]: { sha256: treeDigest(join(candidate, "node_modules"), { exclude: [".cache", ".vite", ".vite-temp"] }), options: { exclude: [".cache", ".vite", ".vite-temp"] } } }));
    const installedDependencies = treeDigest(join(candidate, "node_modules"), { exclude: [".cache", ".vite", ".vite-temp"] });
    await stage(runDir, "build", { buildInputs, dependencies, installedDependencies, tools, buildEnvironment, prepareOutputs }, async () => {
      await run("corepack", ["pnpm", "build"], { cwd: candidate, env: buildEnv, timeoutMs: 30 * 60_000 });
      return { built: true };
    }, () => ({ [join(candidate, "dist")]: treeDigest(join(candidate, "dist")) }));
    if (command === "ci" || command === "patches") {
      const repoInputs = await tracked(repoRoot);
      const execution = command === "ci" ? await regressionEnvironment(repoRoot, run) : {
        environment: jsonDigest(Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b))),
        dependencies: treeDigest(join(repoRoot, "node_modules"), { excludeNames: [".cache", ".vite", ".vite-temp"] }),
      };
      await stage(runDir, "regressions", { candidateInputs, repoInputs, installedDependencies, tools, harness, execution, prepareOutputs, extension: extension.phaseHashes.gate, command }, async () => {
        if (command === "ci") await repositoryGates(run);
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
          const collected = await run("corepack", ["pnpm", "exec", "vitest", "list", "--filesOnly", "--config", `test/vitest/vitest.${project}.config.ts`, ...targets], { cwd: candidate, env: buildEnv, capture: true });
          for (const target of targets) {
            if (!collected.split("\n").some((line) => line.trim() === target || line.trim().endsWith(`/${target}`) || line.trim().endsWith(` ${target}`))) throw new Error("Mapped regression was not collected");
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
    const extensionOutputs = await stage(runDir, "extension-package", { candidateInputs, installedDependencies, tools, prepareOutputs, extension: extension.phaseHashes.package, artifacts: extension.artifacts }, async () => extensionPhase(extension, "package", context), (outputs) => outputs);
    const extras = additionalArtifacts(extension, context, extensionOutputs);
    context.additionalArtifacts = extras;
    const artifact = await stage(runDir, "package", { candidateInputs, installedDependencies, build: treeDigest(join(candidate, "dist")), tools, packaging: fileDigest(join(packageDir, "src", "native-package.mjs")) }, () => packRuntime(candidate, artifacts, run), (result) => ({ [result.path]: result.sha256 }));
    context.artifact = artifact;
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
    for (const [index, { id, artifact: extra }] of extras.entries()) {
      const name = `install-additional-${index}`;
      const extraPrefix = join(runDir, "installed-additional", id);
      const directory = await stage(runDir, name, { id, artifact: extra, tools, installer }, async () => {
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
      artifact, additionalArtifacts: extras, tools, harness, extension: extension.hash, extensionOutputs,
      installedCommands: extension.phaseHashes.installed,
      scenarios: jsonDigest(runtimeScenarios), environment: jsonDigest(fixtureEnv(context)),
    }, async () => {
      const outputs = await extensionPhase(extension, "installed", context);
      const results = [];
      for (const scenario of runtimeScenarios) {
        results.push(await runScenario(installedDir, scenario, { runDir }));
      }
      if (runtimeBefore !== treeDigest(installedDir, { portable: true })) throw new Error("Rehearsal changed the installed artifact");
      for (const [id, directory] of Object.entries(context.additionalInstalledDirs)) {
        if (additionalBefore[id] !== treeDigest(directory, { portable: true })) throw new Error("Rehearsal changed an additional installed artifact");
      }
      return { scenarios: results, outputs };
    }, (result) => result.outputs);
    if (command === "ci" && (await git(repoRoot, ["status", "--porcelain", "--untracked-files=all"])).trim()) throw new Error("Candidate changed during cumulative validation");
    const proofs = {};
    for (const name of ["regressions", "runtime", "install", ...extraProofs]) {
      const path = join(runDir, "stages", `${name}.json`);
      if (existsSync(path)) proofs[name] = JSON.parse(readFileSync(path, "utf8")).key;
    }
    const receipt = {
      schemaVersion: 1, status: "passed", accumulated: command === "ci",
      repository: { head: (await git(repoRoot, ["rev-parse", "HEAD"])).trim(), tree: (await git(repoRoot, ["rev-parse", "HEAD^{tree}"])).trim() },
      source: { ref: suite.openclawRef, sha256: candidateInputs }, artifact, installedDir, additionalArtifacts: extras,
      scenarios: result.scenarios.length, tools, proofs,
    };
    atomicJson(join(runDir, "candidate.json"), receipt);
    console.log(`Native ${command}: passed (${result.scenarios.length} scenarios). Local state: ${runDir}`);
    return receipt;
  } finally {
    unlock();
  }
}
