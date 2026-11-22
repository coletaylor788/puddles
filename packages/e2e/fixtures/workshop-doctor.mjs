import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const { retireSkillWorkshopProposals } = await import(pathToFileURL(join(candidate, "src/commands/doctor-skill-workshop-retire-proposals.ts")));
  const result = await retireSkillWorkshopProposals({ config: JSON.parse(readFileSync(join(stateDir, "openclaw.json"), "utf8")), env: process.env });
  process.stdout.write(JSON.stringify(result));
} else {
  assert.equal(mode, "rehearse");
  const workspace = join(root, "external-workspace");
  const applied = seedWorkshopProposal({ stateDir, workspace, owner: "main" });
  const pending = seedWorkshopProposal({ stateDir, workspace, name: "fixture-pending", kind: "create", owner: "main" });
  writeFileSync(join(pending.directory, "proposal.json"), JSON.stringify({ ...pending.record, status: "pending", appliedAt: undefined }));
  rmSync(pending.record.target.skillDir, { recursive: true });
  const agents = ["main", "reader"].map((id) => ({ id, workspace, agentDir: join(stateDir, "agents", id, "agent") }));
  writeFileSync(join(stateDir, "openclaw.json"), JSON.stringify({ agents: { ownership: "explicit", entries: Object.fromEntries(agents.map(({ id, ...entry }) => [id, entry])) } }));
  const originalSkill = treeDigest(applied.record.target.skillDir);
  const pendingDraft = readFileSync(join(pending.directory, "PROPOSAL.md"), "utf8");
  const draft = join(stateDir, "agents/main/agent/workshop-skills/.drafts", pending.record.id, "SKILL.md");
  const doctor = () => JSON.parse(execFileSync(process.execPath, ["--import", join(candidate, "scripts/tsx.mjs"), import.meta.filename, "doctor", candidate, root], {
    cwd: candidate, env: { ...process.env, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: join(stateDir, "openclaw.json") },
    encoding: "utf8", timeout: 45_000, maxBuffer: 1024 * 1024,
  }));
  const succeeded = doctor();
  assert.deepEqual(succeeded.warnings, []);
  assert.ok(succeeded.changes.some((change) => change.includes("Exported 1 pending Skill Workshop proposal draft")));
  assert.equal(readFileSync(draft, "utf8"), pendingDraft);
  assert.equal(existsSync(pending.record.target.skillDir), false);
  assert.equal(existsSync(join(stateDir, "agents/reader/agent/workshop-skills/.drafts", pending.record.id)), false);
  assert.equal(existsSync(join(stateDir, "skill-workshop/proposals")), false);
  const db = new DatabaseSync(join(stateDir, "state/openclaw.sqlite"), { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE 'skill_workshop_proposal%' OR name='skill_workshop_collection_reviews'").get().n, 0);
  } finally { db.close(); }
  assert.equal(treeDigest(applied.record.target.skillDir), originalSkill);
  // Reopening the retired state is idempotent and keeps the inactive draft,
  // its owning agent and the user-visible applied skill content.
  assert.deepEqual(doctor().warnings, []);
  assert.equal(readFileSync(draft, "utf8"), pendingDraft);
  assert.equal(existsSync(pending.record.target.skillDir), false);
  assert.equal(treeDigest(applied.record.target.skillDir), originalSkill);
  process.stdout.write(JSON.stringify({ passed: true, draftRetained: true, ownershipPreserved: true, appliedContentPreserved: true, repeatable: true }));
}
