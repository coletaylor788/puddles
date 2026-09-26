import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, rmSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { atomicJson, fileDigest, inside, jsonDigest, treeDigest } from "./native-state.mjs";
import { runCommand } from "./process-runner.mjs";
import {
  acquireArtifactPoolLock,
  applyArtifactCleanup,
  registerImportedBuild,
} from "./native-retention.mjs";

const buildSchema = "puddles.openclaw-build/v1";
const bundleSchema = "puddles.openclaw-bundle/v1";
const sourceGateSchema = "puddles.openclaw-source-gate/v1";
const targetProofSchema = "puddles.openclaw-target-proof/v1";
const certificationSchema = "puddles.openclaw-certification/v1";
const releaseSchema = "puddles.openclaw-release/v1";

function artifactIdentity(artifact) {
  if (!artifact || artifact.schemaVersion !== 1 ||
      !["sha256", "runtimeSha256"].every((key) => /^[a-f0-9]{64}$/.test(artifact[key])) ||
      !["platform", "arch", "node"].every((key) => typeof artifact[key] === "string" && artifact[key])) {
    throw new Error("Invalid release artifact identity");
  }
  return Object.fromEntries(
    ["schemaVersion", "sha256", "runtimeSha256", "platform", "arch", "node"].map((key) => [key, artifact[key]]),
  );
}

function provenanceIdentity(provenance) {
  if (!provenance) return null;
  if (provenance.schema !== "puddles.openclaw-provider-artifact/v1" ||
      !["sha256", "sourceSha256", "buildInputsSha256", "buildCommandSha256"].every(
        (key) => /^[a-f0-9]{64}$/.test(provenance[key]),
      ) ||
      !/^[a-f0-9]{40}$/.test(provenance.publicHead)) {
    throw new Error("Invalid release provenance identity");
  }
  return Object.fromEntries(
    ["schema", "sha256", "publicHead", "sourceSha256", "buildInputsSha256", "buildCommandSha256"]
      .map((key) => [key, provenance[key]]),
  );
}

function preparedIdentity(record) {
  if (!record || !/^[a-z][a-z0-9-]*$/.test(record.id) ||
      !["file", "directory"].includes(record.type) ||
      !/^[a-f0-9]{64}$/.test(record.sha256)) {
    throw new Error("Invalid prepared release identity");
  }
  return { id: record.id, type: record.type, sha256: record.sha256 };
}

function extraIdentity(record) {
  if (!record || !/^[a-z][a-z0-9-]*$/.test(record.id)) {
    throw new Error("Invalid additional release artifact id");
  }
  const identity = {
    id: record.id,
    artifact: artifactIdentity(record.artifact),
    ...(record.provenance ? { provenance: provenanceIdentity(record.provenance) } : {}),
  };
  if (record.attestation) {
    if (record.attestation.schema !== "puddles.openclaw-extension-artifact/v1" ||
        !["sourceSha256", "packageInputsSha256", "toolchainSha256", "artifactSha256", "runtimeSha256"]
          .every((key) => /^[a-f0-9]{64}$/.test(record.attestation[key] ?? "")) ||
        record.attestation.artifactSha256 !== identity.artifact.sha256 ||
        record.attestation.runtimeSha256 !== identity.artifact.runtimeSha256) {
      throw new Error("Invalid extension artifact attestation");
    }
    identity.attestation = record.attestation;
  }
  return identity;
}

function buildIdentity(receipt) {
  return {
    source: receipt.source,
    tools: receipt.tools,
    artifact: artifactIdentity(receipt.artifact),
    additionalArtifacts: (receipt.additionalArtifacts ?? []).map(extraIdentity),
    preparedFiles: (receipt.preparedFiles ?? []).map(preparedIdentity),
    proofs: receipt.proofs,
    stateMigration: receipt.stateMigration ?? null,
  };
}

