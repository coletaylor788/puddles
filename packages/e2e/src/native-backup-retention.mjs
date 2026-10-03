import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, openSync, fsyncSync, closeSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { acquireLock, atomicJson, fileDigest, jsonDigest } from "./native-state.mjs";
import { currentBackupRecovery, validateBackupTarget } from "./native-backup.mjs";
import { validateTarget, verifyCurrentActivationRecovery, verifyNodeFile } from "./native-activation.mjs";
import { assertDeploymentOwnership } from "./deploy-coordination.mjs";
import { runCommand } from "./process-runner.mjs";

const schema = "puddles.openclaw-backup-retention/v1";
const activation = /^activation-([0-9]+)-[0-9]+$/;
const hash = /^[a-f0-9]{64}$/;
const terminal = ["healthy", "rolled-back"];
const allowed = /^(recovery\.json|release-receipt\.json|failure\.json|rollback-failure\.json|package|state|service\.plist|candidate|candidate-service\.plist|restore-state|restore-package|failed-state|failed-package|failed-service\.plist|state-migration\.json|read-cache|workshop|additional-staging|command-[0-9]+\.log)$/;
function realDirectory(path) {
  const s = lstatSync(path);
  if (!s.isDirectory() || s.isSymbolicLink() || realpathSync(path) !== resolve(path)) throw new Error("Retention requires canonical real directories");
  return s;
}
function read(path) {
  const s = lstatSync(path);
  if (!s.isFile() || s.isSymbolicLink()) throw new Error("Retention metadata must be a regular file");
  return JSON.parse(readFileSync(path, "utf8"));
}
function sync(root) { const fd = openSync(root, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } }
function identity(path) { const s = realDirectory(path); return { dev: s.dev, ino: s.ino, birthtimeMs: s.birthtimeMs }; }
function validateRetentionTarget(target, policy) {
  if (policy.replacement?.kind !== "activation") return validateBackupTarget(target);
  validateTarget(target);
  if (target.purpose !== "production") throw new Error("Retention requires a production target");
}
function validatePolicy(policy) {
  if (policy.schemaVersion !== 1 || !Number.isFinite(policy.minAgeHours) || policy.minAgeHours < 24 ||
      !Number.isInteger(policy.keepRecent) || policy.keepRecent < 2 ||
      !Number.isInteger(policy.maxBatch) || policy.maxBatch < 1 || policy.maxBatch > 32 ||
      !Array.isArray(policy.protectedTransactions) || policy.protectedTransactions.some(x => !activation.test(x)) ||
      policy.transactions !== undefined && (!Array.isArray(policy.transactions) || policy.transactions.some(x => !activation.test(x))) ||
      !isAbsolute(policy.consumerCheck?.command ?? "") || !hash.test(policy.consumerCheck?.sha256 ?? "") ||
      !Array.isArray(policy.consumerCheck?.args) || policy.consumerCheck.args.some(x => typeof x !== "string")) {
    throw new Error("Retention policy is invalid");
  }
  if (fileDigest(policy.consumerCheck.command) !== policy.consumerCheck.sha256) throw new Error("Retention consumer checker changed");
  return policy;
}
function currentReferences(target, policy) {
  const root = realpathSync(target.backupRoot);
  const latestPath = join(root, "latest-activation.json");
  const latest = read(latestPath);
  if (!activation.test(latest.transaction ?? "") || !hash.test(latest.target ?? "")) throw new Error("Latest activation is invalid");
  const currentDir = join(root, latest.transaction);
  realDirectory(currentDir);
  const journalPath = join(currentDir, "recovery.json");
  const journal = read(journalPath);
  if (journal.schemaVersion !== 1 || journal.transaction !== latest.transaction || journal.target !== latest.target ||
      !terminal.includes(journal.status) || journal.quiesced !== false || journal.snapshotReady !== true) throw new Error("Current activation is not terminal and recoverable");
  const predecessor = journal.coordination?.baseline;
  if (!activation.test(predecessor ?? "")) throw new Error("Current activation predecessor is unknown");
  realDirectory(join(root, predecessor));
  const referenceRoot = join(root, "backup-references");
  realDirectory(referenceRoot);
  const references = {};
  const protectedTransactions = new Set([latest.transaction, predecessor, ...policy.protectedTransactions]);
  for (const name of readdirSync(referenceRoot).sort()) {
    if (!name.endsWith(".json")) throw new Error("Unknown backup reference blocks retention");
    const path = join(referenceRoot, name);
    const reference = read(path);
    // Additional references may have a different owner/schema. Preserve all IDs
    // they mention instead of treating an unfamiliar owner as deletion authority.
    const scan = value => {
      if (typeof value === "string") {
        for (const match of value.matchAll(/activation-[0-9]+-[0-9]+/g)) protectedTransactions.add(match[0]);
      } else if (value && typeof value === "object") for (const child of Object.values(value)) scan(child);
    };
    scan(reference);
    references[name] = fileDigest(path);
  }
  return { latestSha256: fileDigest(latestPath), journalSha256: fileDigest(journalPath),
    retentionContextSha256: existsSync(join(root, "retention-context.json")) ? fileDigest(join(root, "retention-context.json")) : null, references,
    protectedTransactions: [...protectedTransactions].sort() };
}
function inventoryDigest(root) {
  const inventory = [];
  const walk = (directory, prefix) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const child = prefix ? `${prefix}/${name}` : name;
      const s = lstatSync(path);
      if (!s.isDirectory() && !s.isFile() && !s.isSymbolicLink()) throw new Error("Unexpected activation content type");
      inventory.push([child, s.dev, s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs,
        s.isSymbolicLink() ? readlinkSync(path) : null]);
      if (s.isDirectory()) walk(path, child);
    }
  };
  walk(root, "");
  return jsonDigest(inventory);
}
function generation(root, transaction, directoryPath) {
  if (!activation.test(transaction)) throw new Error("Invalid activation transaction");
  const source = directoryPath ?? join(root, transaction);
  const directory = identity(source);
  const journalPath = join(source, "recovery.json");
  const journal = read(journalPath);
  if (journal.schemaVersion !== 1 || journal.transaction !== transaction || !terminal.includes(journal.status) ||
      journal.quiesced !== false || journal.snapshotReady !== true || !hash.test(journal.target ?? "") ||
      !hash.test(journal.artifact ?? "") || !["package", "state", "service"].every(k => hash.test(journal.snapshots?.[k] ?? ""))) {
    throw new Error(`Activation is not a terminal snapshot: ${transaction}`);
  }
  const entries = readdirSync(source).sort().map(name => {
    if (!allowed.test(name)) throw new Error(`Unknown activation entry blocks retention: ${name}`);
    const s = lstatSync(join(source, name));
    if (s.isSymbolicLink() || !s.isDirectory() && !s.isFile()) throw new Error("Unexpected activation entry type");
    return { name, type: s.isDirectory() ? "directory" : "file", dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs };
  });
  return { transaction, directory, journalSha256: fileDigest(journalPath), status: journal.status,
    artifactSha256: journal.artifact, snapshots: journal.snapshots, entries, inventorySha256: inventoryDigest(source) };
}
async function consumers(policy, paths, execute) {
  validatePolicy(policy);
  if (!paths.length) return [];
  const output = await execute(policy.consumerCheck.command, [...policy.consumerCheck.args, JSON.stringify(paths)], {
    quiet: true, capture: true, timeoutMs: 60_000, maxOutputBytes: 1024 * 1024,
  });
  const proof = JSON.parse(output);
  if (proof.schemaVersion !== 1 || jsonDigest(proof.checkedPaths) !== jsonDigest(paths) ||
      !Array.isArray(proof.activePaths) || proof.activePaths.some(p => !paths.includes(p))) throw new Error("Incomplete retention consumer proof");
  return proof.activePaths;
}
async function replacement(target, policy, execute) {
  if (policy.replacement?.kind === "activation") {
    const root = realpathSync(target.backupRoot);
    const latestPath = join(root, "latest-activation.json");
    const latest = read(latestPath);
    if (!activation.test(latest.transaction ?? "")) throw new Error("Invalid current activation");
    const directory = join(root, latest.transaction);
    const verified = verifyCurrentActivationRecovery(target, directory, latestPath, policy.replacement.receipt);
    const journal = read(join(directory, "recovery.json"));
    // An activation contains the predecessor needed for rollback. Both saved
    // interpreter identities remain prerequisites when the release migrated Node.
    if (journal.nodeMigration) {
      verifyNodeFile(journal.nodeMigration.expected);
      verifyNodeFile(journal.nodeMigration.desired);
    } else {
      const receipt = read(policy.replacement.receipt.path);
      if (receipt.tools.node !== process.version || receipt.tools.nodeBinary !== fileDigest(process.execPath)) throw new Error("Rollback interpreter differs from retained receipt");
      verifyNodeFile({ path: realpathSync(process.execPath), sha256: receipt.tools.nodeBinary });
    }
    if (target.browser) {
      const id = journal.previousBrowser;
      if (!/^sha256:[a-f0-9]{64}$/.test(id ?? "")) throw new Error("Rollback browser identity missing");
      const found = (await execute("docker", ["image", "inspect", "--format", "{{.Id}}", id], {
        quiet: true, capture: true, timeoutMs: 60_000,
      })).trim();
      if (found !== id) throw new Error("Rollback browser image is unavailable");
    }
    return verified;
  }
  if (policy.replacement?.kind !== "backup") throw new Error("Retention requires an explicit replacement kind");
  const recovery = currentBackupRecovery(target);
  if (recovery.manifest.browser) {
    const id = recovery.manifest.browser.imageId;
    const found = (await execute("docker", ["image", "inspect", "--format", "{{.Id}}", id], {
      quiet: true, capture: true, timeoutMs: 60_000,
    })).trim();
    if (found !== id) throw new Error("Replacement browser image is unavailable");
  }
  return { reference: recovery.reference, manifestSha256: recovery.manifest.manifestSha256, proofSha256: recovery.proof.proofSha256 };
}
function planDigest(plan) { const { sha256, ...body } = plan; return jsonDigest(body); }
function pathsFor(root, entries) { return entries.flatMap(e => [join(root, e.transaction), join(root, `.retiring-${e.transaction}`)]); }

