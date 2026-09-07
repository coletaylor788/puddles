#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import {
  argvSha256,
  assertGitSha,
  atomicWriteJson,
  candidateTreeSha256,
  createRunId,
  directoryTreeSha256,
  sha256File,
  stageCanResume,
} from "../src/release-state.mjs";
import { runCommand } from "../src/process-runner.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const repoRoot = resolve(packageDir, "..", "..");
const patchDir = join(repoRoot, "docs", "openclaw-setup", "patches");
const patchManifestPath = join(packageDir, "openclaw-patch-suite.json");
const patchManifest = JSON.parse(readFileSync(patchManifestPath, "utf8"));

function parseArguments(argv) {
  if (argv[0] !== "run") {
    throw new Error(
      "Usage: openclaw-release.mjs run --run-dir <path> --source <path> " +
        "--public-repository <owner/repo> --public-head <sha> " +
        "--private-repository <owner/repo> " +
        "--expected-private-head <sha> --pr-number <number> " +
        "--expected-base-head <sha> [--target-host <user@host>] " +
        "[--release-tooling-head <sha>]",
    );
  }
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid release argument: ${key ?? ""}`);
    }
    values[key.slice(2)] = value;
  }
  for (const key of [
    "run-dir",
    "source",
    "public-repository",
    "private-repository",
    "public-head",
    "expected-private-head",
    "pr-number",
    "expected-base-head",
  ]) {
    if (!values[key]) {
      throw new Error(`Missing --${key}`);
    }
  }
  assertGitSha(values["public-head"], "public head");
  assertGitSha(values["expected-private-head"], "private head");
  assertGitSha(values["expected-base-head"], "base head");
  if (values["release-tooling-head"]) {
    assertGitSha(values["release-tooling-head"], "release tooling head");
  }
  if (
    values["target-host"] &&
    !/^(?:[A-Za-z0-9_.-]+@)?[A-Za-z0-9_.-]+$/.test(values["target-host"])
  ) {
    throw new Error("target-host must use host or user@host form");
  }
  if (!/^[1-9][0-9]*$/.test(values["pr-number"])) {
    throw new Error("PR number must be a positive integer");
  }
  for (const key of ["public-repository", "private-repository"]) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(values[key])) {
      throw new Error(`${key} must use owner/repository form`);
    }
  }
  return values;
}

async function run(command, args, options = {}) {
  return runCommand(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    capture: options.capture,
    timeoutMs: options.timeoutMs,
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function stagePath(runDir, name) {
  return join(runDir, "stages", `${name}.json`);
}

function isInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== ".." &&
      !isAbsolute(pathFromParent))
  );
}

export function resolveExternalRunDirectory(requested, protectedRoots) {
  const absolute = resolve(requested);
  const { root } = parse(absolute);
  const segments = absolute.slice(root.length).split(sep).filter(Boolean);
  let existing = root;
  let existingCount = 0;
  for (const segment of segments) {
    const next = join(existing, segment);
    if (!existsSync(next)) {
      break;
    }
    existing = next;
    existingCount += 1;
  }
  const prospective = join(
    realpathSync(existing),
    ...segments.slice(existingCount),
  );
  for (const protectedRoot of protectedRoots.map((path) => realpathSync(path))) {
    if (isInside(protectedRoot, prospective)) {
      throw new Error(
        "release run directory must be outside repository and source trees",
      );
    }
  }
  mkdirSync(prospective, { recursive: true, mode: 0o700 });
  const canonical = realpathSync(prospective);
  for (const protectedRoot of protectedRoots.map((path) => realpathSync(path))) {
    if (isInside(protectedRoot, canonical)) {
      throw new Error(
        "release run directory must be outside repository and source trees",
      );
    }
  }
  return canonical;
}

async function runStage(runDir, name, inputs, argv, action, options = {}) {
  const path = stagePath(runDir, name);
  if (existsSync(path)) {
    const current = readJson(path);
    if (
      options.preservePassedProducer &&
      current.status === "passed" &&
      JSON.stringify(current.inputs) === JSON.stringify(inputs) &&
      stageCanResume(current, { inputs, argv: current.argv })
    ) {
      console.log(`==> ${name}: reusing validated original producer result`);
      return current.result;
    }
    if (stageCanResume(current, { inputs, argv })) {
      console.log(`==> ${name}: reusing validated result`);
      return current.result;
    }
    if (options.immutable && current.status === "passed") {
      throw new Error(
        `${name} output changed after completion; start a new release run`,
      );
    }
  }

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  atomicWriteJson(path, {
    schemaVersion: 1,
    stage: name,
    status: "running",
    startedAt,
    argv,
    argvSha256: argvSha256(argv),
    inputs,
    resume: { reused: false, revalidateInputsAndOutputs: true },
  });
  try {
    const { result, outputPaths = [] } = await action();
    const outputs = Object.fromEntries(
      outputPaths.map((output) => [output, sha256File(output)]),
    );
    atomicWriteJson(path, {
      schemaVersion: 1,
      stage: name,
      status: "passed",
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      argv,
      argvSha256: argvSha256(argv),
      inputs,
      outputs,
      result,
      summary: result.summary,
      resume: { reused: false, revalidateInputsAndOutputs: true },
    });
    return result;
  } catch (error) {
    atomicWriteJson(path, {
      schemaVersion: 1,
      stage: name,
      status: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedMs,
      argv,
      argvSha256: argvSha256(argv),
      inputs,
      outputs: {},
      summary: error instanceof Error ? error.message : String(error),
      resume: { reused: false, revalidateInputsAndOutputs: true },
    });
    throw error;
  }
}

function reconcilePassedStage(runDir, name, inputs, argv, result, outputPaths) {
  const path = stagePath(runDir, name);
  const prior = existsSync(path) ? readJson(path) : {};
  atomicWriteJson(path, {
    schemaVersion: 1,
    stage: name,
    status: "passed",
    startedAt: prior.startedAt ?? new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: prior.durationMs ?? 0,
    argv,
    argvSha256: argvSha256(argv),
    inputs,
    outputs: Object.fromEntries(
      outputPaths.map((output) => [output, sha256File(output)]),
    ),
    result,
    summary: result.summary,
    resume: { reused: true, revalidateInputsAndOutputs: true },
  });
  return result;
}

async function git(path, args, options = {}) {
  return run("git", ["-C", path, ...args], {
    capture: options.capture ?? true,
  });
}

const releaseToolingPaths = new Set([
  "docs/openclaw-setup/patches/README.md",
  "docs/openclaw-setup/patches/apply-and-deploy.sh",
  "docs/plans/036-hardened-openclaw-release-pipeline.md",
  "packages/e2e/README.md",
  "packages/e2e/bin/openclaw-release.mjs",
  "packages/e2e/tests/deployment-topology.test.ts",
  "packages/e2e/tests/release-pipeline-cli.test.ts",
  "packages/e2e/tests/release-pipeline-contract.test.ts",
]);

async function assertPublicCheckout(expectedHead, releaseToolingHead) {
  const head = (await git(repoRoot, ["rev-parse", "HEAD"])).trim();
  if (!releaseToolingHead && head !== expectedHead) {
    throw new Error(`public checkout head ${head} does not match ${expectedHead}`);
  }
  if (releaseToolingHead) {
    if (head !== releaseToolingHead) {
      throw new Error(
        `release tooling checkout head ${head} does not match ${releaseToolingHead}`,
      );
    }
    try {
      await git(repoRoot, ["merge-base", "--is-ancestor", expectedHead, head]);
    } catch {
      throw new Error("release tooling head does not descend from the public head");
    }
    const changedPaths = (
      await git(repoRoot, ["diff", "--name-only", `${expectedHead}..${head}`])
    )
      .split("\n")
      .filter(Boolean);
    const disallowed = changedPaths.filter((path) => !releaseToolingPaths.has(path));
    if (disallowed.length > 0) {
      throw new Error(
        `release tooling repair changes non-infrastructure paths: ${disallowed.join(", ")}`,
      );
    }
  }
  const status = await git(repoRoot, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  if (status !== "") {
    throw new Error("public checkout must be clean before release");
  }
}

function repositoryFromRemote(remote) {
  const match = remote
    .trim()
    .match(/(?:github\.com[/:])([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/);
  return match?.[1];
}

async function assertPrivatePipelineCheckout(
  executable,
  expectedRepository,
  expectedHead,
  expectedTree,
) {
  const root = realpathSync(
    (
      await git(dirname(executable), ["rev-parse", "--show-toplevel"])
    ).trim(),
  );
  if (!isInside(root, executable)) {
    throw new Error("private pipeline executable is outside its Git checkout");
  }
  const remote = await git(root, ["remote", "get-url", "origin"]);
  if (repositoryFromRemote(remote) !== expectedRepository) {
    throw new Error("private pipeline checkout does not match the pinned repository");
  }
  const head = (await git(root, ["rev-parse", "HEAD"])).trim();
  if (head !== expectedHead) {
    throw new Error(`private pipeline head ${head} does not match ${expectedHead}`);
  }
  const tree = (await git(root, ["rev-parse", "HEAD^{tree}"])).trim();
  assertGitSha(tree, "private tree");
  if (expectedTree && tree !== expectedTree) {
    throw new Error("private pipeline tree changed after release initialization");
  }
  const status = await git(root, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  if (status !== "") {
    throw new Error("private pipeline checkout must be clean before release");
  }
  return { root, tree };
}

function validateOverlayReceipt(receipt, expectedHead, expectedTree, stage) {
  if (
    receipt?.status !== "passed" ||
    receipt?.private?.head !== expectedHead ||
    receipt?.candidate?.treeSha256 !== expectedTree
  ) {
    throw new Error(`${stage} receipt does not match the pinned private head and candidate`);
  }
}

function sanitizedOverlayReceipt(
  receipt,
  stage,
  privateRepository,
  productionStage,
) {
  const candidate = {};
  for (const key of ["treeSha256", "preTreeSha256", "postTreeSha256"]) {
    if (receipt.candidate?.[key] !== undefined) {
      if (!/^[0-9a-f]{64}$/.test(receipt.candidate[key])) {
        throw new Error(`private receipt candidate.${key} is not a SHA-256 digest`);
      }
      candidate[key] = receipt.candidate[key];
    }
  }
  const sanitized = {
    schemaVersion: 1,
    stage,
    status: "passed",
    private: {
      repository: privateRepository,
      head: receipt.private.head,
    },
    candidate,
  };
  if (productionStage) {
    sanitized.candidate.productionStage = productionStage;
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(privateRepository)) {
    throw new Error("private receipt repository identifier is invalid");
  }
  return sanitized;
}

function validatedProductionStage(
  receipt,
  rawValidationReceipt,
  privateReceiptDir,
  candidate,
) {
  const expectedPath = `${rawValidationReceipt}.stage`;
  const declared = receipt.candidate?.productionStage;
  if (
    declared?.path !== expectedPath ||
    !/^[0-9a-f]{64}$/.test(declared?.sha256 ?? "") ||
    !existsSync(expectedPath) ||
    lstatSync(expectedPath).isSymbolicLink() ||
    !lstatSync(expectedPath).isDirectory()
  ) {
    throw new Error("combined validation receipt has no valid production stage");
  }
  const canonical = realpathSync(expectedPath);
  if (
    dirname(canonical) !== privateReceiptDir ||
    isInside(candidate, canonical)
  ) {
    throw new Error("production stage is outside its retained release location");
  }
  const actual = directoryTreeSha256(canonical);
  if (actual !== declared.sha256) {
    throw new Error("production stage digest does not match combined validation");
  }
  return { path: canonical, sha256: actual };
}

async function pullRequestState(repository, number) {
  const output = await run(
    "gh",
    [
      "pr",
      "view",
      number,
      "--repo",
      repository,
      "--json",
      "number,headRefOid,baseRefOid,baseRefName,mergeable,reviewDecision,statusCheckRollup,isDraft,state",
    ],
    { capture: true },
  );
  return JSON.parse(output);
}

async function privatePullRequestState(repository, expectedHead) {
  const output = await run(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repository,
      "--state",
      "all",
      "--limit",
      "100",
      "--json",
      "number,headRefOid,baseRefOid,baseRefName,mergeable,reviewDecision,statusCheckRollup,isDraft,state",
    ],
    { capture: true },
  );
  const matches = JSON.parse(output).filter(
    (pullRequest) => pullRequest.headRefOid === expectedHead,
  );
  if (matches.length !== 1) {
    throw new Error("expected exactly one private pull request at the pinned head");
  }
  return matches[0];
}

async function assertPrivatePullRequestReady(
  repository,
  state,
  expectedHead,
  expectedBase,
) {
  if (state.state === "MERGED") {
    if (
      state.headRefOid !== expectedHead ||
      state.baseRefOid !== expectedBase ||
      !(await verifyLanded(repository, state.number, expectedHead))
    ) {
      throw new Error("merged private pull request does not match the pinned candidate");
    }
    return;
  }
  assertPullRequestReady(state, expectedHead, expectedBase);
}

export function assertPullRequestReady(
  state,
  expectedHead,
  expectedBase,
  requireChecks = true,
) {
  if (
    state.headRefOid !== expectedHead ||
    state.baseRefOid !== expectedBase ||
    state.isDraft ||
    state.state !== "OPEN" ||
    state.mergeable !== "MERGEABLE" ||
    state.reviewDecision === "CHANGES_REQUESTED"
  ) {
    throw new Error("pull request state no longer matches the approved candidate");
  }
  const checks = state.statusCheckRollup ?? [];
  const failed = checks.filter(
    (check) =>
      !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(
        check.conclusion ?? check.state,
      ),
  );
  if ((requireChecks && checks.length === 0) || failed.length > 0) {
    throw new Error("pull request checks are not all complete and successful");
  }
}

function postDeployScript(params) {
  return `#!/bin/bash
set -euo pipefail
export PATH="\${OPENCLAW_DEPLOY_PATH:-/opt/homebrew/opt/node@22/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"
test "$(openclaw --version)" = ${JSON.stringify(params.version)}
launchctl print "gui/$(id -u)/ai.openclaw.gateway" >/dev/null
lsof -nP -iTCP:18789 -sTCP:LISTEN >/dev/null
openclaw gateway health --port 18789 >/dev/null
state="$(gh pr view ${params.prNumber} --repo ${JSON.stringify(params.repository)} --json headRefOid,baseRefOid,baseRefName,mergeable,reviewDecision,statusCheckRollup,isDraft,state)"
node - "$state" ${JSON.stringify(params.expectedHead)} ${JSON.stringify(params.expectedBase)} <<'NODE'
const [stateText, head, base] = process.argv.slice(2);
const state = JSON.parse(stateText);
const checks = state.statusCheckRollup ?? [];
const failed = checks.filter(
  (check) => !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(check.conclusion ?? check.state),
);
const openAndReady =
  state.state === "OPEN" && !state.isDraft && state.mergeable === "MERGEABLE" &&
  state.reviewDecision !== "CHANGES_REQUESTED" && checks.length > 0 && failed.length === 0;
if (state.headRefOid !== head || state.baseRefOid !== base ||
    (state.state !== "MERGED" && !openAndReady)) {
  throw new Error("pull request changed after promotion");
}
NODE
private_state="$(gh pr view ${params.privatePrNumber} --repo ${JSON.stringify(params.privateRepository)} --json number,headRefOid,baseRefOid,baseRefName,mergeable,reviewDecision,statusCheckRollup,isDraft,state)"
node - "$private_state" ${JSON.stringify(params.privateHead)} ${JSON.stringify(params.privateBase)} <<'NODE'
const [statesText, head, base] = process.argv.slice(2);
const state = JSON.parse(statesText);
const checks = state.statusCheckRollup ?? [];
const failed = checks.filter(
  (check) => !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(check.conclusion ?? check.state),
);
const openAndReady =
  state.state === "OPEN" && !state.isDraft && state.mergeable === "MERGEABLE" &&
  state.reviewDecision !== "CHANGES_REQUESTED" && checks.length > 0 && failed.length === 0;
if (state.headRefOid !== head || state.baseRefOid !== base ||
    (state.state !== "MERGED" && !openAndReady)) {
  throw new Error("private pull request changed after promotion");
}
NODE
if ! gh pr merge ${params.privatePrNumber} --repo ${JSON.stringify(params.privateRepository)} --merge --match-head-commit ${JSON.stringify(params.privateHead)}; then
  echo "    private merge command failed; reconciling exact landing" >&2
fi
private_landed="$(gh pr view ${params.privatePrNumber} --repo ${JSON.stringify(params.privateRepository)} --json state,headRefOid,baseRefName)"
private_base_name="$(node -p 'JSON.parse(process.argv[1]).baseRefName' "$private_landed")"
private_comparison="$(gh api "repos/${params.privateRepository}/compare/${params.privateHead}...\${private_base_name}" --jq .status)"
node - "$private_landed" "$private_comparison" ${JSON.stringify(params.privateHead)} <<'NODE'
const [stateText, comparison, head] = process.argv.slice(2);
const state = JSON.parse(stateText);
if (state.state !== "MERGED" || state.headRefOid !== head ||
    !["ahead", "identical"].includes(comparison)) {
  throw new Error("exact private candidate was not confirmed landed");
}
NODE
if ! gh pr merge ${params.prNumber} --repo ${JSON.stringify(params.repository)} --merge --match-head-commit ${JSON.stringify(params.expectedHead)}; then
  echo "    public merge command failed; reconciling exact landing" >&2
fi
public_landed="$(gh pr view ${params.prNumber} --repo ${JSON.stringify(params.repository)} --json state,headRefOid,baseRefName)"
public_base_name="$(node -p 'JSON.parse(process.argv[1]).baseRefName' "$public_landed")"
public_comparison="$(gh api "repos/${params.repository}/compare/${params.expectedHead}...\${public_base_name}" --jq .status)"
node - "$public_landed" "$public_comparison" ${JSON.stringify(params.expectedHead)} <<'NODE'
const [stateText, comparison, head] = process.argv.slice(2);
const state = JSON.parse(stateText);
if (state.state !== "MERGED" || state.headRefOid !== head ||
    !["ahead", "identical"].includes(comparison)) {
  throw new Error("exact public candidate was not confirmed landed");
}
NODE
`;
}

async function verifyLanded(repository, prNumber, expectedHead) {
  const merged = JSON.parse(
    await run(
      "gh",
      [
        "pr",
        "view",
        prNumber,
        "--repo",
        repository,
        "--json",
        "state,headRefOid,baseRefName",
      ],
      { capture: true },
    ),
  );
  if (merged.state !== "MERGED" || merged.headRefOid !== expectedHead) {
    return false;
  }
  const comparison = (
    await run(
      "gh",
      [
        "api",
        `repos/${repository}/compare/${expectedHead}...${merged.baseRefName}`,
        "--jq",
        ".status",
      ],
      { capture: true },
    )
  ).trim();
  if (!["ahead", "identical"].includes(comparison)) {
    throw new Error("exact candidate is not present on the default branch");
  }
  return true;
}

function validatedStage(runDir, name, allowIncomplete = false) {
  const path = stagePath(runDir, name);
  if (!existsSync(path)) {
    return undefined;
  }
  const state = readJson(path);
  if (allowIncomplete && state.status !== "passed") {
    return undefined;
  }
  if (
    !stageCanResume(state, {
      inputs: state.inputs,
      argv: state.argv,
    })
  ) {
    throw new Error(`${name} stage evidence no longer validates`);
  }
  return state;
}

function validatedDeploymentChain(
  runDir,
  pins,
  deploymentStageName = "deploy-validate",
) {
  const publicStage = validatedStage(runDir, "public-validation", true);
  const applyStage = validatedStage(runDir, "private-apply", true);
  const validationStage = validatedStage(runDir, "combined-validation", true);
  const packageStage = validatedStage(runDir, "package", true);
  const deploymentStage = validatedStage(runDir, deploymentStageName, true);
  if (
    !publicStage ||
    !applyStage ||
    !validationStage ||
    !packageStage ||
    !deploymentStage
  ) {
    return undefined;
  }
  const productionStage = validationStage.result.productionStage;
  if (
    typeof productionStage?.path !== "string" ||
    !/^[0-9a-f]{64}$/.test(productionStage?.sha256 ?? "") ||
    directoryTreeSha256(productionStage.path) !== productionStage.sha256
  ) {
    throw new Error("retained production stage changed after validation");
  }
  if (
    publicStage.inputs.publicHead !== pins.publicHead ||
    publicStage.inputs.manifestSha256 !== sha256File(patchManifestPath) ||
    publicStage.inputs.openclawRef !== patchManifest.openclawRef ||
    applyStage.inputs.publicTreeSha256 !== publicStage.result.treeSha256 ||
    applyStage.inputs.privateHead !== pins.privateHead ||
    applyStage.inputs.privateTree !== pins.privateTree ||
    validationStage.inputs.combinedTreeSha256 !== applyStage.result.treeSha256 ||
    validationStage.inputs.privateHead !== pins.privateHead ||
    validationStage.inputs.privateTree !== pins.privateTree ||
    packageStage.inputs.combinedTreeSha256 !== validationStage.result.treeSha256 ||
    packageStage.inputs.productionStagePath !== productionStage.path ||
    packageStage.inputs.productionStageSha256 !== productionStage.sha256 ||
    deploymentStage.inputs.artifactSha256 !== packageStage.result.artifactSha256 ||
    deploymentStage.inputs.publicHead !== pins.publicHead ||
    deploymentStage.inputs.expectedBase !== pins.expectedBase ||
    deploymentStage.inputs.privateHead !== pins.privateHead ||
    deploymentStage.inputs.privateTree !== pins.privateTree
  ) {
    throw new Error("completed release stage inputs no longer form the pinned chain");
  }
  const production = readJson(join(runDir, "production.json"));
  const deployment = readJson(join(runDir, "deployment.json"));
  if (
    production.status !== "passed" ||
    production.public?.repository !== pins.publicRepository ||
    production.public?.head !== pins.publicHead ||
    production.public?.base !== pins.expectedBase ||
    production.public?.prNumber !== pins.publicPrNumber ||
    production.private?.repository !== pins.privateRepository ||
    production.private?.head !== pins.privateHead ||
    production.private?.base !== pins.privateBase ||
    production.private?.prNumber !== pins.privatePrNumber ||
    production.private?.tree !== pins.privateTree ||
    production.candidate?.productionStageSha256 !==
      packageStage.inputs.productionStageSha256 ||
    production.artifact?.sha256 !== packageStage.result.artifactSha256 ||
    deployment.status !== "passed" ||
    deployment.artifactSha256 !== packageStage.result.artifactSha256 ||
    JSON.stringify(deployment.public) !== JSON.stringify(production.public) ||
    JSON.stringify(deployment.private) !== JSON.stringify(production.private) ||
    JSON.stringify(deployment.candidate) !== JSON.stringify(production.candidate) ||
    JSON.stringify(deployment.artifact) !== JSON.stringify(production.artifact) ||
    JSON.stringify(deployment.landing) !== JSON.stringify(production.landing)
  ) {
    throw new Error("completed production receipts no longer match the pinned release");
  }
  return { packageStage };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const source = realpathSync(resolve(options.source));
  const runDir = resolveExternalRunDirectory(options["run-dir"], [
    repoRoot,
    source,
  ]);
  const privatePipeline = process.env.PUDDLES_PRIVATE_PIPELINE;
  if (!privatePipeline) {
    throw new Error("PUDDLES_PRIVATE_PIPELINE is required");
  }
  const resolvedPrivatePipeline = realpathSync(resolve(privatePipeline));
  const publicHead = options["public-head"];
  const privateHead = options["expected-private-head"];
  const expectedBase = options["expected-base-head"];
  const repository = options["public-repository"];
  const privateRepository = options["private-repository"];
  const prNumber = options["pr-number"];
  const targetHost = options["target-host"] ?? "";
  const releaseToolingHead = options["release-tooling-head"] ?? "";
  const deploymentAttemptSuffix = releaseToolingHead
    ? `-${releaseToolingHead.slice(0, 12)}`
    : "";
  const deploymentStageName = `deploy-validate${deploymentAttemptSuffix}`;
  const featureStageOptions = {
    immutable: true,
    preservePassedProducer: Boolean(releaseToolingHead),
  };
  const privateCheckout = await assertPrivatePipelineCheckout(
    resolvedPrivatePipeline,
    privateRepository,
    privateHead,
  );
  mkdirSync(join(runDir, "stages"), { recursive: true, mode: 0o700 });
  mkdirSync(join(runDir, "artifacts"), { recursive: true, mode: 0o700 });
  const privateReceiptDir = resolveExternalRunDirectory(`${runDir}.private`, [
    repoRoot,
    source,
    runDir,
  ]);
  const runMetadataPath = join(runDir, "run.json");
  let existingRun;
  if (existsSync(runMetadataPath)) {
    existingRun = readJson(runMetadataPath);
  }
  if (!existingRun) {
    await assertPublicCheckout(publicHead, releaseToolingHead);
    const privatePreflight = await privatePullRequestState(
      privateRepository,
      privateHead,
    );
    await assertPrivatePullRequestReady(
      privateRepository,
      privatePreflight,
      privateHead,
      privatePreflight.baseRefOid,
    );
    existingRun = {
      schemaVersion: 1,
      runId: createRunId(),
      createdAt: new Date().toISOString(),
      public: {
        repository,
        head: publicHead,
        base: expectedBase,
        prNumber: Number(prNumber),
      },
      private: {
        repository: privateRepository,
        head: privateHead,
        base: privatePreflight.baseRefOid,
        prNumber: privatePreflight.number,
        tree: privateCheckout.tree,
      },
      openclaw: { ref: patchManifest.openclawRef },
    };
    atomicWriteJson(runMetadataPath, {
      ...existingRun,
    });
  }
  if (
    existingRun.public?.repository !== repository ||
    existingRun.public?.head !== publicHead ||
    existingRun.public?.base !== expectedBase ||
    existingRun.public?.prNumber !== Number(prNumber) ||
    existingRun.private?.repository !== privateRepository ||
    existingRun.private?.head !== privateHead ||
    existingRun.private?.tree !== privateCheckout.tree ||
    existingRun.openclaw?.ref !== patchManifest.openclawRef
  ) {
    throw new Error("release run metadata does not match the requested pins");
  }
  const privateBase = existingRun.private.base;
  const privatePrNumber = existingRun.private.prNumber;
  assertGitSha(privateBase, "private base head");
  if (!Number.isInteger(privatePrNumber) || privatePrNumber < 1) {
    throw new Error("private pull request number is invalid");
  }

  const pins = {
    publicRepository: repository,
    publicPrNumber: Number(prNumber),
    publicHead,
    expectedBase,
    privateRepository,
    privatePrNumber,
    privateHead,
    privateBase,
    privateTree: privateCheckout.tree,
  };
  const completedDeployment = validatedDeploymentChain(
    runDir,
    pins,
    deploymentStageName,
  );
  if (completedDeployment) {
    const landingInputs = {
      publicHead,
      expectedBase,
      artifactSha256: completedDeployment.packageStage.result.artifactSha256,
    };
    const landingArgv = ["verify-landed", repository, prNumber, publicHead];
    let landingStage = validatedStage(runDir, "land", true);
    if (
      !landingStage &&
      (await verifyLanded(privateRepository, privatePrNumber, privateHead)) &&
      (await verifyLanded(repository, prNumber, publicHead))
    ) {
      const landingReceipt = join(runDir, "landing.json");
      await runStage(runDir, "land", landingInputs, landingArgv, async () => {
        atomicWriteJson(landingReceipt, {
          schemaVersion: 1,
          stage: "landing",
          status: "passed",
          public: { repository, head: publicHead, base: expectedBase },
          artifact: {
            sha256: completedDeployment.packageStage.result.artifactSha256,
          },
          completedAt: new Date().toISOString(),
        });
        return {
          result: { summary: "exact PR head landing reconciled" },
          outputPaths: [landingReceipt],
        };
      });
      landingStage = validatedStage(runDir, "land");
    }
    if (
      landingStage &&
      JSON.stringify(landingStage.inputs) === JSON.stringify(landingInputs) &&
      JSON.stringify(landingStage.argv) === JSON.stringify(landingArgv)
    ) {
      console.log("==> reconciled completed production release");
      return;
    }
  }

  await assertPublicCheckout(publicHead, releaseToolingHead);
  const preflight = await pullRequestState(repository, prNumber);
  if (preflight.state === "MERGED") {
    if (
      !existsSync(join(runDir, "deployment.json")) ||
      !(await verifyLanded(repository, prNumber, publicHead))
    ) {
      throw new Error("merged public pull request has no matching deployment evidence");
    }
  } else {
    assertPullRequestReady(preflight, publicHead, expectedBase);
  }
  const privatePreflight = await privatePullRequestState(
    privateRepository,
    privateHead,
  );
  await assertPrivatePullRequestReady(
    privateRepository,
    privatePreflight,
    privateHead,
    privateBase,
  );

  const candidate = join(runDir, "candidate");
  const publicReceipt = join(runDir, "public.json");
  const publicResult = await runStage(
    runDir,
    "public-validation",
    {
      publicHead,
      manifestSha256: sha256File(patchManifestPath),
      openclawRef: patchManifest.openclawRef,
    },
    ["node", join(packageDir, "bin", "openclaw-test-env.mjs"), "ci"],
    async () => {
      if (existsSync(candidate)) {
        await run("git", ["-C", source, "worktree", "remove", "--force", candidate]);
      }
      if (!existsSync(candidate)) {
        await run("git", [
          "-C",
          source,
          "worktree",
          "add",
          "--detach",
          candidate,
          patchManifest.openclawRef,
        ]);
        for (const patch of patchManifest.patches) {
          await run(
            "git",
            ["apply", join(patchDir, `${patch.name}.patch`)],
            { cwd: candidate },
          );
        }
      }
      await run("node", [join(packageDir, "bin", "openclaw-test-env.mjs"), "ci"], {
        env: { ...process.env, OPENCLAW_SRC: source },
        timeoutMs: 45 * 60_000,
      });
      const version = JSON.parse(
        readFileSync(join(candidate, "package.json"), "utf8"),
      ).version;
      const treeSha256 = candidateTreeSha256(candidate);
      atomicWriteJson(publicReceipt, {
        schemaVersion: 1,
        stage: "public-validation",
        status: "passed",
        openclaw: { ref: patchManifest.openclawRef, version },
        public: {
          repository,
          head: publicHead,
          manifestSha256: sha256File(patchManifestPath),
        },
        candidate: { treeSha256 },
      });
      return {
        result: { summary: "public validation passed", treeSha256, version },
        outputPaths: [publicReceipt],
      };
    },
    featureStageOptions,
  );
  const overlayReceipt = join(runDir, "overlay.json");
  const rawOverlayReceipt = join(privateReceiptDir, "overlay.json");
  const overlayResult = await runStage(
    runDir,
    "private-apply",
    {
      publicTreeSha256: publicResult.treeSha256,
      privateHead,
      privateTree: privateCheckout.tree,
    },
    [
      resolvedPrivatePipeline,
      "apply",
      "--source",
      candidate,
      "--public-result",
      publicReceipt,
      "--output",
      rawOverlayReceipt,
      "--expected-private-head",
      privateHead,
    ],
    async () => {
      await assertPrivatePipelineCheckout(
        resolvedPrivatePipeline,
        privateRepository,
        privateHead,
        privateCheckout.tree,
      );
      await run("git", ["reset", "--hard", "HEAD"], { cwd: candidate });
      await run("git", ["clean", "-fdx"], { cwd: candidate });
      for (const patch of patchManifest.patches) {
        await run("git", ["apply", join(patchDir, `${patch.name}.patch`)], {
          cwd: candidate,
        });
      }
      await run(resolvedPrivatePipeline, [
        "apply",
        "--source",
        candidate,
        "--public-result",
        publicReceipt,
        "--output",
        rawOverlayReceipt,
        "--expected-private-head",
        privateHead,
      ]);
      const treeSha256 = candidateTreeSha256(candidate);
      const receipt = readJson(rawOverlayReceipt);
      validateOverlayReceipt(receipt, privateHead, treeSha256, "private apply");
      atomicWriteJson(
        overlayReceipt,
        sanitizedOverlayReceipt(receipt, "private-apply", privateRepository),
      );
      return {
        result: { summary: "private overlay applied", treeSha256 },
        outputPaths: [overlayReceipt],
      };
    },
    featureStageOptions,
  );
  if (
    !releaseToolingHead &&
    candidateTreeSha256(candidate) !== overlayResult.treeSha256
  ) {
    throw new Error("combined candidate changed after private apply");
  }

  const validationReceipt = join(runDir, "validation.json");
  const rawValidationReceipt = join(privateReceiptDir, "validation.json");
  const validationResult = await runStage(
    runDir,
    "combined-validation",
    {
      combinedTreeSha256: overlayResult.treeSha256,
      privateHead,
      privateTree: privateCheckout.tree,
    },
    [
      resolvedPrivatePipeline,
      "validate",
      "--source",
      candidate,
      "--public-result",
      publicReceipt,
      "--overlay-result",
      rawOverlayReceipt,
      "--output",
      rawValidationReceipt,
      "--expected-private-head",
      privateHead,
    ],
    async () => {
      await assertPrivatePipelineCheckout(
        resolvedPrivatePipeline,
        privateRepository,
        privateHead,
        privateCheckout.tree,
      );
      await run(resolvedPrivatePipeline, [
        "validate",
        "--source",
        candidate,
        "--public-result",
        publicReceipt,
        "--overlay-result",
        rawOverlayReceipt,
        "--output",
        rawValidationReceipt,
        "--expected-private-head",
        privateHead,
      ]);
      const treeSha256 = candidateTreeSha256(candidate);
      if (treeSha256 !== overlayResult.treeSha256) {
        throw new Error("combined validation changed the candidate");
      }
      validateOverlayReceipt(
        readJson(rawValidationReceipt),
        privateHead,
        treeSha256,
        "combined validation",
      );
      const rawReceipt = readJson(rawValidationReceipt);
      const productionStage = validatedProductionStage(
        rawReceipt,
        rawValidationReceipt,
        privateReceiptDir,
        candidate,
      );
      atomicWriteJson(
        validationReceipt,
        sanitizedOverlayReceipt(
          rawReceipt,
          "combined-validation",
          privateRepository,
          productionStage,
        ),
      );
      return {
        result: {
          summary: "combined validation passed",
          treeSha256,
          productionStage,
        },
        outputPaths: [validationReceipt],
      };
    },
    featureStageOptions,
  );
  if (
    !releaseToolingHead &&
    candidateTreeSha256(candidate) !== validationResult.treeSha256
  ) {
    throw new Error("combined candidate changed after validation");
  }

  const artifactReceipt = join(runDir, "package.json");
  const productionStage = validationResult.productionStage;
  if (
    !productionStage ||
    directoryTreeSha256(productionStage.path) !== productionStage.sha256
  ) {
    throw new Error("retained production stage changed before packaging");
  }
  const packageInputs = {
    combinedTreeSha256: overlayResult.treeSha256,
    productionStagePath: productionStage.path,
    productionStageSha256: productionStage.sha256,
  };
  const packageArgv = [
    "corepack",
    "pnpm",
    "pack",
    "--config.ignore-scripts=true",
    "--pack-destination",
    join(runDir, "artifacts"),
  ];
  const currentPackageStage = validatedStage(runDir, "package", true);
  if (!currentPackageStage && existsSync(artifactReceipt)) {
    const receipt = readJson(artifactReceipt);
    if (
      receipt.schemaVersion !== 1 ||
      receipt.stage !== "package" ||
      receipt.status !== "passed" ||
      receipt.candidate?.treeSha256 !== overlayResult.treeSha256 ||
      receipt.candidate?.productionStage?.path !== productionStage.path ||
      receipt.candidate?.productionStage?.sha256 !== productionStage.sha256 ||
      directoryTreeSha256(productionStage.path) !== productionStage.sha256 ||
      typeof receipt.artifact?.path !== "string" ||
      !/^[0-9a-f]{64}$/.test(receipt.artifact?.sha256 ?? "") ||
      !existsSync(receipt.artifact.path) ||
      sha256File(receipt.artifact.path) !== receipt.artifact.sha256
    ) {
      throw new Error("package receipt cannot reconcile the immutable stage");
    }
    reconcilePassedStage(
      runDir,
      "package",
      packageInputs,
      packageArgv,
      {
        summary: "immutable package reconciled",
        artifact: receipt.artifact.path,
        artifactSha256: receipt.artifact.sha256,
      },
      [artifactReceipt, receipt.artifact.path],
    );
  }
  const packageResult = await runStage(
    runDir,
    "package",
    packageInputs,
    packageArgv,
    async () => {
      if (directoryTreeSha256(productionStage.path) !== productionStage.sha256) {
        throw new Error("retained production stage changed before packaging");
      }
      const packed = (
        await run(
          "corepack",
          [
            "pnpm",
            "pack",
            "--config.ignore-scripts=true",
            "--pack-destination",
            join(runDir, "artifacts"),
          ],
          {
            cwd: productionStage.path,
            capture: true,
            timeoutMs: 10 * 60_000,
          },
        )
      )
        .trim()
        .split("\n")
        .at(-1);
      const artifact = resolve(
        packed.startsWith("/") ? packed : join(runDir, "artifacts", packed),
      );
      const artifactSha256 = sha256File(artifact);
      if (directoryTreeSha256(productionStage.path) !== productionStage.sha256) {
        throw new Error("retained production stage changed during packaging");
      }
      atomicWriteJson(artifactReceipt, {
        schemaVersion: 1,
        stage: "package",
        status: "passed",
        candidate: {
          treeSha256: overlayResult.treeSha256,
          productionStage,
        },
        artifact: { path: artifact, sha256: artifactSha256 },
      });
      return {
        result: {
          summary: "immutable package created",
          artifact,
          artifactSha256,
        },
        outputPaths: [artifactReceipt, artifact],
      };
    },
    featureStageOptions,
  );
  if (sha256File(packageResult.artifact) !== packageResult.artifactSha256) {
    throw new Error("immutable artifact changed after packaging");
  }

  const productionReceipt = join(runDir, "production.json");
  const postCheck = join(runDir, "post-deploy-check.sh");
  const releaseMetadata = {
    schemaVersion: 1,
    stage: "production",
    status: "passed",
    public: {
      repository,
      head: publicHead,
      base: expectedBase,
      prNumber: Number(prNumber),
    },
    private: {
      repository: privateRepository,
      head: privateHead,
      base: privateBase,
      prNumber: privatePrNumber,
      tree: privateCheckout.tree,
    },
    candidate: {
      treeSha256: overlayResult.treeSha256,
      productionStageSha256: productionStage.sha256,
    },
    artifact: { sha256: packageResult.artifactSha256 },
    landing: {
      order: ["private", "public"],
      privateConfirmed: true,
      publicConfirmed: true,
    },
  };
  writeFileSync(
    postCheck,
    postDeployScript({
      version: publicResult.version,
      repository,
      prNumber,
      expectedHead: publicHead,
      expectedBase,
      privateRepository,
      privateHead,
      privateBase,
      privatePrNumber,
    }),
    { mode: 0o700 },
  );
  chmodSync(postCheck, 0o700);

  const deploymentReceipt = join(
    runDir,
    `deployment${deploymentAttemptSuffix}.json`,
  );
  const deploymentInputs = {
    artifactSha256: packageResult.artifactSha256,
    publicHead,
    expectedBase,
    privateHead,
    privateTree: privateCheckout.tree,
    targetHost,
    releaseTooling: releaseToolingHead
      ? {
          head: releaseToolingHead,
          deployScriptSha256: sha256File(
            join(patchDir, "apply-and-deploy.sh"),
          ),
          releaseRunnerSha256: sha256File(
            join(packageDir, "bin", "openclaw-release.mjs"),
          ),
        }
      : undefined,
  };
  const deploymentArgv = ["bash", join(patchDir, "apply-and-deploy.sh")];
  const currentDeploymentStage = validatedStage(
    runDir,
    deploymentStageName,
    true,
  );
  if (
    !currentDeploymentStage &&
    (existsSync(deploymentReceipt) || existsSync(productionReceipt))
  ) {
    if (!existsSync(deploymentReceipt)) {
      throw new Error(
        "partial production receipts cannot reconcile immutable deployment",
      );
    }
    const deployment = readJson(deploymentReceipt);
    if (
      deployment.status !== "passed" ||
      deployment.artifactSha256 !== packageResult.artifactSha256 ||
      deployment.public?.repository !== repository ||
      deployment.public?.head !== publicHead ||
      deployment.public?.base !== expectedBase ||
      deployment.public?.prNumber !== Number(prNumber) ||
      deployment.private?.repository !== privateRepository ||
      deployment.private?.head !== privateHead ||
      deployment.private?.base !== privateBase ||
      deployment.private?.prNumber !== privatePrNumber ||
      deployment.private?.tree !== privateCheckout.tree ||
      deployment.candidate?.treeSha256 !== overlayResult.treeSha256 ||
      deployment.candidate?.productionStageSha256 !== productionStage.sha256 ||
      deployment.artifact?.sha256 !== packageResult.artifactSha256 ||
      JSON.stringify(deployment.landing?.order) !==
        JSON.stringify(["private", "public"]) ||
      deployment.landing?.privateConfirmed !== true ||
      deployment.landing?.publicConfirmed !== true
    ) {
      throw new Error(
        "deployment receipt cannot reconcile immutable production",
      );
    }
    if (!existsSync(productionReceipt)) {
      if (
        !(await verifyLanded(privateRepository, privatePrNumber, privateHead)) ||
        !(await verifyLanded(repository, prNumber, publicHead))
      ) {
        throw new Error("deployment receipt has no matching exact landing");
      }
      await run("bash", [postCheck]);
      atomicWriteJson(productionReceipt, {
        ...releaseMetadata,
        completedAt: new Date().toISOString(),
      });
    }
    const production = readJson(productionReceipt);
    if (
      production.status !== "passed" ||
      production.public?.repository !== repository ||
      production.public?.head !== publicHead ||
      production.public?.base !== expectedBase ||
      production.private?.head !== privateHead ||
      production.candidate?.treeSha256 !== overlayResult.treeSha256 ||
      production.candidate?.productionStageSha256 !== productionStage.sha256 ||
      production.artifact?.sha256 !== packageResult.artifactSha256
    ) {
      throw new Error(
        "production receipts cannot reconcile immutable deployment",
      );
    }
    reconcilePassedStage(
      runDir,
      deploymentStageName,
      deploymentInputs,
      deploymentArgv,
      { summary: "production validation reconciled" },
      [deploymentReceipt, productionReceipt],
    );
  }
  await runStage(
    runDir,
    deploymentStageName,
    deploymentInputs,
    deploymentArgv,
    async () => {
      const browserEntrypoint = join(
        productionStage.path,
        "scripts",
        "sandbox-browser-entrypoint.sh",
      );
      await run("bash", [join(patchDir, "apply-and-deploy.sh")], {
        env: {
          ...process.env,
          OPENCLAW_ARTIFACT: packageResult.artifact,
          OPENCLAW_ARTIFACT_SHA256: packageResult.artifactSha256,
          OPENCLAW_BROWSER_ENTRYPOINT: existsSync(browserEntrypoint)
            ? browserEntrypoint
            : "",
          OPENCLAW_POST_DEPLOY_CHECK: postCheck,
          OPENCLAW_TARGET_RESULT: deploymentReceipt,
          OPENCLAW_RELEASE_METADATA: JSON.stringify(releaseMetadata),
          MINI_HOST: targetHost,
        },
        timeoutMs: 45 * 60_000,
      });
      const deployment = readJson(deploymentReceipt);
      if (
        deployment.status !== "passed" ||
        deployment.artifactSha256 !== packageResult.artifactSha256
      ) {
        throw new Error("deployment receipt does not match the immutable artifact");
      }
      if (!existsSync(productionReceipt)) {
        atomicWriteJson(productionReceipt, {
          ...releaseMetadata,
          completedAt: new Date().toISOString(),
        });
      }
      return {
        result: { summary: "production validated" },
        outputPaths: [deploymentReceipt, productionReceipt],
      };
    },
    { immutable: true },
  );

  const landingReceipt = join(runDir, "landing.json");
  await runStage(
    runDir,
    "land",
    { publicHead, expectedBase, artifactSha256: packageResult.artifactSha256 },
    ["verify-landed", repository, prNumber, publicHead],
    async () => {
      if (!(await verifyLanded(privateRepository, privatePrNumber, privateHead))) {
        throw new Error("exact private candidate was not confirmed landed");
      }
      if (!(await verifyLanded(repository, prNumber, publicHead))) {
        throw new Error("exact candidate was not confirmed landed");
      }
      atomicWriteJson(landingReceipt, {
        schemaVersion: 1,
        stage: "landing",
        status: "passed",
        public: { repository, head: publicHead, base: expectedBase },
        artifact: { sha256: packageResult.artifactSha256 },
        completedAt: new Date().toISOString(),
      });
      return {
        result: { summary: "exact PR head landed" },
        outputPaths: [landingReceipt],
      };
    },
    { immutable: true },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
