// One verified current backup replaces old payloads, not their original evidence.
import { existsSync, lstatSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { acquireLock, atomicJson, fileDigest, jsonDigest } from "./native-state.mjs";
import { assertDeploymentOwnership } from "./deploy-coordination.mjs";
import { validateBackupTarget, verifyBackupRetirementIdentity, planCurrentBackup, captureCurrentBackup, materializeCurrentBackup } from "./native-backup.mjs";
import { reserveStageStorage, releaseStorage } from "./native-storage.mjs";
import { retentionChecks as checks } from "./native-backup-retention.mjs";

const schema = "puddles.single-backup-retention/v1";
const transaction = /^(activation|backup)-([0-9]+)-[0-9]+$/;
const hash = /^[a-f0-9]{64}$/;
const activationEntries = /^(recovery\.json|capacity-admission\.json|release-receipt\.json|failure\.json|rollback-failure\.json|package|state|service\.plist|candidate|candidate-service\.plist|restore-state|restore-package|failed-state|failed-package|failed-service\.plist|state-migration\.json|read-cache|workshop|additional-staging|command-[0-9]+\.log)$/;
const backupEntries = /^(runtime|state|service\.plist|backup\.json|backup-journal\.json|materialization\.json|(?:backup-)?command-[0-9]+\.log)$/;
const materializedEntries = /^(runtime|state|service\.plist|materialization\.json|(?:backup-)?command-[0-9]+\.log)$/;
const marker = "payload-retirement.json";
const digest = value => { const { sha256, ...body } = value; return jsonDigest(body); };

function replacementDependencies(target, recovery) {
  const backup = join(realpathSync(target.backupRoot), recovery.reference.transaction);
  const dependencies = new Set([backup, target.installDir, target.stateDir, target.plistPath,
    target.backupNode.path, target.backupNode.realPath ?? target.backupNode.path]);
  const walk = path => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const destination = resolve(dirname(path), readlinkSync(path));
      if (destination !== backup && !destination.startsWith(`${backup}/`)) {
        dependencies.add(destination);
        if (existsSync(destination)) dependencies.add(realpathSync(destination));
      }
    } else if (stat.isDirectory()) for (const child of readdirSync(path)) walk(join(path, child));
  };
  walk(join(backup, "runtime")); walk(join(backup, "state"));
  return [...dependencies].sort();
}

function protectDependencies(entry, dependencies) {
  for (const payload of entry.payloads) for (const dependency of dependencies) {
    if (dependency === payload.path || dependency.startsWith(`${payload.path}/`) ||
        dependency === payload.trash || dependency.startsWith(`${payload.trash}/`)) throw new Error("Payload is required by the verified backup");
  }
}

function references(root, policy) {
  const refs = join(root, "backup-references");
  checks.identity(refs);
  const files = {};
  const held = new Set(policy.protectedTransactions);
  for (const name of readdirSync(refs).sort()) {
    if (!name.endsWith(".json")) throw new Error("Unknown backup reference blocks retention");
    const path = join(refs, name), value = checks.read(path);
    files[name] = fileDigest(path);
    // previousTransaction in this producer's current reference is history, not
    // another recovery promise. Unknown references retain every mentioned ID.
    const scan = item => {
      if (typeof item === "string") for (const match of item.matchAll(/(?:activation|backup)-[0-9]+-[0-9]+/g)) held.add(match[0]);
      else if (item && typeof item === "object") Object.values(item).forEach(scan);
    };
    if (name === "latest-healthy-recovery.json" && value.schema === "puddles.openclaw-current-backup-reference/v1") held.add(value.transaction);
    else scan(value);
  }
  for (const name of ["latest-activation.json", "retention-context.json", "backup-retention-context.json", "backup-materializations.json"]) {
    files[name] = existsSync(join(root, name)) ? fileDigest(join(root, name)) : null;
  }
  return { files, held: [...held].sort() };
}

