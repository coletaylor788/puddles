#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativePipeline, nativeTargetPipeline } from "../src/native-pipeline.mjs";
import { cleanupNativeFixtures, isolatedContext, runScenario } from "../src/native-fixture.mjs";
import { extensionPhase, loadExtension } from "../src/native-extension.mjs";
import { installSignalHandlers, isHandlingSignal } from "../src/process-runner.mjs";
import { nativeRunStatus } from "../src/native-state.mjs";
import scenarios from "../scenarios/imessage.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
async function repositoryGates(run) {
  await run("corepack", ["pnpm", "build"]);
  await run("corepack", ["pnpm", "lint"]);
  await run("corepack", ["pnpm", "test"]);
  const gmailDir = join(repoRoot, "servers", "gmail-mcp");
  const managedPython = join(gmailDir, ".venv", "bin", "python");
  const python = process.env.GMAIL_MCP_PYTHON ?? (existsSync(managedPython) ? managedPython : "python3");
  await run(python, ["-m", "pytest", "tests/", "--ignore=tests/integration", "-q"], { cwd: gmailDir });
  await run(python, ["-m", "ruff", "check", "src/", "tests/"], { cwd: gmailDir });
  await run(python, ["-m", "compileall", "-q", "src", "tests"], { cwd: gmailDir });
}

installSignalHandlers({ cleanup: cleanupNativeFixtures });
try {
  const command = process.argv[2];
  if (["ci", "patches", "native", "build", "source-gate"].includes(command)) {
    await nativePipeline(command, repositoryGates);
  } else if (command === "target") {
    const receipt = process.argv[3];
    const target = process.argv[4];
    if (!receipt || !target || process.argv[5]) {
      throw new Error("Usage: openclaw-test-env.mjs target IMPORTED_BUILD_JSON TARGET_JSON");
    }
    await nativeTargetPipeline(resolve(receipt), resolve(target));
  } else if (command === "resume") {
    const resumed = process.argv[3];
    if (!["ci", "patches", "native", "build", "source-gate"].includes(resumed)) {
      throw new Error("Usage: openclaw-test-env.mjs resume <ci|patches|native|build|source-gate>");
    }
    process.env.E2E_RESUME_FAILED = "1";
    await nativePipeline(resumed, repositoryGates);
  } else if (command === "status") {
    const runDir = process.env.E2E_RUN_DIR;
    if (!runDir) throw new Error("E2E_RUN_DIR is required for status");
    console.log(JSON.stringify(nativeRunStatus(resolve(runDir)), null, 2));
  } else if (command === "scenarios") {
    const installed = process.env.OPENCLAW_CANDIDATE_DIR;
    if (!installed) throw new Error("OPENCLAW_CANDIDATE_DIR must name an installed candidate");
    const extension = await loadExtension(process.env.E2E_LOCAL_EXTENSION);
    for (const scenario of [...scenarios, ...extension.scenarios]) {
      await runScenario(resolve(installed), scenario);
    }
    console.log(`Native scenarios: passed (${scenarios.length + extension.scenarios.length})`);
  } else if (command === "host-health") {
    if (!process.env.E2E_LOCAL_EXTENSION) throw new Error("Host health requires explicit local extension selection");
    const extension = await loadExtension(process.env.E2E_LOCAL_EXTENSION);
    if (!extension.healthChecks.length) throw new Error("No selected host health checks");
    const root = mkdtempSync(join(tmpdir(), "puddles-host-health-"));
    try {
      const context = isolatedContext(root);
      const results = await extensionPhase(extension, "health", context);
      console.log(JSON.stringify({ checks: results.length, passed: results.every((result) => Object.values(result).every(Boolean)) }));
    } finally { rmSync(root, { recursive: true }); }
  } else {
    throw new Error("Usage: openclaw-test-env.mjs <ci|patches|native|build|source-gate|target|resume|status|scenarios|host-health>");
  }
} catch (error) {
  if (!isHandlingSignal()) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
