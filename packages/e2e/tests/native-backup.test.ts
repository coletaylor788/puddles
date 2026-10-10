import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
// @ts-expect-error Native backup lifecycle is also executable without TypeScript.
import { backupOperations, captureCurrentBackup, currentBackupRecovery, materializeCurrentBackup, planCurrentBackup, retireCurrentBackup, verifyCurrentBackup } from "../src/native-backup.mjs";
// @ts-expect-error Native lifecycle is also executable without TypeScript.
import { fileDigest, jsonDigest, treeDigest } from "../src/native-state.mjs";
// @ts-expect-error Native release lifecycle is also executable without TypeScript.
import { certifyRelease, createBuildReceipt, createSourceGate, createTargetProof, promoteRelease } from "../src/native-release.mjs";

// @ts-expect-error Executable target migration contract.
import { migrationTargetIdentity } from "../src/native-migration-bindings.mjs";
// @ts-expect-error Executable activation recovery contract.
import { verifyCurrentActivationRecovery } from "../src/native-activation.mjs";

const roots: string[] = [];
function root() {
  const value = mkdtempSync(join(tmpdir(), "native-backup-test-"));
  roots.push(value);
  return value;
}
afterEach(async () => {
  await new Promise<void>(resolve => setImmediate(resolve));
  vi.unstubAllEnvs();
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
    legacyActivationReceipt: undefined as
      { path: string; sha256: string } | undefined,
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

function legacyRecovery(f: ReturnType<typeof fixture>, paired = false) {
  const releaseRoot = join(f.directory, "release");
  const packageRoot = join(releaseRoot, "package");
  const runtime = join(packageRoot, "runtime");
  mkdirSync(packageRoot, { recursive: true });
  cpSync(f.target.installDir, runtime, { recursive: true });
  const runtimeSha256 = treeDigest(runtime, { portable: true });
  writeFileSync(join(packageRoot, "runtime-identity.json"), JSON.stringify({
    schemaVersion: 1,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    runtimeSha256,
  }));
  const artifactPath = join(releaseRoot, "runtime.tgz");
  execFileSync("tar", [
    "-czf", artifactPath, "-C", packageRoot, "runtime", "runtime-identity.json",
  ]);
  const artifact = {
    schemaVersion: 1,
    path: artifactPath,
    sha256: fileDigest(artifactPath),
    runtimeSha256,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  };
  const stateMigrations = paired ? {
    schema: "puddles.target-state-migrations/v1",
    generator: { repositoryId: "overlay", inputsSha256: "1".repeat(64) },
    policy: { id: "fixture/v1", sha256: "2".repeat(64) },
    bindings: [
      { role: "rehearsal", targetSha256: "3".repeat(64), inputsSha256: "4".repeat(64), manifestSha256: "5".repeat(64) },
      { role: "production", targetSha256: jsonDigest(migrationTargetIdentity(f.target)), inputsSha256: "6".repeat(64), manifestSha256: "7".repeat(64) },
    ],
  } : undefined;
  if (paired) Object.assign(f.target, { stateMigration: { manifestPath: join(releaseRoot, "production.json"), sha256: "7".repeat(64) } });
  const build = createBuildReceipt({
    ...(stateMigrations ? { stateMigrations, stateMigration: { sha256: "5".repeat(64) },
      sourceRepositories: [{ id: "overlay", head: "a".repeat(40), tree: "b".repeat(40) }] } : {}),
    repository: { head: "a".repeat(40), tree: "b".repeat(40) },
    source: {
      ref: "c".repeat(40),
      sha256: "d".repeat(64),
      buildInputsSha256: "e".repeat(64),
      patchesSha256: "f".repeat(64),
      extensionSha256: "none",
    },
    composition: { extensionSha256: "none" },
    tools: {
      node: process.version,
      nodeBinary: fileDigest(process.execPath),
      platform: process.platform,
      arch: process.arch,
      manager: "12.4.0",
      npm: "11.8.0",
    },
    artifact,
    additionalArtifacts: [],
    preparedFiles: [],
    proofs: {
      prepare: "1".repeat(64),
      dependencies: "2".repeat(64),
      build: "3".repeat(64),
      package: "4".repeat(64),
    },
  });
  const stage = (name: string) => {
    const inputs = paired ? { fixture: name, tools: build.tools, buildId: build.buildId, stateMigrations } : { fixture: name };
    const key = jsonDigest(inputs);
    mkdirSync(join(releaseRoot, "stages"), { recursive: true });
    writeFileSync(join(releaseRoot, "stages", `${name}.json`), JSON.stringify({
      schemaVersion: 1,
      name,
      inputs,
      key,
      status: "passed",
      outputs: {},
    }));
    return key;
  };
  stage("regressions");
  stage("install");
  stage("runtime");
  const deploymentRecovery = (name: string, status: "healthy" | "rolled-back") => {
    const recovery = join(releaseRoot, name);
    mkdirSync(recovery);
    writeFileSync(join(recovery, "recovery.json"), JSON.stringify({
      schemaVersion: 1,
      status,
      transaction: name,
      ...(stateMigrations ? { migrationBinding: stateMigrations.bindings[0] } : {}),
      target: "9".repeat(64),
      artifact: artifact.sha256,
    }));
    if (status === "rolled-back") {
      writeFileSync(join(recovery, "failure.json"), JSON.stringify({ message: "fixture" }));
    }
    return recovery;
  };
  const sourceGate = createSourceGate(build, releaseRoot, { tests: ["fixture"] });
  const targetProof = createTargetProof(
    build,
    releaseRoot,
    deploymentRecovery("success", "healthy"),
    deploymentRecovery("rollback", "rolled-back"),
  );
  const certification = certifyRelease(build, sourceGate, targetProof);
  const release = promoteRelease(build, sourceGate, targetProof, certification);
  const receiptPath = join(releaseRoot, "candidate.json");
  writeFileSync(receiptPath, JSON.stringify(release));
  Object.assign(f.target, {
    legacyActivationReceipt: {
      path: receiptPath,
      sha256: fileDigest(receiptPath),
    },
  });
  const transaction = `activation-${Date.now()}-${process.pid}`;
  const directory = join(f.target.backupRoot, transaction);
  mkdirSync(directory);
  cpSync(f.target.installDir, join(directory, "package"), { recursive: true });
  cpSync(f.target.stateDir, join(directory, "state"), { recursive: true });
  cpSync(f.target.plistPath, join(directory, "service.plist"));
  const journal = {
    schemaVersion: 1,
    status: "healthy",
    snapshotReady: true,
    quiesced: false,
    transaction,
    ...(stateMigrations ? { migrationBinding: stateMigrations.bindings[1] } : {}),
    target: (paired ? "8" : "9").repeat(64),
    artifact: artifact.sha256,
    deployedRuntimeSha256: treeDigest(f.target.installDir, { portable: true }),
    deployedServiceSha256: fileDigest(f.target.plistPath),
    snapshots: {
      package: treeDigest(join(directory, "package")),
      state: treeDigest(join(directory, "state")),
      service: fileDigest(join(directory, "service.plist")),
    },
  };
  writeFileSync(join(directory, "recovery.json"), JSON.stringify(journal));
  writeFileSync(join(f.target.backupRoot, "latest-activation.json"), JSON.stringify({
    transaction,
    target: journal.target,
  }));
  return {
    directory,
    journal,
    identity: {
      kind: "activation",
      transaction,
      activationTargetSha256: journal.target,
      artifactSha256: journal.artifact,
      journalSha256: fileDigest(join(directory, "recovery.json")),
      receiptPath: realpathSync(receiptPath),
      receiptSha256: fileDigest(receiptPath),
      latestActivationSha256: fileDigest(join(f.target.backupRoot, "latest-activation.json")),
    },
  };
}

function legacyRetirementState(
  f: ReturnType<typeof fixture>,
  legacy: ReturnType<typeof legacyRecovery>,
  referenceBefore: Record<string, unknown>,
) {
  const backupRoot = realpathSync(f.target.backupRoot);
  const source = join(backupRoot, legacy.journal.transaction);
  const trash = join(backupRoot, `.retiring-${legacy.journal.transaction}`);
  const activationReference = join(backupRoot, "latest-activation.json");
  const activationReferenceTrash = join(
    backupRoot,
    `.retiring-${legacy.journal.transaction}-latest-activation.json`,
  );
  const referenceAfter = {
    ...referenceBefore,
    previousRecovery: null,
    updatedAt: new Date().toISOString(),
  };
  return {
    source,
    trash,
    activationReference,
    activationReferenceTrash,
    referenceAfter,
    journal: {
      schema: "puddles.openclaw-current-backup-retirement/v1",
      schemaVersion: 1,
      kind: "activation",
      transaction: legacy.journal.transaction,
      legacyRecovery: legacy.identity,
      referenceBefore,
      referenceBeforeSha256: jsonDigest(referenceBefore),
      referenceAfter,
      referenceAfterSha256: jsonDigest(referenceAfter),
      source,
      trash,
      activationReference,
      activationReferenceTrash,
      status: "planned",
    },
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
    const deadOwner = spawnSync(process.execPath, ["-e", ""]).pid;
    mkdirSync(join(f.target.backupRoot, "lock"));
    writeFileSync(join(f.target.backupRoot, "lock", "owner.json"), JSON.stringify({
      pid: deadOwner,
      startedAt: new Date().toISOString(),
    }));
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

  it("resolves browser inspection through the caller PATH during materialization", async () => {
    const f = fixture();
    const captured = await captureCurrentBackup(f.target, f.factory);
    const bin = join(root(), "bin");
    mkdirSync(bin);
    const docker = join(bin, "docker");
    writeFileSync(docker, "#!/bin/sh\nprintf '%s\\n' \"$5\"\n");
    chmodSync(docker, 0o755);
    vi.stubEnv("PATH", bin);

    const restored = join(root(), "restored");
    await materializeCurrentBackup(
      f.target,
      captured.directory,
      restored,
      (target: typeof f.target, workDir: string) => ({
        ...f.operations,
        inspectBrowser: backupOperations(target, workDir).inspectBrowser,
      }),
    );

    expect(existsSync(join(restored, "materialization.json"))).toBe(true);
  });

  it("does not create reference storage when current has no published backup", () => {
    const f = fixture();
    const referenceRoot = join(f.target.backupRoot, "backup-references");

    expect(() => currentBackupRecovery(f.target)).toThrow(
      "Verified replacement backup is missing",
    );
    expect(existsSync(referenceRoot)).toBe(false);
  });

  it("refuses retirement with a domain error when no backup is published", async () => {
    const f = fixture();
    const captured = await captureCurrentBackup(f.target, f.factory);

    expect(() => retireCurrentBackup(f.target, captured.directory)).toThrow(
      "A verified replacement reference is required before retirement",
    );
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

  it("replaces and retires the exact legacy activation recovery after one materialization", async () => {
    const f = fixture();
    const legacy = legacyRecovery(f);
    const receipt = f.target.legacyActivationReceipt;
    f.target.legacyActivationReceipt = undefined;
    const captured = await captureCurrentBackup(f.target, f.factory);
    const materialized = await materializeCurrentBackup(
      f.target,
      captured.directory,
      join(root(), "legacy-replacement"),
      f.factory,
    );
    const unrelated = join(f.target.backupRoot, "operator-notes");
    mkdirSync(unrelated);

    expect(captured.manifest.previousRecovery).toBe(null);
    expect(materialized.reference.previousRecovery).toBe(null);
    expect(existsSync(legacy.directory)).toBe(true);
    expect(existsSync(join(f.target.backupRoot, "latest-activation.json"))).toBe(true);

    f.target.legacyActivationReceipt = receipt;
    expect(retireCurrentBackup(f.target, legacy.directory)).toEqual({
      transaction: legacy.journal.transaction,
      retired: true,
    });
    expect(existsSync(legacy.directory)).toBe(false);
    expect(existsSync(join(f.target.backupRoot, "latest-activation.json"))).toBe(false);
    expect(existsSync(captured.directory)).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
    const reference = JSON.parse(readFileSync(
      join(f.target.backupRoot, "backup-references", "latest-healthy-recovery.json"),
      "utf8",
    ));
    expect(reference.previousRecovery).toBe(null);
    expect(currentBackupRecovery(f.target)).toMatchObject({
      directory: realpathSync(captured.directory),
      reference,
    });

    const rediscovered = await materializeCurrentBackup(
      f.target,
      captured.directory,
      join(root(), "legacy-replacement-recheck"),
      f.factory,
    );
    expect(rediscovered.reference).toEqual(reference);
  });

  it("publishes a new-format backup without reading a mismatched legacy pointer", async () => {
      const f = fixture();
      const legacy = legacyRecovery(f);
      f.target.legacyActivationReceipt = undefined;
      writeFileSync(join(f.target.backupRoot, "latest-activation.json"), JSON.stringify({
        transaction: legacy.journal.transaction,
        target: "d".repeat(64),
      }));

      const captured = await captureCurrentBackup(f.target, f.factory);
      const materialized = await materializeCurrentBackup(
        f.target,
        captured.directory,
        join(root(), "legacy-mismatch"),
        f.factory,
      );
      expect(materialized.reference.previousRecovery).toBe(null);
      expect(existsSync(legacy.directory)).toBe(true);
      expect(existsSync(join(f.target.backupRoot, "latest-activation.json"))).toBe(true);
      expect(existsSync(join(
        f.target.backupRoot,
        "backup-references",
        "latest-healthy-recovery.json",
      ))).toBe(true);
  });

  it("rejects mismatched legacy receipt and artifact identities only during cleanup", async () => {
      const receiptFixture = fixture();
      const receiptLegacy = legacyRecovery(receiptFixture);
      const receiptBackup = await captureCurrentBackup(
        receiptFixture.target,
        receiptFixture.factory,
      );
      await materializeCurrentBackup(
        receiptFixture.target,
        receiptBackup.directory,
        join(root(), "receipt-replacement"),
        receiptFixture.factory,
      );
      writeFileSync(
        receiptFixture.target.legacyActivationReceipt!.path,
        JSON.stringify({ changed: true }),
      );
      expect(() => retireCurrentBackup(
        receiptFixture.target,
        receiptLegacy.directory,
      )).toThrow("receipt identity is invalid");
      expect(existsSync(receiptLegacy.directory)).toBe(true);
      expect(existsSync(join(
        receiptFixture.target.backupRoot,
        "latest-activation.json",
      ))).toBe(true);

      const artifactFixture = fixture();
      const artifactLegacy = legacyRecovery(artifactFixture);
      const artifactBackup = await captureCurrentBackup(
        artifactFixture.target,
        artifactFixture.factory,
      );
      await materializeCurrentBackup(
        artifactFixture.target,
        artifactBackup.directory,
        join(root(), "artifact-replacement"),
        artifactFixture.factory,
      );
      const journalPath = join(artifactLegacy.directory, "recovery.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8"));
      journal.artifact = "0".repeat(64);
      writeFileSync(journalPath, JSON.stringify(journal));
      expect(() => retireCurrentBackup(
        artifactFixture.target,
        artifactLegacy.directory,
      )).toThrow("release receipt differs from recovery");
      expect(existsSync(artifactLegacy.directory)).toBe(true);

      const runtimeFixture = fixture();
      const runtimeLegacy = legacyRecovery(runtimeFixture);
      const runtimeBackup = await captureCurrentBackup(
        runtimeFixture.target,
        runtimeFixture.factory,
      );
      await materializeCurrentBackup(
        runtimeFixture.target,
        runtimeBackup.directory,
        join(root(), "runtime-replacement"),
        runtimeFixture.factory,
      );
      const runtimeJournalPath = join(runtimeLegacy.directory, "recovery.json");
      const runtimeJournal = JSON.parse(readFileSync(runtimeJournalPath, "utf8"));
      runtimeJournal.deployedRuntimeSha256 = "1".repeat(64);
      writeFileSync(runtimeJournalPath, JSON.stringify(runtimeJournal));
      expect(() => retireCurrentBackup(
        runtimeFixture.target,
        runtimeLegacy.directory,
      )).toThrow("release receipt differs from recovery");

      const targetFixture = fixture();
      const targetLegacy = legacyRecovery(targetFixture);
      const targetBackup = await captureCurrentBackup(
        targetFixture.target,
        targetFixture.factory,
      );
      await materializeCurrentBackup(
        targetFixture.target,
        targetBackup.directory,
        join(root(), "target-replacement"),
        targetFixture.factory,
      );
      const targetJournalPath = join(targetLegacy.directory, "recovery.json");
      const targetJournal = JSON.parse(readFileSync(targetJournalPath, "utf8"));
      targetJournal.target = "2".repeat(64);
      writeFileSync(targetJournalPath, JSON.stringify(targetJournal));
      writeFileSync(
        join(targetFixture.target.backupRoot, "latest-activation.json"),
        JSON.stringify({
          transaction: targetLegacy.journal.transaction,
          target: targetJournal.target,
        }),
      );
      expect(() => retireCurrentBackup(
        targetFixture.target,
        targetLegacy.directory,
      )).toThrow("release receipt differs from recovery");
  }, 15_000);

  it("refuses legacy retirement before one verified replacement exists", () => {
      const f = fixture();
      const legacy = legacyRecovery(f);
      expect(() => retireCurrentBackup(f.target, legacy.directory)).toThrow(
        "Verified replacement backup is missing",
      );
      expect(existsSync(legacy.directory)).toBe(true);
      expect(existsSync(join(f.target.backupRoot, "latest-activation.json"))).toBe(true);
  });

  it("refuses unknown reference entries while preserving the legacy recovery", async () => {
    const f = fixture();
    const legacy = legacyRecovery(f);
    const captured = await captureCurrentBackup(f.target, f.factory);
    await materializeCurrentBackup(
      f.target,
      captured.directory,
      join(root(), "legacy-unknown-reference"),
      f.factory,
    );
    writeFileSync(
      join(f.target.backupRoot, "backup-references", "operator-note"),
      "unknown",
    );

    expect(() => retireCurrentBackup(f.target, legacy.directory)).toThrow(
      "Unknown backup reference blocks retirement",
    );
    expect(existsSync(legacy.directory)).toBe(true);
    expect(existsSync(join(f.target.backupRoot, "latest-activation.json"))).toBe(true);
  });

  it.each([
      "pointer-moved",
      "recovery-moved",
      "unreferenced",
      "recovery-removed",
  ])("resumes legacy retirement after %s", async (status) => {
      const f = fixture();
      const legacy = legacyRecovery(f);
      const captured = await captureCurrentBackup(f.target, f.factory);
      const result = await materializeCurrentBackup(
        f.target,
        captured.directory,
        join(root(), "legacy-interrupted"),
        f.factory,
      );
      const referencePath = join(
        f.target.backupRoot,
        "backup-references",
        "latest-healthy-recovery.json",
      );
      const state = legacyRetirementState(f, legacy, result.reference);
      renameSync(state.activationReference, state.activationReferenceTrash);
      if (status !== "pointer-moved") renameSync(state.source, state.trash);
      if (["unreferenced", "recovery-removed"].includes(status)) {
        writeFileSync(referencePath, JSON.stringify(state.referenceAfter));
      }
      if (status === "recovery-removed") rmSync(state.trash, { recursive: true });
      state.journal.status = status;
      writeFileSync(
        join(f.target.backupRoot, `retire-${legacy.journal.transaction}.json`),
        JSON.stringify(state.journal),
      );

      expect(retireCurrentBackup(f.target, legacy.directory)).toEqual({
        transaction: legacy.journal.transaction,
        retired: true,
      });
      expect(existsSync(legacy.directory)).toBe(false);
      expect(existsSync(join(f.target.backupRoot, "latest-activation.json"))).toBe(false);
      expect(existsSync(captured.directory)).toBe(true);
  });

  it.each([
      {
        name: "pointer rename before its journal write",
        status: "planned",
        moveRecovery: false,
      },
      {
        name: "recovery rename before its journal write",
        status: "pointer-moved",
        moveRecovery: true,
      },
  ])("repairs $name", async ({ status, moveRecovery }) => {
      const f = fixture();
      const legacy = legacyRecovery(f);
      const captured = await captureCurrentBackup(f.target, f.factory);
      const result = await materializeCurrentBackup(
        f.target,
        captured.directory,
        join(root(), `legacy-prejournal-${status}`),
        f.factory,
      );
      const state = legacyRetirementState(f, legacy, result.reference);
      renameSync(state.activationReference, state.activationReferenceTrash);
      if (moveRecovery) renameSync(state.source, state.trash);
      state.journal.status = status;
      writeFileSync(
        join(f.target.backupRoot, `retire-${legacy.journal.transaction}.json`),
        JSON.stringify(state.journal),
      );

      expect(retireCurrentBackup(f.target, legacy.directory)).toEqual({
        transaction: legacy.journal.transaction,
        retired: true,
      });
      expect(existsSync(state.source)).toBe(false);
      expect(existsSync(state.trash)).toBe(false);
      expect(existsSync(state.activationReference)).toBe(false);
      expect(existsSync(state.activationReferenceTrash)).toBe(false);
      expect(currentBackupRecovery(f.target).directory).toBe(
        realpathSync(captured.directory),
      );
  });

  it("resumes when the healthy reference CAS precedes its journal write", async () => {
    const f = fixture();
    const legacy = legacyRecovery(f);
    const captured = await captureCurrentBackup(f.target, f.factory);
    const result = await materializeCurrentBackup(
      f.target,
      captured.directory,
      join(root(), "legacy-prejournal-cas"),
      f.factory,
    );
    const state = legacyRetirementState(f, legacy, result.reference);
    renameSync(state.activationReference, state.activationReferenceTrash);
    renameSync(state.source, state.trash);
    writeFileSync(
      join(
        f.target.backupRoot,
        "backup-references",
        "latest-healthy-recovery.json",
      ),
      JSON.stringify(state.referenceAfter),
    );
    state.journal.status = "recovery-moved";
    writeFileSync(
      join(f.target.backupRoot, `retire-${legacy.journal.transaction}.json`),
      JSON.stringify(state.journal),
    );

    expect(retireCurrentBackup(f.target, legacy.directory)).toEqual({
      transaction: legacy.journal.transaction,
      retired: true,
    });
    expect(existsSync(state.source)).toBe(false);
    expect(existsSync(state.trash)).toBe(false);
    expect(existsSync(state.activationReference)).toBe(false);
    expect(existsSync(state.activationReferenceTrash)).toBe(false);
    expect(currentBackupRecovery(f.target).directory).toBe(
      realpathSync(captured.directory),
    );
  });

  it("refuses a changed healthy reference during interrupted legacy retirement", async () => {
      const f = fixture();
      const legacy = legacyRecovery(f);
      const captured = await captureCurrentBackup(f.target, f.factory);
      const result = await materializeCurrentBackup(
        f.target,
        captured.directory,
        join(root(), "legacy-reference-drift"),
        f.factory,
      );
      const state = legacyRetirementState(f, legacy, result.reference);
      renameSync(state.activationReference, state.activationReferenceTrash);
      state.journal.status = "pointer-moved";
      writeFileSync(
        join(f.target.backupRoot, `retire-${legacy.journal.transaction}.json`),
        JSON.stringify(state.journal),
      );
      const referencePath = join(
        f.target.backupRoot,
        "backup-references",
        "latest-healthy-recovery.json",
      );
      writeFileSync(referencePath, JSON.stringify({
        ...result.reference,
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      }));

      expect(() => retireCurrentBackup(f.target, legacy.directory)).toThrow(
        "Healthy recovery reference changed during retirement",
      );
      expect(existsSync(state.source)).toBe(true);
      expect(existsSync(state.activationReferenceTrash)).toBe(true);
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
      kind: "backup",
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

  it("finishes new-format retirement when removal precedes its journal write", async () => {
    const f = fixture();
    const first = await captureCurrentBackup(f.target, f.factory);
    await materializeCurrentBackup(f.target, first.directory, join(root(), "first"), f.factory);
    const second = await captureCurrentBackup(f.target, f.factory);
    await materializeCurrentBackup(f.target, second.directory, join(root(), "second"), f.factory);
    const transaction = first.manifest.transaction;
    const backupRoot = realpathSync(f.target.backupRoot);
    const source = realpathSync(first.directory);
    const trash = join(backupRoot, `.retiring-${transaction}`);
    const journalPath = join(backupRoot, `retire-${transaction}.json`);
    writeFileSync(journalPath, JSON.stringify({
      schema: "puddles.openclaw-current-backup-retirement/v1",
      schemaVersion: 1,
      kind: "backup",
      transaction,
      manifestSha256: first.manifest.manifestSha256,
      source,
      trash,
      status: "moved",
    }));
    renameSync(source, trash);
    rmSync(trash, { recursive: true });

    expect(retireCurrentBackup(f.target, first.directory)).toEqual({
      transaction,
      retired: true,
    });
    expect(existsSync(journalPath)).toBe(false);
    expect(existsSync(second.directory)).toBe(true);
  });
});

describe("activation recovery target compatibility", () => {
  it.each([false, true])("accepts retained recovery after cleanup metadata changes (paired=%s)", (paired) => {
    const f = fixture();
    const saved = legacyRecovery(f, paired);
    expect(jsonDigest(f.target)).not.toBe(saved.identity.activationTargetSha256);
    expect(verifyCurrentActivationRecovery(f.target, saved.directory,
      join(f.target.backupRoot, "latest-activation.json"), f.target.legacyActivationReceipt)).toMatchObject(saved.identity);
  });
  it.each(["missing", "wrong-role"])("rejects %s paired production recovery bindings", (fault) => {
    const f = fixture();
    const saved = legacyRecovery(f, true);
    const path = join(saved.directory, "recovery.json");
    const journal = JSON.parse(readFileSync(path, "utf8"));
    if (fault === "missing") delete journal.migrationBinding;
    else journal.migrationBinding.role = "rehearsal";
    writeFileSync(path, JSON.stringify(journal));
    expect(() => verifyCurrentActivationRecovery(f.target, saved.directory,
      join(f.target.backupRoot, "latest-activation.json"), f.target.legacyActivationReceipt)).toThrow(/migration binding differs/);
  });
});

// @ts-expect-error Executable host-maintenance lifecycle.
import { planBackupRetention, applyBackupRetention, runBackupRetention } from "../src/native-backup-retention.mjs";
// @ts-expect-error Executable activation context publisher.
import { publishActivationRetentionContext } from "../src/native-activation.mjs";
// @ts-expect-error Executable backup replacement lifecycle.
import { refreshSingleBackup } from "../src/native-single-backup-retention.mjs";

function retentionFixture() {
  const f = fixture();
  const current = legacyRecovery(f);
  const now = Date.now();
  const cloneGeneration = (days: number, status = "healthy") => {
    const transaction = `activation-${now - days * 86_400_000}-1`;
    const directory = join(f.target.backupRoot, transaction);
    cpSync(current.directory, directory, { recursive: true });
    const journal = { ...current.journal, transaction, status };
    writeFileSync(join(directory, "recovery.json"), JSON.stringify(journal));
    return { transaction, directory, journal };
  };
  const predecessor = cloneGeneration(1);
  const old = cloneGeneration(4, "rolled-back");
  const older = cloneGeneration(5);
  writeFileSync(join(current.directory, "recovery.json"), JSON.stringify({
    ...current.journal, coordination: { baseline: predecessor.transaction }, previousBrowser: f.target.browser.imageId,
  }));
  mkdirSync(join(f.target.backupRoot, "backup-references"));
  writeFileSync(join(f.target.backupRoot, "backup-references", "latest-healthy-recovery.json"), JSON.stringify({ transaction: "backup-1-1" }));
  const policy = {
    schemaVersion: 1, minAgeHours: 24, keepRecent: 2, maxBatch: 8,
    protectedTransactions: [] as string[],
    consumerCheck: { command: process.execPath, sha256: fileDigest(process.execPath), args: [] },
    replacement: { kind: "activation", receipt: f.target.legacyActivationReceipt },
  };
  let activePaths: string[] = [];
  const execute = async (command: string, args: string[]) => command === "docker" ? f.target.browser.imageId :
    JSON.stringify({ schemaVersion: 1, checkedPaths: JSON.parse(args.at(-1)!), activePaths });
  return { ...f, current, predecessor, old, older, policy, execute, cloneGeneration,
    setActive: (paths: string[]) => { activePaths = paths.map(path => realpathSync(path)); } };
}

describe("bounded superseded activation retention", () => {
  it("retires exact old terminal generations while preserving current, predecessor and historical backup reference", async () => {
    const f = retentionFixture();
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    expect(plan.entries.map((e: any) => e.transaction)).toEqual([f.older.transaction, f.old.transaction]);
    const result = await applyBackupRetention(f.target, f.policy, plan, f.execute);
    expect(result.retired).toHaveLength(2);
    expect(existsSync(f.old.directory)).toBe(false);
    expect(existsSync(f.current.directory)).toBe(true);
    expect(existsSync(f.predecessor.directory)).toBe(true);
    expect(readFileSync(join(f.target.backupRoot, "backup-references", "latest-healthy-recovery.json"), "utf8")).toContain("backup-1-1");
    expect(await applyBackupRetention(f.target, f.policy, plan, f.execute)).toEqual(result);
  });
  it("keeps live, explicitly retained, young and nonterminal generations", async () => {
    const f = retentionFixture();
    f.setActive([f.old.directory]);
    f.policy.protectedTransactions.push(f.older.transaction);
    f.cloneGeneration(0.5);
    f.cloneGeneration(6, "recovery-required");
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    expect(plan.entries).toEqual([]);
    expect(plan.excluded).toHaveLength(2);
  });
  it("rejects changed recovery references without deleting any candidate", async () => {
    const f = retentionFixture();
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    writeFileSync(join(f.target.backupRoot, "backup-references", "hold.json"), JSON.stringify({ recovery: f.old.directory }));
    await expect(applyBackupRetention(f.target, f.policy, plan, f.execute)).rejects.toThrow("references changed");
    expect(existsSync(f.older.directory)).toBe(true);
  });
  it("rechecks all pending consumers before the first mutation", async () => {
    const f = retentionFixture();
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    f.setActive([f.old.directory]);
    await expect(applyBackupRetention(f.target, f.policy, plan, f.execute)).rejects.toThrow("consumer blocks");
    expect(existsSync(f.older.directory)).toBe(true);
  });
  it("detects a reference race during the consumer check", async () => {
    const f = retentionFixture();
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    const execute = async (command: string, args: string[]) => {
      if (command !== "docker") writeFileSync(join(f.target.backupRoot, "backup-references", "hold.json"), "{}");
      return f.execute(command, args);
    };
    await expect(applyBackupRetention(f.target, f.policy, plan, execute)).rejects.toThrow("references changed");
    expect(existsSync(f.older.directory)).toBe(true);
  });
  it("rejects altered journals and incomplete consumer evidence", async () => {
    const f = retentionFixture();
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    writeFileSync(join(f.old.directory, "recovery.json"), JSON.stringify({ ...f.old.journal, artifact: "b".repeat(64) }));
    await expect(applyBackupRetention(f.target, f.policy, plan, f.execute)).rejects.toThrow("changed after retention");
    expect(existsSync(f.older.directory)).toBe(true);
    await expect(planBackupRetention(f.target, f.policy, async () => "{}")).rejects.toThrow();
  });
  it("resumes an interrupted recursive removal using only its exact tombstone identity", async () => {
    const f = retentionFixture();
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    const entry = plan.entries[0];
    const trash = join(f.target.backupRoot, `.retiring-${entry.transaction}`);
    renameSync(f.older.directory, trash);
    rmSync(join(trash, "state"), { recursive: true });
    writeFileSync(join(f.target.backupRoot, `retention-${entry.transaction}.json`), JSON.stringify({
      schema: "puddles.openclaw-backup-retention/v1", planSha256: plan.sha256, entry, status: "deleting",
    }));
    const result = await applyBackupRetention(f.target, f.policy, plan, f.execute);
    expect(result.retired).toHaveLength(2);
    expect(existsSync(trash)).toBe(false);
  });
  it("refuses an unexpected replacement at the tombstone path", async () => {
    const f = retentionFixture();
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    const entry = plan.entries[0];
    const trash = join(f.target.backupRoot, `.retiring-${entry.transaction}`);
    renameSync(f.older.directory, f.older.directory + "-held");
    mkdirSync(trash);
    writeFileSync(join(f.target.backupRoot, `retention-${entry.transaction}.json`), JSON.stringify({
      schema: "puddles.openclaw-backup-retention/v1", planSha256: plan.sha256, entry, status: "deleting",
    }));
    await expect(applyBackupRetention(f.target, f.policy, plan, f.execute)).rejects.toThrow("tombstone identity");
    expect(existsSync(f.old.directory)).toBe(true);
  });
  it("runs a bounded batch and retains compact results for a later lifecycle call", async () => {
    const f = retentionFixture();
    f.policy.maxBatch = 1;
    const first = await runBackupRetention(f.target, f.policy, f.execute);
    expect(first.retired).toEqual([f.older.transaction]);
    const second = await runBackupRetention(f.target, f.policy, f.execute);
    expect(second.retired).toEqual([f.old.transaction]);
    expect(existsSync(join(f.target.backupRoot, "retention-plan.json"))).toBe(false);
    expect(existsSync(join(f.target.backupRoot, "retention-result.json"))).toBe(true);
  });
  it("publishes exact target and receipt context only for the current healthy activation", async () => {
    const f = retentionFixture();
    const receipt = JSON.parse(readFileSync(f.target.legacyActivationReceipt!.path, "utf8"));
    await publishActivationRetentionContext(receipt, f.target, f.current.directory, { inspectServiceNode: async () => f.target.backupNode });
    const context = JSON.parse(readFileSync(join(f.target.backupRoot, "retention-context.json"), "utf8"));
    expect(context.transaction).toBe(f.current.journal.transaction);
    expect(context.target).toEqual(JSON.parse(JSON.stringify(f.target)));
    expect(context.receipt.sha256).toBe(fileDigest(context.receipt.path));
    await expect(publishActivationRetentionContext(receipt, f.target, f.old.directory)).rejects.toThrow("current healthy");
  });
});

describe("retention resumption after reference changes", () => {
  it("refreshes a stale plan only while all its candidates remain untouched", async () => {
    const f = retentionFixture();
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    writeFileSync(join(f.target.backupRoot, "retention-plan.json"), JSON.stringify(plan));
    writeFileSync(join(f.target.backupRoot, "backup-references", "hold.json"), JSON.stringify({ recovery: f.old.directory }));
    const result = await runBackupRetention(f.target, f.policy, f.execute);
    expect(result.retired).toEqual([f.older.transaction]);
    expect(existsSync(f.old.directory)).toBe(true);
  });
  it("preserves a partially applied stale plan for owner reconciliation", async () => {
    const f = retentionFixture();
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    writeFileSync(join(f.target.backupRoot, "retention-plan.json"), JSON.stringify(plan));
    const trash = join(f.target.backupRoot, `.retiring-${f.older.transaction}`);
    renameSync(f.older.directory, trash);
    writeFileSync(join(f.target.backupRoot, "backup-references", "hold.json"), "{}");
    await expect(runBackupRetention(f.target, f.policy, f.execute)).rejects.toThrow("partially applied");
    expect(existsSync(trash)).toBe(true);
    expect(existsSync(join(f.target.backupRoot, "retention-plan.json"))).toBe(true);
  });
  it("rejects nested snapshot changes before retiring any candidate", async () => {
    const f = retentionFixture();
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    writeFileSync(join(f.old.directory, "state", "openclaw.json"), "{}");
    await expect(applyBackupRetention(f.target, f.policy, plan, f.execute)).rejects.toThrow("changed after retention");
    expect(existsSync(f.older.directory)).toBe(true);
  });
  it("completes a normal no-op without asking the host checker to inspect zero paths", async () => {
    const f = retentionFixture();
    f.policy.protectedTransactions.push(f.old.transaction, f.older.transaction);
    const execute = async (command: string, args: string[]) => {
      if (command !== "docker") throw new Error("empty path check called");
      return f.execute(command, args);
    };
    expect((await runBackupRetention(f.target, f.policy, execute)).retired).toEqual([]);
  });
});

function ownedInstallation(f: ReturnType<typeof retentionFixture>) {
  const path = join(realpathSync(f.directory), ".puddles-install-100-1");
  mkdirSync(path);
  writeFileSync(join(path, "runtime"), "actual predecessor bytes");
  writeFileSync(join(path, "runtime-identity.json"), "incoming identity is not the predecessor digest");
  const stat = lstatSync(path);
  const journal = { ...f.older.journal, prefix: path,
    externalInstallations: [{ path, identity: { dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs } }] };
  writeFileSync(join(f.older.directory, "recovery.json"), JSON.stringify(journal));
  return path;
}
it("retires the exact external predecessor with its generation and keeps unowned legacy staging", async () => {
  const f = retentionFixture(), path = ownedInstallation(f);
  const legacy = join(f.directory, ".puddles-install-99-1"); mkdirSync(legacy);
  const plan = await planBackupRetention(f.target, f.policy, f.execute);
  expect(plan.excluded).toEqual([]);
  await applyBackupRetention(f.target, f.policy, plan, f.execute);
  expect(existsSync(path)).toBe(false);
  expect(existsSync(legacy)).toBe(true);
  await applyBackupRetention(f.target, f.policy, plan, f.execute);
});
it.each(["consumer", "content", "reference"])("keeps external predecessor on changed %s", async fault => {
  const f = retentionFixture(), path = ownedInstallation(f);
  const plan = await planBackupRetention(f.target, f.policy, f.execute);
  if (fault === "consumer") f.setActive([path]);
  if (fault === "content") writeFileSync(join(path, "runtime"), "changed");
  if (fault === "reference") {
    const journalPath = join(f.predecessor.directory, "recovery.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    writeFileSync(journalPath, JSON.stringify({ ...journal, retainedPath: path }));
  }
  await expect(applyBackupRetention(f.target, f.policy, plan, f.execute)).rejects.toThrow();
  expect(existsSync(path)).toBe(true);
  expect(existsSync(f.older.directory)).toBe(true);
});
it("resumes partial external deletion before retiring the generation", async () => {
  const f = retentionFixture(), path = ownedInstallation(f);
  const plan = await planBackupRetention(f.target, f.policy, f.execute);
  const entry = plan.entries.find((item: any) => item.transaction === f.older.transaction);
  const trash = entry.externalInstallations[0].trash;
  renameSync(path, trash); rmSync(join(trash, "runtime"));
  writeFileSync(join(f.target.backupRoot, `retention-${entry.transaction}.json`), JSON.stringify({
    schema: "puddles.openclaw-backup-retention/v1", planSha256: plan.sha256, entry, status: "planned", external: ["deleting"],
  }));
  await applyBackupRetention(f.target, f.policy, plan, f.execute);
  expect(existsSync(trash)).toBe(false);
  expect(existsSync(f.older.directory)).toBe(false);
});

async function singleBackupFixture(setup?: (f: ReturnType<typeof retentionFixture>) => void) {
  const f = retentionFixture();
  setup?.(f);
  rmSync(join(f.target.backupRoot, 'backup-references', 'latest-healthy-recovery.json'));
  const old = await captureCurrentBackup(f.target, f.factory);
  const oldMaterialized = await materializeCurrentBackup(f.target, old.directory, join(root(), 'old-validation'), f.factory);
  const currentBackup = await captureCurrentBackup(f.target, f.factory);
  const currentMaterialized = await materializeCurrentBackup(f.target, currentBackup.directory, join(root(), 'current-validation'), f.factory);
  const policy = { ...f.policy, transactions: undefined as string[] | undefined, mode: 'single-verified-backup', keepRecent: 0, minAgeHours: 0, maxBatch: 32, replacement: { kind: 'backup' } };
  return { ...f, policy, oldBackup: old, currentBackup, oldMaterialized, currentMaterialized };
}

describe('one verified backup retention', () => {
  it('retires all superseded activation and backup payloads while keeping original evidence and current backup', async () => {
    const f = await singleBackupFixture();
    const journal = readFileSync(join(f.current.directory, 'recovery.json'), 'utf8');
    writeFileSync(join(f.current.directory, 'state', 'changed-sidecar'), 'original mismatch');
    const failed = f.cloneGeneration(6, 'recovery-required');
    const failure = { ...failed.journal, quiesced: true };
    writeFileSync(join(failed.directory, 'recovery.json'), JSON.stringify(failure));
    writeFileSync(join(failed.directory, 'failure.json'), JSON.stringify({ message: 'original failure' }));
    const oldManifestPath = join(f.oldBackup.directory, 'backup.json');
    const oldManifest = JSON.parse(readFileSync(oldManifestPath, 'utf8'));
    oldManifest.node.path = '/missing-obsolete-interpreter';
    const { manifestSha256: _oldHash, ...body } = oldManifest;
    oldManifest.manifestSha256 = jsonDigest(body);
    writeFileSync(oldManifestPath, JSON.stringify(oldManifest));
    const result = await runBackupRetention(f.target, f.policy, f.execute);
    expect(result.retired).toContain(f.current.journal.transaction);
    expect(result.retired).toContain(f.predecessor.transaction);
    expect(result.retired).toContain(failed.transaction);
    expect(existsSync(join(f.currentBackup.directory, 'state'))).toBe(true);
    for (const directory of [f.current.directory, f.predecessor.directory, failed.directory, f.oldBackup.directory, f.oldMaterialized.destination, f.currentMaterialized.destination]) {
      expect(existsSync(join(directory, 'state'))).toBe(false);
      expect(existsSync(join(directory, 'payload-retirement.json'))).toBe(true);
    }
    expect(readFileSync(join(f.current.directory, 'recovery.json'), 'utf8')).toBe(journal);
    expect(JSON.parse(readFileSync(join(failed.directory, 'recovery.json'), 'utf8'))).toEqual(failure);
    expect(JSON.parse(readFileSync(join(failed.directory, 'failure.json'), 'utf8')).message).toBe('original failure');
    expect((await runBackupRetention(f.target, f.policy, f.execute)).retired).toEqual([]);
  }, 20_000);
  it('preserves active consumers and foreign references without an implicit predecessor hold', async () => {
    const f = await singleBackupFixture();
    f.setActive([f.predecessor.directory]);
    writeFileSync(join(f.target.backupRoot, 'backup-references', 'foreign.json'), JSON.stringify({ recovery: f.older.directory }));
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    expect(plan.entries.some((entry: any) => entry.transaction === f.predecessor.transaction)).toBe(false);
    expect(plan.entries.some((entry: any) => entry.transaction === f.older.transaction)).toBe(false);
    expect(plan.entries.some((entry: any) => entry.transaction === f.current.journal.transaction)).toBe(true);
  });
  it('refuses all retirement when replacement contents fail verification', async () => {
    const f = await singleBackupFixture();
    writeFileSync(join(f.currentBackup.directory, 'state', 'changed'), 'changed');
    await expect(planBackupRetention(f.target, f.policy, f.execute)).rejects.toThrow('differs from manifest');
    expect(existsSync(join(f.oldBackup.directory, 'runtime'))).toBe(true);
  });
  it('rechecks payload inventory, evidence and consumer identity before deletion', async () => {
    const f = await singleBackupFixture();
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    writeFileSync(join(f.old.directory, 'state', 'new-consumer-data'), 'new');
    await expect(applyBackupRetention(f.target, f.policy, plan, f.execute)).rejects.toThrow('changed after plan');
    expect(existsSync(join(f.old.directory, 'state'))).toBe(true);
  });
  it('resumes a partially removed payload without rewriting original journals', async () => {
    const f = await singleBackupFixture();
    f.policy.transactions = [f.older.transaction];
    const plan = await planBackupRetention(f.target, f.policy, f.execute);
    const entry = plan.entries.find((entry: any) => entry.transaction === f.older.transaction);
    const payload = entry.payloads[0];
    renameSync(payload.path, payload.trash);
    rmSync(payload.trash, { recursive: true });
    writeFileSync(join(f.target.backupRoot, `retention-${entry.transaction}.json`), JSON.stringify({
      schema: 'puddles.single-backup-retention/v1', planSha256: plan.sha256, entry, status: 'planned',
      payloads: entry.payloads.map((_item: any, index: number) => index === 0 ? 'deleting' : 'planned'),
    }));
    await applyBackupRetention(f.target, f.policy, plan, f.execute);
    expect(existsSync(join(f.older.directory, 'recovery.json'))).toBe(true);
    expect(existsSync(join(f.older.directory, 'state'))).toBe(false);
  });
  it('rejects validation that alters the source and never publishes its reference', async () => {
    const f = fixture();
    const captured = await captureCurrentBackup(f.target, f.factory);
    const factory = () => ({ ...f.factory(), verifySqlite: async () => {
      writeFileSync(join(captured.directory, 'state', 'unexpected-sidecar'), 'changed');
    } });
    await expect(materializeCurrentBackup(f.target, captured.directory, join(root(), 'validation'), factory)).rejects.toThrow('differs from manifest');
    expect(existsSync(join(f.target.backupRoot, 'backup-references'))).toBe(false);
  });
  it('refreshes through capture, isolated verification and exact retirement using existing capacity', async () => {
    const f = await singleBackupFixture();
    vi.stubEnv('E2E_CAPACITY_ROOT', join(realpathSync(root()), 'capacity'));
    vi.stubEnv('E2E_REQUIRED_FREE_BYTES', '0');
    try {
      await refreshSingleBackup(f.target, f.policy, root(), f.execute, f.factory);
      const current = currentBackupRecovery(f.target);
      expect(current.reference.transaction).not.toBe(f.currentBackup.manifest.transaction);
      expect(existsSync(join(f.currentBackup.directory, 'state'))).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  }, 20_000);
});

it('binds replacement authority to the activation captured, not a later release', async () => {
  const f = fixture();
  const pointer = join(f.target.backupRoot, 'latest-activation.json');
  writeFileSync(pointer, JSON.stringify({ transaction: 'activation-1-1', target: 'a'.repeat(64) }));
  const captured = await captureCurrentBackup(f.target, f.factory);
  writeFileSync(pointer, JSON.stringify({ transaction: 'activation-2-1', target: 'a'.repeat(64) }));
  await expect(materializeCurrentBackup(f.target, captured.directory, join(root(), 'changed-release-validation'), f.factory)).rejects.toThrow('Deployment changed after backup capture');
  expect(existsSync(join(f.target.backupRoot, 'backup-references'))).toBe(false);
});

it('retires a closed incomplete capture and preserves its original failure evidence', async () => {
  const f = await singleBackupFixture();
  const incomplete = join(f.target.backupRoot, 'backup-1-3');
  mkdirSync(incomplete); mkdirSync(join(incomplete, 'runtime'));
  writeFileSync(join(incomplete, 'runtime', 'partial'), 'partial-runtime');
  const journal = { schema: 'puddles.openclaw-current-backup-journal/v1', schemaVersion: 1,
    transaction: 'backup-1-3', targetSha256: 'a'.repeat(64), serviceStopped: false, status: 'restarted', failure: 'capture interrupted' };
  writeFileSync(join(incomplete, 'backup-journal.json'), JSON.stringify(journal));
  f.policy.transactions = ['backup-1-3'];
  const result = await runBackupRetention(f.target, f.policy, f.execute);
  expect(result.retired).toContain('backup-1-3');
  expect(existsSync(join(incomplete, 'runtime'))).toBe(false);
  expect(JSON.parse(readFileSync(join(incomplete, 'backup-journal.json'), 'utf8'))).toEqual(journal);
}, 15_000);

it('only adopts a legacy external installation through exact journal and directory identity', async () => {
  const f = await singleBackupFixture();
  const path = join(realpathSync(dirname(f.target.installDir)), '.puddles-install-1-9');
  mkdirSync(path); writeFileSync(join(path, 'old-runtime'), 'old');
  const journalPath = join(f.old.directory, 'recovery.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')); journal.prefix = path;
  writeFileSync(journalPath, JSON.stringify(journal));
  const stat = lstatSync(path);
  const policy = { ...f.policy, transactions: [f.old.transaction], installations: [{ transaction: f.old.transaction,
    path, journalSha256: fileDigest(journalPath), identity: { dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs } }] };
  const invalid = { ...policy, installations: [{ ...policy.installations[0], journalSha256: 'b'.repeat(64) }] };
  const rejected = await planBackupRetention(f.target, invalid, f.execute);
  expect(rejected.excluded.some((item: any) => item.transaction === f.old.transaction)).toBe(true);
  await runBackupRetention(f.target, policy, f.execute);
  expect(existsSync(path)).toBe(false);
}, 15_000);

it('applies exact transaction selection to duplicate materializations including empty nondeleting plans', async () => {
  const f = await singleBackupFixture();
  f.policy.transactions = [];
  expect((await planBackupRetention(f.target, f.policy, f.execute)).entries).toEqual([]);
  f.policy.transactions = [f.oldBackup.manifest.transaction];
  const plan = await planBackupRetention(f.target, f.policy, f.execute);
  expect(plan.entries.some((entry: any) => entry.path === f.oldMaterialized.destination)).toBe(true);
  expect(plan.entries.some((entry: any) => entry.path === f.currentMaterialized.destination)).toBe(false);
}, 15_000);


it('preserves an external installation required by the verified backup', async () => {
  let path = '';
  const f = await singleBackupFixture(f => {
    path = join(realpathSync(dirname(f.target.installDir)), '.puddles-install-1-7');
    mkdirSync(path); writeFileSync(join(path, 'dependency'), 'required');
    symlinkSync(join(path, 'dependency'), join(f.target.installDir, 'dependency'));
    const journalPath = join(f.old.directory, 'recovery.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')); journal.prefix = path;
    writeFileSync(journalPath, JSON.stringify(journal));
  });
  const stat = lstatSync(path);
  const policy = { ...f.policy, transactions: [f.old.transaction], installations: [{ transaction: f.old.transaction,
    path, journalSha256: fileDigest(join(f.old.directory, 'recovery.json')),
    identity: { dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs } }] };
  const plan = await planBackupRetention(f.target, policy, f.execute);
  expect(plan.entries).toEqual([]);
  expect(plan.excluded).toContainEqual({ transaction: f.old.transaction, reason: 'Payload is required by the verified backup' });
  expect(existsSync(path)).toBe(true);
}, 15_000);

it.each(['openclaw.mjs', 'dist/index.js'])('publishes the deployed service interpreter for %s without migrating Node', async entry => {
  const f = retentionFixture();
  const receipt = JSON.parse(readFileSync(f.target.legacyActivationReceipt!.path, 'utf8'));
  const deployed = join(realpathSync(dirname(f.target.installDir)), 'deployed-node');
  writeFileSync(deployed, '#!/bin/sh\nprintf \'{"version":"v26.1.0","platform":"' + process.platform + '","arch":"' + process.arch + '"}\\n\'\n', { mode: 0o755 });
  execFileSync('python3', ['-c', 'import plistlib,sys; plistlib.dump({"ProgramArguments":["/bin/sh","/synthetic/wrapper","/synthetic/environment",sys.argv[2],sys.argv[3]]},open(sys.argv[1],"wb"))', f.target.plistPath, deployed, join(f.target.installDir, entry)]);
  await publishActivationRetentionContext(receipt, f.target, f.current.directory);
  const context = JSON.parse(readFileSync(join(f.target.backupRoot, 'retention-context.json'), 'utf8'));
  expect(context.backupTarget.backupNode).toEqual({ path: deployed, realPath: deployed,
    sha256: fileDigest(deployed), version: 'v26.1.0', platform: process.platform, arch: process.arch });
  expect(context.backupTarget.backupNode.path).not.toBe(process.execPath);
});


it('rejects a materialized service whose interpreter differs from its verified Node', async () => {
  const f = fixture();
  const work = root();
  const other = join(work, 'other-node');
  writeFileSync(other, 'different executable');
  execFileSync('python3', ['-c', 'import plistlib,sys; plistlib.dump({"ProgramArguments":[sys.argv[2],sys.argv[3]]},open(sys.argv[1],"wb"))', f.target.plistPath, other, join(f.target.installDir, 'openclaw.mjs')]);
  await expect(backupOperations(f.target, work).verifyService(f.target.plistPath, f.target.backupNode)).rejects.toThrow('differs from verified Node');
});