function pathRecord(path, trash) {
  return { path, trash, identity: checks.identity(path), inventorySha256: checks.inventoryDigest(path) };
}

function installations(target, name, policy) {
  const owned = checks.externalInstallations(target, name);
  if (policy.installations !== undefined && !Array.isArray(policy.installations)) throw new Error("Invalid installation adoption");
  const explicit = (policy.installations ?? []).filter(record => record.transaction === name);
  if (owned.length && explicit.length || explicit.length > 1) throw new Error("Duplicate installation ownership");
  return owned.length ? owned : explicit.map(record => {
    const journalPath = join(target.backupRoot, name, "recovery.json"), journal = checks.read(journalPath);
    if (fileDigest(journalPath) !== record.journalSha256 || record.path !== journal.prefix ||
        dirname(record.path) !== realpathSync(dirname(target.installDir)) ||
        !/^\.puddles-install-[0-9]+-[0-9]+$/.test(basename(record.path)) ||
        jsonDigest(checks.identity(record.path)) !== jsonDigest(record.identity)) throw new Error("Explicit installation ownership changed");
    for (const live of [target.installDir, target.stateDir, target.backupRoot]) {
      const canonical = realpathSync(live);
      if (record.path === canonical || record.path.startsWith(`${canonical}/`) || canonical.startsWith(`${record.path}/`)) throw new Error("Installation overlaps live paths");
    }
    return { path: record.path, trash: `${record.path}.retiring-${name}`, directory: record.identity,
      inventorySha256: checks.inventoryDigest(record.path) };
  });
}

function metadata(root, name, kind, path = join(root, name)) {
  const directory = checks.identity(path);
  const original = kind === "activation" ? checks.read(join(path, "recovery.json")) :
    kind === "backup" ? verifyBackupRetirementIdentity(path) : checks.read(join(path, "materialization.json"));
  if (kind === "activation" && (original.schemaVersion !== 1 || original.transaction !== name ||
      !hash.test(original.target ?? "") || !hash.test(original.artifact ?? "") ||
      !["healthy", "rolled-back", "failed-before-shutdown", "recovery-required"].includes(original.status))) {
    throw new Error("Activation is not closed or awaiting superseded recovery");
  }
  const allowed = kind === "activation" ? activationEntries : kind === "backup" ? backupEntries : materializedEntries;
  const evidence = [], payloads = [];
  for (const child of readdirSync(path).sort()) {
    if (!allowed.test(child)) throw new Error(`Unknown recovery entry blocks retention: ${child}`);
    const value = join(path, child), stat = lstatSync(value);
    if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new Error("Unexpected recovery entry type");
    if (stat.isDirectory()) payloads.push(pathRecord(value, join(root, `.retiring-${name}-${child}`)));
    else {
      // Original journals, failures and receipts remain at their original paths.
      // Command logs are retained as evidence too; no contents are rebaselined.
      evidence.push({ name: child, sha256: fileDigest(value) });
    }
  }
  return { transaction: name, kind, path, directory, evidence, payloads };
}

function materializations(root, policy) {
  const registry = join(root, "backup-materializations.json");
  const registered = existsSync(registry) ? checks.read(registry) : { schemaVersion: 1, entries: [] };
  if (registered.schemaVersion !== 1 || !Array.isArray(registered.entries) ||
      policy.materializations !== undefined && !Array.isArray(policy.materializations)) throw new Error("Invalid materialization ownership");
  const values = [...registered.entries, ...(policy.materializations ?? [])];
  const seen = new Set();
  return values.filter(record => {
    if (!isAbsolute(record.path ?? "") || !/^backup-[0-9]+-[0-9]+$/.test(record.transaction ?? "") ||
        !hash.test(record.proofSha256 ?? "") || !record.identity) throw new Error("Materialization requires exact producer ownership");
    if (seen.has(record.path)) throw new Error("Duplicate materialization ownership");
    seen.add(record.path); return true;
  });
}