export function createBuildReceipt(value) {
  const receipt = {
    schema: buildSchema,
    schemaVersion: 1,
    eligibility: "built-not-certified",
    ...value,
  };
  receipt.buildId = jsonDigest(buildIdentity(receipt));
  verifyBuildReceipt(receipt);
  return receipt;
}

export function verifyBuildReceipt(receipt, { verifyAssets = true } = {}) {
  if (!receipt || receipt.schema !== buildSchema || receipt.schemaVersion !== 1 ||
      receipt.eligibility !== "built-not-certified" ||
      !/^[a-f0-9]{64}$/.test(receipt.buildId ?? "") ||
      !receipt.source || !receipt.tools || !receipt.proofs ||
      receipt.buildId !== jsonDigest(buildIdentity(receipt))) {
    throw new Error("Invalid immutable build receipt");
  }
  const ids = (receipt.additionalArtifacts ?? []).map((record) => extraIdentity(record).id);
  const preparedIds = (receipt.preparedFiles ?? []).map((record) => preparedIdentity(record).id);
  if (new Set(ids).size !== ids.length || new Set(preparedIds).size !== preparedIds.length) {
    throw new Error("Duplicate release asset id");
  }
  if (verifyAssets) {
    for (const artifact of [receipt.artifact, ...(receipt.additionalArtifacts ?? []).map((record) => record.artifact)]) {
      if (!isAbsolute(artifact.path) || !existsSync(artifact.path) ||
          fileDigest(artifact.path) !== artifact.sha256) {
        throw new Error("Release archive differs from build receipt");
      }
    }
    for (const record of receipt.additionalArtifacts ?? []) {
      if (record.provenance && (!isAbsolute(record.provenance.path) ||
          !existsSync(record.provenance.path) ||
          fileDigest(record.provenance.path) !== record.provenance.sha256)) {
        throw new Error("Release provenance differs from build receipt");
      }
    }
    for (const record of receipt.preparedFiles ?? []) {
      if (!isAbsolute(record.path) || !existsSync(record.path)) {
        throw new Error("Prepared release asset is missing");
      }
      const stat = lstatSync(record.path);
      if (stat.isSymbolicLink() ||
          record.type === "file" && !stat.isFile() ||
          record.type === "directory" && !stat.isDirectory()) {
        throw new Error("Prepared release asset type differs");
      }
      const digest = record.type === "file"
        ? fileDigest(record.path)
        : treeDigest(record.path, { portable: true });
      if (digest !== record.sha256) throw new Error("Prepared release asset differs from build receipt");
    }
  }
  return receipt;
}

function copyAsset(source, destination) {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
  cpSync(source, destination, {
    recursive: lstatSync(source).isDirectory(),
    verbatimSymlinks: true,
  });
}

