import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
// @ts-expect-error Executable lifecycle module.
import { applyWorkshopOwnerRepairs, assertWorkshopConfiguration, inspectWorkshopMigration, restoreWorkshopSnapshots, snapshotWorkshopMigration, validateWorkshopBinding } from "../src/native-workshop-migration.mjs";
// @ts-expect-error Executable fixture module.
import { seedWorkshopProposal } from "../fixtures/workshop-migration.mjs";
// @ts-expect-error Executable lifecycle module.
import { treeDigest } from "../src/native-state.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const operations = {
  async clone(from: string, to: string) { cpSync(from, to, { recursive: true, errorOnExist: true, force: false }); },
  async publishExclusive(from: string, to: string) {
    execFileSync("python3", [resolve(import.meta.dirname, "../../../docs/openclaw-setup/patches/publish-runtime-tree.py"), from, to], { stdio: "pipe" });
  },
};
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "workshop-migration-")));
  roots.push(root);
  const stateDir = join(root, "state");
  const workspace = join(root, "workspace");
  const recovery = join(root, "recovery");
  mkdirSync(recovery);
  const proposal = seedWorkshopProposal({ stateDir, workspace });
  const target: any = { stateDir, purpose: "rehearsal", isolation: { root }, workshopMigration: {
    schemaVersion: 1, agents: ["main", "reader"].map((id) => ({ id, workspace, agentDir: join(stateDir, "agents", id, "agent") })), ownerRepairs: [],
  } };
  return { root, stateDir, workspace, recovery, proposal, target };
}

