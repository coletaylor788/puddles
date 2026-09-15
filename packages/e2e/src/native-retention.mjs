import {
  closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync, statfsSync,
  statSync, writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJson, fileDigest, inside, jsonDigest, treeDigest } from "./native-state.mjs";

const poolSchema = "puddles.openclaw-artifact-pool/v1";
const objectSchema = "puddles.openclaw-retained-object/v1";
const referenceSchema = "puddles.openclaw-retained-reference/v1";
const objectKinds = new Set([
  "successful-build", "failed-reproduction", "diagnostic-log",
  "target-rehearsal", "target-proof",
]);
const referenceKinds = new Set([
  "current", "pinned", "active", "paused", "failed-debug", "deployed",
  "latest-healthy-recovery",
]);
const idPattern = /^[a-z][a-z0-9-]{0,127}$/;

function regular(path, directory = false) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return undefined;
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    throw new Error(`Retention path has an unexpected type: ${path}`);
  }
  return stat;
}

function canonicalPool(path) {
  if (!isAbsolute(path)) throw new Error("Artifact pool path must be absolute");
  const root = realpathSync(path);
  regular(root, true);
  const markerPath = join(root, "pool.json");
  regular(markerPath);
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  if (marker.schema !== poolSchema || marker.schemaVersion !== 1) {
    throw new Error("Artifact pool ownership marker is invalid");
  }
  for (const name of ["objects", "references", "trash"]) regular(join(root, name), true);
  return root;
}

