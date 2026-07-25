#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const repoRoot = resolve(packageDir, "..", "..");
const patchDir = join(repoRoot, "docs", "openclaw-setup", "patches");
const suite = JSON.parse(
  readFileSync(join(packageDir, "openclaw-patch-suite.json"), "utf8"),
);

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

function runLiveSuite() {
  run("corepack", ["pnpm", "--filter", "e2e", "test:e2e"]);
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
  let cleanupError;

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
    try {
      if (worktreeCreated) {
        run("git", ["-C", source, "worktree", "remove", "--force", candidate]);
      }
      rmSync(stateRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupError = error;
    }
  }

  if (primaryError) {
    if (cleanupError) {
      console.error(`Cleanup also failed: ${cleanupError.message}`);
    }
    throw primaryError;
  }
  if (cleanupError) {
    throw cleanupError;
  }
}

const command = process.argv[2];

try {
  if (command === "ci") {
    runRepositoryGates();
    runPatchSuite();
  } else if (command === "patches") {
    runPatchSuite();
  } else if (command === "live") {
    runLiveSuite();
  } else {
    console.error(
      "Usage: openclaw-test-env.mjs <ci|patches|live>\n" +
        "  ci       run repository gates and the isolated cumulative patch suite\n" +
        "  patches  run only the isolated cumulative patch suite\n" +
        "  live     run the read-only live gateway suite",
    );
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
