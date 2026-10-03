// Doctor can move workspace skills outside stateDir. Inventory those surfaces
// before shutdown, then repeat at the stopped snapshot boundary.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { inspectDatabaseCopy as inspectCopy } from "./native-sqlite-inspection.mjs";
import { atomicJson, fileDigest, inside, jsonDigest, treeDigest } from "./native-state.mjs";

const inspectDatabaseCopy = (path, inspect) => inspectCopy(path, inspect, "Workshop");

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const hashPattern = /^[a-f0-9]{64}$/;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const entries = (path) => existsSync(path) ? readdirSync(path).sort() : [];

export function workshopAgentsFromConfig(config, stateDir, resolveWorkspace) {
  const roster = config.agents?.entries ? Object.entries(config.agents.entries).map(([id, entry]) => ({ ...entry, id })) : config.agents?.list;
  if (!Array.isArray(roster) || !roster.length) throw new Error("Workshop migration requires an explicit agent roster");
  return roster.map((agent) => {
    // Defaults have owner-dependent semantics upstream. Never guess that every
    // omitted workspace shares the default directory.
    const workspace = agent.workspace ?? resolveWorkspace?.(config, agent.id, { ...process.env, OPENCLAW_STATE_DIR: stateDir });
    const agentDir = agent.agentDir ?? join(stateDir, "agents", agent.id, "agent");
    if (!idPattern.test(agent.id) || !isAbsolute(workspace ?? "") || !isAbsolute(agentDir)) throw new Error("Workshop migration requires explicit absolute configured paths");
    return { id: agent.id, workspace, agentDir };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export function assertWorkshopConfiguration(binding, config, stateDir, resolveWorkspace) {
  if (!binding) return;
  const actual = workshopAgentsFromConfig(config, stateDir, resolveWorkspace);
  if (jsonDigest(actual) !== jsonDigest([...binding.agents].sort((a, b) => a.id.localeCompare(b.id)))) {
    throw new Error("Workshop bindings differ from Doctor configuration");
  }
}

function containsPath(value, path) {
  if (typeof value === "string") return value.includes(path);
  if (value && typeof value === "object") return Object.values(value).some((child) => containsPath(child, path));
  return false;
}

function canonical(path) {
  if (!isAbsolute(path ?? "") || resolve(path) !== path) throw new Error("Workshop paths must be absolute and normalized");
  let parent = path;
  while (!existsSync(parent)) parent = dirname(parent);
  return resolve(realpathSync(parent), relative(parent, path));
}

function regularTree(path) {
  const stat = lstatSync(path);
  if (stat.isDirectory()) for (const name of readdirSync(path)) regularTree(join(path, name));
  else if (!stat.isFile() || stat.nlink !== 1) throw new Error("Workshop snapshot requires ordinary files and directories");
}

export function validateWorkshopBinding(target) {
  const binding = target.workshopMigration;
  if (binding === undefined) return;
  if (binding.schemaVersion !== 1 || !Array.isArray(binding.agents) || !binding.agents.length ||
      !Array.isArray(binding.ownerRepairs) || Object.keys(binding).some((key) => !["schemaVersion", "agents", "ownerRepairs"].includes(key))) {
    throw new Error("Invalid Workshop migration binding");
  }
  const ids = new Set();
  for (const agent of binding.agents) {
    if (!idPattern.test(agent.id) || ids.has(agent.id) ||
        Object.keys(agent).sort().join(",") !== "agentDir,id,workspace" ||
        !isAbsolute(agent.workspace ?? "") || !isAbsolute(agent.agentDir ?? "") ||
        !inside(resolve(target.stateDir), resolve(agent.agentDir))) {
      throw new Error("Workshop migration requires unique agents and state-owned destinations");
    }
    ids.add(agent.id);
    for (const path of [agent.workspace, agent.agentDir]) {
      if (resolve(path) !== path) throw new Error("Workshop binding path is not normalized");
      if (target.purpose === "rehearsal" && !inside(resolve(target.isolation?.root ?? "/missing"), path)) {
        throw new Error("Workshop rehearsal path escapes its test-owned root");
      }
    }
  }
  const repairs = new Set();
  for (const repair of binding.ownerRepairs) {
    if (!idPattern.test(repair.proposalId) || repairs.has(repair.proposalId) || !ids.has(repair.agentId) ||
        Object.keys(repair).sort().join(",") !== "agentId,draftSha256,proposalId,proposalSha256,rollbackSha256,skillSha256" ||
        ["proposalSha256", "draftSha256", "rollbackSha256", "skillSha256"].some((key) => !hashPattern.test(repair[key]))) {
      throw new Error("Invalid approved Workshop ownership repair");
    }
    repairs.add(repair.proposalId);
  }
}


function storedRecords(stateDir) {
  const records = [];
  const cron = [];
  const databasePath = join(stateDir, "state/openclaw.sqlite");
  if (existsSync(databasePath)) {
    inspectDatabaseCopy(databasePath, (db) => {
      db.exec("BEGIN");
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
      const rollbacks = new Map(tables.has("skill_workshop_proposal_rollbacks")
        ? db.prepare("SELECT * FROM skill_workshop_proposal_rollbacks ORDER BY proposal_id").all().map((row) => [row.proposal_id, row]) : []);
      if (tables.has("skill_workshop_proposals")) {
        for (const row of db.prepare("SELECT proposal_id,record_json,owner_agent_id FROM skill_workshop_proposals ORDER BY proposal_id").all()) {
          records.push({ record: JSON.parse(row.record_json), rowOwner: row.owner_agent_id, rollback: rollbacks.get(row.proposal_id) ?? null, source: "sqlite" });
          rollbacks.delete(row.proposal_id);
        }
      }
      if (rollbacks.size) throw new Error("Workshop has orphaned SQLite rollback records");
      if (tables.has("cron_jobs")) cron.push(...db.prepare("SELECT job_json FROM cron_jobs").all().map((row) => JSON.parse(row.job_json)));
    });
  }
  const root = join(stateDir, "skill-workshop/proposals");
  for (const id of entries(root)) {
    if (!idPattern.test(id)) throw new Error("Invalid legacy Workshop directory");
    const directory = join(root, id);
    regularTree(directory);
    if (!existsSync(join(directory, "proposal.json"))) {
      if (existsSync(join(directory, "rollback.json"))) throw new Error("Workshop has orphaned legacy rollback metadata");
      continue;
    }
    const record = readJson(join(directory, "proposal.json"));
    if (record.id !== id) throw new Error("Workshop proposal identity differs from its directory");
    records.push({ record, rollback: existsSync(join(directory, "rollback.json")) ? readJson(join(directory, "rollback.json")) : null,
      source: "sidecar", proposalSha256: fileDigest(join(directory, "proposal.json")), directory });
  }
  const legacyCron = join(stateDir, "cron/jobs.json");
  if (existsSync(legacyCron)) cron.push(readJson(legacyCron));
  return { records, cron };
}

function verifyRepair(item, repair) {
  const { record, directory } = item;
  if (item.source !== "sidecar" || record.origin !== undefined || record.status !== "applied" || record.kind !== "update" ||
      (record.supportFiles?.length ?? 0) !== 0 || !item.rollback || item.rollback.action !== "update" ||
      item.rollback.targetSkillFile !== record.target.skillFile || item.rollback.proposalId !== record.id ||
      item.proposalSha256 !== repair.proposalSha256 || record.draftHash !== repair.draftSha256 ||
      fileDigest(join(directory, "PROPOSAL.md")) !== repair.draftSha256 ||
      fileDigest(join(directory, "rollback.json")) !== repair.rollbackSha256 ||
      fileDigest(record.target.skillFile) !== repair.skillSha256) throw new Error("Approved Workshop ownership repair preconditions changed");
}

export function inspectWorkshopMigration(target, selectedCronJobs = []) {
  validateWorkshopBinding(target);
  if (entries(join(target.stateDir, "skill-workshop/collection-backups")).length) {
    throw new Error("Workshop collection backups require a separately rehearsed migration before shutdown");
  }
  const { records, cron } = storedRecords(target.stateDir);
  cron.push(...selectedCronJobs);
  const binding = target.workshopMigration;
  if (!binding && records.length) throw new Error("Workshop records require sealed agent and workspace bindings before shutdown");
  if (!binding) return null;
  const state = canonical(target.stateDir);
  const agents = binding.agents.map((agent) => ({ ...agent, workspace: canonical(agent.workspace), agentDir: canonical(agent.agentDir) }));
  const isolationRoot = target.purpose === "rehearsal" ? canonical(target.isolation.root) : null;
  if (isolationRoot && agents.some((agent) => !inside(isolationRoot, agent.workspace) || !inside(isolationRoot, agent.agentDir))) {
    throw new Error("Canonical Workshop rehearsal path escapes its test-owned root");
  }
  if (agents.some((agent) => !inside(state, agent.agentDir))) throw new Error("Workshop destination escapes snapshotted state");
  const external = new Map();
  const matchedRepairs = new Set();
  const inventory = [];
  for (const item of records) {
    const record = item.record;
    if (!idPattern.test(record.id) || !["create", "update"].includes(record.kind) ||
        !["pending", "applied", "rejected", "quarantined", "stale"].includes(record.status)) throw new Error("Invalid Workshop proposal metadata");
    if (record.status === "pending" && item.rollback) throw new Error("Workshop interrupted apply must be resolved before shutdown");
    const skillDir = canonical(record.target?.skillDir);
    if (isolationRoot && !inside(isolationRoot, skillDir)) throw new Error("Canonical Workshop skill escapes its test-owned root");
    if (canonical(record.target?.skillFile) !== join(skillDir, "SKILL.md")) throw new Error("Workshop skill file differs from its directory");
    const repair = binding.ownerRepairs.find((entry) => entry.proposalId === record.id);
    if (repair) {
      if (matchedRepairs.has(repair.proposalId)) throw new Error("Approved Workshop repair has duplicate stored records");
      verifyRepair(item, repair);
      matchedRepairs.add(repair.proposalId);
    }
    const workspaceOwners = agents.filter((agent) => [join(agent.workspace, "skills"), join(agent.workspace, ".agents/skills")]
      .some((root) => inside(root, skillDir) && root !== skillDir));
    const explicitOwner = item.rowOwner || record.origin?.agentId || /^agent:([^:]+):/.exec(record.origin?.sessionKey ?? "")?.[1] || repair?.agentId;
    const owner = explicitOwner ? agents.find((agent) => agent.id === explicitOwner) : workspaceOwners.length === 1 ? workspaceOwners[0] : undefined;
    if (!owner) throw new Error(`Workshop proposal ${record.id} requires explicit configured ownership before shutdown`);
    const ownedDestination = inside(join(owner.agentDir, "workshop-skills"), skillDir);
    if (!ownedDestination && !workspaceOwners.length) throw new Error("Workshop target is outside sealed workspaces");
    let historicalSkillDir;
    if (item.rollback) {
      const rollbackTarget = item.rollback.targetSkillFile ?? item.rollback.target_skill_file;
      if (canonical(rollbackTarget) !== join(skillDir, "SKILL.md")) {
        // Doctor relocates completed creates and retains their old rollback row.
        // It is history, not an interrupted apply. Keep both surfaces in the
        // inventory without changing ownership or rewriting the stored record.
        const key = record.target.skillKey;
        const originalRoots = [join(owner.workspace, "skills"), join(owner.workspace, ".agents/skills")];
        const migratedCreate = item.source === "sqlite" && item.rowOwner === owner.id &&
          record.kind === "create" && record.status === "applied" && record.target.source === "openclaw-workshop" &&
          typeof key === "string" && idPattern.test(key) &&
          skillDir === join(owner.agentDir, "workshop-skills", key) &&
          item.rollback.proposal_id === record.id && item.rollback.action === "create" &&
          originalRoots.some((root) => canonical(rollbackTarget) === join(root, key, "SKILL.md"));
        if (!migratedCreate) throw new Error("Workshop rollback target differs from proposal");
        historicalSkillDir = dirname(canonical(rollbackTarget));
        if (isolationRoot && !inside(isolationRoot, historicalSkillDir)) throw new Error("Canonical Workshop rollback escapes its test-owned root");
      }
    }
    if (item.source === "sidecar" && fileDigest(join(item.directory, "PROPOSAL.md")) !== record.draftHash) throw new Error("Workshop draft content differs from metadata");
    const moves = !ownedDestination && record.kind === "create" && record.status === "applied" && existsSync(skillDir);
    if (moves && cron.some((value) => containsPath(value, skillDir) || containsPath(value, record.target.skillDir))) throw new Error("Scheduled job references a Workshop skill scheduled to move");
    if (!inside(state, skillDir) && !external.has(skillDir)) {
      if (existsSync(skillDir)) regularTree(skillDir);
      external.set(skillDir, { path: skillDir, sha256: existsSync(skillDir) ? treeDigest(skillDir) : null });
    }
    if (historicalSkillDir && !inside(state, historicalSkillDir) && !external.has(historicalSkillDir)) {
      if (existsSync(historicalSkillDir)) regularTree(historicalSkillDir);
      external.set(historicalSkillDir, { path: historicalSkillDir, sha256: existsSync(historicalSkillDir) ? treeDigest(historicalSkillDir) : null });
    }
    inventory.push({ source: item.source, record, rollback: item.rollback, owner: owner.id,
      ...(item.proposalSha256 ? { proposalSha256: item.proposalSha256 } : {}) });
  }
  if (matchedRepairs.size !== binding.ownerRepairs.length) throw new Error("Approved Workshop repair record is missing");
  return { schemaVersion: 1, inventorySha256: jsonDigest(inventory), external: [...external.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}

export async function snapshotWorkshopMigration(target, recoveryDir, expected, operations) {
  const current = inspectWorkshopMigration(target);
  if (jsonDigest(current) !== jsonDigest(expected)) throw new Error("Workshop state changed after preflight");
  if (!current) return null;
  const external = [];
  for (const [index, entry] of current.external.entries()) {
    const snapshot = `workshop/${index}`;
    if (entry.sha256 !== null) {
      mkdirSync(join(recoveryDir, "workshop"), { recursive: true, mode: 0o700 });
      await operations.clone(entry.path, join(recoveryDir, snapshot));
      if (treeDigest(join(recoveryDir, snapshot)) !== entry.sha256 || treeDigest(entry.path) !== entry.sha256) throw new Error("Workshop skill changed while snapshotting");
    }
    external.push({ ...entry, snapshot });
  }
  return { ...current, external };
}

export function applyWorkshopOwnerRepairs(target) {
  // The caller has stopped writers and saved the complete original state.
  inspectWorkshopMigration(target);
  for (const repair of target.workshopMigration?.ownerRepairs ?? []) {
    const path = join(target.stateDir, "skill-workshop/proposals", repair.proposalId, "proposal.json");
    const mode = lstatSync(path).mode & 0o777;
    const record = readJson(path);
    if (fileDigest(path) !== repair.proposalSha256) throw new Error("Workshop ownership compare-and-swap failed");
    atomicJson(path, { ...record, origin: { agentId: repair.agentId } });
    chmodSync(path, mode);
  }
}

export function verifyWorkshopSnapshots(recoveryDir, snapshot) {
  for (const entry of snapshot?.external ?? []) {
    if (!/^workshop\/\d+$/.test(entry.snapshot) || !isAbsolute(entry.path)) throw new Error("Invalid Workshop recovery entry");
    if (entry.sha256 !== null && treeDigest(join(recoveryDir, entry.snapshot)) !== entry.sha256) throw new Error("Workshop recovery snapshot changed");
  }
}

export async function restoreWorkshopSnapshots(recoveryDir, snapshot, operations) {
  verifyWorkshopSnapshots(recoveryDir, snapshot);
  // Check every destination before restoring any of them. Existing paths must
  // match the old snapshot; never overwrite a concurrent workspace edit.
  for (const entry of snapshot?.external ?? []) {
    if (canonical(entry.path) !== entry.path || existsSync(entry.path) &&
        (entry.sha256 === null || treeDigest(entry.path) !== entry.sha256)) throw new Error("Workshop rollback found a changed external skill");
  }
  for (const entry of snapshot?.external ?? []) {
    if (entry.sha256 === null || existsSync(entry.path)) continue;
    const staging = join(dirname(entry.path), `.${basename(entry.path)}-${basename(recoveryDir)}.restore`);
    if (existsSync(staging)) {
      if (treeDigest(staging) !== entry.sha256) throw new Error("Workshop restore staging changed");
    } else await operations.clone(join(recoveryDir, entry.snapshot), staging);
    if (treeDigest(staging) !== entry.sha256) throw new Error("Workshop restored copy differs from snapshot");
    await operations.publishExclusive(staging, entry.path);
  }
  for (const entry of snapshot?.external ?? []) {
    if (entry.sha256 !== null && treeDigest(entry.path) !== entry.sha256) throw new Error("Workshop restoration did not complete");
  }
}
