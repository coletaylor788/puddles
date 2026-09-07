#!/usr/bin/env node

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupWorktree } from "../src/worktree-cleanup.mjs";
import {
  installSignalHandlers,
  isHandlingSignal,
  runCommand,
} from "../src/process-runner.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const repoRoot = resolve(packageDir, "..", "..");
const patchDir = join(repoRoot, "docs", "openclaw-setup", "patches");
const suite = JSON.parse(
  readFileSync(join(packageDir, "openclaw-patch-suite.json"), "utf8"),
);
let activeCleanup;

function run(command, args, options = {}) {
  return runCommand(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    capture: options.capture,
    timeoutMs: options.timeoutMs,
  });
}

function canonicalTempRoot() {
  return realpathSync(tmpdir());
}

function validatePatchManifest() {
  const deployScript = readFileSync(
    join(patchDir, "apply-and-deploy.sh"),
    "utf8",
  );
  const match = deployScript.match(/PATCHES=\(\n([\s\S]*?)\n\)/);
  if (!match) {
    throw new Error("apply-and-deploy.sh has no readable PATCHES array");
  }
  const deployed = match[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const declared = suite.patches.map((patch) => patch.name);
  if (JSON.stringify(deployed) !== JSON.stringify(declared)) {
    throw new Error(
      `Patch manifest does not match deployment order: ${declared.join(", ")}`,
    );
  }
  for (const patch of suite.patches) {
    const patchFile = join(patchDir, `${patch.name}.patch`);
    if (!existsSync(patchFile)) {
      throw new Error(`Declared patch does not exist: ${patchFile}`);
    }
    const changedTests = [
      ...readFileSync(patchFile, "utf8").matchAll(
        /^diff --git a\/(.+\.test\.ts) b\/\1$/gm,
      ),
    ].map((item) => item[1]);
    for (const test of changedTests) {
      if (!patch.tests.includes(test)) {
        throw new Error(
          `Patch test is missing from the manifest: ${patch.name}: ${test}`,
        );
      }
    }
  }
}

function sourcePath() {
  const configured = process.env.OPENCLAW_SRC;
  return resolve(configured ? configured.replace(/^~(?=\/)/, homedir()) : join(homedir(), "git", "openclaw"));
}

async function runRepositoryGates() {
  if (!existsSync(join(repoRoot, "node_modules"))) {
    await run("corepack", ["pnpm", "install", "--frozen-lockfile"], {
      timeoutMs: 15 * 60_000,
    });
  }
  await run("corepack", ["pnpm", "build"]);
  await run("corepack", ["pnpm", "lint"]);
  await run("corepack", ["pnpm", "test"]);

  const gmailDir = join(repoRoot, "servers", "gmail-mcp");
  const gmailEnvironment = process.env.GMAIL_MCP_PYTHON
    ? undefined
    : mkdtempSync(join(canonicalTempRoot(), "puddles-gmail-dev-"));
  const python =
    process.env.GMAIL_MCP_PYTHON ?? join(gmailEnvironment, "bin", "python");
  try {
    if (gmailEnvironment) {
      await run("python3", ["-m", "venv", gmailEnvironment]);
      await run(
        python,
        ["-m", "pip", "install", "--disable-pip-version-check", "-e", ".[dev]"],
        { cwd: gmailDir, timeoutMs: 10 * 60_000 },
      );
    }
    await run(
      python,
      ["-m", "pytest", "tests/", "--ignore=tests/integration", "-q"],
      {
        cwd: gmailDir,
        env: { ...process.env, CI: "true" },
      },
    );
    await run(python, ["-m", "ruff", "check", "src/", "tests/"], {
      cwd: gmailDir,
    });
    await run(python, ["-m", "compileall", "-q", "src", "tests"], {
      cwd: gmailDir,
    });
  } finally {
    if (gmailEnvironment) {
      rmSync(gmailEnvironment, { recursive: true, force: true });
    }
  }
}

async function runPatchSuite() {
  const source = sourcePath();
  if (!existsSync(join(source, ".git"))) {
    throw new Error(
      `OPENCLAW_SRC must point to a git checkout containing ${suite.openclawRef}: ${source}`,
    );
  }
  await run("git", ["-C", source, "cat-file", "-e", `${suite.openclawRef}^{commit}`]);

  const stateRoot = mkdtempSync(
    join(canonicalTempRoot(), "puddles-openclaw-test-"),
  );
  const candidate = join(stateRoot, "candidate");
  let worktreeCreated = false;
  let primaryError;
  const cleanupErrors = [];

  let cleanupPromise;
  const cleanup = () => {
    cleanupPromise ??= cleanupWorktree({
        source,
        candidate,
        stateRoot,
        worktreeCreated,
        runCommand: run,
        captureCommand: (command, args) => run(command, args, { capture: true }),
        removeDirectory: (path) => rmSync(path, { recursive: true, force: true }),
      }).then((errors) => {
        cleanupErrors.push(...errors);
        return cleanupErrors;
      });
    return cleanupPromise;
  };
  activeCleanup = cleanup;

  try {
    await run("git", ["-C", source, "worktree", "add", "--detach", candidate, suite.openclawRef]);
    worktreeCreated = true;

    for (const patch of suite.patches) {
      const patchFile = join(patchDir, `${patch.name}.patch`);
      await run("git", ["apply", "--check", patchFile], { cwd: candidate });
      await run("git", ["apply", patchFile], { cwd: candidate });
    }

    await run("corepack", ["pnpm", "install", "--frozen-lockfile"], {
      cwd: candidate,
      env: { ...process.env, CI: process.env.CI ?? "true" },
      timeoutMs: 15 * 60_000,
    });

    await run("corepack", ["pnpm", "prompt:snapshots:check"], {
      cwd: candidate,
      env: { ...process.env, CI: process.env.CI ?? "true" },
    });
    await run("corepack", ["pnpm", "build"], {
      cwd: candidate,
      env: {
        ...process.env,
        CI: process.env.CI ?? "true",
        NODE_OPTIONS: "--max-old-space-size=8192",
      },
      timeoutMs: 30 * 60_000,
    });

    const tests = [...new Set(suite.patches.flatMap((patch) => patch.tests))];
    for (const test of tests) {
      if (!existsSync(join(candidate, test))) {
        throw new Error(`Mapped OpenClaw test does not exist after patching: ${test}`);
      }
    }
    if (tests.length > 0) {
      const testsByProject = Map.groupBy(
        tests,
        (test) => suite.testProjects[test],
      );
      for (const [project, projectTests] of testsByProject) {
        if (!project) {
          throw new Error(
            `Mapped OpenClaw test has no Vitest project: ${projectTests[0]}`,
          );
        }
        await run(
          "corepack",
          [
            "pnpm",
            "exec",
            "vitest",
            "run",
            "--config",
            `test/vitest/vitest.${project}.config.ts`,
            ...projectTests,
          ],
          {
            cwd: candidate,
            env: { ...process.env, CI: process.env.CI ?? "true" },
            timeoutMs: 10 * 60_000,
          },
        );
      }
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
      await run(
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
          timeoutMs: 5 * 60_000,
        },
      );
    }
  } catch (error) {
    primaryError = error;
  } finally {
    await cleanup();
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

installSignalHandlers({
  cleanup: async () => (await activeCleanup?.()) ?? [],
});

const command = process.argv[2];

try {
  validatePatchManifest();
  if (command === "ci") {
    await runRepositoryGates();
    await runPatchSuite();
  } else if (command === "patches") {
    await runPatchSuite();
  } else {
    console.error(
      "Usage: openclaw-test-env.mjs <ci|patches>\n" +
        "  ci       run repository gates and the isolated cumulative patch suite\n" +
        "  patches  run only the isolated cumulative patch suite",
    );
    process.exitCode = 2;
  }
} catch (error) {
  if (!isHandlingSignal()) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