function allPaths(entries) {
  return entries.flatMap(entry => [entry.path, ...entry.payloads.flatMap(p => [p.path, p.trash])]);
}

export async function planSingleBackupRetention(target, policy, execute) {
  validateBackupTarget(target); checks.validatePolicy(policy);
  const root = realpathSync(target.backupRoot), unlock = acquireLock(root);
  try {
    const recovery = await checks.replacement(target, policy, execute);
    const dependencies = replacementDependencies(target, recovery);
    const refs = references(root, policy), entries = [], excluded = [];
    for (const name of readdirSync(root).filter(name => transaction.test(name)).sort()) {
      if (refs.held.includes(name) || policy.transactions && !policy.transactions.includes(name) ||
          Date.now() - Number(name.match(transaction)[2]) < policy.minAgeHours * 3600_000 ||
          existsSync(join(root, name, marker))) continue;
      try {
        const entry = metadata(root, name, name.startsWith("activation-") ? "activation" : "backup");
        if (entry.kind === "activation") {
          const external = installations(target, name, policy);
          checks.assertNoExternalReferences(root, { transaction: name, externalInstallations: external });
          entry.externalInstallations = external;
          entry.payloads.push(...external.map(value => ({ path: value.path, trash: value.trash, identity: value.directory, inventorySha256: value.inventorySha256 })));
        }
        protectDependencies(entry, dependencies);
        entries.push(entry);
      } catch (error) { excluded.push({ transaction: name, reason: error.message }); }
    }
    for (const record of materializations(root, policy)) {
      if (policy.transactions && !policy.transactions.includes(record.transaction) || policy.protectedTransactions.includes(record.transaction)) continue;
      try {
        if (existsSync(join(record.path, marker))) continue;
        if (jsonDigest(checks.identity(record.path)) !== jsonDigest(record.identity)) throw new Error("Materialization directory identity changed");
        for (const managed of [target.backupRoot, target.installDir, target.stateDir, dirname(target.plistPath)]) {
          const path = realpathSync(managed);
          if (record.path === path || record.path.startsWith(`${path}/`) || path.startsWith(`${record.path}/`)) throw new Error("Materialization overlaps managed paths");
        }
        const proofPath = join(record.path, "materialization.json");
        for (const name of readdirSync(join(root, "backup-references"))) {
          const scan = value => {
            if (typeof value === "string" && (value === record.path || value.startsWith(`${record.path}/`))) throw new Error("Materialization has a retained recovery reference");
            if (value && typeof value === "object") Object.values(value).forEach(scan);
          };
          scan(checks.read(join(root, "backup-references", name)));
        }
        const sourceProof = join(root, record.transaction, "materialization.json");
        const proof = checks.read(proofPath);
        const { proofSha256, ...proofBody } = proof;
        if (proof.schema !== "puddles.openclaw-current-backup-materialization/v1" || proof.transaction !== record.transaction || proofSha256 !== jsonDigest(proofBody) ||
            proof.proofSha256 !== record.proofSha256 || jsonDigest(proof) !== jsonDigest(checks.read(sourceProof))) throw new Error("Materialization proof changed");
        // Explicit path and directory identity disambiguate multiple validations.
        const id = `materialization-${jsonDigest(record).slice(0, 24)}`;
        const entry = { ...metadata(root, id, "materialization", record.path), sourceTransaction: record.transaction };
        protectDependencies(entry, dependencies);
        entries.push(entry);
      } catch (error) { excluded.push({ transaction: record.transaction, reason: error.message }); }
    }
    const active = await checks.consumers(policy, allPaths(entries), execute);
    const eligible = entries.filter(entry => {
      if (allPaths([entry]).some(path => active.includes(path))) { excluded.push({ transaction: entry.transaction, reason: "Active or uncertain consumer" }); return false; }
      return true;
    }).slice(0, policy.maxBatch);
    const plan = { schema, schemaVersion: 1, root, targetSha256: jsonDigest(target), policySha256: jsonDigest(policy),
      createdAt: new Date().toISOString(), references: refs, recovery, entries: eligible, excluded };
    return { ...plan, sha256: digest(plan) };
  } finally { unlock(); }
}

