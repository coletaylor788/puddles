import {
  closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readdirSync, realpathSync, renameSync, rmSync, statfsSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { systemOperations, validateTarget, verifyNodeFile } from "./native-activation.mjs";
import { acquireLock, atomicJson, fileDigest, inside, jsonDigest, treeDigest } from "./native-state.mjs";
import { runCommand } from "./process-runner.mjs";

const manifestSchema = "puddles.openclaw-current-backup/v1";
const journalSchema = "puddles.openclaw-current-backup-journal/v1";
const materializationSchema = "puddles.openclaw-current-backup-materialization/v1";
const referenceSchema = "puddles.openclaw-current-backup-reference/v1";
const retirementSchema = "puddles.openclaw-current-backup-retirement/v1";
const transactionPattern = /^backup-[0-9]+-[0-9]+$/;
const captureTimeoutMs = 7 * 60_000;

function stat(path, directory = false) {
  const value = lstatSync(path, { throwIfNoEntry: false });
  if (!value || value.isSymbolicLink() || (directory ? !value.isDirectory() : !value.isFile())) {
    throw new Error(`Backup path has an unexpected type: ${path}`);
  }
  return value;
}

function syncDirectory(path) {
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function durableCopy(from, to) {
  const staged = `${to}.${randomUUID()}.staged`;
  try {
    cpSync(from, staged, { errorOnExist: true, force: false, preserveTimestamps: true });
    const descriptor = openSync(staged, "r");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    renameSync(staged, to);
    syncDirectory(dirname(to));
  } finally {
    rmSync(staged, { force: true });
  }
}

function parseJson(path, message) {
  stat(path);
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(message, { cause: error }); }
}

function referencesRoot(target) {
  const root = join(realpathSync(target.backupRoot), "backup-references");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return root;
}

function currentReferencePath(target) {
  return join(referencesRoot(target), "latest-healthy-recovery.json");
}

function validateReference(value) {
  if (value.schema !== referenceSchema || value.schemaVersion !== 1 ||
      !transactionPattern.test(value.transaction ?? "") ||
      !/^[a-f0-9]{64}$/.test(value.manifestSha256 ?? "") ||
      !/^[a-f0-9]{64}$/.test(value.materializationSha256 ?? "") ||
      value.previousTransaction !== null &&
        !transactionPattern.test(value.previousTransaction ?? "") ||
      !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error("Backup reference is invalid");
  }
  return value;
}

function readReference(path) {
  return existsSync(path) ? validateReference(parseJson(path, "Backup reference is invalid")) : null;
}

function referenceToken(reference) {
  return reference ? jsonDigest(reference) : null;
}

function canonicalNode(identity) {
  return identity.realPath ?? identity.path;
}

function validateBackupNode(target) {
  const identity = target.backupNode;
  if (!identity || !isAbsolute(identity.path ?? "") ||
      identity.realPath !== undefined && !isAbsolute(identity.realPath) ||
      !/^[a-f0-9]{64}$/.test(identity.sha256 ?? "") ||
      !/^v\d+\.\d+\.\d+$/.test(identity.version ?? "") ||
      identity.platform !== process.platform || identity.arch !== process.arch) {
    throw new Error("Backup target requires an exact external Node identity");
  }
  const nodePath = resolve(canonicalNode(identity));
  for (const root of [target.installDir, target.stateDir, target.backupRoot]) {
    if (inside(realpathSync(root), nodePath)) throw new Error("Backup Node interpreter must remain outside managed roots");
  }
  verifyNodeFile(identity);
  return identity;
}

function validateBackupExclusions(target) {
  const expected = [{ path: "deploy-snapshots", reason: "legacy-backup-storage" }];
  if (jsonDigest(target.backupExclusions) !== jsonDigest(expected)) {
    throw new Error("Backup exclusions must select only direct legacy deploy-snapshots storage");
  }
  const excluded = join(realpathSync(target.stateDir), expected[0].path);
  const value = lstatSync(excluded, { throwIfNoEntry: false });
  if (value && (value.isSymbolicLink() || !value.isDirectory())) {
    throw new Error("Excluded legacy deploy-snapshots must be a real directory");
  }
  return expected;
}

export function validateBackupTarget(target) {
  validateTarget(target);
  if (target.purpose !== "production") throw new Error("Current backup target must be production");
  if (target.host !== hostname()) throw new Error("Current backup target host differs");
  if (target.nodeMigration) throw new Error("Current backup uses backupNode, not a candidate Node migration");
  validateBackupNode(target);
  validateBackupExclusions(target);
  return target;
}

export function backupOperations(target, workDir, execute = runCommand) {
  const operations = systemOperations(target, workDir, execute);
  let sequence = 100;
  const env = {
    HOME: process.env.HOME,
    OPENCLAW_STATE_DIR: target.stateDir,
    OPENCLAW_CONFIG_PATH: join(target.stateDir, "openclaw.json"),
    OPENCLAW_SERVICE_REPAIR_POLICY: "external",
    NO_COLOR: "1",
  };
  const run = (command, args, options = {}) => execute(command, args, {
    env, timeoutMs: 60_000, quiet: true,
    logPath: join(workDir, `backup-command-${sequence++}.log`), ...options,
  });
  return {
    ...operations,
    async inspectBrowser(imageId) {
      const found = (await run("docker", ["image", "inspect", "--format", "{{.Id}}", imageId], { capture: true })).trim();
      if (found !== imageId) throw new Error("Backup browser image is unavailable");
    },
    async verifyService(path) {
      await run("python3", ["-c", "import plistlib,sys; plistlib.load(open(sys.argv[1],'rb'))", path]);
    },
    async verifyConfig(stateDir) {
      const config = join(stateDir, "openclaw.json");
      if (existsSync(config)) JSON.parse(readFileSync(config, "utf8"));
    },
    async verifySqlite(stateDir) {
      const pending = [stateDir];
      while (pending.length) {
        const directory = pending.pop();
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) pending.push(path);
          else if (entry.isFile() && /\.(?:db|sqlite|sqlite3)$/.test(entry.name)) {
            const result = (await run("sqlite3", [path, "PRAGMA quick_check;"], { capture: true })).trim();
            if (result !== "ok") throw new Error(`Backup SQLite check failed: ${entry.name}`);
          }
        }
      }
    },
    async verifyRuntime(runtimeDir, stateDir, nodePath) {
      await run(nodePath, [join(runtimeDir, "openclaw.mjs"), "--version"], {
        env: {
          ...env,
          PATH: `${dirname(nodePath)}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          OPENCLAW_STATE_DIR: stateDir,
          OPENCLAW_CONFIG_PATH: join(stateDir, "openclaw.json"),
        },
      });
    },
  };
}

function backupDirectory(target, requested) {
  const root = realpathSync(target.backupRoot);
  let directory;
  if (requested) {
    directory = realpathSync(resolve(requested));
  } else {
    let timestamp = Date.now();
    do {
      directory = join(root, `backup-${timestamp++}-${process.pid}`);
    } while (existsSync(directory));
  }
  if (dirname(directory) !== root || !transactionPattern.test(basename(directory))) {
    throw new Error("Backup directory must be one direct owned child of backupRoot");
  }
  if (requested) stat(directory, true);
  return directory;
}

function journalIdentity(target, directory) {
  return {
    schema: journalSchema,
    schemaVersion: 1,
    transaction: basename(directory),
    targetSha256: jsonDigest(target),
  };
}

function reclaimStoppedCaptureLock(target, directory) {
  const lock = join(realpathSync(target.backupRoot), "lock");
  if (!existsSync(lock)) return;
  stat(lock, true);
  const journal = parseJson(join(directory, "backup-journal.json"), "Backup journal is invalid");
  const identity = journalIdentity(target, directory);
  if (Object.entries(identity).some(([key, value]) => journal[key] !== value) ||
      journal.serviceStopped !== true) {
    throw new Error("Existing backup lock is not owned by this stopped capture");
  }
  const owner = parseJson(join(lock, "owner.json"), "Backup lock owner is invalid");
  if (!Number.isSafeInteger(owner.pid) || owner.pid < 1 ||
      !Number.isFinite(Date.parse(owner.startedAt))) {
    throw new Error("Backup lock owner is invalid");
  }
  try {
    process.kill(owner.pid, 0);
    throw new Error("Backup capture owner is still running");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  rmSync(lock, { recursive: true });
  syncDirectory(dirname(lock));
}

function saveJournal(path, journal, status) {
  journal.status = status;
  journal.updatedAt = new Date().toISOString();
  atomicJson(path, journal);
}

async function restartUnchanged(target, operations, journal, journalPath) {
  let stoppedHealthError;
  try {
    await operations.health(canonicalNode(target.backupNode));
    journal.serviceStopped = false;
    saveJournal(journalPath, journal, "restarted");
    return;
  } catch (error) {
    stoppedHealthError = error;
  }
  try {
    await operations.start();
    await operations.health(canonicalNode(target.backupNode));
    journal.serviceStopped = false;
    saveJournal(journalPath, journal, "restarted");
  } catch (restartError) {
    saveJournal(journalPath, journal, "restart-failed");
    throw new AggregateError(
      [stoppedHealthError, restartError],
      "Backup capture failed to restore the unchanged service",
    );
  }
}

function manifestDigest(manifest) {
  const { manifestSha256, ...content } = manifest;
  return jsonDigest(content);
}

function validateBackupTopLevel(directory) {
  const allowed = new Set([
    "runtime",
    "state",
    "service.plist",
    "backup.json",
    "backup-journal.json",
    "materialization.json",
  ]);
  for (const name of readdirSync(directory)) {
    if (!allowed.has(name) && !/^(?:backup-)?command-\d+\.log$/.test(name)) {
      throw new Error(`Unknown backup entry blocks recovery and retirement: ${name}`);
    }
  }
}

function measureTree(root, excludedDirectChild) {
  let allocatedBytes = 0;
  let logicalBytes = 0;
  let entries = 0;
  function walk(path, top = false) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (top && entry.name === excludedDirectChild) continue;
      const child = join(path, entry.name);
      const value = lstatSync(child);
      entries += 1;
      allocatedBytes += value.blocks * 512;
      logicalBytes += value.isFile() ? value.size : 0;
      if (value.isDirectory()) walk(child);
    }
  }
  walk(root, true);
  return { allocatedBytes, logicalBytes, entries };
}

export function planCurrentBackup(target) {
  validateBackupTarget(target);
  const exclusion = validateBackupExclusions(target)[0].path;
  const runtime = measureTree(realpathSync(target.installDir));
  const state = measureTree(realpathSync(target.stateDir), exclusion);
  const service = stat(target.plistPath);
  const includedAllocatedBytes = runtime.allocatedBytes + state.allocatedBytes + service.blocks * 512;
  const requiredBytes = includedAllocatedBytes * 2;
  const filesystem = statfsSync(target.backupRoot);
  return {
    schema: "puddles.openclaw-current-backup-plan/v1",
    schemaVersion: 1,
    targetSha256: jsonDigest(target),
    exclusions: validateBackupExclusions(target),
    runtime,
    state,
    service: { allocatedBytes: service.blocks * 512, logicalBytes: service.size, entries: 1 },
    formula: "2 * included allocated bytes for capture plus isolated materialization",
    includedAllocatedBytes,
    requiredBytes,
    freeBytes: filesystem.bavail * filesystem.bsize,
    ready: filesystem.bavail * filesystem.bsize >= requiredBytes,
  };
}

export function verifyCurrentBackup(target, requestedDirectory) {
  validateBackupTarget(target);
  const directory = realpathSync(backupDirectory(target, requestedDirectory));
  const manifest = parseJson(join(directory, "backup.json"), "Backup manifest is invalid");
  if (manifest.schema !== manifestSchema || manifest.schemaVersion !== 1 ||
      manifest.transaction !== basename(directory) || manifest.targetSha256 !== jsonDigest(target) ||
      manifest.status !== "captured" || manifest.host !== hostname() ||
      manifest.manifestSha256 !== manifestDigest(manifest) ||
      jsonDigest(manifest.exclusions) !== jsonDigest(validateBackupExclusions(target)) ||
      !Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new Error("Backup manifest identity is invalid");
  }
  if (jsonDigest(manifest.assets) !== jsonDigest({
    runtime: { path: "runtime", sha256: manifest.assets?.runtime?.sha256 },
    state: { path: "state", sha256: manifest.assets?.state?.sha256 },
    service: { path: "service.plist", sha256: manifest.assets?.service?.sha256 },
  })) {
    throw new Error("Backup manifest asset layout is invalid");
  }
  validateBackupTopLevel(directory);
  const actual = {
    runtime: treeDigest(join(directory, "runtime")),
    state: treeDigest(join(directory, "state")),
    service: fileDigest(join(directory, "service.plist")),
  };
  for (const [name, digest] of Object.entries(actual)) {
    if (manifest.assets?.[name]?.sha256 !== digest) throw new Error(`Backup ${name} differs from manifest`);
  }
  for (const exclusion of manifest.exclusions) {
    if (existsSync(join(directory, "state", exclusion.path))) {
      throw new Error("Excluded legacy backup storage entered the recovery snapshot");
    }
  }
  verifyNodeFile(manifest.node);
  if (jsonDigest(manifest.node) !== jsonDigest(target.backupNode)) throw new Error("Backup Node differs from target");
  if ((manifest.browser?.tag ?? null) !== (target.browser?.tag ?? null) ||
      target.browser && !/^sha256:[a-f0-9]{64}$/.test(manifest.browser?.imageId ?? "")) {
    throw new Error("Backup browser differs from target");
  }
  return manifest;
}

export async function captureCurrentBackup(target, operationsFactory = backupOperations, requestedDirectory, options = {}) {
  validateBackupTarget(target);
  const capacity = planCurrentBackup(target);
  if (!capacity.ready) {
    throw new Error(`Backup requires ${capacity.requiredBytes} free bytes; ${capacity.freeBytes} available`);
  }
  const timeoutMs = options.captureTimeoutMs ?? captureTimeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > captureTimeoutMs) {
    throw new Error("Backup capture timeout must be a positive integer no greater than seven minutes");
  }
  const directory = backupDirectory(target, requestedDirectory);
  if (requestedDirectory) reclaimStoppedCaptureLock(target, directory);
  const unlock = acquireLock(target.backupRoot);
  if (!requestedDirectory) mkdirSync(directory, { mode: 0o700 });
  const journalPath = join(directory, "backup-journal.json");
  const identity = journalIdentity(target, directory);
  let journal = existsSync(journalPath)
    ? parseJson(journalPath, "Backup journal is invalid")
    : {
      ...identity,
      createdAt: new Date().toISOString(),
      status: "preparing",
      serviceStopped: false,
      referenceToken: referenceToken(readReference(currentReferencePath(target))),
    };
  const operations = operationsFactory(target, directory);
  try {
    if (Object.entries(identity).some(([key, value]) => journal[key] !== value)) {
      throw new Error("Backup journal identity is invalid");
    }
    if (![
      "preparing", "prepared", "stopping", "stopped", "state-captured",
      "restarted", "capture-failed", "restart-failed", "resumed", "captured",
    ].includes(journal.status)) {
      throw new Error("Backup journal status is invalid");
    }
    if (journal.status === "captured") {
      return { directory, manifest: verifyCurrentBackup(target, directory) };
    }
    if (journal.serviceStopped) {
      await restartUnchanged(target, operations, journal, journalPath);
      rmSync(join(directory, "state"), { recursive: true, force: true });
      saveJournal(journalPath, journal, "resumed");
    }
    verifyNodeFile(target.backupNode);
    const inspected = await operations.inspectNode(canonicalNode(target.backupNode));
    for (const key of ["version", "platform", "arch"]) {
      if (inspected[key] !== target.backupNode[key]) throw new Error("Backup Node identity changed");
    }
    const browserImageId = target.browser ? await operations.currentBrowser() : null;
    if (target.browser && !/^sha256:[a-f0-9]{64}$/.test(browserImageId ?? "")) {
      throw new Error("Current browser image identity is invalid");
    }
    for (const name of ["runtime", "state", "service.plist", "backup.json"]) {
      rmSync(join(directory, name), { recursive: true, force: true });
    }
    await operations.clone(target.installDir, join(directory, "runtime"));
    await operations.verifyService(target.plistPath);
    durableCopy(target.plistPath, join(directory, "service.plist"));
    journal.runtimeSha256 = treeDigest(join(directory, "runtime"));
    journal.serviceSha256 = fileDigest(join(directory, "service.plist"));
    journal.node = target.backupNode;
    journal.browser = target.browser ? { tag: target.browser.tag, imageId: browserImageId } : null;
    saveJournal(journalPath, journal, "prepared");
    await operations.health(canonicalNode(target.backupNode));
    const stoppedAt = Date.now();
    journal.serviceStopped = true;
    saveJournal(journalPath, journal, "stopping");
    try {
      await operations.stop(target.installDir);
    } catch (stopError) {
      try {
        await restartUnchanged(target, operations, journal, journalPath);
      } catch (restartError) {
        throw new AggregateError(
          [stopError, restartError],
          "Backup capture could not stop writers and failed to restore the unchanged service",
        );
      }
      throw stopError;
    }
    saveJournal(journalPath, journal, "stopped");
    try {
      const remaining = timeoutMs - (Date.now() - stoppedAt);
      if (remaining <= 0) throw new Error("Backup capture exceeded the outage budget");
      await operations.clone(
        target.stateDir,
        join(directory, "state"),
        remaining,
        validateBackupExclusions(target)[0].path,
      );
      if (Date.now() - stoppedAt > timeoutMs) throw new Error("Backup capture exceeded the outage budget");
    } catch (captureError) {
      await restartUnchanged(target, operations, journal, journalPath);
      saveJournal(journalPath, journal, "capture-failed");
      throw captureError;
    }
    saveJournal(journalPath, journal, "state-captured");
    await restartUnchanged(target, operations, journal, journalPath);
    if (treeDigest(target.installDir) !== journal.runtimeSha256 ||
        fileDigest(target.plistPath) !== journal.serviceSha256) {
      throw new Error("Runtime or service changed during backup capture");
    }
    verifyNodeFile(target.backupNode);
    const finalNode = await operations.inspectNode(canonicalNode(target.backupNode));
    for (const key of ["version", "platform", "arch"]) {
      if (finalNode[key] !== target.backupNode[key]) throw new Error("Backup Node identity changed during capture");
    }
    if (target.browser && await operations.currentBrowser() !== journal.browser.imageId) {
      throw new Error("Browser image changed during backup capture");
    }
    const manifest = {
      schema: manifestSchema,
      schemaVersion: 1,
      transaction: journal.transaction,
      targetSha256: journal.targetSha256,
      host: hostname(),
      status: "captured",
      createdAt: journal.createdAt,
      assets: {
        runtime: { path: "runtime", sha256: journal.runtimeSha256 },
        state: { path: "state", sha256: treeDigest(join(directory, "state")) },
        service: { path: "service.plist", sha256: journal.serviceSha256 },
      },
      exclusions: validateBackupExclusions(target),
      node: journal.node,
      browser: journal.browser,
    };
    manifest.manifestSha256 = manifestDigest(manifest);
    atomicJson(join(directory, "backup.json"), manifest);
    verifyCurrentBackup(target, directory);
    saveJournal(journalPath, journal, "captured");
    return { directory, manifest };
  } finally {
    unlock();
  }
}

function isolatedRoot(target, requested) {
  if (!isAbsolute(requested)) throw new Error("Materialization root must be absolute");
  const absolute = resolve(requested);
  let parent = absolute;
  while (!existsSync(parent)) parent = dirname(parent);
  const canonical = resolve(realpathSync(parent), relative(parent, absolute));
  for (const root of [target.installDir, target.stateDir, target.backupRoot, dirname(target.plistPath)]) {
    const protectedRoot = existsSync(root) ? realpathSync(root) : resolve(root);
    if (inside(protectedRoot, canonical) || inside(canonical, protectedRoot)) {
      throw new Error("Materialization root must be isolated from managed paths");
    }
  }
  if (existsSync(canonical)) throw new Error("Materialization root already exists");
  return canonical;
}

function materializationDigest(proof) {
  const { proofSha256, ...content } = proof;
  return jsonDigest(content);
}

export async function materializeCurrentBackup(
  target,
  requestedDirectory,
  requestedDestination,
  operationsFactory = backupOperations,
) {
  const manifest = verifyCurrentBackup(target, requestedDirectory);
  const directory = realpathSync(requestedDirectory);
  const destination = isolatedRoot(target, requestedDestination);
  mkdirSync(destination, { mode: 0o700 });
  const operations = operationsFactory(target, destination);
  try {
    await operations.clone(join(directory, "runtime"), join(destination, "runtime"));
    await operations.clone(join(directory, "state"), join(destination, "state"));
    durableCopy(join(directory, "service.plist"), join(destination, "service.plist"));
    if (treeDigest(join(destination, "runtime")) !== manifest.assets.runtime.sha256 ||
        treeDigest(join(destination, "state")) !== manifest.assets.state.sha256 ||
        fileDigest(join(destination, "service.plist")) !== manifest.assets.service.sha256) {
      throw new Error("Materialized backup differs from manifest");
    }
    verifyNodeFile(manifest.node);
    const inspected = await operations.inspectNode(canonicalNode(manifest.node));
    for (const key of ["version", "platform", "arch"]) {
      if (inspected[key] !== manifest.node[key]) throw new Error("Backup Node is incompatible");
    }
    if (manifest.browser) await operations.inspectBrowser(manifest.browser.imageId);
    await operations.verifyService(join(destination, "service.plist"));
    await operations.verifyConfig(join(destination, "state"));
    await operations.verifySqlite(join(destination, "state"));
    await operations.verifyRuntime(
      join(destination, "runtime"),
      join(destination, "state"),
      canonicalNode(manifest.node),
    );
    const proofBase = {
      schema: materializationSchema,
      schemaVersion: 1,
      transaction: manifest.transaction,
      manifestSha256: manifest.manifestSha256,
      runtimeSha256: treeDigest(join(destination, "runtime")),
      stateSha256: treeDigest(join(destination, "state")),
      serviceSha256: fileDigest(join(destination, "service.plist")),
    };
    const retainedProofPath = join(directory, "materialization.json");
    let proof;
    if (existsSync(retainedProofPath)) {
      proof = parseJson(retainedProofPath, "Backup materialization proof is invalid");
      if (proof.schema !== proofBase.schema || proof.schemaVersion !== 1 ||
          proof.transaction !== proofBase.transaction ||
          proof.manifestSha256 !== proofBase.manifestSha256 ||
          proof.runtimeSha256 !== proofBase.runtimeSha256 ||
          proof.stateSha256 !== proofBase.stateSha256 ||
          proof.serviceSha256 !== proofBase.serviceSha256 ||
          proof.proofSha256 !== materializationDigest(proof)) {
        throw new Error("Backup materialization proof is invalid");
      }
    } else {
      proof = { ...proofBase, verifiedAt: new Date().toISOString() };
      proof.proofSha256 = materializationDigest(proof);
      atomicJson(retainedProofPath, proof);
    }
    atomicJson(join(destination, "materialization.json"), proof);
    const unlock = acquireLock(target.backupRoot);
    try {
      const journal = parseJson(join(directory, "backup-journal.json"), "Backup journal is invalid");
      const referencePath = currentReferencePath(target);
      const previous = readReference(referencePath);
      if (previous?.transaction === manifest.transaction &&
          previous.manifestSha256 === manifest.manifestSha256 &&
          previous.materializationSha256 === proof.proofSha256) {
        journal.reference = previous;
        saveJournal(join(directory, "backup-journal.json"), journal, "referenced");
        return { destination, manifest, proof, reference: previous };
      }
      if (referenceToken(previous) !== journal.referenceToken) {
        throw new Error("Healthy recovery reference changed during backup validation");
      }
      const reference = {
        schema: referenceSchema,
        schemaVersion: 1,
        transaction: manifest.transaction,
        manifestSha256: manifest.manifestSha256,
        materializationSha256: proof.proofSha256,
        previousTransaction: previous?.transaction ?? null,
        updatedAt: new Date().toISOString(),
      };
      atomicJson(referencePath, reference);
      journal.reference = reference;
      saveJournal(join(directory, "backup-journal.json"), journal, "referenced");
      return { destination, manifest, proof, reference };
    } finally {
      unlock();
    }
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

export function retireCurrentBackup(target, requestedDirectory) {
  validateBackupTarget(target);
  const backupRoot = realpathSync(target.backupRoot);
  const requested = resolve(requestedDirectory);
  const source = join(realpathSync(dirname(requested)), basename(requested));
  if (dirname(source) !== backupRoot || !transactionPattern.test(basename(source))) {
    throw new Error("Retirement target is outside the backup root");
  }
  const transaction = basename(source);
  const journalPath = join(backupRoot, `retire-${transaction}.json`);
  const unlock = acquireLock(target.backupRoot);
  try {
    let journal;
    let manifest;
    if (existsSync(journalPath)) {
      journal = parseJson(journalPath, "Backup retirement journal is invalid");
      if (journal.schema !== retirementSchema || journal.schemaVersion !== 1 ||
          journal.transaction !== transaction || journal.source !== source ||
          journal.trash !== join(backupRoot, `.retiring-${transaction}`) ||
          !["planned", "moved", "removed"].includes(journal.status)) {
        throw new Error("Backup retirement journal is invalid");
      }
      manifest = { transaction, manifestSha256: journal.manifestSha256 };
    } else {
      manifest = verifyCurrentBackup(target, source);
    }
    const referenceRoot = referencesRoot(target);
    const references = readdirSync(referenceRoot);
    if (!references.length) throw new Error("A verified replacement reference is required before retirement");
    for (const name of references) {
      if (!name.endsWith(".json")) throw new Error("Unknown backup reference blocks retirement");
      if (readReference(join(referenceRoot, name)).transaction === manifest.transaction) {
        throw new Error("Referenced backup cannot be retired");
      }
    }
    const current = readReference(currentReferencePath(target));
    const replacement = current && join(backupRoot, current.transaction);
    if (!replacement || !existsSync(replacement)) throw new Error("Verified replacement backup is missing");
    const replacementManifest = verifyCurrentBackup(target, replacement);
    const proof = parseJson(join(replacement, "materialization.json"), "Replacement materialization proof is missing");
    if (proof.schema !== materializationSchema || proof.schemaVersion !== 1 ||
        proof.manifestSha256 !== replacementManifest.manifestSha256 ||
        proof.proofSha256 !== materializationDigest(proof) ||
        proof.proofSha256 !== current.materializationSha256) {
      throw new Error("Replacement materialization proof is invalid");
    }
    if (!journal) {
      journal = {
        schema: retirementSchema,
        schemaVersion: 1,
        transaction,
        manifestSha256: manifest.manifestSha256,
        source,
        trash: join(backupRoot, `.retiring-${transaction}`),
        status: "planned",
      };
      atomicJson(journalPath, journal);
    }
    if (journal.status === "planned") {
      if (!existsSync(source) && existsSync(journal.trash)) {
        renameSync(journal.trash, source);
        syncDirectory(backupRoot);
      }
      if (!existsSync(source) || existsSync(journal.trash)) {
        throw new Error("Backup retirement paths do not match the durable journal");
      }
      verifyCurrentBackup(target, source);
      renameSync(source, journal.trash);
      syncDirectory(backupRoot);
      journal.status = "moved";
      atomicJson(journalPath, journal);
    }
    if (journal.status === "moved") {
      stat(journal.trash, true);
      rmSync(journal.trash, { recursive: true });
      journal.status = "removed";
      atomicJson(journalPath, journal);
    }
    rmSync(journalPath);
    syncDirectory(backupRoot);
    return { transaction: manifest.transaction, retired: true };
  } finally {
    unlock();
  }
}
