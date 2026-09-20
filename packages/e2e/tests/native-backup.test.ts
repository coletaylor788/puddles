import { afterEach, describe, expect, it } from "vitest";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Native backup lifecycle is also executable without TypeScript.
import { captureCurrentBackup, materializeCurrentBackup, planCurrentBackup, retireCurrentBackup, verifyCurrentBackup } from "../src/native-backup.mjs";
// @ts-expect-error Native lifecycle is also executable without TypeScript.
import { fileDigest } from "../src/native-state.mjs";

const roots: string[] = [];
function root() {
  const value = mkdtempSync(join(tmpdir(), "native-backup-test-"));
  roots.push(value);
  return value;
}
afterEach(() => {
  for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture() {
  const directory = root();
  const installDir = join(directory, "installed");
  const stateDir = join(directory, "state");
  const backupRoot = join(directory, "backups");
  const plistPath = join(directory, "gateway.plist");
  mkdirSync(installDir);
  mkdirSync(stateDir);
  mkdirSync(backupRoot);
  writeFileSync(join(installDir, "openclaw.mjs"), "console.log('synthetic')");
  writeFileSync(join(stateDir, "openclaw.json"), JSON.stringify({ gateway: { mode: "local" } }));
  writeFileSync(join(stateDir, "state.sqlite"), "synthetic sqlite");
  writeFileSync(plistPath, "synthetic plist");
  const target = {
    schemaVersion: 1,
    purpose: "production",
    host: hostname(),
    installDir,
    stateDir,
    backupRoot,
    plistPath,
    label: "synthetic.gateway",
    port: 18799,
    additionalInstalls: [],
    preparedFiles: [],
    backupExclusions: [{ path: "deploy-snapshots", reason: "legacy-backup-storage" }],
    backupNode: {
      path: process.execPath,
      sha256: fileDigest(process.execPath),
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    browser: {
      tag: "synthetic-browser",
      imageId: "sha256:" + "a".repeat(64),
    },
  };
  const calls: string[] = [];
  let started = true;
  let failStateClone = false;
  let failStop = false;
  let failRestart = false;
  const operations = {
    async inspectNode() {
      calls.push("inspect-node");
      return {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
      };
    },
    async currentBrowser() {
      calls.push("current-browser");
      return target.browser.imageId;
    },
    async inspectBrowser(imageId: string) {
      calls.push(`inspect-browser:${imageId}`);
    },
    async verifyService(path: string) {
      calls.push(`verify-service:${path}`);
      expect(existsSync(path)).toBe(true);
    },
    async verifyConfig(path: string) {
      calls.push("verify-config");
      JSON.parse(readFileSync(join(path, "openclaw.json"), "utf8"));
    },
    async verifySqlite(path: string) {
      calls.push("verify-sqlite");
      expect(readFileSync(join(path, "state.sqlite"), "utf8")).toBe("synthetic sqlite");
    },
    async verifyRuntime(runtime: string, state: string, node: string) {
      calls.push("verify-runtime");
      expect(readFileSync(join(runtime, "openclaw.mjs"), "utf8")).toContain("synthetic");
      expect(existsSync(join(state, "openclaw.json"))).toBe(true);
      expect(node).toBe(process.execPath);
    },
    async clone(from: string, to: string, _timeout?: number, exclusion?: string) {
      calls.push(from === stateDir ? "clone-state" : from === installDir ? "clone-runtime" : "clone-backup");
      if (from === stateDir && failStateClone) throw new Error("state clone timeout");
      cpSync(from, to, {
        recursive: true,
        filter: (source) => !exclusion || source !== join(from, exclusion),
      });
    },
    async stop() {
      calls.push("stop");
      started = false;
      if (failStop) throw new Error("stop failed after unload");
    },
    async start() {
      calls.push("start");
      if (failRestart) throw new Error("restart failed");
      started = true;
    },
    async health() {
      calls.push("health");
      if (!started) throw new Error("not started");
    },
  };
  const factory = () => operations;
  return {
    directory,
    target,
    calls,
    factory,
    operations,
    setFailStateClone(value: boolean) { failStateClone = value; },
    setFailStop(value: boolean) { failStop = value; },
    setFailRestart(value: boolean) { failRestart = value; },
    started: () => started,
  };
}

describe("current production recovery backup", () => {
  it("plans exact included capacity and direct legacy exclusion", () => {
    const f = fixture();
    mkdirSync(join(f.target.stateDir, "deploy-snapshots"));
    writeFileSync(join(f.target.stateDir, "deploy-snapshots", "large"), "not included");
    const plan = planCurrentBackup(f.target);
    expect(plan.exclusions).toEqual([
      { path: "deploy-snapshots", reason: "legacy-backup-storage" },
    ]);
    expect(plan.requiredBytes).toBe(plan.includedAllocatedBytes * 2);
    expect(plan.state.entries).toBe(2);
    expect(plan.freeBytes).toBeGreaterThan(0);
  });

  it("captures only after stopping writers and restarts unchanged before returning", async () => {
    const f = fixture();
    mkdirSync(join(f.target.stateDir, "deploy-snapshots"));
    writeFileSync(join(f.target.stateDir, "deploy-snapshots", "old"), "legacy");
    const result = await captureCurrentBackup(f.target, f.factory);
    expect(f.calls.indexOf("stop")).toBeLessThan(f.calls.indexOf("clone-state"));
    expect(f.calls.indexOf("clone-state")).toBeLessThan(f.calls.indexOf("start"));
    expect(f.started()).toBe(true);
    expect(existsSync(join(result.directory, "state", "deploy-snapshots"))).toBe(false);
    expect(result.manifest.exclusions).toEqual(f.target.backupExclusions);
    expect(existsSync(join(f.target.backupRoot, "backup-references", "latest-healthy-recovery.json"))).toBe(false);
  });

  it("restarts the unchanged service when state capture fails or times out", async () => {
    const f = fixture();
    f.setFailStateClone(true);
    await expect(captureCurrentBackup(f.target, f.factory, undefined, { captureTimeoutMs: 1000 }))
      .rejects.toThrow("state clone timeout");
    expect(f.calls.slice(-2)).toEqual(["start", "health"]);
    expect(f.started()).toBe(true);
    expect(existsSync(join(f.target.backupRoot, "backup-references", "latest-healthy-recovery.json"))).toBe(false);
  });

  it("restarts when writer stop fails after unloading the service", async () => {
    const f = fixture();
    f.setFailStop(true);
    await expect(captureCurrentBackup(f.target, f.factory)).rejects.toThrow(
      "stop failed after unload",
    );
    expect(f.calls.slice(-3)).toEqual(["health", "start", "health"]);
    expect(f.started()).toBe(true);
    expect(existsSync(join(f.target.backupRoot, "backup-references", "latest-healthy-recovery.json"))).toBe(false);
  });

  it("retains restart failure and resumes an interrupted stopped journal safely", async () => {
    const f = fixture();
    f.setFailStateClone(true);
    f.setFailRestart(true);
    await expect(captureCurrentBackup(f.target, f.factory)).rejects.toThrow(
      "failed to restore the unchanged service",
    );
    f.setFailRestart(false);
    f.setFailStateClone(false);
    const directory = join(
      f.target.backupRoot,
      readdirSync(f.target.backupRoot).find((name) => /^backup-\d+-\d+$/.test(name))!,
    );
    const result = await captureCurrentBackup(f.target, f.factory, directory);
    expect(result.manifest.status).toBe("captured");
    expect(f.started()).toBe(true);
    expect(f.calls.filter((entry) => entry === "start")).toHaveLength(3);
  });

  it("rejects manifest, runtime, Node, browser and exclusion drift", async () => {
    const f = fixture();
    const result = await captureCurrentBackup(f.target, f.factory);
    writeFileSync(join(result.directory, "runtime", "changed"), "tamper");
    expect(() => verifyCurrentBackup(f.target, result.directory)).toThrow(
      "Backup runtime differs from manifest",
    );
    rmSync(join(result.directory, "runtime", "changed"));
    const manifestPath = join(result.directory, "backup.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.browser.imageId = "sha256:" + "b".repeat(64);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => verifyCurrentBackup(f.target, result.directory)).toThrow(
      "Backup manifest identity is invalid",
    );
  });

  it("uses the actual recovery consumer before advancing the healthy reference", async () => {
    const f = fixture();
    const captured = await captureCurrentBackup(f.target, f.factory);
    const destination = join(root(), "restore");
    const result = await materializeCurrentBackup(
      f.target,
      captured.directory,
      destination,
      f.factory,
    );
    expect(f.calls).toContain("verify-runtime");
    expect(f.calls).toContain("verify-config");
    expect(f.calls).toContain("verify-sqlite");
    expect(f.calls).toContain(`inspect-browser:${f.target.browser.imageId}`);
    expect(result.reference.transaction).toBe(captured.manifest.transaction);
    expect(JSON.parse(readFileSync(
      join(f.target.backupRoot, "backup-references", "latest-healthy-recovery.json"),
      "utf8",
    )).materializationSha256).toBe(result.proof.proofSha256);
    await expect(materializeCurrentBackup(
      f.target,
      captured.directory,
      destination,
      f.factory,
    )).rejects.toThrow("already exists");
  });

  it("fails closed when the healthy reference changes before materialization", async () => {
    const f = fixture();
    const captured = await captureCurrentBackup(f.target, f.factory);
    const referenceRoot = join(f.target.backupRoot, "backup-references");
    mkdirSync(referenceRoot, { recursive: true });
    writeFileSync(join(referenceRoot, "latest-healthy-recovery.json"), JSON.stringify({
      schema: "puddles.openclaw-current-backup-reference/v1",
      schemaVersion: 1,
      transaction: "backup-1-1",
      manifestSha256: "a".repeat(64),
      materializationSha256: "b".repeat(64),
      previousTransaction: null,
      updatedAt: new Date().toISOString(),
    }));
    await expect(materializeCurrentBackup(
      f.target,
      captured.directory,
      join(root(), "isolated"),
      f.factory,
    )).rejects.toThrow("reference changed");
    expect(existsSync(captured.directory)).toBe(true);
  });

  it("repairs journal state after an identical reference was committed", async () => {
    const f = fixture();
    const captured = await captureCurrentBackup(f.target, f.factory);
    await materializeCurrentBackup(
      f.target,
      captured.directory,
      join(root(), "first-restore"),
      f.factory,
    );
    const manifestPath = join(captured.directory, "backup.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.status = "captured";
    delete manifest.materializedAt;
    delete manifest.materialization;
    writeFileSync(manifestPath, JSON.stringify(manifest));

    const resumed = await materializeCurrentBackup(
      f.target,
      captured.directory,
      join(root(), "second-restore"),
      f.factory,
    );
    expect(JSON.parse(readFileSync(
      join(captured.directory, "backup-journal.json"),
      "utf8",
    )).status).toBe("referenced");
    expect(resumed.reference.transaction).toBe(captured.manifest.transaction);
  });

  it("rejects incompatible Node and browser identities in the recovery consumer", async () => {
    const f = fixture();
    const captured = await captureCurrentBackup(f.target, f.factory);
    const originalInspectNode = f.operations.inspectNode;
    f.operations.inspectNode = async () => ({
      version: "v0.0.0",
      platform: process.platform,
      arch: process.arch,
    });
    await expect(materializeCurrentBackup(
      f.target,
      captured.directory,
      join(root(), "wrong-node"),
      f.factory,
    )).rejects.toThrow("Backup Node is incompatible");

    f.operations.inspectNode = originalInspectNode;
    f.operations.inspectBrowser = async () => {
      throw new Error("browser image is unavailable");
    };
    await expect(materializeCurrentBackup(
      f.target,
      captured.directory,
      join(root(), "wrong-browser"),
      f.factory,
    )).rejects.toThrow("browser image is unavailable");
    expect(existsSync(join(f.target.backupRoot, "backup-references", "latest-healthy-recovery.json"))).toBe(false);
  });

  it("retires exactly one superseded verified recovery and leaves unrelated paths", async () => {
    const f = fixture();
    const first = await captureCurrentBackup(f.target, f.factory);
    await materializeCurrentBackup(f.target, first.directory, join(root(), "first"), f.factory);
    const second = await captureCurrentBackup(f.target, f.factory);
    await materializeCurrentBackup(f.target, second.directory, join(root(), "second"), f.factory);
    const unrelated = join(f.target.backupRoot, "operator-notes");
    mkdirSync(unrelated);
    expect(retireCurrentBackup(f.target, first.directory)).toEqual({
      transaction: first.manifest.transaction,
      retired: true,
    });
    expect(existsSync(first.directory)).toBe(false);
    expect(existsSync(second.directory)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
    expect(() => retireCurrentBackup(f.target, second.directory)).toThrow(
      "Referenced backup cannot be retired",
    );
  });

  it("resumes one interrupted retirement and rejects unknown backup content", async () => {
    const f = fixture();
    const first = await captureCurrentBackup(f.target, f.factory);
    await materializeCurrentBackup(f.target, first.directory, join(root(), "first"), f.factory);
    const second = await captureCurrentBackup(f.target, f.factory);
    await materializeCurrentBackup(f.target, second.directory, join(root(), "second"), f.factory);

    writeFileSync(join(first.directory, "unknown"), "must block");
    expect(() => retireCurrentBackup(f.target, first.directory)).toThrow(
      "Unknown backup entry blocks recovery and retirement",
    );
    rmSync(join(first.directory, "unknown"));

    const transaction = first.manifest.transaction;
    const backupRoot = realpathSync(f.target.backupRoot);
    const source = realpathSync(first.directory);
    const trashPath = join(backupRoot, `.retiring-${transaction}`);
    const journalPath = join(backupRoot, `retire-${transaction}.json`);
    writeFileSync(journalPath, JSON.stringify({
      schema: "puddles.openclaw-current-backup-retirement/v1",
      schemaVersion: 1,
      transaction,
      manifestSha256: first.manifest.manifestSha256,
      source,
      trash: trashPath,
      replacementTransaction: second.manifest.transaction,
      status: "planned",
      updatedAt: new Date().toISOString(),
    }));
    renameSync(source, trashPath);

    expect(retireCurrentBackup(f.target, first.directory)).toEqual({
      transaction,
      retired: true,
    });
    expect(existsSync(trashPath)).toBe(false);
    expect(existsSync(journalPath)).toBe(false);
    expect(existsSync(second.directory)).toBe(true);
  });
});
