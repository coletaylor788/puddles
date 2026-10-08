import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Lifecycle executable.
import { planApproval, progressRelease } from "../src/deployment-progress.mjs";
// @ts-expect-error Lifecycle executable.
import { coordinate, initializeCoordination, readCoordination } from "../src/deploy-coordination.mjs";
// @ts-expect-error Lifecycle executable.
import { createBuildReceipt } from "../src/native-release.mjs";
// @ts-expect-error Lifecycle executable.
import { atomicJson, fileDigest } from "../src/native-state.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(approval = "Production approved", full = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "release-progress-"))); roots.push(root);
  const developmentRoot = join(root, "development"); mkdirSync(developmentRoot);
  const protectedRoot = join(root, "production"); mkdirSync(protectedRoot);
  writeFileSync(join(protectedRoot, "keep"), "production state");
  const plan = join(root, "plan.md");
  const approve = (value: string) => writeFileSync(plan, `# Plan\n## Human section\n### Design\nDesign.\n### Status\n**Approval:** ${value}\n**Approval reference:** Requester approved this design.\n## Agent section\n### State\nImplementing.\n`);
  approve(approval);
  const coordination = join(root, "slots.json");
  initializeCoordination(coordination, Object.fromEntries(["DEV", "TEST", "PROD"].map((name, i) => [name, { host: hostname(), port: 18000 + i }])));
  const agent = { id: "owner", contact: "thread:owner" };
  const repository = { id: "public", head: "a".repeat(40), tree: "b".repeat(40), base: "c".repeat(40), commits: [{ sha: "a".repeat(40), agent }] };
  const batch = coordinate(coordination, "batch", { agent, sources: [repository] });
  const artifact = join(root, "archive.tgz"); writeFileSync(artifact, "candidate");
  const build = createBuildReceipt({ repository, source: { head: repository.head }, tools: {}, proofs: {},
    artifact: { schemaVersion: 1, path: artifact, sha256: fileDigest(artifact), runtimeSha256: "a".repeat(64), platform: process.platform, arch: process.arch, node: process.version } });
  const buildPath = join(root, "build.json"); atomicJson(buildPath, build);
  const gatePath = join(root, "source-gate.json");
  atomicJson(gatePath, { schema: "puddles.openclaw-source-gate/v1", schemaVersion: 1, status: "passed", buildId: build.buildId, stages: { regressions: "c".repeat(64) } });
  const script = join(root, "stage.mjs");
  writeFileSync(script, `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertDeploymentOwnership } from ${JSON.stringify(new URL("../src/deploy-coordination.mjs", import.meta.url).href)};
const [root, environment, action] = process.argv.slice(2);
const read = name => JSON.parse(readFileSync(root + '/' + name));
appendFileSync(root + '/trace', environment + ':' + action + '\\n');
if (action !== 'prepare' && !process.env.PUDDLES_DEPLOY_TOKEN) throw Error('lease missing');
if (action !== 'prepare') {
 const target = read('slots.json').environments[environment].target;
 assertDeploymentOwnership({ ...target, coordination: { path: root + '/slots.json' } }, environment);
}
if (existsSync(root + '/fail-' + environment + '-' + action)) throw Error('injected failure');
if (environment === 'TEST' && action === 'verify') {
 const build = read('build.json'); const slots = read('slots.json'); const owner = slots.environments.TEST.owner;
 const success = { target: 'b'.repeat(64), artifact: build.artifact.sha256, status: 'healthy', transaction: 'test-success', journalSha256: 'c'.repeat(64), coordination: { requestId: owner.requestId, attemptId: owner.attemptId, baseline: owner.baseline } };
 const rollback = { ...success, status: 'rolled-back', transaction: 'test-rollback' };
 const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
 writeFileSync(root + '/proof.json', JSON.stringify({ schema: 'puddles.openclaw-target-proof/v1', schemaVersion: 1, buildId: build.buildId, status: 'passed', stages: { install: 'd'.repeat(64), runtime: 'e'.repeat(64), 'deployment-success': digest(success), 'deployment-rollback': digest(rollback) }, deployment: { success, rollback } }));
}
if (environment === 'PROD' && action === 'verify') {
 const owner = read('slots.json').environments.PROD.owner;
 writeFileSync(root + '/recovery.json', JSON.stringify({ status: 'healthy', transaction: 'prod-transaction', artifact: read('build.json').artifact.sha256, coordination: { requestId: owner.requestId, attemptId: owner.attemptId, baseline: owner.baseline } }));
}
`);
  const command = (environment: string, action: string) => ({ command: process.execPath, args: [script, root, environment, action], cwd: root, timeoutMs: 5000 });
  const config: any = { schemaVersion: 1, runId: "release-1", agent, worktree: root, plan, coordination,
    directory: join(root, "controller"), task: { root: join(developmentRoot, "task"), owner: agent.id, developmentRoot, protectedPaths: [protectedRoot] },
    batch: { id: batch.id, token: batch.token }, candidate: { build: buildPath, sourceGate: gatePath },
    stages: (full ? ["DEV", "TEST", "PROD"] : ["DEV"]).map(environment => ({ environment,
      ...Object.fromEntries(["prepare", "execute", "verify", "recover", "cleanup", "verifyCleanup"].map(action => [action, command(environment, action)])),
      ...(environment === "TEST" ? { proof: join(root, "proof.json") } : {}),
      ...(environment === "PROD" ? { recoveryJournal: join(root, "recovery.json") } : {}),
    })) };
  const trace = () => existsSync(join(root, "trace")) ? readFileSync(join(root, "trace"), "utf8").trim().split("\n") : [];
  const fail = (action: string) => writeFileSync(join(root, `fail-${action}`), "fail");
  return { root, config, approve, trace, fail, protectedRoot };
}

