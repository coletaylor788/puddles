import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { acquireArtifactPoolLock, applyArtifactCleanup, artifactPoolRunId, initializeArtifactPool, protectRunArtifacts, registerDiagnosticLogs } from "./native-retention.mjs";
import { randomUUID } from "node:crypto";
import { atomicJson, fileDigest, inside, jsonDigest } from "./native-state.mjs";
import { importReleaseBundle, verifySourceGate } from "./native-release.mjs";
import {
  assertTerminalNativeStorage, initializeStorage, registerScratch, sealScratch, applyStorageCleanup,
} from "./native-storage.mjs";

export function retainCompletedOperationLog(root, log, owner, poolPath) {
  root = realpathSync(root);
  if (!/^logs\/[a-zA-Z0-9._-]+\.log$/.test(log)) throw new Error("Invalid operation log path");
  const source = join(root, log);
  if (!lstatSync(source).isFile() || realpathSync(source) !== source) throw new Error("Operation log must be a regular owned file");
  const digest = fileDigest(source);
  const staging = join(root, `.log-archive-${randomUUID()}`);
  const pool = poolPath ?? join(root, "draft-controller/log-pool");
  initializeArtifactPool(pool);
  mkdirSync(join(staging, "logs"), { recursive: true, mode: 0o700 });
  try {
    copyFileSync(source, join(staging, "logs/operation.log"));
    const release = acquireArtifactPoolLock(pool);
    let logs;
    try {
      logs = registerDiagnosticLogs(pool, staging);
      const id = artifactPoolRunId(staging);
      protectRunArtifacts(pool, { id, kind: "paused", objectIds: [logs.id] });
      // Operation completion is not feature completion. Keep diagnostics in
      // this task's local pool until the whole task closes.
      applyArtifactCleanup(pool);
    } finally { release(); }
    if (fileDigest(source) !== digest) throw new Error("Operation log changed during archival");
    const reference = { pool, objectId: logs.id, sha256: digest };
    atomicJson(`${source}.reference.json`, reference);
    rmSync(source);
    return reference;
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

function retainBuildLogs(root) {
  if (!existsSync(join(root, "logs")) || !process.env.E2E_ARTIFACT_POOL) return [];
  const pool = process.env.E2E_ARTIFACT_POOL;
  const release = acquireArtifactPoolLock(pool);
  try {
    const logs = registerDiagnosticLogs(pool, root);
    if (!logs) return [];
    protectRunArtifacts(pool, { id: artifactPoolRunId(root), kind: "paused", objectIds: [logs.id] });
    atomicJson(join(root, "logs-reference.json"), { pool, id: logs.id, assets: logs.assets });
    return ["logs"];
  } finally { release(); }
}

// Only outer controllers know that every consumer has finished. The native build
// command itself cannot retire outputs that export/certification still needs.
export function finalizeScratch(root, owner, paths, evidence) {
  root = realpathSync(root);
  const record = initializeStorage(root, owner);
  for (const path of paths) {
    const previous = record.entries.findLast(entry => entry.path === path && !["removed", "superseded"].includes(entry.status));
    if (!previous && !existsSync(join(root, path))) continue;
    const entry = previous ?? registerScratch(root, owner, {
      id: `scratch-${randomUUID()}`, path, evidence, purpose: "Completed controller scratch",
    });
    if (entry.status === "active") sealScratch(root, owner, entry.id);
  }
  return applyStorageCleanup(root, owner);
}

export async function finalizeNativeBuild(root, owner, bundle, expectedDigest) {
  root = realpathSync(root);
  assertTerminalNativeStorage(root);
  if (!/^[a-f0-9]{64}$/.test(expectedDigest ?? "") || fileDigest(bundle) !== expectedDigest) {
    throw new Error("Finalization requires the acknowledged bundle digest");
  }
  for (const path of ["context", "installed", "installed-additional", "artifacts", "source"]) {
    if (inside(join(root, path), realpathSync(bundle))) throw new Error("Bundle must live outside disposable build output");
  }
  const status = JSON.parse(readFileSync(join(root, "run-status.json"), "utf8"));
  if (status.status !== "passed") throw new Error("Only a passed builder can finalize a portable handoff");
  const verification = join(root, `storage-verify-${randomUUID()}`);
  let buildId;
  try {
    const { receipt } = await importReleaseBundle(bundle, verification);
    const original = JSON.parse(readFileSync(join(root, "build.json"), "utf8"));
    if (receipt.buildId !== original.buildId) throw new Error("Retained bundle belongs to another build");
    verifySourceGate(JSON.parse(readFileSync(join(root, "source-gate.json"), "utf8")), receipt.buildId);
    buildId = receipt.buildId;
  } finally { rmSync(verification, { recursive: true, force: true }); }
  mkdirSync(join(root, "evidence"), { recursive: true, mode: 0o700 });
  atomicJson(join(root, "evidence", "handoff.json"), {
    bundle: realpathSync(bundle), sha256: expectedDigest, buildId,
    verifiedAt: new Date().toISOString(), consumerAcknowledged: true,
  });
  // Preserve the source checkout and compact stage records. Retiring the Git
  // worktree is a separate supported operation after unique source is accounted for.
  const logs = retainBuildLogs(root);
  return finalizeScratch(root, owner, [
    ...logs, "context", "installed", "installed-additional", "artifacts",
    "source/node_modules", "source/dist",
  ], ["build.json", "source-gate.json", "stages", "evidence/handoff.json", ...(logs.length ? ["logs-reference.json"] : [])]);
}


export function finalizeFailedNativeBuild(root, owner, buildRoot) {
  root = realpathSync(root);
  buildRoot = realpathSync(buildRoot);
  assertTerminalNativeStorage(buildRoot);
  if (root === buildRoot || !inside(root, buildRoot)) throw new Error("Failed builder must be a strict child of its task storage root");
  const status = JSON.parse(readFileSync(join(buildRoot, "run-status.json"), "utf8"));
  if (status.status !== "failed") throw new Error("Failed builder lacks terminal failure evidence");
  const record = initializeStorage(root, owner);
  const group = `failure-${jsonDigest(buildRoot).slice(0, 32)}`;
  const logs = retainBuildLogs(buildRoot);
  const evidence = ["run-status.json", "stages", ...(logs.length ? ["logs-reference.json"] : [])].filter(name => existsSync(join(buildRoot, name)))
    .map(name => relative(root, join(buildRoot, name)));
  for (const name of [...logs, "context", "artifacts", "installed", "installed-additional", "source/node_modules", "source/dist"]) {
    const path = relative(root, join(buildRoot, name));
    if (!existsSync(join(root, path))) continue;
    const prior = record.entries.findLast(entry => entry.path === path && !["removed", "superseded"].includes(entry.status));
    const entry = prior ?? registerScratch(root, owner, {
      id: `scratch-${randomUUID()}`, group, kind: "failed", path, evidence,
      purpose: "Terminal local builder failure; source and compact reproduction remain",
    });
    if (entry.status === "active") sealScratch(root, owner, entry.id);
  }
  return applyStorageCleanup(root, owner);
}