// The plan adopts only producer-owned terminal generations. It binds compact
// immutable recovery metadata and filesystem identities, not the age alone.
export async function planBackupRetention(target, policy, execute = runCommand) {
  validateRetentionTarget(target, policy);
  validatePolicy(policy);
  const root = realpathSync(target.backupRoot);
  const unlock = acquireLock(root);
  try {
    const references = currentReferences(target, policy);
    const recovery = await replacement(target, policy, execute);
    const names = readdirSync(root).filter(n => activation.test(n)).sort((a, b) => Number(b.match(activation)[1]) - Number(a.match(activation)[1]));
    const held = new Set([...references.protectedTransactions, ...names.slice(0, policy.keepRecent)]);
    const excluded = [];
    const entries = [];
    for (const name of names.reverse()) {
      if (held.has(name) || policy.transactions && !policy.transactions.includes(name) ||
          Date.now() - Number(name.match(activation)[1]) < policy.minAgeHours * 3600_000) continue;
      try { entries.push(generation(root, name)); }
      catch (error) { excluded.push({ transaction: name, reason: error.message }); }
    }
    const active = await consumers(policy, pathsFor(root, entries), execute);
    const eligible = entries.filter(e => {
      if (pathsFor(root, [e]).some(p => active.includes(p))) {
        excluded.push({ transaction: e.transaction, reason: "Active or uncertain consumer" }); return false;
      }
      return true;
    }).slice(0, policy.maxBatch);
    const plan = { schema, schemaVersion: 1, targetSha256: jsonDigest(target), policySha256: jsonDigest(policy),
      createdAt: new Date().toISOString(), root, references, recovery, entries: eligible, excluded };
    plan.sha256 = planDigest(plan);
    return plan;
  } finally { unlock(); }
}