export function initializeArtifactPool(path) {
  if (!isAbsolute(path)) throw new Error("Artifact pool path must be absolute");
  if (existsSync(path)) {
    if (readdirSync(path).length) return canonicalPool(path);
  } else {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  const root = realpathSync(path);
  for (const name of ["objects", "references", "trash"]) {
    mkdirSync(join(root, name), { mode: 0o700 });
  }
  atomicJson(join(root, "pool.json"), {
    schema: poolSchema,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
  });
  return root;
}

export function acquireArtifactPoolLock(poolPath) {
  const root = canonicalPool(poolPath);
  const lock = join(root, "retention-lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error("Artifact pool is locked. Confirm the recorded process stopped before recovery.");
  }
  atomicJson(join(lock, "owner.json"), {
    schemaVersion: 1,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  return () => rmSync(lock, { recursive: true });
}

function safeRelative(name) {
  if (typeof name !== "string" || !name || isAbsolute(name) ||
      name.split("/").includes("..") || name === ".") {
    throw new Error("Retained asset path must be relative");
  }
  return name;
}

function walkOwned(root) {
  let bytes = 0;
  const entries = [];
  function walk(path, name) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Retained object contains a symbolic link: ${name}`);
    if (stat.isFile()) {
      bytes += stat.size;
      entries.push([name, "file", stat.size, fileDigest(path)]);
      return;
    }
    if (!stat.isDirectory()) throw new Error(`Retained object contains an unsupported entry: ${name}`);
    entries.push([name, "directory"]);
    for (const child of readdirSync(path).sort()) walk(join(path, child), name ? `${name}/${child}` : child);
  }
  walk(root, "");
  return { bytes, entries, digest: jsonDigest(entries) };
}

function validateObject(root, path) {
  regular(path, true);
  if (!inside(join(root, "objects"), path) || dirname(path) !== join(root, "objects")) {
    throw new Error("Retained object is outside the managed object root");
  }
  const metadataPath = join(path, "ownership.json");
  if (!regular(metadataPath)) throw new Error(`Retained object ownership is missing: ${basename(path)}`);
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  if (metadata.schema !== objectSchema || metadata.schemaVersion !== 1 ||
      !idPattern.test(metadata.id ?? "") || basename(path) !== metadata.id ||
      !objectKinds.has(metadata.kind) || !Number.isFinite(Date.parse(metadata.createdAt)) ||
      !Array.isArray(metadata.assets) || !Array.isArray(metadata.dependencies) ||
      metadata.dependencies.some((id) => !idPattern.test(id)) ||
      new Set(metadata.dependencies).size !== metadata.dependencies.length) {
    throw new Error(`Retained object ownership is invalid: ${basename(path)}`);
  }
  for (const asset of metadata.assets) {
    const name = safeRelative(asset.path);
    const assetPath = resolve(path, name);
    if (!inside(path, assetPath)) throw new Error("Retained asset escapes its object");
    const stat = regular(assetPath, asset.type === "directory");
    if (!stat || !["file", "directory"].includes(asset.type) ||
        !/^[a-f0-9]{64}$/.test(asset.sha256 ?? "") ||
        !Number.isSafeInteger(asset.bytes) || asset.bytes < 0) {
      throw new Error(`Retained asset metadata is invalid: ${metadata.id}/${name}`);
    }
    const identity = asset.type === "directory"
      ? treeDigest(assetPath, { portable: true })
      : fileDigest(assetPath);
    const bytes = asset.type === "directory" ? walkOwned(assetPath).bytes : stat.size;
    if (identity !== asset.sha256 || bytes !== asset.bytes) {
      throw new Error(`Retained asset differs from ownership metadata: ${metadata.id}/${name}`);
    }
  }
  const entries = walkOwned(path).entries.map(([name]) => name);
  const allowed = new Set(["", "ownership.json"]);
  for (const asset of metadata.assets) {
    const parts = asset.path.split("/");
    for (let index = 1; index <= parts.length; index++) {
      allowed.add(parts.slice(0, index).join("/"));
    }
    if (asset.type === "directory") {
      for (const name of entries) {
        if (name.startsWith(`${asset.path}/`)) allowed.add(name);
      }
    }
  }
  if (entries.some((name) => !allowed.has(name))) {
    throw new Error(`Retained object contains undeclared content: ${metadata.id}`);
  }
  const { objectSha256, ...projection } = metadata;
  const expected = jsonDigest({
    metadata: projection,
    assets: metadata.assets.map(({ path: name, sha256, bytes, type }) => [name, type, sha256, bytes]),
  });
  if (objectSha256 !== expected) throw new Error(`Retained object digest is invalid: ${metadata.id}`);
  return { path, metadata, bytes: metadata.assets.reduce((sum, asset) => sum + asset.bytes, 0) };
}

function validateReference(root, path) {
  regular(path);
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.schema !== referenceSchema || value.schemaVersion !== 1 ||
      !idPattern.test(value.id ?? "") || basename(path) !== `${value.id}.json` ||
      !referenceKinds.has(value.kind) || !Array.isArray(value.objectIds) ||
      value.objectIds.some((id) => !idPattern.test(id)) ||
      new Set(value.objectIds).size !== value.objectIds.length) {
    throw new Error(`Retained reference is invalid: ${basename(path)}`);
  }
  return value;
}

function loadPool(root) {
  const objects = new Map();
  for (const name of readdirSync(join(root, "objects")).sort()) {
    if (!idPattern.test(name)) throw new Error(`Unregistered object entry blocks cleanup: ${name}`);
    const object = validateObject(root, join(root, "objects", name));
    objects.set(name, object);
  }
  const references = [];
  for (const name of readdirSync(join(root, "references")).sort()) {
    if (!name.endsWith(".json")) throw new Error(`Unregistered reference entry blocks cleanup: ${name}`);
    references.push(validateReference(root, join(root, "references", name)));
  }
  for (const object of objects.values()) {
    for (const dependency of object.metadata.dependencies) {
      if (!objects.has(dependency)) {
        throw new Error(`Retained dependency is missing: ${object.metadata.id} -> ${dependency}`);
      }
    }
  }
  for (const reference of references) {
    for (const id of reference.objectIds) {
      if (!objects.has(id)) throw new Error(`Retained reference target is missing: ${reference.id} -> ${id}`);
    }
  }
  return { objects, references };
}

function closure(objects, seeds) {
  const retained = new Set();
  const pending = [...seeds];
  while (pending.length) {
    const id = pending.pop();
    if (retained.has(id)) continue;
    const object = objects.get(id);
    if (!object) throw new Error(`Retained dependency is missing: ${id}`);
    retained.add(id);
    pending.push(...object.metadata.dependencies);
  }
  return retained;
}

function newest(objects, kind) {
  return [...objects.values()].filter((object) => object.metadata.kind === kind)
    .sort((a, b) => Date.parse(b.metadata.createdAt) - Date.parse(a.metadata.createdAt) ||
      a.metadata.id.localeCompare(b.metadata.id));
}

function dependencyDepth(objects, id, visiting = new Set()) {
  if (visiting.has(id)) throw new Error(`Retained dependency cycle detected: ${id}`);
  const object = objects.get(id);
  if (!object?.metadata.dependencies.length) return 0;
  const next = new Set(visiting);
  next.add(id);
  return 1 + Math.max(...object.metadata.dependencies.map((dependency) =>
    dependencyDepth(objects, dependency, next)));
}

function selectRetention(state) {
  const protectedIds = closure(
    state.objects,
    state.references.flatMap((reference) => reference.objectIds),
  );
  const retained = new Set(protectedIds);
  for (const object of newest(state.objects, "diagnostic-log")) retained.add(object.metadata.id);
  for (const [kind, count] of [["successful-build", 2], ["failed-reproduction", 1]]) {
    for (const object of newest(state.objects, kind).slice(0, count)) retained.add(object.metadata.id);
  }

  return { protectedIds, retained: closure(state.objects, retained) };
}

function disk(path) {
  const value = statfsSync(path);
  return { freeBytes: value.bavail * value.bsize, totalBytes: value.blocks * value.bsize };
}

function validateDeletion(root, object, metadataSha256) {
  const current = validateObject(root, object.path);
  if (fileDigest(join(current.path, "ownership.json")) !== metadataSha256) {
    throw new Error(`Retained ownership changed before deletion: ${current.metadata.id}`);
  }
  if (realpathSync(dirname(current.path)) !== realpathSync(join(root, "objects")) ||
      realpathSync(current.path) === realpathSync(root)) {
    throw new Error("Refusing to delete the artifact pool root or an escaped object");
  }
  walkOwned(current.path);
}

function recoverCleanup(root) {
  const journalPath = join(root, "cleanup-journal.json");
  if (!existsSync(journalPath)) return;
  regular(journalPath);
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  if (journal.schema !== "puddles.openclaw-retention-cleanup/v1" ||
      !Array.isArray(journal.entries)) throw new Error("Retention cleanup journal is invalid");
  for (const entry of journal.entries) {
    if (!idPattern.test(entry.id ?? "") || !["planned", "moved", "removed"].includes(entry.status)) {
      throw new Error("Retention cleanup journal entry is invalid");
    }
    const trash = join(root, "trash", entry.id);
    const object = join(root, "objects", entry.id);
    if (entry.status === "moved" && existsSync(trash)) {
      regular(trash, true);
      rmSync(trash, { recursive: true });
      entry.status = "removed";
      atomicJson(journalPath, journal);
    } else if (entry.status === "removed" && (existsSync(trash) || existsSync(object))) {
      throw new Error(`Retention cleanup journal disagrees with disk: ${entry.id}`);
    } else if (entry.status === "planned" && !existsSync(object)) {
      throw new Error(`Planned retention object disappeared: ${entry.id}`);
    }
  }
  if (journal.entries.every((entry) => entry.status === "removed")) rmSync(journalPath);
}

function recoverRegistrations(root) {
  const trash = join(root, "trash");
  for (const name of readdirSync(trash)) {
    if (!/^\.register-[a-f0-9-]+$/.test(name)) continue;
    const path = join(trash, name);
    const stat = regular(path, true);
    if (!stat || dirname(path) !== trash) throw new Error(`Invalid interrupted registration: ${name}`);
    walkOwned(path);
    rmSync(path, { recursive: true });
  }
}

export function planArtifactCleanup(poolPath, now = new Date()) {
  const root = canonicalPool(poolPath);
  recoverCleanup(root);
  const state = loadPool(root);
  const selection = selectRetention(state);
  const remove = [...state.objects.values()]
    .filter((object) => !selection.retained.has(object.metadata.id))
    .sort((a, b) => dependencyDepth(state.objects, b.metadata.id) -
      dependencyDepth(state.objects, a.metadata.id) ||
      Date.parse(a.metadata.createdAt) - Date.parse(b.metadata.createdAt) ||
      a.metadata.id.localeCompare(b.metadata.id))
    .map((object) => ({
      id: object.metadata.id,
      kind: object.metadata.kind,
      bytes: object.bytes,
      metadataSha256: fileDigest(join(object.path, "ownership.json")),
    }));
  const retained = [...selection.retained].map((id) => state.objects.get(id));
  return {
    schema: "puddles.openclaw-retention-plan/v1",
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    root,
    remove,
    retained: retained.map((object) => ({
      id: object.metadata.id,
      kind: object.metadata.kind,
      bytes: object.bytes,
      protected: selection.protectedIds.has(object.metadata.id),
    })),
    summary: {
      removableObjects: remove.length,
      removableBytes: remove.reduce((sum, object) => sum + object.bytes, 0),
      retainedObjects: retained.length,
      retainedBytes: retained.reduce((sum, object) => sum + object.bytes, 0),
      protectedBytes: retained.filter((object) => selection.protectedIds.has(object.metadata.id))
        .reduce((sum, object) => sum + object.bytes, 0),
      diagnosticsBytes: retained.filter((object) => object.metadata.kind === "diagnostic-log")
        .reduce((sum, object) => sum + object.bytes, 0),
      diskBefore: disk(root),
    },
  };
}

export function applyArtifactCleanup(poolPath, now = new Date()) {
  const root = canonicalPool(poolPath);
  recoverRegistrations(root);
  const plan = planArtifactCleanup(root, now);
  if (!plan.remove.length) {
    return { ...plan, applied: true, summary: { ...plan.summary, diskAfter: disk(root) } };
  }
  const journalPath = join(root, "cleanup-journal.json");
  const journal = {
    schema: "puddles.openclaw-retention-cleanup/v1",
    schemaVersion: 1,
    startedAt: now.toISOString(),
    entries: plan.remove.map((entry) => ({ ...entry, status: "planned" })),
  };
  atomicJson(journalPath, journal);
  for (const entry of journal.entries) {
    const state = loadPool(root);
    const selection = selectRetention(state);
    if (selection.retained.has(entry.id)) {
      throw new Error(`Retention changed before deletion; object is now protected: ${entry.id}`);
    }
    const object = state.objects.get(entry.id);
    if (!object) throw new Error(`Retention object disappeared before deletion: ${entry.id}`);
    validateDeletion(root, object, entry.metadataSha256);
    const trash = join(root, "trash", entry.id);
    if (existsSync(trash)) throw new Error(`Retention trash destination already exists: ${entry.id}`);
    renameSync(object.path, trash);
    entry.status = "moved";
    atomicJson(journalPath, journal);
    rmSync(trash, { recursive: true });
    entry.status = "removed";
    atomicJson(journalPath, journal);
  }
  rmSync(journalPath);
  return {
    ...plan,
    applied: true,
    summary: { ...plan.summary, diskAfter: disk(root) },
  };
}

function assetMetadata(path, name) {
  const stat = regular(path, lstatSync(path).isDirectory());
  const type = stat.isDirectory() ? "directory" : "file";
  if (!inside(realpathSync(dirname(path)), realpathSync(path)) && type === "directory") {
    throw new Error("Retained source path is not canonical");
  }
  const bytes = type === "directory" ? walkOwned(path).bytes : stat.size;
  const sha256 = type === "directory"
    ? treeDigest(path, { portable: true })
    : fileDigest(path);
  return { path: safeRelative(name), type, bytes, sha256 };
}

export function registerRetainedObject(poolPath, value) {
  const root = canonicalPool(poolPath);
  if (!idPattern.test(value.id ?? "") || !objectKinds.has(value.kind) ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      !Array.isArray(value.assets) || !value.assets.length ||
      !Array.isArray(value.dependencies ?? []) ||
      (value.dependencies ?? []).some((id) => !idPattern.test(id))) {
    throw new Error("Invalid retained object registration");
  }
  const destination = join(root, "objects", value.id);
  if (existsSync(destination)) {
    const existing = validateObject(root, destination).metadata;
    const proposedAssets = value.assets.map((asset) => {
      if (!isAbsolute(asset.source) || !existsSync(asset.source)) {
        throw new Error("Retained asset source must be an existing absolute path");
      }
      const source = realpathSync(asset.source);
      if (source === dirname(source)) throw new Error("Refusing to register a filesystem root");
      return assetMetadata(source, safeRelative(asset.path));
    });
    if (existing.kind !== value.kind ||
        jsonDigest(existing.dependencies) !== jsonDigest([...new Set(value.dependencies ?? [])].sort()) ||
        jsonDigest(existing.assets) !== jsonDigest(proposedAssets)) {
      throw new Error(`Retained object id already owns different content: ${value.id}`);
    }
    return existing;
  }
  const temporary = join(root, "trash", `.register-${randomUUID()}`);
  mkdirSync(temporary, { mode: 0o700 });
  try {
    const assets = [];
    for (const asset of value.assets) {
      if (!isAbsolute(asset.source) || !existsSync(asset.source)) {
        throw new Error("Retained asset source must be an existing absolute path");
      }
      const source = realpathSync(asset.source);
      if (source === dirname(source)) throw new Error("Refusing to register a filesystem root");
      const name = safeRelative(asset.path);
      const target = join(temporary, name);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      cpSync(source, target, {
        recursive: lstatSync(source).isDirectory(),
        verbatimSymlinks: true,
      });
      assets.push(assetMetadata(target, name));
    }
    const projection = {
      schema: objectSchema,
      schemaVersion: 1,
      id: value.id,
      kind: value.kind,
      createdAt: value.createdAt,
      dependencies: [...new Set(value.dependencies ?? [])].sort(),
      assets,
    };
    const metadata = {
      ...projection,
      objectSha256: jsonDigest({
        metadata: projection,
        assets: assets.map(({ path, type, sha256, bytes }) => [path, type, sha256, bytes]),
      }),
    };
    atomicJson(join(temporary, "ownership.json"), metadata);
    walkOwned(temporary);
    renameSync(temporary, destination);
    const directory = openSync(join(root, "objects"), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
    return validateObject(root, destination).metadata;
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function setRetentionReference(poolPath, value) {
  const root = canonicalPool(poolPath);
  if (!idPattern.test(value.id ?? "") || !referenceKinds.has(value.kind) ||
      !Array.isArray(value.objectIds) || value.objectIds.some((id) => !idPattern.test(id))) {
    throw new Error("Invalid retention reference");
  }
  const state = loadPool(root);
  for (const id of value.objectIds) {
    if (!state.objects.has(id)) throw new Error(`Cannot reference missing retained object: ${id}`);
  }
  const reference = {
    schema: referenceSchema,
    schemaVersion: 1,
    id: value.id,
    kind: value.kind,
    objectIds: [...new Set(value.objectIds)].sort(),
    updatedAt: new Date().toISOString(),
  };
  atomicJson(join(root, "references", `${value.id}.json`), reference);
  return reference;
}

export function removeRetentionReference(poolPath, id) {
  const root = canonicalPool(poolPath);
  if (!idPattern.test(id)) throw new Error("Invalid retention reference id");
  rmSync(join(root, "references", `${id}.json`), { force: true });
}

function copyProofAssets(runDir, names) {
  return names.flatMap((name) => {
    const path = join(runDir, "stages", `${name}.json`);
    return existsSync(path) ? [{ source: path, path: `proofs/${name}.json` }] : [];
  });
}

export function registerSuccessfulBuild(poolPath, runDir, bundlePath, buildId, now = new Date()) {
  if (!/^[a-f0-9]{64}$/.test(buildId)) throw new Error("Successful build requires an exact build id");
  const id = `success-${buildId.slice(0, 48)}`;
  const metadata = registerRetainedObject(poolPath, {
    id,
    kind: "successful-build",
    createdAt: now.toISOString(),
    dependencies: [],
    assets: [
      { source: bundlePath, path: "bundle.tar.gz" },
      { source: join(runDir, "build.json"), path: "build.json" },
      ...copyProofAssets(runDir, [
        "prepare", "dependencies", "build", "extension-package",
        "provider-package", "prepared-files", "package",
      ]),
    ],
  });
  setRetentionReference(poolPath, { id: "current", kind: "current", objectIds: [id] });
  return metadata;
}

export function findSuccessfulBuild(poolPath, buildId) {
  if (!/^[a-f0-9]{64}$/.test(buildId)) throw new Error("Successful build requires an exact build id");
  const root = canonicalPool(poolPath);
  const id = `success-${buildId.slice(0, 48)}`;
  const path = join(root, "objects", id);
  if (!existsSync(path)) return null;
  const object = validateObject(root, path);
  if (object.metadata.kind !== "successful-build") {
    throw new Error(`Retained build id has the wrong object kind: ${id}`);
  }
  const receiptPath = join(path, "build.json");
  const bundlePath = join(path, "bundle.tar.gz");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (receipt.buildId !== buildId || !regular(bundlePath)) {
    throw new Error(`Retained build identity is invalid: ${id}`);
  }
  return { metadata: object.metadata, receiptPath, bundlePath };
}

export function registerImportedBuild(poolPath, bundlePath, receiptPath, buildId, now = new Date()) {
  const existing = findSuccessfulBuild(poolPath, buildId);
  if (existing) {
    setRetentionReference(poolPath, {
      id: "current",
      kind: "current",
      objectIds: [existing.metadata.id],
    });
    return existing.metadata;
  }
  const metadata = registerRetainedObject(poolPath, {
    id: `success-${buildId.slice(0, 48)}`,
    kind: "successful-build",
    createdAt: now.toISOString(),
    dependencies: [],
    assets: [
      { source: bundlePath, path: "bundle.tar.gz" },
      { source: receiptPath, path: "build.json" },
    ],
  });
  setRetentionReference(poolPath, {
    id: "current",
    kind: "current",
    objectIds: [metadata.id],
  });
  return metadata;
}

export function registerFailedReproduction(poolPath, runDir, now = new Date(), dependencies = []) {
  const runStatus = join(runDir, "run-status.json");
  regular(runStatus);
  const key = jsonDigest(JSON.parse(readFileSync(runStatus, "utf8")));
  const id = `failure-${key.slice(0, 48)}`;
  const stages = regular(join(runDir, "stages"), true)
    ? readdirSync(join(runDir, "stages")).filter((name) => name.endsWith(".json"))
      .map((name) => join(runDir, "stages", name))
      .filter((path) => JSON.parse(readFileSync(path, "utf8")).status === "failed")
    : [];
  const metadata = registerRetainedObject(poolPath, {
    id,
    kind: "failed-reproduction",
    createdAt: now.toISOString(),
    dependencies,
    assets: [
      { source: runStatus, path: "run-status.json" },
      ...stages.map((path) => ({ source: path, path: `proofs/${basename(path)}` })),
    ],
  });
  setRetentionReference(poolPath, { id: "failed-debug", kind: "failed-debug", objectIds: [id] });
  return metadata;
}

export function registerDiagnosticLogs(poolPath, runDir, now = new Date()) {
  const logs = join(runDir, "logs");
  if (!regular(logs, true) || !readdirSync(logs).length) return null;
  const identity = treeDigest(logs, { portable: true });
  const root = canonicalPool(poolPath);
  const id = `log-${identity.slice(0, 48)}`;
  const existing = join(root, "objects", id);
  if (existsSync(existing)) {
    const object = validateObject(root, existing);
    if (object.metadata.kind !== "diagnostic-log") {
      throw new Error(`Retained log id has the wrong object kind: ${id}`);
    }
    return object.metadata;
  }
  return registerRetainedObject(poolPath, {
    id,
    kind: "diagnostic-log",
    createdAt: now.toISOString(),
    dependencies: [],
    assets: [{ source: logs, path: "logs" }],
  });
}

export function registerTargetProof(
  poolPath,
  runDir,
  successRecoveryDir,
  rollbackRecoveryDir,
  targetProofPath,
  buildId,
  now = new Date(),
) {
  const build = findSuccessfulBuild(poolPath, buildId);
  if (!build) throw new Error("Target proof requires its retained successful build");
  const proof = JSON.parse(readFileSync(targetProofPath, "utf8"));
  if (proof.buildId !== buildId || proof.schema !== "puddles.openclaw-target-proof/v1") {
    throw new Error("Target proof identity differs from its retained build");
  }
  const proofAssets = [
    ...copyProofAssets(runDir, ["install", "runtime"]),
    { source: join(successRecoveryDir, "recovery.json"), path: "deployment/success-recovery.json" },
    { source: join(rollbackRecoveryDir, "recovery.json"), path: "deployment/rollback-recovery.json" },
    { source: join(rollbackRecoveryDir, "failure.json"), path: "deployment/rollback-failure.json" },
  ];
  const rehearsalId = `target-${jsonDigest(proofAssets.map(({ source, path }) => [
    path,
    fileDigest(source),
  ])).slice(0, 48)}`;
  const rehearsal = registerRetainedObject(poolPath, {
    id: rehearsalId,
    kind: "target-rehearsal",
    createdAt: now.toISOString(),
    dependencies: [build.metadata.id],
    assets: proofAssets,
  });
  const proofId = `target-proof-${jsonDigest(proof).slice(0, 41)}`;
  const retainedProof = registerRetainedObject(poolPath, {
    id: proofId,
    kind: "target-proof",
    createdAt: now.toISOString(),
    dependencies: [build.metadata.id, rehearsal.id],
    assets: [{ source: targetProofPath, path: "target-proof.json" }],
  });
  setRetentionReference(poolPath, {
    id: "current",
    kind: "current",
    objectIds: [build.metadata.id, retainedProof.id],
  });
  return { rehearsal, proof: retainedProof };
}

export function retentionSpaceSummary(poolPath, requiredBytes) {
  const root = canonicalPool(poolPath);
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) {
    throw new Error("Required disk budget must be a nonnegative integer");
  }
  const plan = planArtifactCleanup(root);
  const current = disk(root);
  return {
    requiredBytes,
    freeBytes: current.freeBytes,
    retainedBytes: plan.summary.retainedBytes,
    protectedBytes: plan.summary.protectedBytes,
    removableBytes: plan.summary.removableBytes,
    sufficient: current.freeBytes >= requiredBytes,
  };
}

export function artifactPoolRunId(runDir) {
  return `run-${jsonDigest(realpathSync(runDir)).slice(0, 48)}`;
}
