import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
// @ts-expect-error Executable lifecycle module.
import { assertBatchArtifact, assertDeploymentOwnership, coordinate, initializeCoordination, processIdentity, readCoordination } from "../src/deploy-coordination.mjs";

// @ts-expect-error Executable lifecycle module.
import { retryCoordinate } from "../bin/openclaw-deployment-slot.mjs";
// @ts-expect-error Executable lifecycle module.
import { snapshotMergedBatch } from "../src/merged-batch.mjs";
// @ts-expect-error Executable lifecycle module.
import { createBuildReceipt } from "../src/native-release.mjs";
// @ts-expect-error Executable lifecycle module.
import { fileDigest, jsonDigest } from "../src/native-state.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const alice = { id: "task-a", contact: "thread:task-a" };
const bob = { id: "task-b", contact: "thread:task-b" };
const sources = (head = "a".repeat(40)) => [{ id: "public", head, tree: "b".repeat(40), base: "c".repeat(40), commits: [
  { sha: head, agent: alice }, { sha: "d".repeat(40), agent: bob },
] }];
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "deployment-queue-"))); roots.push(root);
  const path = join(root, "slots.json");
  initializeCoordination(path, Object.fromEntries(["DEV", "TEST", "PROD"].map((name, index) => [name, { host: hostname(), port: 18000 + index }])));
  const op = (operation: string, input: any) => coordinate(path, operation, input);
  const enqueue = (id: string, environment = "DEV", extra = {}) => op("enqueue", {
    requestId: id, agent: id === "b" ? bob : alice, worktree: root, runId: id, environment, ...extra,
  });
  const lease = (ticket: any, environment = "DEV") => ({ requestId: ticket.requestId, token: ticket.token, environment });
  const tested = (ticket: any, batch: any) => {
    const archive = join(root, `${batch.id}.tar.gz`); writeFileSync(archive, batch.id);
    const build = createBuildReceipt({ repository: batch.sources[0], source: { head: batch.sources[0].head }, tools: {}, proofs: {},
      artifact: { schemaVersion: 1, path: archive, sha256: fileDigest(archive), runtimeSha256: "a".repeat(64),
        platform: process.platform, arch: process.arch, node: process.version } });
    const success = { target: "b".repeat(64), artifact: build.artifact.sha256, status: "healthy", transaction: "test-success", journalSha256: "c".repeat(64), coordination: { requestId: ticket.requestId, attemptId: readCoordination(path).environments.TEST.owner.attemptId, baseline: readCoordination(path).environments.TEST.owner.baseline } };
    const rollback = { ...success, status: "rolled-back", transaction: "test-rollback" };
    const proof = { schema: "puddles.openclaw-target-proof/v1", schemaVersion: 1, buildId: build.buildId, status: "passed",
      stages: { install: "d".repeat(64), runtime: "e".repeat(64), "deployment-success": jsonDigest(success), "deployment-rollback": jsonDigest(rollback) },
      deployment: { success, rollback } };
    const buildPath = join(root, `${batch.id}-build.json`); const proofPath = join(root, `${batch.id}-proof.json`);
    writeFileSync(buildPath, JSON.stringify(build)); writeFileSync(proofPath, JSON.stringify(proof));
    return op("tested", { ...lease(ticket, "TEST"), build: buildPath, proof: proofPath });
  };
  return { root, path, op, enqueue, lease, tested };
}