describe("Workshop migration boundaries", () => {
  it("refuses shared-workspace ambiguity without modifying metadata or skills", () => {
    const f = fixture();
    const before = [treeDigest(f.stateDir), treeDigest(f.workspace)];
    expect(() => inspectWorkshopMigration(f.target)).toThrow("explicit configured ownership");
    expect([treeDigest(f.stateDir), treeDigest(f.workspace)]).toEqual(before);
    delete f.target.workshopMigration;
    expect(() => inspectWorkshopMigration(f.target)).toThrow("sealed agent");
  });

  it("repairs only approved ownership and retains every other field and file", async () => {
    const f = fixture();
    f.target.workshopMigration.ownerRepairs = [f.proposal.repair];
    const preflight = inspectWorkshopMigration(f.target);
    cpSync(f.stateDir, join(f.recovery, "state"), { recursive: true });
    const before = treeDigest(f.workspace);
    const snapshot = await snapshotWorkshopMigration(f.target, f.recovery, preflight, operations);
    applyWorkshopOwnerRepairs(f.target);
    expect(JSON.parse(readFileSync(join(f.proposal.directory, "proposal.json"), "utf8"))).toEqual({ ...f.proposal.record, origin: { agentId: "main" } });
    for (const file of ["rollback.json", "PROPOSAL.md"]) expect(readFileSync(join(f.proposal.directory, file))).toEqual(readFileSync(join(f.recovery, "state/skill-workshop/proposals", f.proposal.record.id, file)));
    expect(treeDigest(f.workspace)).toBe(before);
    expect(snapshot.external).toHaveLength(1);
    expect(() => applyWorkshopOwnerRepairs(f.target)).toThrow("preconditions changed");
  });

  it.each(["proposal.json", "PROPOSAL.md", "rollback.json", "SKILL.md"])("rejects changed approved %s before mutation", (file) => {
    const f = fixture();
    f.target.workshopMigration.ownerRepairs = [f.proposal.repair];
    const path = file === "SKILL.md" ? f.proposal.record.target.skillFile : join(f.proposal.directory, file);
    writeFileSync(path, `${readFileSync(path, "utf8")} `);
    expect(() => inspectWorkshopMigration(f.target)).toThrow("preconditions changed");
  });

  it("detects stopped-boundary drift and unsupported interrupted apply", async () => {
    const f = fixture();
    f.target.workshopMigration.ownerRepairs = [f.proposal.repair];
    const before = inspectWorkshopMigration(f.target);
    chmodSync(f.proposal.record.target.skillFile, 0o700);
    await expect(snapshotWorkshopMigration(f.target, f.recovery, before, operations)).rejects.toThrow("changed after preflight");
    f.target.workshopMigration.ownerRepairs = [];
    writeFileSync(join(f.proposal.directory, "proposal.json"), JSON.stringify({ ...f.proposal.record, status: "pending", origin: { agentId: "main" } }));
    expect(() => inspectWorkshopMigration(f.target)).toThrow("interrupted apply");
  });

  it("inventories imported SQLite records with no sidecars and rejects cron references", () => {
    const f = fixture();
    const created = seedWorkshopProposal({ stateDir: f.stateDir, workspace: f.workspace, name: "created", kind: "create", owner: "main" });
    rmSync(join(f.stateDir, "skill-workshop"), { recursive: true });
    mkdirSync(join(f.stateDir, "state"));
    const db = new DatabaseSync(join(f.stateDir, "state/openclaw.sqlite"));
    db.exec("CREATE TABLE skill_workshop_proposals (proposal_id TEXT, record_json TEXT, owner_agent_id TEXT); CREATE TABLE cron_jobs (job_json TEXT)");
    db.prepare("INSERT INTO skill_workshop_proposals VALUES (?,?,?)").run(created.record.id, JSON.stringify(created.record), "main");
    expect(inspectWorkshopMigration(f.target).external.map((entry: any) => entry.path)).toEqual([created.record.target.skillDir]);
    db.prepare("INSERT INTO cron_jobs VALUES (?)").run(JSON.stringify({ payload: { message: `Run ${created.record.target.skillDir}/task.sh` } }).replaceAll("/", "\\u002f"));
    expect(() => inspectWorkshopMigration(f.target)).toThrow("Scheduled job references");
    db.close();
  });

  it("checks effective config paths and the SDK-selected alternate cron store", () => {
    const f = fixture();
    f.target.workshopMigration.ownerRepairs = [f.proposal.repair];
    const config = { agents: { entries: Object.fromEntries(f.target.workshopMigration.agents.map(({ id, ...entry }: any) => [id, entry])) } };
    expect(() => assertWorkshopConfiguration(f.target.workshopMigration, config, f.stateDir)).not.toThrow();
    config.agents.entries.main.agentDir = join(f.root, "external-agent");
    expect(() => assertWorkshopConfiguration(f.target.workshopMigration, config, f.stateDir)).toThrow("Doctor configuration");
    const created = seedWorkshopProposal({ stateDir: f.stateDir, workspace: f.workspace, kind: "create", name: "created", owner: "main" });
    expect(() => inspectWorkshopMigration(f.target, [{ payload: { command: `${created.record.target.skillDir}/task.sh` } }])).toThrow("Scheduled job references");
  });

  it("rejects unsnapshotted destinations, collection backups and live rehearsal paths", () => {
    const f = fixture();
    f.target.workshopMigration.agents[0].agentDir = join(f.root, "outside");
    expect(() => validateWorkshopBinding(f.target)).toThrow("state-owned destinations");
    f.target.workshopMigration.agents[0].agentDir = join(f.stateDir, "agents/main/agent");
    f.target.workshopMigration.agents[0].workspace = "/synthetic-live/workspace";
    expect(() => validateWorkshopBinding(f.target)).toThrow("test-owned root");
    f.target.workshopMigration.agents[0].workspace = f.workspace;
    mkdirSync(join(f.stateDir, "skill-workshop/collection-backups/retained"), { recursive: true });
    expect(() => inspectWorkshopMigration(f.target)).toThrow("collection backups");
  });

  it("rejects a TEST workspace alias that resolves outside the owned root", () => {
    const f = fixture();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "workshop-foreign-")));
    roots.push(outside);
    renameSync(f.workspace, join(outside, "workspace"));
    symlinkSync(join(outside, "workspace"), f.workspace);
    expect(() => inspectWorkshopMigration(f.target)).toThrow("Canonical Workshop rehearsal path escapes");
    expect(existsSync(join(outside, "workspace/skills/fixture-update/SKILL.md"))).toBe(true);
  });

  it("restores missing external skills and reuses identical paths across interruption", async () => {
    const f = fixture();
    f.target.workshopMigration.ownerRepairs = [f.proposal.repair];
    const snapshot = await snapshotWorkshopMigration(f.target, f.recovery, inspectWorkshopMigration(f.target), operations);
    renameSync(f.proposal.record.target.skillDir, join(f.root, "doctor-moved"));
    await restoreWorkshopSnapshots(f.recovery, snapshot, operations);
    expect(treeDigest(f.proposal.record.target.skillDir)).toBe(snapshot.external[0].sha256);
    await restoreWorkshopSnapshots(f.recovery, snapshot, operations);
    expect(existsSync(join(f.root, "doctor-moved"))).toBe(true);
    writeFileSync(f.proposal.record.target.skillFile, "concurrent change");
    await expect(restoreWorkshopSnapshots(f.recovery, snapshot, operations)).rejects.toThrow("changed external skill");
    expect(readFileSync(f.proposal.record.target.skillFile, "utf8")).toBe("concurrent change");
  });

  it("refuses damaged recovery copies and exclusive-publication collisions", async () => {
    const f = fixture();
    f.target.workshopMigration.ownerRepairs = [f.proposal.repair];
    const snapshot = await snapshotWorkshopMigration(f.target, f.recovery, inspectWorkshopMigration(f.target), operations);
    const stage = join(f.root, "staged");
    mkdirSync(stage);
    await expect(operations.publishExclusive(stage, f.proposal.record.target.skillDir)).rejects.toThrow();
    writeFileSync(join(f.recovery, snapshot.external[0].snapshot, "SKILL.md"), "damage");
    await expect(restoreWorkshopSnapshots(f.recovery, snapshot, operations)).rejects.toThrow("snapshot changed");
  });
});
