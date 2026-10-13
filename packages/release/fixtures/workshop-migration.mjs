import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digest, fileDigest } from "../src/native-state.mjs";

// All content is synthetic. Logical paths can differ from the seed location so
// copied TEST state never retains a production workspace reference.
export function seedWorkshopProposal({ stateDir, workspace, logicalWorkspace = workspace, name = "fixture-update", kind = "update", owner }) {
  const now = "2026-09-01T00:00:00.000Z";
  const id = `${name}-20260901-1234567890`;
  const content = `---\nname: ${name}\ndescription: Synthetic fixture\n---\n\nUse only recorded fixture tools.\n`;
  const draft = content.replace("description: Synthetic fixture\n", "description: Synthetic fixture\nstatus: proposal\nversion: v1\ndate: 2026-09-01\n");
  const skillDir = join(logicalWorkspace, "skills", name);
  const record = {
    schema: "openclaw.skill-workshop.proposal.v1", id, kind, status: "applied", title: name, description: "Synthetic fixture",
    createdAt: now, updatedAt: now, createdBy: "cli", proposedVersion: "v1", draftFile: "PROPOSAL.md", draftHash: digest(draft),
    appliedAt: now, ...(owner ? { origin: { agentId: owner } } : {}),
    target: { skillName: name, skillKey: name, skillDir, skillFile: join(skillDir, "SKILL.md"), source: "openclaw-workspace",
      ...(kind === "update" ? { currentContentHash: digest("old content") } : {}) },
    scan: { state: "clean", scannedAt: now, critical: 0, warn: 0, info: 0, findings: [] },
  };
  const rollback = { schema: "openclaw.skill-workshop.rollback.v1", proposalId: id, writtenAt: now,
    targetSkillFile: record.target.skillFile, action: kind,
    ...(kind === "update" ? { previousContent: "old content", previousContentHash: digest("old content") } : {}) };
  const directory = join(stateDir, "skill-workshop/proposals", id);
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(workspace, "skills", name), { recursive: true });
  for (const [path, value] of [["proposal.json", JSON.stringify(record)], ["rollback.json", JSON.stringify(rollback)], ["PROPOSAL.md", draft]]) {
    writeFileSync(join(directory, path), value);
  }
  writeFileSync(join(workspace, "skills", name, "SKILL.md"), content);
  return { record, rollback, directory, repair: { proposalId: id, agentId: "main",
    proposalSha256: fileDigest(join(directory, "proposal.json")), rollbackSha256: fileDigest(join(directory, "rollback.json")),
    draftSha256: digest(draft), skillSha256: digest(content) } };
}
