import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Executable host-maintenance entrypoint.
import { maintain, maintenanceInputs } from "../bin/openclaw-backup-maintenance.mjs";

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
