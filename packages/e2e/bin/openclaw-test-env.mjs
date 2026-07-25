#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupWorktree } from "../src/worktree-cleanup.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const repoRoot = resolve(packageDir, "..", "..");
const patchDir = join(repoRoot, "docs", "openclaw-setup", "patches");
const suite = JSON.parse(
  readFileSync(join(packageDir, "openclaw-patch-suite.json"), "utf8"),
);
let activeCleanup;
let handlingSignal = false;

function run(command, args, options = {}) {
  console.log(`+ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function sourcePath() {
  const configured = process.env.OPENCLAW_SRC;
  return resolve(configured ? configured.replace(/^~(?=\/)/, homedir()) : join(homedir(), "git", "openclaw"));
}

function runRepositoryGates() {
  run("corepack", ["pnpm", "build"]);
  run("corepack", ["pnpm", "lint"]);
  run("corepack", ["pnpm", "test"]);
}

function runPatchSuite() {
  const source = sourcePath();
  if (!existsSync(join(source, ".git"))) {
    throw new Error(
      `OPENCLAW_SRC must point to a git checkout containing ${suite.openclawRef}: ${source}`,
    );
  }
  run("git", ["-C", source, "cat-file", "-e", `${suite.openclawRef}^{commit}`]);

  const stateRoot = mkdtempSync(join(tmpdir(), "puddles-openclaw-test-"));
  const candidate = join(stateRoot, "candidate");
  let worktreeCreated = false;
  let primaryError;
  const cleanupErrors = [];

  const cleanup = () => {
    cleanupErrors.push(
      ...cleanupWorktree({
        source,
        candidate,
        stateRoot,
        worktreeCreated,
        runCommand: run,
        removeDirectory: (path) => rmSync(path, { recursive: true, force: true }),
      }),
    );
    return cleanupErrors;
  };
  activeCleanup = cleanup;

  try {
    run("git", ["-C", source, "worktree", "add", "--detach", candidate, suite.openclawRef]);
    worktreeCreated = true;
    run("corepack", ["pnpm", "install", "--frozen-lockfile"], {
      cwd: candidate,
      env: { ...process.env, CI: process.env.CI ?? "true" },
    });

    for (const patch of suite.patches) {
      const patchFile = join(patchDir, `${patch.name}.patch`);
      run("git", ["apply", "--check", patchFile], { cwd: candidate });
      run("git", ["apply", patchFile], { cwd: candidate });
    }

    const tests = [...new Set(suite.patches.flatMap((patch) => patch.tests))];
    for (const test of tests) {
      if (!existsSync(join(candidate, test))) {
        throw new Error(`Mapped OpenClaw test does not exist after patching: ${test}`);
      }
    }
    if (tests.length > 0) {
      run("corepack", ["pnpm", "exec", "vitest", "run", ...tests], {
        cwd: candidate,
        env: { ...process.env, CI: process.env.CI ?? "true" },
      });
    }

    const candidateTests = [
      ...new Set(suite.patches.flatMap((patch) => patch.candidateTests ?? [])),
    ];
    for (const test of candidateTests) {
      if (!existsSync(join(packageDir, test))) {
        throw new Error(`Mapped candidate test does not exist: ${test}`);
      }
    }
    if (candidateTests.length > 0) {
      run(
        "corepack",
        [
          "pnpm",
          "--filter",
          "e2e",
          "exec",
          "vitest",
          "run",
          "--config",
          "vitest.candidate.config.ts",
          ...candidateTests,
        ],
        {
          env: {
            ...process.env,
            CI: process.env.CI ?? "true",
            OPENCLAW_CANDIDATE: candidate,
          },
        },
      );
    }
  } catch (error) {
    primaryError = error;
  } finally {
    cleanup();
    activeCleanup = undefined;
  }

  if (primaryError) {
    for (const error of cleanupErrors) {
      console.error(`Cleanup also failed: ${error.message}`);
    }
    throw primaryError;
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, "OpenClaw test worktree cleanup failed");
  }
}

for (const [signal, exitCode] of [
  ["SIGHUP", 129],
  ["SIGINT", 130],
  ["SIGTERM", 143],
]) {
  process.once(signal, () => {
    if (handlingSignal) {
      return;
    }
    handlingSignal = true;
    const errors = activeCleanup?.() ?? [];
    for (const error of errors) {
      console.error(`Signal cleanup failed: ${error.message}`);
    }
    process.exit(exitCode);
  });
}

const command = process.argv[2];

try {
  if (command === "ci") {
    runRepositoryGates();
    runPatchSuite();
  } else if (command === "patches") {
    runPatchSuite();
  } else {
    console.error(
      "Usage: openclaw-test-env.mjs <ci|patches>\n" +
        "  ci       run repository gates and the isolated cumulative patch suite\n" +
        "  patches  run only the isolated cumulative patch suite",
    );
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