describe("release progression through existing coordination and storage", () => {
  it("reads only the Human Status approval and refuses ambiguous grants", () => {
    const f = fixture();
    expect(planApproval(f.config.plan).level).toBe("Production approved");
    writeFileSync(f.config.plan, "# Plan\n## Human section\n### Design\n**Approval:** Production approved\n### Status\nProposed\n");
    expect(() => planApproval(f.config.plan)).toThrow("requires one approval");
  });

  it("refuses a proposed design before creating task storage or running commands", async () => {
    const f = fixture("Proposed");
    await expect(progressRelease(f.config)).rejects.toThrow("does not approve");
    expect(f.trace()).toEqual([]);
    expect(existsSync(f.config.task.root)).toBe(false);
  });

  it("runs, verifies, cleans, releases, and removes only owned task storage", async () => {
    const f = fixture("DEV approved");
    const result = await progressRelease(f.config);
    expect(result.status).toBe("completed");
    expect(f.trace()).toEqual(["DEV:prepare", "DEV:execute", "DEV:verify", "DEV:cleanup", "DEV:verifyCleanup"]);
    expect(readCoordination(f.config.coordination).environments.DEV.owner).toBeNull();
    expect(existsSync(f.config.task.root)).toBe(false);
    expect(readdirSync(f.config.directory).some(name => name.endsWith(".log"))).toBe(false);
    expect(readFileSync(join(f.protectedRoot, "keep"), "utf8")).toBe("production state");
    await progressRelease(f.config);
    expect(f.trace()).toHaveLength(5);
  });

  it("stops at DEV approval, then resumes TEST and PROD without repeating DEV", async () => {
    const f = fixture("DEV approved", true);
    expect((await progressRelease(f.config)).status).toBe("awaiting-approval");
    expect(f.trace().some(line => line.startsWith("TEST:"))).toBe(false);
    f.approve("Production approved");
    expect((await progressRelease(f.config)).status).toBe("completed");
    expect(f.trace().filter(line => line === "DEV:execute")).toHaveLength(1);
    const slots = readCoordination(f.config.coordination);
    expect(slots.lastHealthy.transaction).toBe("prod-transaction");
    expect(Object.values(slots.environments).every((slot: any) => slot.owner === null)).toBe(true);
  }, 15000);

  it("recovers failure and verifies cleanup before releasing; never advances", async () => {
    const f = fixture("Production approved", true); f.fail("DEV-execute");
    await expect(progressRelease(f.config)).rejects.toThrow();
    expect(f.trace()).toEqual(["DEV:prepare", "DEV:execute", "DEV:recover", "DEV:cleanup", "DEV:verifyCleanup"]);
    expect(readCoordination(f.config.coordination).environments.DEV.previous.result).toBe("recovered");
    await expect(progressRelease(f.config)).rejects.toThrow("engineering review");
    expect(f.trace()).toHaveLength(5);
  });

  it("retains ownership after recovery fails and resumes recovery rather than activation", async () => {
    const f = fixture(); f.fail("DEV-execute"); f.fail("DEV-recover");
    await expect(progressRelease(f.config)).rejects.toThrow();
    expect(readCoordination(f.config.coordination).environments.DEV.owner).not.toBeNull();
    rmSync(join(f.root, "fail-DEV-recover"));
    await expect(progressRelease(f.config)).rejects.toThrow("Interrupted stage recovered");
    expect(f.trace().filter(line => line === "DEV:execute")).toHaveLength(1);
    expect(readCoordination(f.config.coordination).environments.DEV.owner).toBeNull();
  });

  it("permits guarded PROD recovery after marking the candidate failed", async () => {
    const f = fixture("Production approved", true); f.fail("PROD-execute");
    await expect(progressRelease(f.config)).rejects.toThrow();
    expect(f.trace().slice(-4)).toEqual(["PROD:execute", "PROD:recover", "PROD:cleanup", "PROD:verifyCleanup"]);
    const slots = readCoordination(f.config.coordination);
    expect(slots.environments.PROD.owner).toBeNull();
    expect(slots.environments.PROD.previous.result).toBe("recovered");
    expect(slots.batches[f.config.batch.id].status).toBe("failed");
  }, 15000);

  it.each(["interruption", "candidate changed"])("cancels only its queued ticket on %s", async reason => {
    const f = fixture();
    const first = coordinate(f.config.coordination, "enqueue", { environment: "DEV", requestId: "another-run", runId: "another-run", agent: f.config.agent, worktree: f.root });
    const wait = async () => {
      if (reason === "interruption") process.emit("SIGTERM");
      else {
        coordinate(f.config.coordination, "cancel", { environment: "DEV", ...first });
        writeFileSync(join(f.root, "archive.tgz"), "changed while queued");
      }
    };
    await expect(progressRelease(f.config, { wait })).rejects.toThrow(reason === "interruption" ? "interrupted while queued" : "archive differs");
    const slot = readCoordination(f.config.coordination).environments.DEV;
    expect(slot.queue.map((ticket: any) => ticket.requestId)).toEqual(reason === "interruption" ? ["another-run"] : []);
    expect(slot.owner).toBeNull();
    expect(f.trace()).toEqual(["DEV:prepare"]);
  });

  it("cancels its ticket when a claim is rejected without releasing another slot", async () => {
    const f = fixture();
    const ticket = coordinate(f.config.coordination, "enqueue", { environment: "TEST", requestId: "maintenance", runId: "maintenance", agent: f.config.agent, worktree: f.root, purpose: "maintenance" });
    coordinate(f.config.coordination, "claim", { environment: "TEST", ...ticket });
    await expect(progressRelease(f.config)).rejects.toThrow("Release the other environment");
    const slots = readCoordination(f.config.coordination);
    expect(slots.environments.DEV.queue).toEqual([]);
    expect(slots.environments.TEST.owner.requestId).toBe("maintenance");
  });

  it("withdraws from the queue when approval changes, then resumes after approval", async () => {
    const f = fixture();
    const first = coordinate(f.config.coordination, "enqueue", { environment: "DEV", requestId: "another-run", runId: "another-run", agent: f.config.agent, worktree: f.root });
    expect((await progressRelease(f.config, { wait: async () => f.approve("Proposed") })).status).toBe("awaiting-approval");
    expect(readCoordination(f.config.coordination).environments.DEV.queue.map((ticket: any) => ticket.requestId)).toEqual(["another-run"]);
    coordinate(f.config.coordination, "cancel", { environment: "DEV", ...first });
    f.approve("Production approved");
    expect((await progressRelease(f.config)).status).toBe("completed");
    expect(f.trace().filter(line => line === "DEV:prepare")).toHaveLength(1);
  });

  it("retries cleanup without replaying a verified deployment", async () => {
    const f = fixture(); f.fail("DEV-cleanup");
    await expect(progressRelease(f.config)).rejects.toThrow();
    expect(readCoordination(f.config.coordination).environments.DEV.owner).not.toBeNull();
    rmSync(join(f.root, "fail-DEV-cleanup"));
    expect((await progressRelease(f.config)).status).toBe("completed");
    expect(f.trace().filter(line => line === "DEV:execute")).toHaveLength(1);
  });

  it("rejects changed controller inputs and changed artifact bytes on resume", async () => {
    const f = fixture("DEV approved", true);
    await progressRelease(f.config);
    f.approve("Production approved");
    await expect(progressRelease({ ...f.config, runId: "other" })).rejects.toThrow("inputs changed");
    writeFileSync(join(f.root, "archive.tgz"), "different");
    await expect(progressRelease(f.config)).rejects.toThrow("archive differs");
    expect(f.trace().some(line => line === "TEST:execute")).toBe(false);
  });
});
