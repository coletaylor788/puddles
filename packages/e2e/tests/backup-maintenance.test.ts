import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Executable host-maintenance entrypoint.
import { maintain, maintenanceInputs } from "../bin/openclaw-backup-maintenance.mjs";
// @ts-expect-error Executable digest helpers.
import { fileDigest, jsonDigest } from "../src/native-state.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "backup-maintenance-"));
  const root = join(dir, "backups"), work = join(dir, "work");
  mkdirSync(root); mkdirSync(work);
  const write = (path: string, data: unknown) => writeFileSync(path, JSON.stringify(data));
  write(join(root, "latest-activation.json"), { transaction: "activation-10-1" });
  write(join(root, "retention-context.json"), { schemaVersion: 1, transaction: "activation-10-1", target: { backupRoot: root, purpose: "production" }, receipt: { path: "/receipt", sha256: "a".repeat(64) } });
  const policy = join(dir, "policy.json"); write(policy, { minAgeHours: 24 });
  const calls: Array<{ operation: string; input: Record<string, any> }> = [];
  const config = { backupRoot: root, workDir: work, coordination: "/slots", policy, agent: { id: "maintenance", contact: "local:maintenance" } };
  const deps = {
    status: (): { environments: { PROD: { owner: unknown; queue: unknown[] } } } => ({ environments: { PROD: { owner: null, queue: [] } } }),
    coordinate: async (_path: string, operation: string, input: Record<string, any>) => { calls.push({ operation, input }); return { token: "token" }; },
    execute: async (..._args: any[]) => {},
  };
  return { dir, root, work, write, config, deps, calls, close: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("scheduled backup maintenance", () => {
  it("refreshes the exact receipt from current context and releases a joined success", async () => {
    const f = fixture();
    try {
      expect(maintenanceInputs(f.root, {}).policy.replacement.receipt.path).toBe("/receipt");
      expect((await maintain(f.config, f.deps)).status).toBe("passed");
      expect(f.calls.map(c => c.operation)).toEqual(["enqueue", "claim", "release"]);
      expect(f.calls[0].input.purpose).toBe("maintenance");
    } finally { f.close(); }
  });
  it("does not queue or mutate when another owner is active", async () => {
    const f = fixture();
    try {
      f.deps.status = () => ({ environments: { PROD: { owner: {}, queue: [] } } });
      expect(await maintain(f.config, f.deps)).toEqual({ status: "busy" });
      expect(f.calls).toEqual([]);
    } finally { f.close(); }
  });
  it("rejects stale producer context before claiming", async () => {
    const f = fixture();
    try {
      f.write(join(f.root, "latest-activation.json"), { transaction: "activation-20-2" });
      await expect(maintain(f.config, f.deps)).rejects.toThrow("matching retention context");
      expect(f.calls).toEqual([]);
    } finally { f.close(); }
  });
  it("cancels its own ticket if a concurrent owner wins", async () => {
    const f = fixture();
    try {
      const base = f.deps.coordinate;
      f.deps.coordinate = async (path, operation, input) => {
        const result = await base(path, operation, input);
        if (operation === "claim") throw new Error("busy race");
        return result;
      };
      await expect(maintain(f.config, f.deps)).rejects.toThrow("busy race");
      expect(f.calls.map(c => c.operation)).toEqual(["enqueue", "claim", "cancel"]);
    } finally { f.close(); }
  });
  it("retains ownership on a failed controller or unresolved backup lock", async () => {
    const f = fixture();
    try {
      f.deps.execute = async () => { throw new Error("controller failed"); };
      await expect(maintain(f.config, f.deps)).rejects.toThrow("controller failed");
      expect(f.calls.map(c => c.operation)).toEqual(["enqueue", "claim"]);
      f.deps.execute = async () => { mkdirSync(join(f.root, "lock")); };
      await expect(maintain(f.config, f.deps)).rejects.toThrow("Backup lock remains");
      expect(f.calls.some(c => c.operation === "release")).toBe(false);
    } finally { f.close(); }
  });
});

it.each(["none", "plan", "tombstone", "lock", "journal", "missing-join"])("failed maintenance release requires clean joined preflight: %s", async fault => {
  const f = fixture();
  try {
    f.deps.execute = async (...args: any[]) => {
      const lease = JSON.parse(readFileSync(join(f.work, "lease.json"), "utf8"));
      if (fault !== "missing-join") f.write(args[4], { schemaVersion: 1, requestId: lease.requestId, joined: true, controllerPid: 123 });
      if (fault === "plan") f.write(join(f.root, "retention-plan.json"), {});
      if (fault === "tombstone") mkdirSync(join(f.root, ".retiring-activation-1-1"));
      if (fault === "lock") mkdirSync(join(f.root, "lock"));
      if (fault === "journal") f.write(join(f.root, "retention-activation-1-1.json"), { status: "removed" });
      throw new Error("preflight failed");
    };
    await expect(maintain(f.config, f.deps)).rejects.toThrow("preflight failed");
    expect(f.calls.some(call => call.operation === "release")).toBe(fault === "none");
    const result = JSON.parse(readFileSync(join(f.root, "retention-health.json"), "utf8"));
    expect(result.status).toBe(fault === "none" ? "blocked" : "failed");
    expect(result.leaseRetained).toBe(fault !== "none");
  } finally { f.close(); }
});

it('uses current backup authority after activation payloads are retired', async () => {
  const f = fixture();
  try {
    const target = { backupRoot: f.root, purpose: 'production', backupNode: { path: '/synthetic-node' } };
    f.write(join(f.root, 'backup-retention-context.json'), { schemaVersion: 1, transaction: 'backup-30-1', target, activation: { transaction: 'activation-10-1' } });
    const policy = { mode: 'single-verified-backup' };
    const inputs = maintenanceInputs(f.root, policy);
    expect(inputs.policy.replacement.kind).toBe('backup');
    expect(inputs.target).toEqual(target);
    expect(inputs.refresh).toBeUndefined();
    f.write(f.config.policy, policy);
    expect((await maintain(f.config, f.deps)).transaction).toBe('backup-30-1');
  } finally { f.close(); }
});

it('refreshes a newly published healthy release and retains ownership after a failed refresh', async () => {
  const f = fixture();
  try {
    const target = { backupRoot: f.root, purpose: 'production' };
    f.write(join(f.root, 'backup-retention-context.json'), { schemaVersion: 1, transaction: 'backup-30-1', target, activation: { transaction: 'activation-10-1' } });
    f.write(join(f.root, 'latest-activation.json'), { transaction: 'activation-40-1' });
    f.write(join(f.root, 'retention-context.json'), { schemaVersion: 1, transaction: 'activation-40-1', target, backupTarget: { ...target, backupNode: { path: '/new-node' } } });
    f.write(f.config.policy, { mode: 'single-verified-backup' });
    expect(maintenanceInputs(f.root, { mode: 'single-verified-backup' })).toMatchObject({ refresh: true, target: { backupNode: { path: '/new-node' } } });
    f.deps.execute = async (...args: any[]) => {
      expect(args[1]).toContain('refresh');
      const lease = JSON.parse(readFileSync(join(f.work, 'lease.json'), 'utf8'));
      f.write(args[4], { schemaVersion: 1, requestId: lease.requestId, joined: true, controllerPid: 123 });
      throw new Error('capture failed before context publication');
    };
    await expect(maintain(f.config, f.deps)).rejects.toThrow('capture failed');
    expect(f.calls.some(call => call.operation === 'release')).toBe(false);
    expect(JSON.parse(readFileSync(join(f.root, 'retention-health.json'), 'utf8')).readOnlyFailure).toBe(false);
  } finally { f.close(); }
});


function legacyPublisherFixture() {
  const f = fixture();
  const plistPath = join(f.dir, 'service.plist');
  writeFileSync(plistPath, 'original deployed service');
  const target = { backupRoot: f.root, purpose: 'production', plistPath,
    nodeMigration: { desired: { path: '/obsolete-candidate-node' } },
    legacyActivationReceipt: { path: '/obsolete-receipt' } };
  const latest = { transaction: 'activation-40-1', target: jsonDigest(target) };
  f.write(join(f.root, 'backup-retention-context.json'), { schemaVersion: 1, transaction: 'backup-30-1',
    target: { backupRoot: f.root, purpose: 'production' }, activation: { transaction: 'activation-10-1' } });
  f.write(join(f.root, 'latest-activation.json'), latest);
  f.write(join(f.root, 'retention-context.json'), { schemaVersion: 1, transaction: latest.transaction, target });
  mkdirSync(join(f.root, latest.transaction));
  const journalPath = join(f.root, latest.transaction, 'recovery.json');
  const journal = { schemaVersion: 1, ...latest, status: 'healthy', quiesced: false, deployedServiceSha256: fileDigest(plistPath) };
  f.write(journalPath, journal);
  f.write(f.config.policy, { mode: 'single-verified-backup' });
  return { ...f, target, latest, journalPath, journal };
}

it('refreshes a matching older publisher using the actual service interpreter under ownership', async () => {
  const f = legacyPublisherFixture();
  try {
    const node = { path: '/actual-deployed-node', sha256: 'a'.repeat(64) };
    const deps = { ...f.deps, inspectServiceNode: async () => {
      expect(f.calls.map(call => call.operation)).toEqual(['enqueue', 'claim']);
      return node;
    }, execute: async (...args: any[]) => {
      const selected = JSON.parse(readFileSync(join(f.work, 'target.json'), 'utf8'));
      expect(args[1]).toContain('refresh');
      expect(selected.backupNode).toEqual(node);
      expect(selected.nodeMigration).toBeUndefined();
      expect(selected.legacyActivationReceipt).toBeUndefined();
      expect(selected.backupExclusions).toEqual([{ path: 'deploy-snapshots', reason: 'legacy-backup-storage' }]);
    } };
    expect((await maintain(f.config, deps)).status).toBe('passed');
    expect(f.calls.map(call => call.operation)).toEqual(['enqueue', 'claim', 'release']);
  } finally { f.close(); }
});

it.each(['target', 'service', 'journal', 'transaction'])('holds older publisher with mismatched %s', async fault => {
  const f = legacyPublisherFixture();
  try {
    if (fault === 'target') f.write(join(f.root, 'retention-context.json'), { schemaVersion: 1, transaction: f.latest.transaction, target: { ...f.target, port: 1 } });
    if (fault === 'service') writeFileSync(f.target.plistPath, 'changed');
    if (fault === 'journal') f.write(f.journalPath, { ...f.journal, status: 'recovery-required' });
    if (fault === 'transaction') f.write(join(f.root, 'latest-activation.json'), { ...f.latest, transaction: '../unexpected' });
    await expect(maintain(f.config, f.deps)).rejects.toThrow();
    expect(f.calls).toEqual([]);
  } finally { f.close(); }
});

it('releases a claimed owner when legacy service inspection fails before starting capture', async () => {
  const f = legacyPublisherFixture();
  try {
    const deps = { ...f.deps, inspectServiceNode: async () => { throw new Error('unsupported interpreter'); } };
    await expect(maintain(f.config, deps)).rejects.toThrow('unsupported interpreter');
    expect(f.calls.at(-1)).toMatchObject({ operation: 'release', input: { result: 'failed-before-start' } });
  } finally { f.close(); }
});

it('rechecks producer identity after winning a maintenance claim', async () => {
  const f = legacyPublisherFixture();
  try {
    const coordinate = f.deps.coordinate;
    f.deps.coordinate = async (path, operation, input) => {
      const result = await coordinate(path, operation, input);
      if (operation === 'claim') f.write(join(f.root, 'latest-activation.json'), { transaction: 'activation-99-1' });
      return result;
    };
    await expect(maintain(f.config, f.deps)).rejects.toThrow();
    expect(f.calls.at(-1)).toMatchObject({ operation: 'release', input: { result: 'failed-before-start' } });
  } finally { f.close(); }
});