describe("shared deployment queue and merged batch ownership", () => {
  it("isolates unit targets from inherited host slots while enforcing explicit records", () => {
    const f = setup();
    const target = { host: hostname(), port: 18000 };
    try {
      vi.stubEnv("PUDDLES_DEPLOY_COORDINATION", f.path);
      expect(() => assertDeploymentOwnership(target, "PROD")).toThrow("registered deployment environment");
    } finally {
      vi.unstubAllEnvs();
    }
    expect(assertDeploymentOwnership(target, "PROD")).toBeNull();
    expect(process.env.PUDDLES_DEPLOY_REQUEST_ID).toBe("");
    expect(process.env.PUDDLES_DEPLOY_TOKEN).toBe("");
    const registered = { ...target, coordination: { path: f.path } };
    expect(() => assertDeploymentOwnership(registered, "PROD")).toThrow("registered deployment environment");
    expect(() => assertDeploymentOwnership(registered, "DEV")).toThrow("another request");
  });

  it("enforces FIFO, idempotent signup, and atomic ownership before notification", () => {
    const f = setup(); const a = f.enqueue("a"); const b = f.enqueue("b");
    expect(f.enqueue("a").token).toBe(a.token);
    expect(() => f.op("claim", f.lease(b))).toThrow("oldest ready");
    f.op("claim", f.lease(a));
    expect(() => f.op("claim", f.lease(b))).toThrow("in use");
    expect(() => f.op("release", { ...f.lease(b), result: "healthy", cleanupEvidence: "clean" })).toThrow("another request");
    f.op("release", { ...f.lease(a), result: "healthy", cleanupEvidence: "owned processes joined" });
    const state = readCoordination(f.path);
    expect(state.environments.DEV.owner).toBeNull();
    expect(state.notifications.at(-1).recipient.id).toBe(bob.id);
    f.op("claim", f.lease(b));
    expect(readCoordination(f.path).environments.DEV.owner.agent.id).toBe(bob.id);
  });

  it("defers unready requests and cancels only the owning ticket", () => {
    const f = setup(); const a = f.enqueue("a", "DEV", { ready: false }); const b = f.enqueue("b");
    expect(() => f.op("cancel", { ...f.lease(a), token: b.token })).toThrow("ownership");
    f.op("claim", f.lease(b));
    f.op("cancel", f.lease(a));
    expect(readCoordination(f.path).environments.DEV.queue).toEqual([]);
  });

  it("never takes over on an old heartbeat or allows an owner to hold two slots", () => {
    const f = setup(); const a = f.enqueue("a"); f.op("claim", f.lease(a));
    const t = f.enqueue("test", "TEST", { purpose: "maintenance" });
    expect(() => f.op("claim", f.lease(t, "TEST"))).toThrow("other environment");
    f.op("bind-process", { ...f.lease(a), process: processIdentity() });
    const state = readCoordination(f.path); state.environments.DEV.owner.heartbeatAt = "2000-01-01T00:00:00Z";
    writeFileSync(f.path, JSON.stringify(state));
    expect(() => f.op("recover-owner", { ...f.lease(a), agent: bob, evidence: "old heartbeat" })).toThrow("stopped");
    expect(() => f.op("release", { ...f.lease(a), result: "healthy", cleanupEvidence: "not stopped" })).toThrow("must stop");
  });

  it("keeps one initiating batch owner and notifies all included commit owners", () => {
    const f = setup(); const batch = f.op("batch", { agent: alice, sources: sources() });
    const attached = f.op("batch", { agent: bob, sources: sources() });
    expect(attached.id).toBe(batch.id); expect(attached.owner.id).toBe(alice.id); expect(attached.token).toBeUndefined();
    expect(readCoordination(f.path).notifications.map((n: any) => n.recipient.id)).toContain(bob.id);
    expect(() => f.enqueue("b", "TEST", { batchId: batch.id, batchToken: batch.token })).toThrow("batch owner");
    const ticket = f.enqueue("a", "TEST", { batchId: batch.id, batchToken: batch.token });
    f.op("claim", f.lease(ticket, "TEST"));
    f.op("release", { ...f.lease(ticket, "TEST"), result: "waiting-for-ci", cleanupEvidence: "no process started" });
    expect(readCoordination(f.path).batches[batch.id].owner.id).toBe(alice.id);
  });

  it.each(["revert", "repair"])("holds promotion through a reviewed %s until corrected TEST passes", (kind) => {
    const f = setup(); const batch = f.op("batch", { agent: alice, sources: sources() });
    f.op("batch-fail", { batchId: batch.id, batchToken: batch.token, agent: alice,
      evidence: "recorded failing assertion", responsible: ["d".repeat(40)], revertEvidence: "revert PR" });
    expect(readCoordination(f.path).notifications.at(-1)).toMatchObject({ recipient: bob, kind: "batch-regression" });
    const repaired = f.op("batch", { agent: alice, sources: sources("e".repeat(40)), predecessor: batch.id,
      previousToken: batch.token, [kind + "Evidence"]: "reviewed correction merged",
      [kind + "s"]: [{ commit: "d".repeat(40), [kind]: "e".repeat(40) }] });
    expect(readCoordination(f.path).promotionHolds[batch.id]).toBeTruthy();
    expect(readCoordination(f.path).disqualified["d".repeat(40)][kind]).toBeUndefined();
    expect(readCoordination(f.path).notifications.some((n: any) => n.kind === (kind === "repair" ? "change-repaired" : "repair-reverted-change") && n.detail[kind] === "e".repeat(40))).toBe(true);
    const early = f.enqueue("early-prod", "PROD", { batchId: repaired.id, batchToken: repaired.token });
    expect(() => f.op("claim", { ...f.lease(early, "PROD"), expectedHealthy: null })).toThrow("promotion is on hold");
    f.op("cancel", f.lease(early, "PROD"));
    const ticket = f.enqueue("a", "TEST", { batchId: repaired.id, batchToken: repaired.token });
    f.op("claim", f.lease(ticket, "TEST"));
    f.tested(ticket, repaired);
    expect(readCoordination(f.path).promotionHolds).toEqual({});
    expect(readCoordination(f.path).disqualified["d".repeat(40)][kind]).toBe("e".repeat(40));
    f.op("release", { ...f.lease(ticket, "TEST"), result: "passed", cleanupEvidence: "cleaned" });
    const prod = f.enqueue("prod", "PROD", { batchId: repaired.id, batchToken: repaired.token });
    expect(() => f.op("claim", { ...f.lease(prod, "PROD"), expectedHealthy: "stale" })).toThrow("baseline changed");
    f.op("claim", { ...f.lease(prod, "PROD"), expectedHealthy: null });
  });

  it("checks the registered target, controller identity, and exact batch artifacts", () => {
    const f = setup(); const batch = f.op("batch", { agent: alice, sources: sources() });
    const t = f.enqueue("a", "TEST", { batchId: batch.id, batchToken: batch.token });
    f.op("claim", f.lease(t, "TEST"));
    const target = { host: hostname(), port: 18001, coordination: { path: f.path } };
    const env = { PUDDLES_DEPLOY_REQUEST_ID: t.requestId, PUDDLES_DEPLOY_TOKEN: t.token };
    expect(() => assertDeploymentOwnership(target, "TEST", env)).toThrow("controller");
    f.op("bind-process", { ...f.lease(t, "TEST"), process: processIdentity() });
    const ownership = assertDeploymentOwnership(target, "TEST", env);
    expect(() => assertBatchArtifact(ownership, { repository: { head: "f".repeat(40), tree: "b".repeat(40) } })).toThrow("merged batch");
    expect(() => assertBatchArtifact(ownership, { repository: { head: "a".repeat(40), tree: "b".repeat(40) } })).not.toThrow();
    expect(() => assertDeploymentOwnership({ ...target, port: 9999 }, "TEST", env)).toThrow("registered");
    const composed = { ...ownership, batch: { sources: [...batch.sources, { id: "private", head: "1".repeat(40), tree: "2".repeat(40) }] } };
    const receipt = { sourceRepositories: [batch.sources[0], { id: "private", head: "3".repeat(40), tree: "2".repeat(40) }] };
    expect(() => assertBatchArtifact(composed, receipt)).toThrow("merged batch");
    receipt.sourceRepositories[1].head = "1".repeat(40);
    expect(() => assertBatchArtifact(composed, receipt)).not.toThrow();
  });

  it("rejects stale generations and damaged established records", () => {
    const f = setup(); const a = f.enqueue("a");
    expect(() => f.op("claim", { ...f.lease(a), expectedGeneration: 0 })).toThrow("generation changed");
    writeFileSync(f.path, "{}");
    expect(() => f.enqueue("b")).toThrow("Invalid coordination");
    expect(() => initializeCoordination(f.path, {})).toThrow("already initialized");
  });

  it("allows only one of simultaneous processes to claim a slot", async () => {
    const f = setup(); const a = f.enqueue("a");
    const input = join(f.root, "request.json"); writeFileSync(input, JSON.stringify(f.lease(a)));
    const cli = join(import.meta.dirname, "../bin/openclaw-deployment-slot.mjs");
    const run = () => new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, [cli, "claim", input, f.path], { stdio: "ignore" });
      child.once("error", reject); child.once("close", resolve);
    });
    const results = await Promise.all([run(), run()]);
    expect(results.filter((result) => result === 0)).toHaveLength(1);
    expect(JSON.parse(readFileSync(f.path, "utf8")).environments.DEV.owner.requestId).toBe("a");
  });
  it("retries short metadata contention without killing the deployment", async () => {
    let attempts = 0;
    const update = () => { if (++attempts < 3) throw Object.assign(new Error("busy"), { code: "COORDINATION_BUSY" }); return "alive"; };
    expect(await retryCoordinate("unused", "heartbeat", {}, update, async () => {})).toBe("alive");
    expect(attempts).toBe(3);
    await expect(retryCoordinate("unused", "heartbeat", {}, () => { throw new Error("ownership changed"); }, async () => {})).rejects.toThrow("ownership changed");
  });

  it("recovers abandoned unbound slots and idle batches with fresh ownership tokens", () => {
    const f = setup(); const batch = f.op("batch", { agent: alice, sources: sources() });
    const t = f.enqueue("a", "TEST", { batchId: batch.id, batchToken: batch.token }); f.op("claim", f.lease(t, "TEST"));
    const obsolete = f.enqueue("prod", "PROD", { batchId: batch.id, batchToken: batch.token });
    const recovered = f.op("recover-owner", { ...f.lease(t, "TEST"), agent: bob, evidence: "owner contacted; no controller or journal exists" });
    expect(() => f.op("heartbeat", f.lease(t, "TEST"))).toThrow("another request");
    f.op("release", { ...f.lease(recovered, "TEST"), result: "recovered", cleanupEvidence: "no processes" });
    expect(() => f.op("claim", { ...f.lease(obsolete, "PROD"), expectedHealthy: null })).toThrow("oldest ready");
    const current = readCoordination(f.path).batches[batch.id];
    const adopted = f.op("recover-batch", { batchId: batch.id, previousAgent: bob, batchToken: current.token, agent: alice, evidence: "confirmed handoff" });
    expect(adopted.token).not.toBe(current.token);
    expect(() => f.enqueue("b", "TEST", { batchId: batch.id, batchToken: current.token })).toThrow("batch owner");
  });

  it("binds TEST proof to its production baseline even if the caller supplies the new baseline", () => {
    const f = setup(); const batch = f.op("batch", { agent: alice, sources: sources() });
    const t = f.enqueue("a", "TEST", { batchId: batch.id, batchToken: batch.token }); f.op("claim", f.lease(t, "TEST"));
    f.tested(t, batch); f.op("release", { ...f.lease(t, "TEST"), result: "passed", cleanupEvidence: "clean" });
    const state = readCoordination(f.path); state.lastHealthy = { transaction: "other-release", sources: [] }; writeFileSync(f.path, JSON.stringify(state));
    const p = f.enqueue("prod", "PROD", { batchId: batch.id, batchToken: batch.token });
    expect(() => f.op("claim", { ...f.lease(p, "PROD"), expectedHealthy: "other-release" })).toThrow("changed since TEST");
    const rerun = f.enqueue("rerun", "TEST", { batchId: batch.id, batchToken: batch.token }); f.op("claim", f.lease(rerun, "TEST"));
    expect(() => f.op("tested", { ...f.lease(rerun, "TEST"), build: join(f.root, `${batch.id}-build.json`),
      proof: join(f.root, `${batch.id}-proof.json`) })).toThrow("different attempt or production baseline");
  });

  it.each(["revert", "repair"])("keeps older batches disqualified after a %s passes TEST", (kind) => {
    const f = setup(); const older = f.op("batch", { agent: alice, sources: sources() });
    const t = f.enqueue("a", "TEST", { batchId: older.id, batchToken: older.token }); f.op("claim", f.lease(t, "TEST"));
    f.tested(t, older); f.op("release", { ...f.lease(t, "TEST"), result: "passed", cleanupEvidence: "clean" });
    const newer = f.op("batch", { agent: alice, sources: sources("f".repeat(40)) });
    f.op("batch-fail", { batchId: newer.id, batchToken: newer.token, agent: alice, evidence: "failure", responsible: ["d".repeat(40)] });
    const corrected = f.op("batch", { agent: alice, sources: sources("e".repeat(40)), predecessor: newer.id, previousToken: newer.token,
      [kind + "Evidence"]: "reviewed correction merged",
      [kind + "s"]: [{ commit: "d".repeat(40), [kind]: "e".repeat(40) }] });
    const next = f.enqueue("next", "TEST", { batchId: corrected.id, batchToken: corrected.token }); f.op("claim", f.lease(next, "TEST"));
    f.tested(next, corrected); f.op("release", { ...f.lease(next, "TEST"), result: "passed", cleanupEvidence: "clean" });
    const p = f.enqueue("prod", "PROD", { batchId: older.id, batchToken: older.token });
    expect(() => f.op("claim", { ...f.lease(p, "PROD"), expectedHealthy: null })).toThrow("disqualified");
    const laterSources = sources("1".repeat(40));
    laterSources[0].commits.push({ sha: "e".repeat(40), agent: alice });
    const later = f.op("batch", { agent: alice, sources: laterSources });
    expect(later.invalidatedBy).toEqual([]);
    expect(f.op("batch", { agent: alice, sources: sources("2".repeat(40)) }).invalidatedBy).toEqual(["d".repeat(40)]);
  });


  it.each(["repair", "revert"])("rechecks a selected batch after another batch proves its %s", (kind) => {
    const f = setup();
    const failed = f.op("batch", { agent: alice, sources: sources() });
    const bad = "d".repeat(40), correction = "e".repeat(40);
    f.op("batch-fail", { batchId: failed.id, batchToken: failed.token, agent: alice,
      evidence: "regression", responsible: [bad] });
    const pendingSources = sources("1".repeat(40));
    pendingSources[0].commits.push({ sha: correction, agent: alice });
    const pending = f.op("batch", { agent: alice, sources: pendingSources });
    expect(pending.invalidatedBy).toEqual([bad]);
    const first = f.enqueue("pending-before-proof", "TEST", { batchId: pending.id, batchToken: pending.token });
    f.op("claim", f.lease(first, "TEST"));
    expect(() => f.tested(first, pending)).toThrow("disqualified");
    f.op("release", { ...f.lease(first, "TEST"), result: "waiting", cleanupEvidence: "clean" });
    const corrected = f.op("batch", { agent: alice, sources: sources(correction), predecessor: failed.id,
      previousToken: failed.token, [kind + "Evidence"]: "reviewed merged correction",
      [kind + "s"]: [{ commit: bad, [kind]: correction }] });
    const proving = f.enqueue("proving", "TEST", { batchId: corrected.id, batchToken: corrected.token });
    f.op("claim", f.lease(proving, "TEST")); f.tested(proving, corrected);
    f.op("release", { ...f.lease(proving, "TEST"), result: "passed", cleanupEvidence: "clean" });
    const next = f.enqueue("pending-after-proof", "TEST", { batchId: pending.id, batchToken: pending.token });
    f.op("claim", f.lease(next, "TEST"));
    expect(() => f.op("tested", { ...f.lease(next, "TEST"), build: join(f.root, `${pending.id}-build.json`),
      proof: join(f.root, `${pending.id}-proof.json`) })).toThrow("different attempt");
    expect(readCoordination(f.path).batches[pending.id].invalidatedBy).toEqual([bad]);
    f.tested(next, pending);
    expect(readCoordination(f.path).batches[pending.id]).toMatchObject({ status: "tested", invalidatedBy: [] });
    expect(readCoordination(f.path).batches[failed.id].invalidatedBy).toEqual([bad]);
  });

  it("rejects missing, self, unknown, cross-repository and ambiguous repairs without clearing holds", () => {
    const f = setup();
    const failed = f.op("batch", { agent: alice, sources: sources() });
    const bad = "d".repeat(40);
    const repair = "e".repeat(40);
    f.op("batch-fail", { batchId: failed.id, batchToken: failed.token, agent: alice,
      evidence: "configuration integration regression", responsible: [bad] });
    const candidate = { agent: alice, sources: sources(repair), predecessor: failed.id,
      previousToken: failed.token, repairEvidence: "reviewed merged fix", repairs: [{ commit: bad, repair }] };
    expect(() => f.op("batch", { ...candidate, repairEvidence: "" })).toThrow("recorded evidence");
    for (const record of [
      { commit: bad, repair: bad },
      { commit: bad, repair: "9".repeat(40) },
      { commit: "8".repeat(40), repair },
    ]) expect(() => f.op("batch", { ...candidate, repairs: [record] })).toThrow("different merged commit");
    expect(() => f.op("batch", { ...candidate, reverts: [{ commit: bad, revert: repair }] })).toThrow("one correction");
    expect(() => f.op("batch", { ...candidate, sources: [sources("f".repeat(40))[0],
      { ...sources(repair)[0], id: "companion" }] })).toThrow("same repository");
    const current = readCoordination(f.path);
    expect(current.promotionHolds[failed.id]).toBeTruthy();
    expect(current.batches[failed.id].successor).toBeUndefined();
    expect(current.disqualified[bad].repair).toBeUndefined();
  });

  it("carries explicit repair attribution through merged batch selection", async () => {
    const f = setup();
    const repair = "e".repeat(40);
    const repairs = [{ commit: "d".repeat(40), repair }];
    const responses = ["", repair, "b".repeat(40), "", repair];
    const selected = await snapshotMergedBatch({ agent: alice, predecessor: "failed-batch",
      previousToken: "owner-token", repairEvidence: "reviewed fix and regression", repairs,
      repositories: [{ id: "public", root: f.root, base: "c".repeat(40), owners: { [repair]: alice } }] },
      async () => responses.shift());
    expect(selected).toMatchObject({ repairs, repairEvidence: "reviewed fix and regression",
      predecessor: "failed-batch", previousToken: "owner-token", reverts: [] });
    expect(selected.sources[0].head).toBe(repair);
  });

  it("requires retained TEST proof and explicit attribution for every merged commit", async () => {
    const f = setup(); const batch = f.op("batch", { agent: alice, sources: sources() });
    const t = f.enqueue("a", "TEST", { batchId: batch.id, batchToken: batch.token }); f.op("claim", f.lease(t, "TEST"));
    expect(() => f.op("tested", { ...f.lease(t, "TEST"), buildId: "claimed", proof: "missing" })).toThrow("retained build");
    const results = ["", "a".repeat(40), "b".repeat(40), "", "a".repeat(40)];
    await expect(snapshotMergedBatch({ agent: alice, repositories: [{ id: "public", root: f.root, base: "c".repeat(40) }] },
      async () => results.shift())).rejects.toThrow("feature owner");
  });

});
