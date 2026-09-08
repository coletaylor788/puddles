import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
// @ts-expect-error Native lifecycle is also executable without TypeScript.
import { activateNative, systemOperations, validateTarget, verifyIntegratedCandidate } from "../src/native-activation.mjs";
// @ts-expect-error Native lifecycle is also executable without TypeScript.
import { fileDigest, treeDigest } from "../src/native-state.mjs";

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
  };
  mkdirSync(target.installDir);
  mkdirSync(target.stateDir);
  writeFileSync(join(target.installDir, "package"), "previous");
  writeFileSync(join(target.stateDir, "config"), "original");
  writeFileSync(target.plistPath, "original-service");
  const artifact = join(directory, "artifact");
  writeFileSync(artifact, "synthetic artifact");
  const receipt = { status: "passed", accumulated: true, scenarios: 8, artifact: { path: artifact, sha256: fileDigest(artifact) },
    additionalArtifacts: [] as Array<{ id: string; artifact: { path: string; sha256: string; runtimeSha256: string } }> };
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
    async stop() { check("stop"); started = false; },
    async start() { check("start"); started = true; },
    async clone(from: string, to: string) {
      if (from.includes("/additional-staging/")) expect(started).toBe(false);
      check(from.includes("/additional-staging/") ? "additional-copy" : to.endsWith("/candidate") ? "candidate-snapshot" : to.includes("restore-") ? "restore-clone" : from === target.stateDir ? "state-snapshot" : "package-snapshot");
      cpSync(from, to, { recursive: true });
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
    expect(wrapper).toContain('exec node "$ROOT/packages/e2e/bin/openclaw-activate.mjs"');
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

  it("rolls back both runtimes through the real macOS clone and atomic-swap helpers", async () => {
    const f = fixture(["health"]);
    const extra = addAuxiliary(f);
    f.ops.clone = async (from, to) => {
      const result = spawnSync("python3", [cloneHelper, from, to], { encoding: "utf8", timeout: 10_000 });
      expect(result.status, result.stderr).toBe(0);
    };
    f.ops.swap = async (from, to) => {
      const result = spawnSync("python3", [swapHelper, from, to], { encoding: "utf8", timeout: 10_000 });
      expect(result.status, result.stderr).toBe(0);
    };
    await expect(activateNative(f.receipt, f.target, () => f.ops)).rejects.toThrow("Activation failed");
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
});
