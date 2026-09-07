import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..", "..", "..");
const release = join(repoRoot, "packages", "e2e", "bin", "openclaw-release.mjs");
const releaseLauncher = join(
  repoRoot,
  "packages",
  "e2e",
  "bin",
  "openclaw-release.sh",
);
const roots: string[] = [];
const publicHead = "a".repeat(40);
const publicBase = "b".repeat(40);
const privateHead = "c".repeat(40);
const privateBase = "d".repeat(40);

function executable(path: string, body: string) {
  writeFileSync(path, `#!/bin/bash\nset -euo pipefail\n${body}`);
  chmodSync(path, 0o755);
}

function fixture(
  options: {
    dirtyPrivateCheckout?: boolean;
    mutatePrivateAfterApply?: boolean;
    publicMergeFailure?: boolean;
    productionStageMode?: "missing" | "outside" | "symlink";
    stalePublicHead?: boolean;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "puddles-release-cli-"));
  roots.push(root);
  const bin = join(root, "bin");
  const source = join(root, "source");
  const runDir = join(root, "run");
  const log = join(root, "commands.log");
  const mergeState = join(root, "merged");
  const releaseNodeDir = join(root, "Node Runtime");
  const inheritedPathEntry = join(root, "Copilot.app", "Contents", "MacOS");
  mkdirSync(bin);
  mkdirSync(source);
  mkdirSync(releaseNodeDir);
  mkdirSync(inheritedPathEntry, { recursive: true });

  executable(
    join(bin, "git"),
    `
printf 'git\\t%s\\n' "$*" >> "$COMMAND_LOG"
while [ "\${1:-}" = -C ]; do cwd="$2"; shift 2; done
case "\${1:-} \${2:-}" in
  "rev-parse --show-toplevel") printf '%s\\n' "$PRIVATE_REPO_ROOT" ;;
  "rev-parse HEAD")
    if [ "$cwd" = "$PRIVATE_REPO_ROOT" ]; then
      printf '%s\\n' "$PRIVATE_HEAD"
    else
      printf '%s\\n' "\${PUBLIC_CHECKOUT_HEAD:-$PUBLIC_HEAD}"
    fi
    ;;
  "rev-parse HEAD^{tree}") printf '%s\\n' "$PRIVATE_TREE" ;;
  "remote get-url") printf '%s\\n' 'https://github.com/coletaylor788/puddles-private.git' ;;
  "status --porcelain"*)
    if [ "$cwd" = "$PRIVATE_REPO_ROOT" ] &&
       { [ "$PRIVATE_DIRTY" = 1 ] || [ -f "$PRIVATE_DIRTY_MARKER" ]; }; then
      printf ' M private-overlay\\n'
    fi
    ;;
  "worktree add")
    candidate="$4"
    mkdir -p "$candidate"
    printf '%s\\n' '{"name":"openclaw","version":"1.2.3"}' > "$candidate/package.json"
    ;;
  "merge-base --is-ancestor") ;;
  "diff --name-only") printf '%s\\n' 'docs/openclaw-setup/patches/apply-and-deploy.sh' 'packages/e2e/bin/openclaw-release.mjs' ;;
  "diff --binary") ;;
  "ls-files --others") ;;
  *) ;;
esac
`,
  );
  executable(
    join(bin, "gh"),
    `
printf 'gh\\t%s\\n' "$*" >> "$COMMAND_LOG"
if [ "$1 $2" = "pr list" ]; then
  if [ -f "$PRIVATE_MERGE_STATE" ]; then state=MERGED; else state=OPEN; fi
  printf '[{"number":30,"headRefOid":"%s","baseRefOid":"%s","baseRefName":"main","mergeable":"MERGEABLE","reviewDecision":"APPROVED","statusCheckRollup":[{"conclusion":"SUCCESS"}],"isDraft":false,"state":"%s"}]\\n' "$PRIVATE_HEAD" "$PRIVATE_BASE" "$state"
elif [ "$1 $2" = "pr merge" ]; then
  repo=
  previous=
  for arg in "$@"; do
    if [ "$previous" = --repo ]; then repo="$arg"; break; fi
    previous="$arg"
  done
  if [ "$repo" = "coletaylor788/puddles-private" ]; then
    : > "$PRIVATE_MERGE_STATE"
  elif [ "$PUBLIC_MERGE_FAILURE" != 1 ]; then
    : > "$PUBLIC_MERGE_STATE"
  fi
  exit 73
elif [ "$1 $2" = "pr view" ]; then
  repo=
  previous=
  for arg in "$@"; do
    if [ "$previous" = --repo ]; then repo="$arg"; break; fi
    previous="$arg"
  done
  if [ "$repo" = "coletaylor788/puddles-private" ]; then
    if [ -f "$PRIVATE_MERGE_STATE" ]; then state=MERGED; else state=OPEN; fi
    printf '{"number":30,"state":"%s","headRefOid":"%s","baseRefOid":"%s","baseRefName":"main","mergeable":"MERGEABLE","reviewDecision":"APPROVED","statusCheckRollup":[{"conclusion":"SUCCESS"}],"isDraft":false}\\n' "$state" "$PRIVATE_HEAD" "$PRIVATE_BASE"
  else
    if [ -f "$PUBLIC_MERGE_STATE" ]; then state=MERGED; else state=OPEN; fi
    printf '{"state":"%s","headRefOid":"%s","baseRefOid":"%s","baseRefName":"main","mergeable":"MERGEABLE","reviewDecision":"APPROVED","statusCheckRollup":[{"conclusion":"SUCCESS"}],"isDraft":false}\\n' "$state" "$PUBLIC_HEAD" "$PUBLIC_BASE"
  fi
elif [ "$1" = api ]; then
  printf 'ahead\\n'
fi
`,
  );
  const releaseNode = join(releaseNodeDir, "node");
  executable(
    releaseNode,
    `
printf 'release-node\\t%s\\n' "$*" >> "$COMMAND_LOG"
if printf '%s' "\${1:-}" | grep -q 'openclaw-test-env.mjs$'; then
  printf 'public-validation\\n' >> "$COMMAND_LOG"
  exit 0
fi
exec "$REAL_NODE" "$@"
`,
  );
  executable(
    join(bin, "corepack"),
    `
printf 'corepack\\t%s\\n' "$*" >> "$COMMAND_LOG"
if [ "\${1:-} \${2:-}" = "pnpm pack" ]; then
  destination=
  while [ "$#" -gt 0 ]; do
    if [ "$1" = --pack-destination ]; then destination="$2"; break; fi
    shift
  done
  mkdir -p "$destination"
  printf artifact > "$destination/openclaw-test.tgz"
  printf '%s\\n' "$destination/openclaw-test.tgz"
fi
`,
  );
  executable(
    join(bin, "bash"),
    `
printf 'bash\\t%s\\n' "$*" >> "$COMMAND_LOG"
if printf '%s' "\${1:-}" | grep -q 'apply-and-deploy.sh$'; then
  printf 'target-host\\t%s\\n' "\${MINI_HOST:-}" >> "$COMMAND_LOG"
  if [ "\${DEPLOY_FAIL:-0}" = 1 ]; then
    exit 91
  fi
  /bin/bash "$OPENCLAW_POST_DEPLOY_CHECK"
  "$REAL_NODE" - "$OPENCLAW_TARGET_RESULT" "$OPENCLAW_ARTIFACT_SHA256" <<'NODE'
const fs = require("node:fs");
const metadata = JSON.parse(process.env.OPENCLAW_RELEASE_METADATA);
fs.writeFileSync(process.argv[2], JSON.stringify({
  ...metadata,
  schemaVersion: 1,
  stage: "deployment",
  status: "passed",
  detail: "fixture",
  artifactSha256: process.argv[3],
}) + "\\n");
NODE
  exit 0
fi
exec /bin/bash "$@"
`,
  );
  for (const [name, body] of [
    ["openclaw", 'if [ "${1:-}" = --version ]; then echo 1.2.3; fi'],
    ["launchctl", "exit 0"],
    ["lsof", "exit 0"],
  ]) {
    executable(join(bin, name), body);
  }
  const privatePipeline = join(root, "private-overlay");
  executable(
    privatePipeline,
    `
printf 'private\\t%s\\n' "$*" >> "$COMMAND_LOG"
command="$1"
shift
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) source="$2"; shift 2 ;;
    --public-result) public_result="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    --expected-private-head) private_head="$2"; shift 2 ;;
    *) shift 2 ;;
  esac
done
"$REAL_NODE" --input-type=module - "$command" "$source" "$public_result" "$output" "$private_head" <<'NODE'
import fs from "node:fs";
import path from "node:path";
const [command, source, publicPath, output, head] = process.argv.slice(2);
const publicReceipt = JSON.parse(fs.readFileSync(publicPath));
fs.mkdirSync(path.dirname(output), { recursive: true });
let productionStage;
if (command === "validate") {
  const expectedStage = output + ".stage";
  let stage = expectedStage;
  if (process.env.PRIVATE_STAGE_MODE === "outside") {
    stage = process.env.PRIVATE_OUTSIDE_STAGE;
  }
  if (!["missing", "symlink"].includes(process.env.PRIVATE_STAGE_MODE)) {
    fs.cpSync(source, stage, { recursive: true });
  }
  const { directoryTreeSha256 } = await import(process.env.RELEASE_STATE_URL);
  if (process.env.PRIVATE_STAGE_MODE === "symlink") {
    const outside = process.env.PRIVATE_OUTSIDE_STAGE;
    fs.cpSync(source, outside, { recursive: true });
    fs.symlinkSync(outside, expectedStage);
  }
  productionStage = {
    path: stage,
    sha256: process.env.PRIVATE_STAGE_MODE === "missing"
      ? "0".repeat(64)
      : directoryTreeSha256(stage),
  };
}
fs.writeFileSync(output, JSON.stringify({
  schemaVersion: 1,
  stage: command,
  status: "passed",
  private: { repository: "wrong/private-repository", head },
  candidate: {
    treeSha256: publicReceipt.candidate.treeSha256,
    preTreeSha256: publicReceipt.candidate.treeSha256,
    postTreeSha256: publicReceipt.candidate.treeSha256,
    ...(productionStage ? { productionStage } : {}),
  },
  secretPath: "/private/account",
}) + "\\n");
if (command === "apply" && process.env.MUTATE_PRIVATE_AFTER_APPLY === "1") {
  fs.writeFileSync(process.env.PRIVATE_DIRTY_MARKER, "dirty");
}
NODE
`,
  );
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${inheritedPathEntry}:/usr/bin:/bin`,
    REAL_NODE: process.execPath,
    COMMAND_LOG: log,
    PUBLIC_MERGE_STATE: mergeState,
    PRIVATE_MERGE_STATE: join(root, "private-merged"),
    PUBLIC_MERGE_FAILURE: options.publicMergeFailure ? "1" : "0",
    PUBLIC_HEAD: options.stalePublicHead ? "e".repeat(40) : publicHead,
    PUBLIC_BASE: publicBase,
    PRIVATE_HEAD: privateHead,
    PRIVATE_BASE: privateBase,
    PRIVATE_TREE: "f".repeat(40),
    PRIVATE_REPO_ROOT: realpathSync(root),
    PRIVATE_DIRTY: options.dirtyPrivateCheckout ? "1" : "0",
    PRIVATE_DIRTY_MARKER: join(root, "private-dirty"),
    MUTATE_PRIVATE_AFTER_APPLY: options.mutatePrivateAfterApply ? "1" : "0",
    OPENCLAW_DEPLOY_PATH: `${releaseNodeDir}:${bin}:/usr/bin:/bin`,
    RELEASE_STATE_URL: pathToFileURL(
      join(repoRoot, "packages", "e2e", "src", "release-state.mjs"),
    ).href,
    PRIVATE_STAGE_MODE: options.productionStageMode ?? "normal",
    PRIVATE_OUTSIDE_STAGE: join(root, "outside-production-stage"),
  };
  const args = [
    releaseLauncher,
    "--node",
    releaseNode,
    "--private-pipeline",
    privatePipeline,
    "--",
    "run",
    "--run-dir",
    runDir,
    "--source",
    source,
    "--public-repository",
    "coletaylor788/puddles",
    "--private-repository",
    "coletaylor788/puddles-private",
    "--public-head",
    publicHead,
    "--expected-private-head",
    privateHead,
    "--pr-number",
    "110",
    "--expected-base-head",
    publicBase,
  ];
  return { args, env, log, root, runDir };
}

function runFixture(test: ReturnType<typeof fixture>) {
  return spawnSync("/bin/bash", test.args, {
    env: test.env,
    encoding: "utf8",
  });
}

function markStageRunning(runDir: string, name: string) {
  const path = join(runDir, "stages", `${name}.json`);
  const state = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, `${JSON.stringify({ ...state, status: "running" })}\n`);
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("OpenClaw release CLI", () => {
  it("validates, sanitizes private evidence, reconciles merge ambiguity, and resumes", () => {
    const test = fixture();
    const first = runFixture(test);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    expect(readFileSync(test.log, "utf8")).toContain("private\tapply");
    expect(readFileSync(test.log, "utf8")).toContain("private\tvalidate");
    expect(readFileSync(test.log, "utf8")).toContain(
      `release-node\t${release} run`,
    );
    expect(readFileSync(test.log, "utf8")).toContain("gh\tpr merge");
    expect(readFileSync(test.log, "utf8")).not.toMatch(
      /corepack\tpnpm (install|build)/,
    );
    expect(readFileSync(join(test.runDir, "landing.json"), "utf8")).toContain(
      '"status": "passed"',
    );
    expect(readFileSync(join(test.runDir, "overlay.json"), "utf8")).not.toContain(
      "secretPath",
    );
    expect(readFileSync(join(test.runDir, "overlay.json"), "utf8")).toContain(
      "coletaylor788/puddles-private",
    );

    unlinkSync(join(test.runDir, "landing.json"));
    unlinkSync(join(test.runDir, "stages", "land.json"));
    const beforeReconcile = readFileSync(test.log, "utf8");
    const resumed = runFixture(test);
    expect(resumed.status, `${resumed.stdout}\n${resumed.stderr}`).toBe(0);
    expect(resumed.stdout).toContain("reconciled completed production release");
    const afterReconcile = readFileSync(test.log, "utf8");
    expect(afterReconcile.slice(beforeReconcile.length)).not.toMatch(
      /public-validation|private\t|corepack\t|bash\t/,
    );

    const completedResume = runFixture(test);
    expect(
      completedResume.status,
      `${completedResume.stdout}\n${completedResume.stderr}`,
    ).toBe(0);
    const completedDelta = readFileSync(test.log, "utf8").slice(
      afterReconcile.length,
    );
    expect(completedDelta).not.toMatch(
      /public-validation|private\t|corepack\t|bash\t|pr merge/,
    );
  });

  it("rejects a stale public head before validation", () => {
    const test = fixture({ stalePublicHead: true });
    const result = runFixture(test);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("public checkout head");
    expect(readFileSync(test.log, "utf8")).not.toContain("public-validation");
  });

  it("rejects a dirty private pipeline checkout before validation", () => {
    const test = fixture({ dirtyPrivateCheckout: true });
    const result = runFixture(test);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "private pipeline checkout must be clean before release",
    );
    expect(readFileSync(test.log, "utf8")).not.toContain("public-validation");
  });

  it("rejects private pipeline mutation between apply and validation", () => {
    const test = fixture({ mutatePrivateAfterApply: true });
    const result = runFixture(test);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "private pipeline checkout must be clean before release",
    );
    expect(readFileSync(test.log, "utf8")).not.toContain("private\tvalidate");
  });

  it("rolls back an unlanded public candidate and permits a new run", () => {
    const test = fixture({ publicMergeFailure: true });
    const result = runFixture(test);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "exact public candidate was not confirmed landed",
    );
    expect(existsSync(join(test.runDir, "production.json"))).toBe(false);
    expect(existsSync(join(test.runDir, "landing.json"))).toBe(false);

    test.env.PUBLIC_MERGE_FAILURE = "0";
    const retryDir = join(test.root, "retry");
    test.args[test.args.indexOf("--run-dir") + 1] = retryDir;
    const retry = runFixture(test);
    expect(retry.status, `${retry.stdout}\n${retry.stderr}`).toBe(0);
    expect(existsSync(join(retryDir, "production.json"))).toBe(true);
    expect(existsSync(join(retryDir, "landing.json"))).toBe(true);
  });

  it("revalidates the immutable artifact before completed-run resume", () => {
    const test = fixture();
    const first = runFixture(test);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const packageReceipt = JSON.parse(
      readFileSync(join(test.runDir, "package.json"), "utf8"),
    );
    writeFileSync(packageReceipt.artifact.path, "changed");

    const resumed = runFixture(test);
    expect(resumed.status).not.toBe(0);
    expect(resumed.stderr).toContain("package stage evidence no longer validates");
  });

  it("rejects production-stage tampering before package reuse", () => {
    const test = fixture();
    const first = runFixture(test);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    const validation = JSON.parse(
      readFileSync(join(test.runDir, "validation.json"), "utf8"),
    );
    writeFileSync(
      join(validation.candidate.productionStage.path, "tampered"),
      "changed",
    );

    const resumed = runFixture(test);
    expect(resumed.status).not.toBe(0);
    expect(resumed.stderr).toContain(
      "retained production stage changed after validation",
    );
  });

  for (const mode of ["missing", "outside", "symlink"] as const) {
    it(`rejects a ${mode} production stage`, () => {
      const test = fixture({ productionStageMode: mode });
      const result = runFixture(test);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/production stage/);
      expect(readFileSync(test.log, "utf8")).not.toMatch(/corepack\tpnpm pack/);
    });
  }

  it("rejects a symlinked private receipt directory into a protected tree", () => {
    const test = fixture();
    symlinkSync(join(test.root, "source"), `${test.runDir}.private`);

    const result = runFixture(test);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "release run directory must be outside repository and source trees",
    );
  });

  it("reconciles a package receipt after interruption without repackaging", () => {
    const test = fixture();
    const first = runFixture(test);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    rmSync(join(test.root, "merged"));
    for (const path of [
      join(test.runDir, "stages", "deploy-validate.json"),
      join(test.runDir, "stages", "land.json"),
      join(test.runDir, "deployment.json"),
      join(test.runDir, "production.json"),
      join(test.runDir, "landing.json"),
    ]) {
      rmSync(path, { force: true });
    }
    markStageRunning(test.runDir, "package");
    const packsBefore = readFileSync(test.log, "utf8").match(
      /corepack\tpnpm pack/g,
    )?.length;

    const resumed = runFixture(test);
    expect(resumed.status, `${resumed.stdout}\n${resumed.stderr}`).toBe(0);
    expect(
      readFileSync(test.log, "utf8").match(/corepack\tpnpm pack/g)?.length,
    ).toBe(packsBefore);
  });

  it("resumes unchanged stages with a pinned tooling repair and remote target", () => {
    const test = fixture();
    test.env.DEPLOY_FAIL = "1";
    const first = runFixture(test);
    expect(first.status).not.toBe(0);

    const logBeforeResume = readFileSync(test.log, "utf8");
    const toolingHead = "e".repeat(40);
    test.env.DEPLOY_FAIL = "0";
    test.env.PUBLIC_CHECKOUT_HEAD = toolingHead;
    test.args.push(
      "--target-host",
      "puddles@coles-mac-mini",
      "--release-tooling-head",
      toolingHead,
    );

    const resumed = runFixture(test);
    expect(resumed.status, `${resumed.stdout}\n${resumed.stderr}`).toBe(0);
    const resumedLog = readFileSync(test.log, "utf8").slice(
      logBeforeResume.length,
    );
    expect(resumedLog).not.toMatch(/public-validation|private\t|corepack\t/);
    expect(resumedLog).toContain("target-host\tpuddles@coles-mac-mini");
    const deploymentStage = JSON.parse(
      readFileSync(join(test.runDir, "stages", "deploy-validate.json"), "utf8"),
    );
    expect(deploymentStage.inputs.targetHost).toBe(
      "puddles@coles-mac-mini",
    );
    expect(deploymentStage.inputs.releaseTooling.head).toBe(toolingHead);
  });

  it("reconciles production receipts after interruption without redeploying", () => {
    const test = fixture();
    const first = runFixture(test);
    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0);
    rmSync(join(test.runDir, "stages", "land.json"), { force: true });
    rmSync(join(test.runDir, "landing.json"), { force: true });
    rmSync(join(test.runDir, "production.json"), { force: true });
    markStageRunning(test.runDir, "deploy-validate");
    const deploysBefore = readFileSync(test.log, "utf8").match(
      /bash\t.*apply-and-deploy\.sh/g,
    )?.length;

    const resumed = runFixture(test);
    expect(resumed.status, `${resumed.stdout}\n${resumed.stderr}`).toBe(0);
    expect(
      readFileSync(test.log, "utf8").match(
        /bash\t.*apply-and-deploy\.sh/g,
      )?.length,
    ).toBe(deploysBefore);
  });
});
