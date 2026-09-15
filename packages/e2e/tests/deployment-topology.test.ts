import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
// @ts-expect-error Native lifecycle is also executable without TypeScript.
import { activateNative, systemOperations, validateTarget, verifyIntegratedCandidate } from "../src/native-activation.mjs";
// @ts-expect-error Native lifecycle is also executable without TypeScript.
import { fileDigest, jsonDigest, treeDigest } from "../src/native-state.mjs";
// @ts-expect-error Native lifecycle is also executable without TypeScript.
import { createBuildReceipt } from "../src/native-release.mjs";

const repoRoot = resolve(import.meta.dirname, "../../..");
const cloneHelper = join(repoRoot, "docs/openclaw-setup/patches/clone-runtime-tree.py");
const swapHelper = join(repoRoot, "docs/openclaw-setup/patches/swap-runtime-trees.py");
const roots: string[] = [];
function root() { const path = mkdtempSync(join(tmpdir(), "native-deploy-test-")); roots.push(path); return path; }
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("runtime clone and atomic swap", () => {
  it("preserves hard links, symbolic links, special modes, ACLs and xattrs", () => {
    const directory = root();
    const source = join(directory, "source");
    const destination = join(directory, "destination");
    mkdirSync(join(source, "nested"), { recursive: true });
    writeFileSync(join(source, "nested/state"), "original");
    linkSync(join(source, "nested/state"), join(source, "hardlink"));
    symlinkSync("nested/state", join(source, "symlink"));
    chmodSync(join(source, "nested"), 0o2750);
    chmodSync(join(source, "nested/state"), 0o6750);
    expect(spawnSync("xattr", ["-w", "com.apple.puddles-test", "fixture", join(source, "nested")]).status).toBe(0);
    expect(spawnSync("chmod", ["+a", "everyone allow readattr", join(source, "nested")]).status).toBe(0);
    const cloned = spawnSync("python3", [cloneHelper, source, destination], { encoding: "utf8" });
    expect(cloned.status, cloned.stderr).toBe(0);
    expect(readlinkSync(join(destination, "symlink"))).toBe("nested/state");
    expect(statSync(join(destination, "hardlink")).ino).toBe(statSync(join(destination, "nested/state")).ino);
    expect(lstatSync(join(destination, "nested")).mode & 0o7777).toBe(0o2750);
    expect(lstatSync(join(destination, "nested/state")).mode & 0o7777).toBe(0o6750);
    expect(spawnSync("xattr", ["-p", "com.apple.puddles-test", join(destination, "nested")], { encoding: "utf8" }).stdout.trim()).toBe("fixture");
    expect(spawnSync("ls", ["-lde", join(destination, "nested")], { encoding: "utf8" }).stdout).toContain("group:everyone allow readattr");
    writeFileSync(join(destination, "nested/state"), "replacement");
    const swapped = spawnSync("python3", [swapHelper, source, destination], { encoding: "utf8" });
    expect(swapped.status, swapped.stderr).toBe(0);
    expect(readFileSync(join(source, "nested/state"), "utf8")).toBe("replacement");
    expect(readFileSync(join(destination, "nested/state"), "utf8")).toBe("original");
    const firstFile = join(directory, "first-file");
    const secondFile = join(directory, "second-file");
    writeFileSync(firstFile, "first");
    writeFileSync(secondFile, "second");
    const swappedFiles = spawnSync("python3", [swapHelper, firstFile, secondFile], { encoding: "utf8" });
    expect(swappedFiles.status, swappedFiles.stderr).toBe(0);
    expect(readFileSync(firstFile, "utf8")).toBe("second");
    expect(readFileSync(secondFile, "utf8")).toBe("first");
  });

  it("rejects nested and differently-cased APFS destination aliases", () => {
    const directory = mkdtempSync(join(repoRoot, ".puddles-clone-case-test-"));
    roots.push(directory);
    const source = join(directory, "source");
    mkdirSync(source);
    for (const destination of [join(source, "backup"), join(source.replace(/^\/Users\//, "/users/"), "backup")]) {
      const result = spawnSync("python3", [cloneHelper, source, destination], { encoding: "utf8" });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("runtime clone destination must be outside the source");
      expect(existsSync(destination)).toBe(false);
    }
  });
});

function fixture(failures: string[] = []) {
  const directory = root();
  const target = {
    schemaVersion: 1, host: hostname(), installDir: join(directory, "installed"),
    stateDir: join(directory, "state"), plistPath: join(directory, "gateway.plist"),
    backupRoot: join(directory, "backups"), label: "test.gateway", port: 18799,
    browser: { imageId: "candidate-browser", path: "/synthetic/image", sha256: "synthetic", tag: "production-browser" },
    additionalInstalls: [] as Array<{ id: string; path: string }>,
    preparedFiles: [] as Array<{ id: string; path: string }>,
  };
  mkdirSync(target.installDir);
  mkdirSync(target.stateDir);
  writeFileSync(join(target.installDir, "package"), "previous");
  writeFileSync(join(target.stateDir, "config"), "original");
  writeFileSync(target.plistPath, "original-service");
  const artifact = join(directory, "artifact");
  writeFileSync(artifact, "synthetic artifact");
  const receipt = { status: "passed", accumulated: true, scenarios: 8, artifact: { path: artifact, sha256: fileDigest(artifact) },
    additionalArtifacts: [] as Array<{ id: string; artifact: { path: string; sha256: string; runtimeSha256: string } }>,
    preparedFiles: [] as Array<{ id: string; type: "file" | "directory"; path: string; sha256: string }> };
  const calls: string[] = [];
  let started = true;
  let browser = "previous-browser";
  const check = (name: string) => {
    calls.push(name);
    const index = failures.indexOf(name);
    if (index >= 0) { failures.splice(index, 1); throw new Error(`synthetic ${name} failure`); }
  };
  const ops = {
    async preflight() { check("preflight"); return browser; },
    async install(_artifact: unknown, prefix: string) {
      check("install");
      const runtime = join(prefix, "runtime");
      mkdirSync(runtime, { recursive: true });
      writeFileSync(join(runtime, "package"), "candidate");
      return runtime;
    },
    async stagePrepared(record: { path: string; type: "file" | "directory" }, destination: string) {
      check("prepared-stage");
      expect(started).toBe(true);
      cpSync(record.path, destination, { recursive: record.type === "directory", verbatimSymlinks: true });
    },
    async move(from: string, to: string) {
      check("prepared-move");
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
    },
    async stop() { check("stop"); started = false; },
    async start() { check("start"); started = true; },
    async clone(from: string, to: string) {
      if (from.includes("/additional-staging/")) expect(started).toBe(false);
      check(from.includes("/additional-staging/") ? "additional-copy" : to.endsWith("/candidate") ? "candidate-snapshot" : to.includes("restore-") ? "restore-clone" : from === target.stateDir ? "state-snapshot" : "package-snapshot");
      cpSync(from, to, { recursive: true });
      // Node's copy mock does not preserve nested directory modes like clonefile.
      for (const name of ["", ...readdirSync(from, { recursive: true, encoding: "utf8" })]) {
        const stat = lstatSync(join(from, name));
        if (stat.isDirectory()) chmodSync(join(to, name), stat.mode & 0o7777);
      }
    },
    async swap(from: string, to: string) {
      check(to.includes("restore-") ? "restore-swap" : "replace");
      const temporary = `${from}.swap`;
      renameSync(from, temporary); renameSync(to, from); renameSync(temporary, to);
    },
    async doctor() {
      check("doctor");
      expect(started).toBe(false);
      writeFileSync(join(target.stateDir, "config"), "migrated");
      writeFileSync(join(target.stateDir, "new-state"), "new");
    },
    async browser(image: string, runtime = target.installDir) {
      check(image === "previous-browser" ? "browser-restore" : "browser");
      expect(started).toBe(false);
      expect(readFileSync(join(runtime, "package"), "utf8")).toBe("candidate");
      browser = image;
    },
    async currentBrowser() { check("browser-identity"); return browser; },
    async health() { check("health"); expect(started).toBe(true); },
  };
  return { directory, target, receipt, calls, ops, running: () => started, browser: () => browser };
}

function addAuxiliary(f: ReturnType<typeof fixture>, existing = true) {
  const path = "managed/auxiliary";
  const destination = join(f.target.stateDir, path);
  const expected = join(f.directory, "expected-auxiliary");
  mkdirSync(expected);
  writeFileSync(join(expected, "package"), "candidate");
  const archive = join(f.directory, "auxiliary-archive");
  writeFileSync(archive, "synthetic additional archive");
  const artifact = { path: archive, sha256: fileDigest(archive), runtimeSha256: treeDigest(expected, { portable: true }) };
  f.receipt.additionalArtifacts.push({ id: "auxiliary", artifact });
  f.target.additionalInstalls.push({ id: "auxiliary", path });
  if (existing) {
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "package"), "previous-auxiliary");
    writeFileSync(join(destination, "stale-chunk"), "must not survive replacement");
  }
  writeFileSync(join(f.target.stateDir, "registry.db"), "opaque existing registry");
  return { destination, artifact };
}

function addPrepared(f: ReturnType<typeof fixture>, type: "file" | "directory", existing = true) {
  const id = `embedding-${type}`;
  const path = `managed/${id}`;
  const source = join(f.directory, `source-${id}`);
  if (type === "file") writeFileSync(source, "candidate bytes");
  else {
    mkdirSync(source);
    writeFileSync(join(source, "model"), "candidate bytes");
    symlinkSync("model", join(source, "model-current"));
  }
  const sha256 = type === "file" ? fileDigest(source) : treeDigest(source, { portable: true });
  f.receipt.preparedFiles.push({ id, type, path: source, sha256 });
  f.target.preparedFiles.push({ id, path });
  const destination = join(f.target.stateDir, path);
  if (existing) {
    mkdirSync(dirname(destination), { recursive: true });
    if (type === "file") writeFileSync(destination, "previous bytes");
    else {
      mkdirSync(destination);
      writeFileSync(join(destination, "model"), "previous bytes");
    }
  }
  return { id, source, destination, sha256 };
}

function wrapperFixture(fault: boolean) {
    const directory = root();
    const installed = join(directory, "installed");
    const state = join(directory, "state");
    const backups = join(directory, "backups");
    const bin = join(directory, "bin");
    const packageRoot = join(directory, "package");
    const runtime = join(packageRoot, "runtime");
    const faultMarker = join(directory, "fail-doctor");
    const serviceMarker = join(directory, "service-loaded");
    for (const path of [installed, state, backups, bin, runtime]) mkdirSync(path, { recursive: true });
    const runtimeScript = `import { existsSync, rmSync } from "node:fs";
  if (process.argv[2] === "doctor" && existsSync(${JSON.stringify(faultMarker)})) {
    rmSync(${JSON.stringify(faultMarker)}); process.exit(42);
  }`;
    writeFileSync(join(runtime, "openclaw.mjs"), runtimeScript);
    mkdirSync(join(runtime, "node_modules/openclaw"), { recursive: true });
    writeFileSync(join(runtime, "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(runtime, "node_modules/openclaw/package.json"), JSON.stringify({
      type: "module", exports: { "./plugin-sdk/process-runtime": "./process-runtime.mjs" },
    }));
    writeFileSync(join(runtime, "node_modules/openclaw/process-runtime.mjs"),
      "export async function stopGatewayAndJoinLocalServices() {}\nexport function requireServiceProcessIdentity() { return null; }\n");
    writeFileSync(join(installed, "openclaw.mjs"), "");
    writeFileSync(join(installed, "version"), "previous");
    writeFileSync(join(state, "openclaw.json"), "{}");
    const preparedSource = join(directory, "model.gguf");
    const preparedDestination = join(state, "models/model.gguf");
    mkdirSync(dirname(preparedDestination), { recursive: true });
    writeFileSync(preparedSource, "candidate model");
    writeFileSync(preparedDestination, "previous model");
    const runtimeSha256 = treeDigest(runtime, { portable: true });
    writeFileSync(join(packageRoot, "runtime-identity.json"), JSON.stringify({
      schemaVersion: 1, platform: process.platform, arch: process.arch, node: process.version, runtimeSha256,
    }));
    const archive = join(directory, "runtime.tar.gz");
    expect(spawnSync("tar", ["-czf", archive, "-C", packageRoot, "runtime", "runtime-identity.json"]).status).toBe(0);
    const artifact = {
      schemaVersion: 1, path: archive, sha256: fileDigest(archive), runtimeSha256,
      platform: process.platform, arch: process.arch, node: process.version,
    };
    const prepared = { id: "embedding-model", type: "file", path: preparedSource, sha256: fileDigest(preparedSource) };
    const receiptDir = join(directory, "candidate");
    mkdirSync(join(receiptDir, "stages"), { recursive: true });
    const proofs: Record<string, string> = {};
    const stages: Record<string, { inputs: unknown; result?: unknown }> = {
      build: { inputs: { source: "wrapper-fixture" } },
      "prepared-files": { inputs: { source: "wrapper-fixture" }, result: [prepared] },
      regressions: { inputs: { source: "wrapper-fixture" } },
      runtime: { inputs: { artifact, additionalArtifacts: [], preparedFiles: [prepared] } },
      install: { inputs: { artifact } },
    };
    for (const [name, stage] of Object.entries(stages)) {
      const key = jsonDigest(stage.inputs);
      proofs[name] = key;
      writeFileSync(join(receiptDir, "stages", `${name}.json`), JSON.stringify({ ...stage, key, status: "passed" }));
    }

    const tree = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
    const receiptPath = join(receiptDir, "candidate.json");
    writeFileSync(receiptPath, JSON.stringify({
      status: "passed", accumulated: true, scenarios: 1, repository: { tree },
      artifact, additionalArtifacts: [], preparedFiles: [prepared], proofs,
    }));
    const plistPath = join(directory, "gateway.plist");
    writeFileSync(plistPath, "fixture service");
    const targetPath = join(directory, "target.json");
    writeFileSync(targetPath, JSON.stringify({
      schemaVersion: 1, host: hostname(), installDir: installed, stateDir: state, plistPath,
      backupRoot: backups, label: "test.gateway", port: 18799, additionalInstalls: [],
      preparedFiles: [{ id: prepared.id, path: "models/model.gguf" }],
      integration: { repository: repoRoot, ref: "HEAD" },
    }));
    writeFileSync(join(bin, "launchctl"), `#!/bin/bash
  if [ "$1" = print ]; then [ -f ${JSON.stringify(serviceMarker)} ] && exit 0 || exit 113; fi
  if [ "$1" = bootout ]; then rm -f ${JSON.stringify(serviceMarker)}; exit 0; fi
  if [ "$1" = bootstrap ]; then touch ${JSON.stringify(serviceMarker)}; exit 0; fi
  exit 2
  `);
    chmodSync(join(bin, "launchctl"), 0o700);
    writeFileSync(serviceMarker, "");
    if (fault) writeFileSync(faultMarker, "");
    return {
      directory, receiptPath, targetPath, preparedDestination, backups,
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`,
        OPENCLAW_CANDIDATE_RECEIPT: receiptPath, OPENCLAW_DEPLOY_TARGET: targetPath,
        MINI_HOST: "", OPENCLAW_DEPLOY_ACTION: "activate",
      },
    };
}

function rehearsalWrapperFixture(fault: boolean) {
  const fixture = wrapperFixture(fault);
  const candidate = JSON.parse(readFileSync(fixture.receiptPath, "utf8"));
  const receipt = createBuildReceipt({
    repository: candidate.repository,
    source: {
      ref: "a".repeat(40),
      sha256: "b".repeat(64),
      buildInputsSha256: "c".repeat(64),
      patchesSha256: "d".repeat(64),
      extensionSha256: "none",
    },
    composition: { extensionSha256: "none" },
    tools: {
      node: process.version,
      nodeBinary: fileDigest(process.execPath),
      platform: process.platform,
      arch: process.arch,
      manager: "synthetic",
      npm: "synthetic",
    },
    artifact: candidate.artifact,
    additionalArtifacts: candidate.additionalArtifacts,
    preparedFiles: candidate.preparedFiles,
    proofs: {
      prepare: "1".repeat(64),
      dependencies: "2".repeat(64),
      build: "3".repeat(64),
      package: "4".repeat(64),
    },
  });
  writeFileSync(fixture.receiptPath, JSON.stringify(receipt));
  const target = JSON.parse(readFileSync(fixture.targetPath, "utf8"));
  target.purpose = "rehearsal";
  target.isolation = {
    schema: "puddles.openclaw-rehearsal-target/v1",
    root: realpathSync(fixture.directory),
  };
  target.label = "puddles.rehearsal.gateway";
  delete target.integration;
  writeFileSync(fixture.targetPath, JSON.stringify(target));
  fixture.env.OPENCLAW_DEPLOY_ACTION = "rehearse";
  return fixture;
}

describe("native activation and recovery transaction", () => {
  it("installs before downtime and preserves exact snapshots, locking and local health", async () => {
    const f = fixture();
    const result = await activateNative(f.receipt, f.target, () => f.ops);
    expect(result.status).toBe("healthy");
    expect(f.calls).toEqual(["preflight", "install", "candidate-snapshot", "package-snapshot", "stop", "state-snapshot", "replace", "doctor", "browser", "start", "health"]);
    expect(readFileSync(join(result.recoveryDir, "state/config"), "utf8")).toBe("original");
    expect(readFileSync(join(result.recoveryDir, "package/package"), "utf8")).toBe("previous");
    expect(existsSync(join(f.target.backupRoot, "lock"))).toBe(false);
  });

  it("explicitly rolls back a healthy activation after smoke failure while ordinary recovery stays a no-op", async () => {
    const f = fixture();
    const extra = addAuxiliary(f);
    const activated = await activateNative(f.receipt, f.target, () => f.ops);
    writeFileSync(join(f.target.stateDir, "post-activation-session"), "preserve failed live state");
    const calls = f.calls.length;
    expect((await activateNative(f.receipt, f.target, () => f.ops, activated.recoveryDir)).status).toBe("healthy");
    expect(f.calls).toHaveLength(calls);
    mkdirSync(join(f.target.backupRoot, "lock"));
    await expect(activateNative(f.receipt, f.target, () => f.ops, activated.recoveryDir, "rollback")).rejects.toThrow("locked");
    rmSync(join(f.target.backupRoot, "lock"), { recursive: true });
    const result = await activateNative(f.receipt, f.target, () => f.ops, activated.recoveryDir, "rollback");
    expect(result.status).toBe("rolled-back");
    expect(readFileSync(join(f.target.installDir, "package"), "utf8")).toBe("previous");
    expect(readFileSync(join(extra.destination, "package"), "utf8")).toBe("previous-auxiliary");
    expect(readFileSync(join(f.target.stateDir, "config"), "utf8")).toBe("original");
    expect(readFileSync(f.target.plistPath, "utf8")).toBe("original-service");
    expect(f.browser()).toBe("previous-browser");
    expect(f.running()).toBe(true);
    expect(readFileSync(join(result.recoveryDir, "failed-state/post-activation-session"), "utf8")).toBe("preserve failed live state");
    expect(readFileSync(join(result.recoveryDir, "failed-state/managed/auxiliary/package"), "utf8")).toBe("candidate");
    expect(readFileSync(join(result.recoveryDir, "failed-package/package"), "utf8")).toBe("candidate");
    const completedCalls = f.calls.length;
    expect((await activateNative(f.receipt, f.target, () => f.ops, activated.recoveryDir, "rollback")).status).toBe("rolled-back");
    expect(f.calls).toHaveLength(completedCalls);
  });

  it.each(["root", "additional", "service", "browser", "snapshot", "candidate"])("refuses explicit rollback if current %s identity changed", async (part) => {
    const f = fixture();
    const extra = addAuxiliary(f);
    const activated = await activateNative(f.receipt, f.target, () => f.ops);
    const journalPath = join(activated.recoveryDir, "recovery.json");
    const journal = readFileSync(journalPath, "utf8");
    if (part === "root") writeFileSync(join(f.target.installDir, "package"), "different deployed runtime");
    if (part === "additional") writeFileSync(join(extra.destination, "package"), "different deployed auxiliary");
    if (part === "service") writeFileSync(f.target.plistPath, "different service");
    if (part === "browser") f.ops.currentBrowser = async () => "different-browser";
    if (part === "snapshot") writeFileSync(join(activated.recoveryDir, "state/config"), "damaged snapshot");
    if (part === "candidate") writeFileSync(join(activated.recoveryDir, "candidate/package"), "damaged recovery CLI");
    const stops = f.calls.filter((call) => call === "stop").length;
    await expect(activateNative(f.receipt, f.target, () => f.ops, activated.recoveryDir, "rollback")).rejects.toThrow(/differs|changed/);
    expect(f.calls.filter((call) => call === "stop")).toHaveLength(stops);
    expect(readFileSync(journalPath, "utf8")).toBe(journal);
    expect(f.running()).toBe(true);
  });

  it("rejects a missing explicit rollback directory without leaving a target lock", async () => {
    const f = fixture();
    await expect(activateNative(f.receipt, f.target, () => f.ops, join(f.target.backupRoot, "missing"), "rollback")).rejects.toThrow();
    expect(existsSync(join(f.target.backupRoot, "lock"))).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it.each(["healthy", "interrupted"])("refuses a superseded %s transaction even when the same artifact was deployed again", async (state) => {
    const failures: string[] = [];
    const f = fixture(failures);
    const first = await activateNative(f.receipt, f.target, () => f.ops);
    if (state === "interrupted") {
      failures.push("start");
      await expect(activateNative(f.receipt, f.target, () => f.ops, first.recoveryDir, "rollback")).rejects.toThrow("Rollback failed");
    }
    const second = await activateNative(f.receipt, f.target, () => f.ops);
    expect(second.recoveryDir).not.toBe(first.recoveryDir);
    const calls = f.calls.length;
    await expect(activateNative(f.receipt, f.target, () => f.ops, first.recoveryDir, "rollback")).rejects.toThrow("superseded");
    expect(f.calls).toHaveLength(calls);
    expect(f.running()).toBe(true);
  });

  it.each([
    ["rollback", "state-snapshot"], ["rollback", "restore-swap"],
    ["rollback", "browser-restore"], ["rollback", "start"], ["recover", "start"],
  ])("replays explicit rollback through %s after %s failure without losing failed state", async (action, failure) => {
    const failures: string[] = [];
    const f = fixture(failures);
    const extra = addAuxiliary(f, false);
    const activated = await activateNative(f.receipt, f.target, () => f.ops);
    writeFileSync(join(f.target.stateDir, "post-activation-session"), "retained after interruption");
    const failedState = treeDigest(f.target.stateDir);
    failures.push(failure);
    await expect(activateNative(f.receipt, f.target, () => f.ops, activated.recoveryDir, "rollback")).rejects.toThrow("Rollback failed");
    expect(f.running()).toBe(false);
    rmSync(f.receipt.artifact.path);
    rmSync(extra.artifact.path);
    const result = await activateNative(f.receipt, f.target, () => f.ops, activated.recoveryDir, action);
    expect(result.status).toBe("rolled-back");
    expect(readFileSync(join(f.target.installDir, "package"), "utf8")).toBe("previous");
    expect(existsSync(extra.destination)).toBe(false);
    expect(readFileSync(join(f.target.stateDir, "config"), "utf8")).toBe("original");
    expect(treeDigest(join(activated.recoveryDir, "failed-state"))).toBe(failedState);
    expect(f.browser()).toBe("previous-browser");
    expect(f.running()).toBe(true);
  });

  it.each(["preflight", "install", "candidate-snapshot", "package-snapshot"])("never stops the gateway after failed %s", async (failure) => {
    const f = fixture([failure]);
    await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("Activation failed");
    expect(f.calls).not.toContain("stop");
    expect(f.running()).toBe(true);
  });

  it.each(["stop", "state-snapshot", "replace", "doctor", "browser", "start", "health"])("restores safely after %s fails", async (failure) => {
    const f = fixture([failure]);
    await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("Activation failed");
    expect(f.running()).toBe(true);
    expect(readFileSync(join(f.target.stateDir, "config"), "utf8")).toBe("original");
    expect(readFileSync(join(f.target.installDir, "package"), "utf8")).toBe("previous");
    expect(readFileSync(f.target.plistPath, "utf8")).toBe("original-service");
    expect(f.browser()).toBe("previous-browser");
  });

  it.each(["restore-clone", "restore-swap", "browser-restore"])("blocks restart when critical %s fails", async (failure) => {
    const f = fixture(["health", failure]);
    await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("Activation and rollback failed");
    expect(f.running()).toBe(false);
    expect(f.calls.filter((call) => call === "start")).toHaveLength(1);
  });

  it("preserves both original and rollback failures and recovers without guessing swap state", async () => {
    const f = fixture(["health", "restore-clone"]);
    await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("Activation and rollback failed");
    const { readdirSync } = await import("node:fs");
    const recovery = join(f.target.backupRoot, readdirSync(f.target.backupRoot).find((name) => name.startsWith("activation-"))!);
    const result = await activateNative(f.receipt, f.target, () => f.ops, recovery);
    expect(result.status).toBe("rolled-back");
    expect(readFileSync(join(f.target.stateDir, "config"), "utf8")).toBe("original");
    expect(readFileSync(join(f.target.installDir, "package"), "utf8")).toBe("previous");
    expect(f.running()).toBe(true);
  });

  it("uses an immutable candidate CLI when recovery resumes after the old package was restored", async () => {
    const f = fixture(["health"]);
    const start = f.ops.start;
    let starts = 0;
    f.ops.start = async () => {
      if (++starts === 2) throw new Error("interrupted rollback restart");
      return start();
    };
    await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("Activation and rollback failed");
    expect(readFileSync(join(f.target.installDir, "package"), "utf8")).toBe("previous");
    const { readdirSync } = await import("node:fs");
    const recovery = join(f.target.backupRoot, readdirSync(f.target.backupRoot).find((name) => name.startsWith("activation-"))!);
    expect((await activateNative(f.receipt, f.target, () => f.ops, recovery)).status).toBe("rolled-back");
    expect(f.calls.filter((name) => name === "browser-restore")).toHaveLength(2);
    expect(f.running()).toBe(true);
  });

  it("rejects wrong host, overlapping roots, symlinked runtime and held lock before mutation", async () => {
    const f = fixture();
    expect(() => validateTarget({ ...f.target, host: "wrong.example.test" })).toThrow("identity");
    expect(() => validateTarget({ ...f.target, backupRoot: join(f.target.stateDir, "backups") })).toThrow("disjoint");
    const alias = join(f.directory, "state-link");
    symlinkSync(f.target.stateDir, alias);
    expect(() => validateTarget({ ...f.target, stateDir: alias })).toThrow("real directory");
    mkdirSync(join(f.target.backupRoot, "lock"), { recursive: true });
    await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("locked");
    expect(f.calls).toEqual([]);
  });

  describe("browser archive preflight through system operations", () => {
    it.each(["production-browser", "production-browser:latest", "docker.io/library/production-browser:latest"])("rejects production tag collision %s before Docker load", async (tag) => {
      const f = fixture();
      f.target.browser = { path: f.receipt.artifact.path, sha256: f.receipt.artifact.sha256,
        imageId: `sha256:${"a".repeat(64)}`, tag: "production-browser" };
      const calls: string[][] = [];
      const execute = async (command: string, args: string[]) => {
        calls.push([command, ...args]);
        return command === "tar" ? JSON.stringify([{ RepoTags: [tag] }]) : "";
      };
      await expect(systemOperations(f.target, f.directory, execute).preflight()).rejects.toThrow("isolated candidate tags");
      expect(calls.some((args) => args[0] === "docker")).toBe(false);
    });

    describe("explicit remote activation interpreter", () => {
      function remoteFixture() {
        const directory = root();
        const bin = join(directory, "bin");
        const runtime = join(directory, "runtime 'quoted");
        mkdirSync(bin);
        mkdirSync(runtime);
        const node = join(runtime, "node");
        const argumentsFile = join(directory, "arguments");
        const pathFile = join(directory, "path");
        const sshMarker = join(directory, "ssh-called");
        writeFileSync(node, '#!/bin/bash\nprintf "%s\\0" "$@" > "$REMOTE_ARGUMENTS"\nprintf "%s" "$PATH" > "$REMOTE_PATH_RECORD"\n');
        chmodSync(node, 0o700);
        writeFileSync(join(bin, "ssh"), '#!/bin/bash\nset -e\nprintf called > "$REMOTE_SSH_MARKER"\nPATH=/usr/bin:/bin /bin/bash -c "$2"\n');
        chmodSync(join(bin, "ssh"), 0o700);
        const env: NodeJS.ProcessEnv = {
          ...process.env, PATH: `${bin}:/usr/bin:/bin`, MINI_HOST: "gateway.example.test",
          PUDDLES_REMOTE_ROOT: join(directory, "tooling 'quoted"),
          PUDDLES_REMOTE_NODE: node, PUDDLES_REMOTE_PATH: `${runtime}:/usr/bin:/bin`,
          OPENCLAW_CANDIDATE_RECEIPT: join(directory, "candidate 'quoted; literal.json"),
          OPENCLAW_DEPLOY_TARGET: join(directory, "target 'quoted.json"),
          OPENCLAW_RECOVERY_DIR: join(directory, "recovery 'quoted"),
          OPENCLAW_DEPLOY_ACTION: "activate",
          REMOTE_ARGUMENTS: argumentsFile, REMOTE_PATH_RECORD: pathFile, REMOTE_SSH_MARKER: sshMarker,
        };
        return { env, argumentsFile, pathFile, sshMarker };
      }

      it("uses a safely quoted pinned executable and selected PATH without relying on SSH's node lookup", () => {
        const f = remoteFixture();
        const result = spawnSync("/bin/bash", [join(repoRoot, "docs/openclaw-setup/patches/apply-and-deploy.sh")], { env: f.env, encoding: "utf8", timeout: 10_000 });
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(f.argumentsFile, "utf8").split("\0").filter(Boolean)).toEqual([
          `${f.env.PUDDLES_REMOTE_ROOT}/packages/e2e/bin/openclaw-activate.mjs`,
          f.env.OPENCLAW_CANDIDATE_RECEIPT, f.env.OPENCLAW_DEPLOY_TARGET, f.env.OPENCLAW_RECOVERY_DIR,
        ]);
        expect(readFileSync(f.pathFile, "utf8")).toBe(f.env.PUDDLES_REMOTE_PATH);
      });

      it("rejects an explicitly selected relative interpreter before contacting SSH", () => {
        const f = remoteFixture();
        f.env.PUDDLES_REMOTE_NODE = "relative-node";
        const result = spawnSync("/bin/bash", [join(repoRoot, "docs/openclaw-setup/patches/apply-and-deploy.sh")], { env: f.env, encoding: "utf8", timeout: 10_000 });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("absolute executable path");
        expect(existsSync(f.sshMarker)).toBe(false);
      });

      it.each(["local", "remote"])("passes the explicit rollback action through the %s wrapper", (topology) => {
        const f = remoteFixture();
        f.env.OPENCLAW_DEPLOY_ACTION = "rollback";
        if (topology === "local") {
          f.env.MINI_HOST = "";
          f.env.PATH = `${dirname(f.env.PUDDLES_REMOTE_NODE!)}:/usr/bin:/bin`;
        }
        const result = spawnSync("/bin/bash", [join(repoRoot, "docs/openclaw-setup/patches/apply-and-deploy.sh")], { env: f.env, encoding: "utf8", timeout: 10_000 });
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(f.argumentsFile, "utf8").split("\0").filter(Boolean)).toEqual([
          `${topology === "local" ? repoRoot : f.env.PUDDLES_REMOTE_ROOT}/packages/e2e/bin/openclaw-activate.mjs`,
          f.env.OPENCLAW_CANDIDATE_RECEIPT, f.env.OPENCLAW_DEPLOY_TARGET, f.env.OPENCLAW_RECOVERY_DIR, "--rollback",
        ]);
      });

      it("requires an explicit rollback recovery directory before contacting SSH", () => {
        const f = remoteFixture();
        f.env.OPENCLAW_DEPLOY_ACTION = "rollback";
        delete f.env.OPENCLAW_RECOVERY_DIR;
        const result = spawnSync("/bin/bash", [join(repoRoot, "docs/openclaw-setup/patches/apply-and-deploy.sh")], { env: f.env, encoding: "utf8", timeout: 10_000 });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("explicit rollback requires");
        expect(existsSync(f.sshMarker)).toBe(false);
      });
    });

    it("records the previous image before loading isolated tags and uses the retained CLI on recovery", async () => {
      const f = fixture();
      const previous = `sha256:${"b".repeat(64)}`;
      f.target.browser = { path: f.receipt.artifact.path, sha256: f.receipt.artifact.sha256,
        imageId: `sha256:${"a".repeat(64)}`, tag: "production-browser" };
      const calls: string[][] = [];
      const execute = async (command: string, args: string[]) => {
        calls.push([command, ...args]);
        if (command === "tar") return JSON.stringify([{ RepoTags: ["isolated-candidate:fixture"] }]);
        if (command === "docker" && args[0] === "image") return args.at(-1) === f.target.browser.tag ? previous : f.target.browser.imageId;
        return "";
      };
      const ops = systemOperations(f.target, f.directory, execute);
      expect(await ops.preflight()).toBe(previous);
      const docker = calls.filter((args) => args[0] === "docker");
      expect(docker[0].at(-1)).toBe("production-browser");
      expect(docker[1][1]).toBe("load");
      const retained = join(f.directory, "retained-candidate");
      await ops.browser(previous, retained);
      expect(calls.slice(-2).every((args) => args[1] === join(retained, "openclaw.mjs"))).toBe(true);
    });
  });

  it("rejects changed artifact, missing cumulative gate and missing integration evidence", async () => {
    const f = fixture();
    await expect(activateNative({ ...f.receipt, accumulated: false }, f.target, () => f.ops)).rejects.toThrow("accumulated");
    writeFileSync(f.receipt.artifact.path, "changed");
    await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("changed");
    const receipt = join(f.directory, "candidate.json");
    writeFileSync(receipt, JSON.stringify(f.receipt));
    await expect(verifyIntegratedCandidate(receipt, f.target)).rejects.toThrow("integration evidence");
    expect(f.calls).toEqual([]);
  });

  it("never invokes GitHub or dependency installation inside activation", () => {
    const script = readFileSync(join(repoRoot, "packages/e2e/src/native-activation.mjs"), "utf8");
    const activation = script.slice(script.indexOf("export async function activateNative"), script.indexOf("export async function verifyIntegratedCandidate"));
    expect(activation).not.toMatch(/["'](?:gh|npm|pnpm)["']|["']docker["'][^\n]*["']build["']/);
    const wrapper = readFileSync(join(repoRoot, "docs/openclaw-setup/patches/apply-and-deploy.sh"), "utf8");
    expect(wrapper).toContain('if [ -n "${MINI_HOST:-}" ]');
    expect(wrapper).toContain('exec ssh "$MINI_HOST" "$command"');
    expect(wrapper).toContain('exec node "$ROOT/packages/e2e/bin/$entrypoint"');
  });

  it.each([
    ["success", false],
    ["fault rollback", true],
  ] as const)("runs prepared-file %s through the executable rehearsal wrapper", (_name, fault) => {
    const f = rehearsalWrapperFixture(fault);
    expect(JSON.parse(readFileSync(f.targetPath, "utf8"))).toMatchObject({
      purpose: "rehearsal",
      isolation: {
        schema: "puddles.openclaw-rehearsal-target/v1",
        root: realpathSync(dirname(f.targetPath)),
      },
    });
    const result = spawnSync("/bin/bash", [join(repoRoot, "docs/openclaw-setup/patches/apply-and-deploy.sh")], {
      env: f.env, encoding: "utf8", timeout: 30_000,
    });
    if (fault) {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Activation failed");
      expect(readFileSync(f.preparedDestination, "utf8")).toBe("previous model");
      const recovery = readdirSync(f.backups).find((name) => name.startsWith("activation-"))!;
      expect(JSON.parse(readFileSync(join(f.backups, recovery, "recovery.json"), "utf8")).status).toBe("rolled-back");
    } else {
      const recovery = readdirSync(f.backups).find((name) => name.startsWith("activation-"));
      const details = recovery && existsSync(join(f.backups, recovery, "failure.json"))
        ? readFileSync(join(f.backups, recovery, "failure.json"), "utf8") : "";
      const rollback = recovery && existsSync(join(f.backups, recovery, "rollback-failure.json"))
        ? readFileSync(join(f.backups, recovery, "rollback-failure.json"), "utf8") : "";
      const logs = recovery ? readdirSync(join(f.backups, recovery)).filter((name) => name.startsWith("command-"))
        .map((name) => `${name}: ${readFileSync(join(f.backups, recovery, name), "utf8")}`).join("\n") : "";
      expect(result.status, `${result.stderr}\n${details}\n${rollback}\n${logs}`).toBe(0);
      expect(readFileSync(f.preparedDestination, "utf8")).toBe("candidate model");
    }
  });

  it("stages all artifacts before stopping, replaces only the selected subtree, and preserves current state", async () => {
    const f = fixture();
    const extra = addAuxiliary(f);
    const install = f.ops.install;
    f.ops.install = async (artifact, prefix) => {
      expect(f.running()).toBe(true);
      writeFileSync(join(f.target.stateDir, "late-session"), "arrived before shutdown");
      return install(artifact, prefix);
    };
    await activateNative(f.receipt, f.target, () => f.ops);
    expect(f.calls.filter((call) => call === "install")).toHaveLength(2);
    expect(f.calls.lastIndexOf("install")).toBeLessThan(f.calls.indexOf("stop"));
    expect(f.calls.indexOf("additional-copy")).toBeGreaterThan(f.calls.indexOf("state-snapshot"));
    expect(treeDigest(extra.destination, { portable: true })).toBe(extra.artifact.runtimeSha256);
    expect(existsSync(join(extra.destination, "stale-chunk"))).toBe(false);
    expect(readFileSync(join(f.target.stateDir, "late-session"), "utf8")).toBe("arrived before shutdown");
    expect(readFileSync(join(f.target.stateDir, "registry.db"), "utf8")).toBe("opaque existing registry");
  });

  it("stages immutable files and directories before downtime and restores both through the state snapshot", async () => {
    const f = fixture();
    const file = addPrepared(f, "file");
    const directory = addPrepared(f, "directory", false);
    const activated = await activateNative(f.receipt, f.target, () => f.ops);
    expect(f.calls.filter((call) => call === "prepared-stage")).toHaveLength(2);
    expect(f.calls.lastIndexOf("prepared-stage")).toBeLessThan(f.calls.indexOf("stop"));
    expect(fileDigest(file.destination)).toBe(file.sha256);
    expect(treeDigest(directory.destination, { portable: true })).toBe(directory.sha256);
    expect(readlinkSync(join(directory.destination, "model-current"))).toBe("model");
    expect((await activateNative(f.receipt, f.target, () => f.ops, activated.recoveryDir, "rollback")).status).toBe("rolled-back");
    expect(readFileSync(file.destination, "utf8")).toBe("previous bytes");
    expect(existsSync(directory.destination)).toBe(false);
  });

  it("restores prepared destinations after a post-replacement fault without their original sources", async () => {
    const f = fixture(["health", "restore-clone"]);
    const file = addPrepared(f, "file");
    const added = addPrepared(f, "directory", false);
    await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("Activation and rollback failed");
    rmSync(file.source, { force: true });
    rmSync(added.source, { recursive: true, force: true });
    const recovery = join(f.target.backupRoot, readdirSync(f.target.backupRoot).find((name) => name.startsWith("activation-"))!);
    expect((await activateNative(f.receipt, f.target, () => f.ops, recovery)).status).toBe("rolled-back");
    expect(readFileSync(file.destination, "utf8")).toBe("previous bytes");
    expect(existsSync(added.destination)).toBe(false);
  });

  it.each(["additional-copy", "health"])("restores the root and additional runtime after %s fails", async (failure) => {
    const f = fixture([failure]);
    const extra = addAuxiliary(f);
    await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("Activation failed");
    expect(readFileSync(join(f.target.installDir, "package"), "utf8")).toBe("previous");
    expect(readFileSync(join(extra.destination, "package"), "utf8")).toBe("previous-auxiliary");
    expect(existsSync(join(extra.destination, "stale-chunk"))).toBe(true);
    expect(readFileSync(join(f.target.stateDir, "registry.db"), "utf8")).toBe("opaque existing registry");
    expect(f.running()).toBe(true);
  });

  it.each(["activation", "smoke"])("rolls back both runtimes after %s failure through real macOS clone and atomic-swap helpers", async (failure) => {
    const f = fixture(failure === "activation" ? ["health"] : []);
    const extra = addAuxiliary(f);
    f.ops.clone = async (from, to) => {
      const result = spawnSync("python3", [cloneHelper, from, to], { encoding: "utf8", timeout: 10_000 });
      expect(result.status, result.stderr).toBe(0);
    };
    f.ops.swap = async (from, to) => {
      const result = spawnSync("python3", [swapHelper, from, to], { encoding: "utf8", timeout: 10_000 });
      expect(result.status, result.stderr).toBe(0);
    };
    if (failure === "activation") {
      await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("Activation failed");
    } else {
      const activated = await activateNative(f.receipt, f.target, () => f.ops);
      expect((await activateNative(f.receipt, f.target, () => f.ops, activated.recoveryDir, "rollback")).status).toBe("rolled-back");
      expect(readFileSync(join(activated.recoveryDir, "failed-state/managed/auxiliary/package"), "utf8")).toBe("candidate");
    }
    expect(readFileSync(join(f.target.installDir, "package"), "utf8")).toBe("previous");
    expect(readFileSync(join(extra.destination, "package"), "utf8")).toBe("previous-auxiliary");
    expect(existsSync(join(extra.destination, "stale-chunk"))).toBe(true);
    expect(readFileSync(join(f.target.stateDir, "registry.db"), "utf8")).toBe("opaque existing registry");
    expect(f.running()).toBe(true);
  });

  it("recovers a failed additional install without requiring its archive or leaving a new subtree", async () => {
    const f = fixture(["health", "restore-clone"]);
    const extra = addAuxiliary(f, false);
    await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("Activation and rollback failed");
    rmSync(extra.artifact.path);
    const { readdirSync } = await import("node:fs");
    const recovery = join(f.target.backupRoot, readdirSync(f.target.backupRoot).find((name) => name.startsWith("activation-"))!);
    expect((await activateNative(f.receipt, f.target, () => f.ops, recovery)).status).toBe("rolled-back");
    expect(existsSync(extra.destination)).toBe(false);
    expect(f.running()).toBe(true);
  });

  it("rejects unsealed, unmapped, overlapping and symlinked additional installs before downtime", async () => {
    const f = fixture();
    const extra = addAuxiliary(f);
    await expect(activateNative({ ...f.receipt, additionalArtifacts: [] }, f.target, () => f.ops)).rejects.toThrow("map every");
    expect(() => validateTarget({ ...f.target, additionalInstalls: [{ id: "auxiliary", path: "../outside" }] })).toThrow("child");
    expect(() => validateTarget({ ...f.target, additionalInstalls: [{ id: "auxiliary", path: "managed" }, { id: "nested", path: "managed/nested" }] })).toThrow("disjoint");
    symlinkSync(join(f.directory, "missing-external"), join(f.target.stateDir, "broken-link"));
    expect(() => validateTarget({ ...f.target, additionalInstalls: [{ id: "auxiliary", path: "broken-link/runtime" }] })).toThrow("real state");
    writeFileSync(extra.artifact.path, "changed");
    await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("artifact changed");
    expect(f.calls).toEqual([]);
  });

  it("rejects changed, unmapped, overlapping and symlinked prepared files before downtime", async () => {
    const f = fixture();
    const prepared = addPrepared(f, "file");
    await expect(activateNative({ ...f.receipt, preparedFiles: [] }, f.target, () => f.ops)).rejects.toThrow("map every");
    expect(() => validateTarget({ ...f.target, preparedFiles: [{ id: prepared.id, path: "../outside" }] })).toThrow("child");
    expect(() => validateTarget({
      ...f.target,
      additionalInstalls: [{ id: "auxiliary", path: "managed" }],
      preparedFiles: [{ id: prepared.id, path: "managed/model" }],
    })).toThrow("disjoint");
    symlinkSync(join(f.directory, "missing-external"), join(f.target.stateDir, "prepared-link"));
    expect(() => validateTarget({ ...f.target, preparedFiles: [{ id: prepared.id, path: "prepared-link/model" }] })).toThrow("real state entries");
    writeFileSync(prepared.source, "changed");
    await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("prepared file changed");
    expect(f.calls).toEqual([]);
  });

  it("allows in-tree prepared directory links and rejects escaping links before downtime", async () => {
    const valid = fixture();
    const directory = addPrepared(valid, "directory");
    await activateNative(valid.receipt, valid.target, () => valid.ops);
    expect(readlinkSync(join(directory.destination, "model-current"))).toBe("model");

    const escaped = fixture();
    const unsafe = addPrepared(escaped, "directory");
    writeFileSync(join(escaped.directory, "outside"), "outside");
    symlinkSync(join(escaped.directory, "outside"), join(unsafe.source, "escaping"));
    escaped.receipt.preparedFiles[0].sha256 = treeDigest(unsafe.source);
    await expect(activateNative(escaped.receipt, escaped.target, () => escaped.ops)).rejects.toThrow("escapes");
    expect(escaped.calls).toEqual([]);
  });
});