export async function applySingleBackupRetention(target, policy, plan, execute) {
  assertDeploymentOwnership(target, "PROD"); validateBackupTarget(target); checks.validatePolicy(policy);
  const root = realpathSync(target.backupRoot);
  if (plan.schema !== schema || plan.sha256 !== digest(plan) || plan.root !== root ||
      plan.targetSha256 !== jsonDigest(target) || plan.policySha256 !== jsonDigest(policy) || !Array.isArray(plan.entries) ||
      plan.entries.length > policy.maxBatch || new Set(plan.entries.map(e => e.transaction)).size !== plan.entries.length) throw new Error("Retention plan identity is invalid");
  const unlock = acquireLock(root);
  try {
    if (jsonDigest(await checks.replacement(target, policy, execute)) !== jsonDigest(plan.recovery)) throw new Error("Verified replacement changed after retention plan");
    const dependencies = replacementDependencies(target, plan.recovery);
    const states = plan.entries.map(entry => {
      protectDependencies(entry, dependencies);
      if (!["activation", "backup", "materialization"].includes(entry.kind) ||
          entry.kind !== "materialization" && !transaction.test(entry.transaction) ||
          entry.kind === "materialization" && !/^materialization-[a-f0-9]{24}$/.test(entry.transaction)) throw new Error("Invalid recovery producer");
      if (entry.kind === "materialization" && !materializations(root, policy).some(record => record.path === entry.path &&
          `materialization-${jsonDigest(record).slice(0, 24)}` === entry.transaction && jsonDigest(record.identity) === jsonDigest(entry.directory))) throw new Error("Materialization ownership changed");
      if (entry.kind !== "materialization" && (entry.path !== join(root, entry.transaction) || plan.references.held.includes(entry.transaction))) throw new Error("Protected recovery in retention plan");
      for (const payload of entry.payloads) {
        for (const live of [target.installDir, target.stateDir]) {
          const canonical = realpathSync(live);
          if (payload.path === canonical || payload.path.startsWith(`${canonical}/`) || canonical.startsWith(`${payload.path}/`)) throw new Error("Payload overlaps live runtime or state");
        }
        const external = entry.externalInstallations?.some(value => value.path === payload.path && value.trash === payload.trash);
        if (!external && (dirname(payload.path) !== entry.path || payload.trash !== join(root, `.retiring-${entry.transaction}-${basename(payload.path)}`))) throw new Error("Invalid payload retirement path");
      }
      const path = join(root, `retention-${entry.transaction}.json`);
      const journal = existsSync(path) ? checks.read(path) : { schema, planSha256: plan.sha256, entry, status: "planned", payloads: entry.payloads.map(() => "planned") };
      if (journal.schema !== schema || journal.planSha256 !== plan.sha256 || jsonDigest(journal.entry) !== jsonDigest(entry) ||
          !["planned", "removed"].includes(journal.status) || journal.payloads.length !== entry.payloads.length ||
          journal.payloads.some(value => !["planned", "moved", "deleting", "removed"].includes(value))) throw new Error("Retention journal identity is invalid");
      return { entry, path, journal };
    });
    const verify = async () => {
      if (jsonDigest(references(root, policy)) !== jsonDigest(plan.references)) throw new Error("Recovery references changed after retention plan");
      if ((await checks.consumers(policy, allPaths(states.filter(s => s.journal.status !== "removed").map(s => s.entry)), execute)).length) throw new Error("Active or uncertain consumer blocks retention batch");
      if (jsonDigest(references(root, policy)) !== jsonDigest(plan.references)) throw new Error("Recovery references changed after retention plan");
      for (const { entry, journal } of states) {
        if (jsonDigest(checks.identity(entry.path)) !== jsonDigest(entry.directory)) throw new Error("Recovery directory identity changed");
        for (const file of entry.evidence) if (fileDigest(join(entry.path, file.name)) !== file.sha256) throw new Error("Original recovery evidence changed");
        const expected = new Set([...entry.evidence.map(f => f.name), ...entry.payloads.filter(p => dirname(p.path) === entry.path).map(p => basename(p.path)), marker]);
        if (readdirSync(entry.path).some(name => !expected.has(name))) throw new Error("Unexpected recovery content after plan");
        if (entry.externalInstallations) checks.assertNoExternalReferences(root, entry);
        for (const [index, payload] of entry.payloads.entries()) {
          const status = journal.payloads[index], source = existsSync(payload.path), trash = existsSync(payload.trash);
          if (status === "removed") { if (source || trash) throw new Error("Retired payload reappeared"); continue; }
          if (source && trash || source && status !== "planned" || !source && !trash && status !== "deleting") throw new Error("Retirement payload paths changed");
          if (source || trash) {
            const path = source ? payload.path : payload.trash;
            if (jsonDigest(checks.identity(path)) !== jsonDigest(payload.identity) || status !== "deleting" && checks.inventoryDigest(path) !== payload.inventorySha256) throw new Error("Recovery payload changed after plan");
          }
        }
      }
    };
    for (const state of states) {
      const { entry, journal, path } = state;
      await verify();
      if (journal.status === "removed") continue;
      const save = () => { atomicJson(path, journal); checks.sync(root); };
      for (const [index, payload] of entry.payloads.entries()) {
        if (journal.payloads[index] === "removed") continue;
        await verify(); save();
        if (journal.payloads[index] === "planned") {
          if (existsSync(payload.path)) { renameSync(payload.path, payload.trash); checks.sync(dirname(payload.path)); checks.sync(dirname(payload.trash)); }
          journal.payloads[index] = "moved"; save();
        }
        await verify(); journal.payloads[index] = "deleting"; save();
        if (existsSync(payload.trash)) rmSync(payload.trash, { recursive: true });
        checks.sync(dirname(payload.trash)); journal.payloads[index] = "removed"; save();
      }
      atomicJson(join(entry.path, marker), { schema, planSha256: plan.sha256, replacement: plan.recovery, evidence: entry.evidence });
      journal.status = "removed"; save();
    }
    return { schema, planSha256: plan.sha256, retired: states.map(s => s.entry.transaction) };
  } finally { unlock(); }
}