export async function applyBackupRetention(target, policy, plan, execute = runCommand) {
  assertDeploymentOwnership(target, "PROD");
  validateRetentionTarget(target, policy);
  validatePolicy(policy);
  const root = realpathSync(target.backupRoot);
  if (plan.schema !== schema || plan.schemaVersion !== 1 || plan.root !== root || plan.sha256 !== planDigest(plan) ||
      plan.targetSha256 !== jsonDigest(target) || plan.policySha256 !== jsonDigest(policy) ||
      !Array.isArray(plan.entries) || plan.entries.length > policy.maxBatch ||
      new Set(plan.entries.map(e => e.transaction)).size !== plan.entries.length ||
      plan.entries.some(e => !activation.test(e.transaction) || plan.references.protectedTransactions.includes(e.transaction) ||
        Date.now() - Number(e.transaction.match(activation)[1]) < policy.minAgeHours * 3600_000)) throw new Error("Retention plan identity is invalid");
  const unlock = acquireLock(root);
  try {
    const verifyReferences = () => {
      if (jsonDigest(currentReferences(target, policy)) !== jsonDigest(plan.references)) throw new Error("Recovery references changed after retention plan");
    };
    verifyReferences();
    if (jsonDigest(await replacement(target, policy, execute)) !== jsonDigest(plan.recovery)) throw new Error("Verified replacement changed after retention plan");
    const states = plan.entries.map(entry => {
      const source = join(root, entry.transaction);
      const trash = join(root, `.retiring-${entry.transaction}`);
      const journalPath = join(root, `retention-${entry.transaction}.json`);
      const journal = existsSync(journalPath) ? read(journalPath) : { schema, planSha256: plan.sha256, entry, status: "planned" };
      if (journal.schema !== schema || journal.planSha256 !== plan.sha256 || jsonDigest(journal.entry) !== jsonDigest(entry) ||
          !["planned", "moved", "deleting", "removed"].includes(journal.status)) throw new Error("Retention journal identity is invalid");
      return { entry, source, trash, journalPath, journal };
    });
    const verifyPending = async () => {
      verifyReferences();
      const pending = states.filter(s => s.journal.status !== "removed");
      if ((await consumers(policy, pathsFor(root, pending.map(s => s.entry)), execute)).length) throw new Error("Active or uncertain consumer blocks retention batch");
      verifyReferences();
      // Every remaining path is checked again before *each* destructive step.
      for (const s of states) {
        if (s.journal.status === "removed") {
          if (existsSync(s.source) || existsSync(s.trash)) throw new Error("Retired activation reappeared");
        } else if (s.journal.status === "planned" && existsSync(s.source)) {
          if (existsSync(s.trash) || jsonDigest(generation(root, s.entry.transaction)) !== jsonDigest(s.entry)) throw new Error("Activation changed after retention plan");
        } else {
          if (existsSync(s.source)) throw new Error("Retirement source reappeared");
          if (!existsSync(s.trash)) {
            if (s.journal.status !== "deleting") throw new Error("Retirement tombstone missing");
          } else {
            if (jsonDigest(identity(s.trash)) !== jsonDigest(s.entry.directory)) throw new Error("Retirement tombstone identity changed");
            if (s.journal.status !== "deleting" && jsonDigest(generation(root, s.entry.transaction, s.trash)) !== jsonDigest(s.entry)) throw new Error("Moved activation changed after retention plan");
          }
        }
      }
    };
    for (const s of states) {
      await verifyPending();
      if (s.journal.status === "removed") continue;
      const save = status => { s.journal.status = status; atomicJson(s.journalPath, s.journal); sync(root); };
      if (s.journal.status === "planned") {
        save("planned");
        if (existsSync(s.source)) { renameSync(s.source, s.trash); sync(root); }
        save("moved");
      }
      await verifyPending();
      save("deleting");
      if (existsSync(s.trash)) rmSync(s.trash, { recursive: true });
      sync(root);
      save("removed");
    }
    return { schema, planSha256: plan.sha256, retired: states.map(s => s.entry.transaction) };
  } finally { unlock(); }
}