export async function exportReleaseBundle(receiptPath, outputPath, profile = "public", run = runCommand) {
  if (!["public", "local"].includes(profile)) throw new Error("Bundle export profile must be public or local");
  if (existsSync(outputPath)) throw new Error("Bundle output must be new");
  const receipt = verifyBuildReceipt(JSON.parse(readFileSync(receiptPath, "utf8")));
  if (profile === "public" && receipt.composition?.extensionSha256 !== "none") {
    throw new Error("Public bundle export rejects local extension composition");
  }
  const root = mkdtempSync(join(tmpdir(), "puddles-release-export-"));
  try {
    const manifest = structuredClone(receipt);
    manifest.schema = bundleSchema;
    manifest.profile = profile;
    manifest.buildSchema = buildSchema;
    manifest.artifact.path = "assets/openclaw-runtime.tar.gz";
    copyAsset(receipt.artifact.path, join(root, manifest.artifact.path));
    for (const [index, record] of (receipt.additionalArtifacts ?? []).entries()) {
      const target = `assets/additional/${record.id}.tar.gz`;
      manifest.additionalArtifacts[index].artifact.path = target;
      copyAsset(record.artifact.path, join(root, target));
      if (record.provenance) {
        const provenance = `provenance/${record.id}.json`;
        manifest.additionalArtifacts[index].provenance.path = provenance;
        copyAsset(record.provenance.path, join(root, provenance));
      }
    }
    for (const [index, record] of (receipt.preparedFiles ?? []).entries()) {
      const target = `prepared/${record.id}`;
      manifest.preparedFiles[index].path = target;
      copyAsset(record.path, join(root, target));
    }
    atomicJson(join(root, "bundle.json"), manifest);
    await run("tar", ["-czf", outputPath, "-C", root, "."]);
    return {
      schema: bundleSchema,
      schemaVersion: 1,
      profile,
      buildId: receipt.buildId,
      path: outputPath,
      sha256: fileDigest(outputPath),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function portablePath(root, value) {
  if (typeof value !== "string" || !value || isAbsolute(value) || value.split("/").includes("..")) {
    throw new Error("Invalid portable release path");
  }
  const path = resolve(root, value);
  if (!inside(root, path)) throw new Error("Portable release path escapes import root");
  return path;
}

export async function importReleaseBundle(bundlePath, destination, run = runCommand) {
  const unlock = process.env.E2E_ARTIFACT_POOL
    ? acquireArtifactPoolLock(resolve(process.env.E2E_ARTIFACT_POOL))
    : null;
  try {
  if (!isAbsolute(bundlePath) || !existsSync(bundlePath)) throw new Error("Bundle import requires an existing absolute archive");
  if (existsSync(destination)) throw new Error("Bundle import destination must be new");
  const entries = (await run("tar", ["-tzf", bundlePath], { capture: true })).split("\n").filter(Boolean);
  if (!entries.length || entries.some((entry) => {
    const normalized = entry.replace(/^\.\//, "").replace(/\/$/, "");
    return isAbsolute(normalized) || normalized.split("/").includes("..") ||
      normalized && !["bundle.json", "assets", "prepared", "provenance"].includes(normalized.split("/")[0]);
  })) {
    throw new Error("Bundle contains an invalid path");
  }
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  try {
    await run("tar", ["-xpzf", bundlePath, "-C", destination]);
    const manifestPath = join(destination, "bundle.json");
    if (!existsSync(manifestPath)) throw new Error("Bundle manifest is missing");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.schema !== bundleSchema || manifest.buildSchema !== buildSchema ||
        !["public", "local"].includes(manifest.profile)) {
      throw new Error("Invalid release bundle manifest");
    }
    const receipt = structuredClone(manifest);
    receipt.schema = buildSchema;
    delete receipt.profile;
    delete receipt.buildSchema;
    receipt.artifact.path = portablePath(destination, receipt.artifact.path);
    for (const record of receipt.additionalArtifacts ?? []) {
      record.artifact.path = portablePath(destination, record.artifact.path);
      if (record.provenance) record.provenance.path = portablePath(destination, record.provenance.path);
    }
    for (const record of receipt.preparedFiles ?? []) {
      record.path = portablePath(destination, record.path);
    }
    verifyBuildReceipt(receipt);
    const declared = new Set(["bundle.json"]);
    const declareParents = (name) => {
      const parts = name.split("/");
      for (let index = 1; index < parts.length; index++) {
        declared.add(parts.slice(0, index).join("/"));
      }
    };
    const addTree = (path, relativePath) => {
      declareParents(relativePath);
      declared.add(relativePath);
      if (lstatSync(path).isDirectory()) {
        for (const child of readdirSync(path)) addTree(join(path, child), `${relativePath}/${child}`);
      }
    };
    addTree(receipt.artifact.path, manifest.artifact.path);
    for (const [index, record] of (receipt.additionalArtifacts ?? []).entries()) {
      addTree(record.artifact.path, manifest.additionalArtifacts[index].artifact.path);
      if (record.provenance) addTree(record.provenance.path, manifest.additionalArtifacts[index].provenance.path);
    }
    for (const [index, record] of (receipt.preparedFiles ?? []).entries()) {
      addTree(record.path, manifest.preparedFiles[index].path);
    }
    const actual = new Set();
    const collect = (path, name = "") => {
      if (name) actual.add(name);
      if (lstatSync(path).isDirectory()) {
        for (const child of readdirSync(path)) collect(join(path, child), name ? `${name}/${child}` : child);
      }
    };
    collect(destination);
    if (actual.size !== declared.size || [...actual].some((name) => !declared.has(name))) {
      throw new Error("Bundle contains undeclared content");
    }
    const importedPath = join(destination, "imported-build.json");
    atomicJson(importedPath, receipt);
    if (process.env.E2E_ARTIFACT_POOL) {
      registerImportedBuild(
        resolve(process.env.E2E_ARTIFACT_POOL),
        bundlePath,
        importedPath,
        receipt.buildId,
      );
      applyArtifactCleanup(resolve(process.env.E2E_ARTIFACT_POOL));
    }
    return { receiptPath: importedPath, receipt };
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
  } finally {
    unlock?.();
  }
}

function verifyStageAttestation(attestation, schema, buildId, required) {
  if (!attestation || attestation.schema !== schema || attestation.schemaVersion !== 1 ||
      attestation.buildId !== buildId || attestation.status !== "passed" ||
      !attestation.stages || required.some((name) => !/^[a-f0-9]{64}$/.test(attestation.stages[name] ?? ""))) {
    throw new Error(`Invalid ${schema} attestation`);
  }
  return attestation;
}

function verifyTargetProof(targetProof, buildId) {
  verifyStageAttestation(
    targetProof,
    targetProofSchema,
    buildId,
    ["install", "runtime", "deployment-success", "deployment-rollback"],
  );
  const { success, rollback } = targetProof.deployment ?? {};
  for (const [record, status] of [[success, "healthy"], [rollback, "rolled-back"]]) {
    if (!record || record.status !== status ||
        !/^[a-f0-9]{64}$/.test(record.target ?? "") ||
        !/^[a-f0-9]{64}$/.test(record.artifact ?? "") ||
        !/^[a-f0-9]{64}$/.test(record.journalSha256 ?? "") ||
        typeof record.transaction !== "string" || !record.transaction) {
      throw new Error("Target proof is not derived from deployment journals");
    }
  }
  if (success.target !== rollback.target || success.artifact !== rollback.artifact ||
      targetProof.stages["deployment-success"] !== jsonDigest(success) ||
      targetProof.stages["deployment-rollback"] !== jsonDigest(rollback)) {
    throw new Error("Target proof deployment evidence differs");
  }
  return targetProof;
}

function passedStage(runDir, name) {
  const path = join(runDir, "stages", `${name}.json`);
  if (!existsSync(path)) throw new Error(`Required retained stage is missing: ${name}`);
  const record = JSON.parse(readFileSync(path, "utf8"));
  if (record.name !== name || record.status !== "passed" ||
      record.key !== jsonDigest(record.inputs)) {
    throw new Error(`Required retained stage is invalid: ${name}`);
  }
  return record;
}

export function createSourceGate(build, runDir, inventory) {
  verifyBuildReceipt(build);
  const regression = passedStage(runDir, "regressions");
  const receipt = {
    schema: sourceGateSchema,
    schemaVersion: 1,
    status: "passed",
    buildId: build.buildId,
    stages: { regressions: regression.key },
    inventory,
  };
  return verifyStageAttestation(receipt, sourceGateSchema, build.buildId, ["regressions"]);
}

function deploymentJournal(build, recoveryDir, expected) {
  const path = join(recoveryDir, "recovery.json");
  if (!existsSync(path)) throw new Error("Deployment recovery journal is missing");
  const journal = JSON.parse(readFileSync(path, "utf8"));
  if (journal.schemaVersion !== 1 || journal.status !== expected ||
      journal.artifact !== build.artifact.sha256 ||
      !/^[a-f0-9]{64}$/.test(journal.target ?? "")) {
    throw new Error("Deployment recovery journal does not match the build");
  }
  if (expected === "rolled-back" && !existsSync(join(recoveryDir, "failure.json"))) {
    throw new Error("Injected rollback journal is missing its original failure");
  }
  return {
    transaction: journal.transaction,
    target: journal.target,
    artifact: journal.artifact,
    status: journal.status,
    journalSha256: fileDigest(path),
  };
}

export function createTargetProof(build, runDir, successRecoveryDir, rollbackRecoveryDir) {
  verifyBuildReceipt(build);
  const install = passedStage(runDir, "install");
  const runtime = passedStage(runDir, "runtime");
  const success = deploymentJournal(build, successRecoveryDir, "healthy");
  const rollback = deploymentJournal(build, rollbackRecoveryDir, "rolled-back");
  if (success.target !== rollback.target) throw new Error("Deployment success and rollback used different targets");
  const receipt = {
    schema: targetProofSchema,
    schemaVersion: 1,
    status: "passed",
    buildId: build.buildId,
    stages: {
      install: install.key,
      runtime: runtime.key,
      "deployment-success": jsonDigest(success),
      "deployment-rollback": jsonDigest(rollback),
    },
    deployment: { success, rollback },
  };
  return verifyStageAttestation(receipt, targetProofSchema, build.buildId, ["install", "runtime", "deployment-success", "deployment-rollback"]);
}

export function certifyRelease(build, sourceGate, targetProof, { verifyAssets = true } = {}) {
  verifyBuildReceipt(build, { verifyAssets });
  verifyStageAttestation(sourceGate, sourceGateSchema, build.buildId, ["regressions"]);
  verifyTargetProof(targetProof, build.buildId);
  return {
    schema: certificationSchema,
    schemaVersion: 1,
    status: "passed",
    eligibility: "certified-not-production",
    buildId: build.buildId,
    sourceGateSha256: jsonDigest(sourceGate),
    targetProofSha256: jsonDigest(targetProof),
  };
}

export function promoteRelease(build, sourceGate, targetProof, certification, { verifyAssets = true } = {}) {
  const expected = certifyRelease(build, sourceGate, targetProof, { verifyAssets });
  if (jsonDigest(certification) !== jsonDigest(expected)) throw new Error("Certification differs from retained proofs");
  return {
    schema: releaseSchema,
    schemaVersion: 1,
    status: "passed",
    eligibility: "production",
    buildId: build.buildId,
    certificationSha256: jsonDigest(certification),
    repository: build.repository,
    source: build.source,
    tools: build.tools,
    artifact: build.artifact,
    additionalArtifacts: build.additionalArtifacts ?? [],
    preparedFiles: build.preparedFiles ?? [],
    stateMigration: build.stateMigration ?? null,
    evidence: { build, sourceGate, targetProof, certification },
  };
}

export function verifyProductionRelease(release, { verifyAssets = true } = {}) {
  if (!release || release.schema !== releaseSchema || release.schemaVersion !== 1 ||
      release.status !== "passed" || release.eligibility !== "production") {
    throw new Error("A production-eligible release receipt is required");
  }
  const { build, sourceGate, targetProof, certification } = release.evidence ?? {};
  const expected = promoteRelease(build, sourceGate, targetProof, certification, { verifyAssets });
  if (jsonDigest(expected) !== jsonDigest(release)) throw new Error("Production release evidence does not match");
  verifyBuildReceipt(build, { verifyAssets });
  return release;
}

export const releaseSchemas = {
  build: buildSchema,
  bundle: bundleSchema,
  sourceGate: sourceGateSchema,
  targetProof: targetProofSchema,
  certification: certificationSchema,
  release: releaseSchema,
};
