import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { seedWorkshopProposal } from "./workshop-migration.mjs";
import { treeDigest } from "../src/native-state.mjs";

const [mode, candidate, root] = process.argv.slice(2);
const stateDir = join(root, "state");
if (mode === "doctor") {
  const deny = () => { throw new Error("Network is forbidden in Workshop migration fixture"); };
  globalThis.fetch = deny;
  http.request = http.get = https.request = https.get = deny;
  net.connect = net.createConnection = net.Socket.prototype.connect = deny;
  const { migrateLegacySkillWorkshopProposals } = await import(pathToFileURL(join(candidate, "src/commands/doctor-skill-workshop-sqlite.ts")));
  const result = await migrateLegacySkillWorkshopProposals({ config: JSON.parse(readFileSync(join(stateDir, "openclaw.json"), "utf8")), env: process.env });
  process.stdout.write(JSON.stringify(result));
} else {
  assert.equal(mode, "rehearse");
  const workspace = join(root, "external-workspace");
  const update = seedWorkshopProposal({ stateDir, workspace, owner: "main" });
  const created = seedWorkshopProposal({ stateDir, workspace, name: "fixture-created", kind: "create", owner: "main" });
  const agents = ["main", "reader"].map((id) => ({ id, workspace, agentDir: join(stateDir, "agents", id, "agent") }));
  writeFileSync(join(stateDir, "openclaw.json"), JSON.stringify({ agents: { ownership: "explicit", entries: Object.fromEntries(agents.map(({ id, ...entry }) => [id, entry])) } }));
  const originalSkill = treeDigest(update.record.target.skillDir);
  const doctor = () => JSON.parse(execFileSync(process.execPath, ["--import", join(candidate, "scripts/tsx.mjs"), import.meta.filename, "doctor", candidate, root], {
    cwd: candidate, env: { ...process.env, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: join(stateDir, "openclaw.json") },
    encoding: "utf8", timeout: 45_000, maxBuffer: 1024 * 1024,
  }));
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
  assert.equal(treeDigest(update.record.target.skillDir), originalSkill);
  // Reopening already stored history is idempotent and keeps the same owner,
  // proposal status and user-visible skill content.
  assert.deepEqual(doctor().warnings, []);
  const reopened = new DatabaseSync(join(stateDir, "state/openclaw.sqlite"), { readOnly: true });
  try {
    assert.equal(reopened.prepare("SELECT count(*) AS n FROM skill_workshop_proposals WHERE owner_agent_id='main'").get().n, 2);
    assert.equal(reopened.prepare("SELECT count(*) AS n FROM skill_workshop_proposal_rollbacks WHERE proposal_id=?").get(update.record.id).n, 1);
  } finally { reopened.close(); }
  assert.equal(treeDigest(update.record.target.skillDir), originalSkill);
  process.stdout.write(JSON.stringify({ passed: true, historyPreserved: true, ownershipPreserved: true, repeatable: true }));
}