export async function runSingleBackupRetention(target, policy, execute) {
  assertDeploymentOwnership(target, "PROD");
  const path = join(target.backupRoot, "retention-plan.json");
  let plan = existsSync(path) ? checks.read(path) : null;
  if (!plan) { plan = await planSingleBackupRetention(target, policy, execute); atomicJson(path, plan); }
  const result = await applySingleBackupRetention(target, policy, plan, execute);
  atomicJson(join(target.backupRoot, "retention-result.json"), { ...result, excluded: plan.excluded, completedAt: new Date().toISOString() });
  rmSync(path); checks.sync(target.backupRoot);
  return result;
}

// Called by the existing maintenance controller after a healthy release. Old
// authority remains untouched until capture and isolated validation succeed.
export async function refreshSingleBackup(target, policy, work, execute, operationsFactory) {
  assertDeploymentOwnership(target, "PROD"); checks.validatePolicy(policy);
  if (policy.mode !== "single-verified-backup") throw new Error("Backup refresh requires single replacement policy");
  const plan = planCurrentBackup(target);
  const reservation = reserveStageStorage(`backup-${process.pid}`, target.backupRoot, plan.requiredBytes);
  try {
    const captured = await captureCurrentBackup(target, operationsFactory);
    await materializeCurrentBackup(target, captured.directory, join(realpathSync(work), `materialized-${basename(captured.directory)}-${randomUUID()}`), operationsFactory);
    return await runSingleBackupRetention(target, policy, execute);
  } finally { releaseStorage(reservation.root, reservation.token); }
}
