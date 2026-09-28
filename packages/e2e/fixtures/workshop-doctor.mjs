import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { seedWorkshopProposal } from "./workshop-migration.mjs";
import { applyWorkshopOwnerRepairs, assertWorkshopConfiguration, inspectWorkshopMigration, restoreWorkshopSnapshots, snapshotWorkshopMigration, workshopAgentsFromConfig } from "../src/native-workshop-migration.mjs";
import { treeDigest } from "../src/native-state.mjs";

const [mode, candidate, root] = process.argv.slice(2);
const stateDir = join(root, "state");
if (mode === "doctor") {
  const deny = () => { throw new Error("Network is forbidden in Workshop migration fixture"); };
  globalThis.fetch = deny;
  http.request = http.get = https.request = https.get = deny;
  net.connect = net.createConnection = net.Socket.prototype.connect = deny;
  const { migrateLegacySkillWorkshopProposals } = await import(pathToFileURL(join(candidate, "src/commands/doctor-skill-workshop-sqlite.ts")));
  const { resolveAgentWorkspaceDir } = await import(pathToFileURL(join(candidate, "src/agents/agent-scope-config.ts")));
  const implicit = { agents: { ownership: "explicit", defaults: { workspace: join(root, "default") }, entries: { main: {}, reader: {} } } };
  const resolved = workshopAgentsFromConfig(implicit, stateDir, resolveAgentWorkspaceDir);
  assert.equal(resolved.find((entry) => entry.id === "reader").workspace, join(root, "default/reader"));
  assertWorkshopConfiguration({ agents: resolved }, implicit, stateDir, resolveAgentWorkspaceDir);
  resolved.find((entry) => entry.id === "reader").workspace = join(root, "default");
  assert.throws(() => assertWorkshopConfiguration({ agents: resolved }, implicit, stateDir, resolveAgentWorkspaceDir), /Doctor configuration/);
  const result = await migrateLegacySkillWorkshopProposals({ config: JSON.parse(readFileSync(join(stateDir, "openclaw.json"), "utf8")), env: process.env });
  process.stdout.write(JSON.stringify(result));
} else {
  assert.equal(mode, "rehearse");
  const workspace = join(root, "external-workspace");
  const recovery = join(root, "recovery");
  mkdirSync(recovery, { recursive: true });
  const update = seedWorkshopProposal({ stateDir, workspace });
  const created = seedWorkshopProposal({ stateDir, workspace, name: "fixture-created", kind: "create", owner: "main" });
  const agents = ["main", "reader"].map((id) => ({ id, workspace, agentDir: join(stateDir, "agents", id, "agent") }));
  writeFileSync(join(stateDir, "openclaw.json"), JSON.stringify({ agents: { ownership: "explicit", entries: Object.fromEntries(agents.map(({ id, ...entry }) => [id, entry])) } }));
  const target = { stateDir, purpose: "rehearsal", isolation: { root }, workshopMigration: { schemaVersion: 1, agents, ownerRepairs: [] } };
  assert.throws(() => inspectWorkshopMigration(target), /explicit configured ownership/);
  target.workshopMigration.ownerRepairs.push(update.repair);
  const operations = {
    async clone(from, to) { cpSync(from, to, { recursive: true, force: false, errorOnExist: true }); },
    async publishExclusive(from, to) {
      execFileSync("python3", [resolve(import.meta.dirname, "../../../docs/openclaw-setup/patches/publish-runtime-tree.py"), from, to], { stdio: "pipe" });
    },
  };
  cpSync(stateDir, join(recovery, "state"), { recursive: true });
  const originalState = treeDigest(stateDir);
  const snapshot = await snapshotWorkshopMigration(target, recovery, inspectWorkshopMigration(target), operations);
  const doctor = () => JSON.parse(execFileSync(process.execPath, ["--import", join(candidate, "scripts/tsx.mjs"), import.meta.filename, "doctor", candidate, root], {
    cwd: candidate, env: { ...process.env, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: join(stateDir, "openclaw.json") },
    encoding: "utf8", timeout: 45_000, maxBuffer: 1024 * 1024,
  }));
  const reset = async () => {
    rmSync(stateDir, { recursive: true });
    cpSync(join(recovery, "state"), stateDir, { recursive: true });
    await restoreWorkshopSnapshots(recovery, snapshot, operations);
    assert.equal(treeDigest(stateDir), originalState);
  };
  // Reproduce the production failure with synthetic data: Doctor can move a
  // different completed create even when an ownerless update refuses import.
  const failed = doctor();
  assert.ok(failed.warnings.some((message) => message.includes("owning agent")));
  assert.equal(existsSync(created.record.target.skillDir), false);
  await reset();
  applyWorkshopOwnerRepairs(target);
  const succeeded = doctor();
  assert.deepEqual(succeeded.warnings, []);
  const db = new DatabaseSync(join(stateDir, "state/openclaw.sqlite"), { readOnly: true });
  try {
    const rows = db.prepare("SELECT owner_agent_id,record_json FROM skill_workshop_proposals ORDER BY proposal_id").all();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.owner_agent_id === "main"));
    assert.equal(JSON.parse(rows.find((row) => JSON.parse(row.record_json).id === update.record.id).record_json).status, "applied");
    assert.equal(db.prepare("SELECT count(*) AS n FROM skill_workshop_proposal_rollbacks WHERE proposal_id=?").get(update.record.id).n, 1);
  } finally { db.close(); }
  assert.equal(existsSync(created.record.target.skillDir), false);
  assert.equal(treeDigest(update.record.target.skillDir), snapshot.external.find((entry) => entry.path === update.record.target.skillDir).sha256);
  await reset();
  assert.equal(JSON.parse(readFileSync(join(update.directory, "proposal.json"), "utf8")).origin, undefined);
  process.stdout.write(JSON.stringify({ passed: true, actualDoctorFailureReproduced: true, repairedOwnership: true, externalRollback: true }));
}