// A lifecycle caller keeps this exact manifest until all interrupted deletes
// finish. A subsequent invocation produces a new bounded plan from fresh facts.
export async function runBackupRetention(target, policy, execute = runCommand) {
  assertDeploymentOwnership(target, "PROD");
  const root = realpathSync(target.backupRoot);
  const path = join(root, "retention-plan.json");
  let plan = existsSync(path) ? read(path) : null;
  if (plan) {
    validateRetentionTarget(target, policy);
    validatePolicy(policy);
    const unlock = acquireLock(root);
    try {
      if (plan.schema !== schema || plan.sha256 !== planDigest(plan) || plan.root !== root) throw new Error("Stored retention plan is invalid");
      const changed = plan.targetSha256 !== jsonDigest(target) || plan.policySha256 !== jsonDigest(policy) ||
        jsonDigest(currentReferences(target, policy)) !== jsonDigest(plan.references);
      if (changed) {
        // A blocked plan with no mutation is disposable. Never refresh authority
        // around a partially deleted recovery or lose its external journal.
        for (const entry of plan.entries) {
          const journalPath = join(root, `retention-${entry.transaction}.json`);
          const journal = existsSync(journalPath) ? read(journalPath) : null;
          if (existsSync(join(root, `.retiring-${entry.transaction}`)) ||
              journal && (journal.planSha256 !== plan.sha256 || journal.status !== "planned") ||
              jsonDigest(generation(root, entry.transaction)) !== jsonDigest(entry)) {
            throw new Error("Changed recovery requires reconciliation of partially applied retention");
          }
        }
        for (const entry of plan.entries) rmSync(join(root, `retention-${entry.transaction}.json`), { force: true });
        rmSync(path);
        sync(root);
        plan = null;
      }
    } finally { unlock(); }
  }
  if (!plan) {
    plan = await planBackupRetention(target, policy, execute);
    atomicJson(path, plan);
  }
  const result = await applyBackupRetention(target, policy, plan, execute);
  atomicJson(join(root, "retention-result.json"), { ...result, completedAt: new Date().toISOString(), excluded: plan.excluded });
  rmSync(path);
  sync(root);
  return result;
}
