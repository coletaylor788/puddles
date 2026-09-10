import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
// @ts-expect-error Native lifecycle also runs without TypeScript.
import { activateNative, systemOperations } from "../src/native-activation.mjs";
// @ts-expect-error Native lifecycle also runs without TypeScript.
import { fileDigest } from "../src/native-state.mjs";

// Repeated real binary hashes and complete rollback passes take up to 15s on hosted Intel.
vi.setConfig({ testTimeout: 30_000 });

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  // Synchronous plist subprocesses and binary hashes must not starve worker RPC.
  await setImmediate();
});

function plist(path: string, value?: unknown, binary = false) {
  if (value) {
    execFileSync("python3", ["-c", "import json,plistlib,sys; plistlib.dump(json.loads(sys.argv[2]),open(sys.argv[1],'wb'),fmt=plistlib.FMT_BINARY if sys.argv[3]=='True' else plistlib.FMT_XML)", path, JSON.stringify(value), String(binary ? "True" : "False")]);
  }
  return JSON.parse(execFileSync("python3", ["-c", "import json,plistlib,sys; print(json.dumps(plistlib.load(open(sys.argv[1],'rb'))))", path], { encoding: "utf8" }));
}

function fixture(wrapper = true, migration = true, binary = false, oldAlias = false) {
  const directory = realpathSync(resolve(import.meta.dirname, "../../.."));
  const root = join(directory, `.node-migration-test-${randomUUID()}`);
  mkdirSync(root);
  roots.push(root);
  const oldNode = oldAlias ? join(root, "opt/node/bin/node") : join(root, "node-old");
  if (oldAlias) {
    mkdirSync(join(root, "cellar/node-22/bin"), { recursive: true });
    mkdirSync(join(root, "opt"));
    symlinkSync(join(root, "cellar/node-22"), join(root, "opt/node"));
  }
  writeFileSync(oldNode, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const expected = { path: oldNode, sha256: fileDigest(oldNode), version: "v22.22.0", platform: process.platform, arch: process.arch,
    ...(oldAlias ? { realPath: realpathSync(oldNode) } : {}) };
  const desired = { path: realpathSync(process.execPath), sha256: fileDigest(process.execPath), version: process.version, platform: process.platform, arch: process.arch };
  const target = {
    schemaVersion: 1, host: hostname(), installDir: join(root, "runtime"), stateDir: join(root, "state"),
    backupRoot: join(root, "backups"), plistPath: join(root, "service.plist"), label: "synthetic.gateway", port: 18799,
    browser: { tag: "synthetic-browser", imageId: "candidate-browser" },
    nodeMigration: migration ? { argumentIndex: wrapper ? 4 : 0, expected, desired } : undefined,
  };
  mkdirSync(target.installDir);
  mkdirSync(target.stateDir);
  writeFileSync(join(target.installDir, "openclaw.mjs"), "old runtime");
  writeFileSync(join(target.stateDir, "config"), "old state");
  const args = [...(wrapper ? ["/bin/sh", "/synthetic/env-wrapper", "--env-file", "/synthetic/gateway.env"] : []),
    oldNode, join(target.installDir, "openclaw.mjs"), "gateway", "--port", "18799", "--label", `prefix:${oldNode}`];
  const service = { Label: target.label, ProgramArguments: args, EnvironmentVariables: { KEEP: "unchanged", NODE_OPTIONS: "--trace-warnings" },
    KeepAlive: { SuccessfulExit: false }, WorkingDirectory: "/synthetic/working", UnknownField: ["preserve", 3, true] };
  plist(target.plistPath, service, binary);
  chmodSync(target.plistPath, 0o640);
  const original = readFileSync(target.plistPath);
  const archive = join(root, "artifact");
  writeFileSync(archive, "synthetic archive");
  const receipt = { status: "passed", accumulated: true, scenarios: 3,
    tools: { node: desired.version, nodeBinary: desired.sha256, platform: desired.platform, arch: desired.arch },
    artifact: { path: archive, sha256: fileDigest(archive), node: desired.version, platform: desired.platform, arch: desired.arch } };
  const calls: Array<{ command: string; args: string[]; options: any }> = [];
  const events: string[] = [];
  const failures: string[] = [];
  const check = (event: string) => {
    events.push(event);
    const index = failures.indexOf(event);
    if (index >= 0) { failures.splice(index, 1); throw new Error(`synthetic ${event} failure`); }
  };
  let browser = "old-browser";
  let running = true;
  const metadata = new Map([[oldNode, expected], [desired.path, desired]]);
  if (expected.realPath) metadata.set(expected.realPath, expected);
  const execute = async (command: string, args: string[], options: any = {}) => {
    calls.push({ command, args, options });
    if (command === "python3" && args[0] === "-c") return execFileSync(command, args, { encoding: "utf8", stdio: "pipe" });
    if (command === "python3" && args[0] === "--version") return "Python fixture";
    if (metadata.has(command)) {
      if (args[0] === "-p") return JSON.stringify(metadata.get(command));
      if (!args[0].endsWith("openclaw.mjs")) throw new Error("Unexpected fixture Node command");
      if (migration) {
        const oldRuntime = readFileSync(args[0], "utf8") === "old runtime";
        expect(command).toBe(oldRuntime ? expected.realPath ?? expected.path : desired.path);
      }
      return "";
    }
    if (command === "launchctl") {
      if (args[0] === "print" && !running) throw new Error("status 113");
      if (args[0] === "bootout") { check("stop"); running = false; }
      if (args[0] === "bootstrap") {
        check("start");
        if (migration) {
          const oldRuntime = readFileSync(join(target.installDir, "openclaw.mjs"), "utf8") === "old runtime";
          expect(plist(target.plistPath).ProgramArguments[target.nodeMigration!.argumentIndex]).toBe(oldRuntime ? expected.path : desired.path);
        }
        running = true;
      }
      return "";
    }
    if (command === "docker" && args[0] === "tag") { browser = args[1]; return ""; }
    throw new Error(`Unrecorded fixture command: ${command}`);
  };
  const factory = (_target: unknown, recovery: string) => {
    const native = systemOperations(target, recovery, execute);
    return {
      ...native,
      async preflight() { check("preflight"); return browser; },
      async currentBrowser() { return browser; },
      async install(_artifact: unknown, prefix: string) {
        check("install");
        expect(running).toBe(true);
        const runtime = join(prefix, "runtime");
        mkdirSync(runtime, { recursive: true });
        roots.push(prefix);
        writeFileSync(join(runtime, "openclaw.mjs"), "candidate runtime");
        return runtime;
      },
      async clone(from: string, to: string) { cpSync(from, to, { recursive: true }); },
      async swap(from: string, to: string) {
        check(to.includes("restore-package") ? "restore-package" : "swap");
        renameSync(from, `${from}.exchange`); renameSync(to, from); renameSync(`${from}.exchange`, to);
      },
      async doctor() { check("doctor"); await native.doctor(); },
      async stateMigration(phase: string, runtime: string, manifestPath: string, sha256: string) {
        check(`migration:${phase}`);
        expect(readFileSync(join(runtime, "openclaw.mjs"), "utf8")).toBe("candidate runtime");
        expect(fileDigest(manifestPath)).toBe(sha256);
        if (phase === "preflight") {
          expect(running).toBe(true);
        } else {
          expect(running).toBe(false);
          const journal = JSON.parse(readFileSync(join(recovery, "recovery.json"), "utf8"));
          expect(journal.snapshotReady).toBe(true);
          expect(readFileSync(join(recovery, "state/config"), "utf8")).toBe("old state");
          writeFileSync(join(target.stateDir, "config"), `${phase} migrated state`);
        }
      },
      async health(interpreter?: string) { check("health"); await native.health(interpreter); },
    };
  };
  const activate = (recovery?: string, action?: string) => activateNative(receipt, target, factory, recovery, action);
  const recovery = () => join(target.backupRoot, readdirSync(target.backupRoot).find((name) => name.startsWith("activation-"))!);
  return { root, target, expected, desired, service, original, receipt, calls, events, failures, metadata, execute, activate, recovery };
}

function stateMigration(f: ReturnType<typeof fixture>) {
  const manifestPath = join(f.root, "migration.json");
  writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    configOperations: [{ kind: "set", path: ["memory", "search", "provider"], expected: { exists: false }, value: "local" }],
  }));
  const sha256 = fileDigest(manifestPath);
  Object.assign(f.target, { stateMigration: { manifestPath, sha256 } });
  Object.assign(f.receipt, { stateMigration: { sha256 } });
  return { manifestPath, sha256 };
}

describe("stopped-state migration inside interpreter rollback", () => {
  it("checks the manifest before stop, then mutates config before doctor and cron before start", async () => {
    const f = fixture();
    const migration = stateMigration(f);
    const result = await f.activate();
    expect(f.events.indexOf("migration:preflight")).toBeLessThan(f.events.indexOf("stop"));
    expect(f.events.indexOf("migration:config")).toBeGreaterThan(f.events.indexOf("stop"));
    expect(f.events.indexOf("migration:schema")).toBeGreaterThan(f.events.indexOf("stop"));
    expect(f.events.indexOf("migration:schema")).toBeLessThan(f.events.indexOf("migration:config"));
    expect(f.events.indexOf("migration:config")).toBeLessThan(f.events.indexOf("doctor"));
    expect(f.events.indexOf("migration:cron")).toBeGreaterThan(f.events.indexOf("doctor"));
    expect(f.events.indexOf("migration:cron")).toBeLessThan(f.events.indexOf("start"));
    expect(fileDigest(join(result.recoveryDir, "state-migration.json"))).toBe(migration.sha256);
    expect(JSON.parse(readFileSync(join(result.recoveryDir, "recovery.json"), "utf8")).stateMigration).toEqual({
      sha256: migration.sha256, phase: "complete",
    });
  });

  it.each(["migration:schema", "migration:config", "doctor", "migration:cron"])("restores stopped snapshots and the old interpreter after %s fails", async (failure) => {
    const f = fixture();
    stateMigration(f);
    f.failures.push(failure);
    await expect(f.activate()).rejects.toThrow("Activation failed");
    expect(readFileSync(join(f.target.stateDir, "config"), "utf8")).toBe("old state");
    expect(readFileSync(f.target.plistPath)).toEqual(f.original);
    expect(readFileSync(join(f.target.installDir, "openclaw.mjs"), "utf8")).toBe("old runtime");
    expect(JSON.parse(readFileSync(join(f.recovery(), "failure.json"), "utf8")).message).toBe(`synthetic ${failure} failure`);
  });

  it("retains recovery after a partial config migration and interrupted rollback", async () => {
    const f = fixture();
    const migration = stateMigration(f);
    f.failures.push("migration:cron", "restore-package");
    await expect(f.activate()).rejects.toThrow();
    rmSync(migration.manifestPath);
    const recovered = await f.activate(f.recovery());
    expect(recovered.status).toBe("rolled-back");
    expect(readFileSync(join(f.target.stateDir, "config"), "utf8")).toBe("old state");
    expect(readFileSync(f.target.plistPath)).toEqual(f.original);
  });

  it.each(["receipt", "digest", "manifest", "preflight"])("rejects %s mismatch before stopping", async (failure) => {
    const f = fixture();
    const migration = stateMigration(f);
    if (failure === "receipt") Object.assign(f.receipt, { stateMigration: { sha256: "0".repeat(64) } });
    if (failure === "digest") writeFileSync(migration.manifestPath, "{}");
    if (failure === "manifest") {
      writeFileSync(migration.manifestPath, '{"schemaVersion":1,"command":"forbidden"}');
      const sha256 = fileDigest(migration.manifestPath);
      Object.assign(f.target, { stateMigration: { manifestPath: migration.manifestPath, sha256 } });
      Object.assign(f.receipt, { stateMigration: { sha256 } });
    }
    if (failure === "preflight") f.failures.push("migration:preflight");
    await expect(f.activate()).rejects.toThrow();
    expect(f.events).not.toContain("stop");
    expect(readFileSync(join(f.target.stateDir, "config"), "utf8")).toBe("old state");
  });
});

describe("reversible configured Node interpreter migration", () => {
  it("keeps no-option activation unchanged without inspecting or rewriting the service", async () => {
    const f = fixture(true, false);
    await f.activate();
    expect(readFileSync(f.target.plistPath)).toEqual(f.original);
    expect(f.calls.some(({ args }) => args[0] === "-p" || args[0] === "-c")).toBe(false);
    expect(f.calls.filter(({ args }) => args[0].endsWith("openclaw.mjs")).every(({ command }) => command === process.execPath)).toBe(true);
  });

  it.each([[false, false], [true, false], [true, true]])("changes only the selected interpreter (wrapper %s, binary %s)", async (wrapper, binary) => {
    const f = fixture(wrapper, true, binary);
    const result = await f.activate();
    const expected = structuredClone(f.service);
    expected.ProgramArguments[f.target.nodeMigration!.argumentIndex] = f.desired.path;
    expect(plist(f.target.plistPath)).toEqual(expected);
    expect(readFileSync(join(result.recoveryDir, "service.plist"))).toEqual(f.original);
    const journal = JSON.parse(readFileSync(join(result.recoveryDir, "recovery.json"), "utf8"));
    expect(journal.nodeMigration.expected).toEqual(f.expected);
    expect(journal.nodeMigration.desired).toEqual(f.desired);
    expect(journal.deployedServiceSha256).toBe(journal.nodeMigration.migratedServiceSha256);
    expect(existsSync(f.expected.path)).toBe(true);
  });

  it.each(["expected-argument", "missing-argument", "ambiguous-argument", "program-override", "missing-executable",
    "old-digest", "new-digest", "version", "old-version", "platform", "arch", "unsupported", "toolchain", "artifact", "permission"])("rejects %s before shutdown", async (failure) => {
    const f = fixture();
    const migration = f.target.nodeMigration!;
    if (failure === "expected-argument") f.service.ProgramArguments[migration.argumentIndex] = "/wrong/node";
    if (failure === "missing-argument") f.service.ProgramArguments.splice(migration.argumentIndex, 1);
    if (failure === "ambiguous-argument") f.service.ProgramArguments.push(f.expected.path);
    if (failure === "program-override") Object.assign(f.service, { Program: "/other/executable" });
    if (failure === "missing-executable") migration.desired.path = join(f.root, "missing");
    if (failure === "old-digest") migration.expected.sha256 = "0".repeat(64);
    if (failure === "new-digest") migration.desired.sha256 = "0".repeat(64);
    if (failure === "version") f.metadata.set(f.desired.path, { ...f.desired, version: "v26.2.0" });
    if (failure === "old-version") f.metadata.set(f.expected.path, { ...f.expected, version: "v22.1.0" });
    if (failure === "platform") f.metadata.set(f.desired.path, { ...f.desired, platform: "wrong" as any });
    if (failure === "arch") f.metadata.set(f.desired.path, { ...f.desired, arch: "wrong" as any });
    if (failure === "unsupported") migration.desired.version = "v25.0.0";
    if (failure === "toolchain") f.receipt.tools.nodeBinary = "0".repeat(64);
    if (failure === "artifact") f.receipt.artifact.node = "v22.22.0";
    if (failure === "permission") chmodSync(f.expected.path, 0o600);
    plist(f.target.plistPath, f.service);
    const before = readFileSync(f.target.plistPath);
    await expect(f.activate()).rejects.toThrow();
    expect(f.events).not.toContain("stop");
    expect(f.events).not.toContain("install");
    expect(readFileSync(f.target.plistPath)).toEqual(before);
    expect(readFileSync(join(f.target.installDir, "openclaw.mjs"), "utf8")).toBe("old runtime");
  });

  it("uses old Node for existing CLI preflight and desired Node for candidate CLI", async () => {
    const f = fixture();
    const target = { ...f.target, browser: undefined };
    const ops = systemOperations(target, f.root, f.execute);
    await ops.preflight();
    writeFileSync(join(target.installDir, "openclaw.mjs"), "candidate runtime");
    await ops.health();
    const commands = f.calls.filter(({ args }) => args[0].endsWith("openclaw.mjs"));
    expect(commands.map(({ command }) => command)).toEqual([f.expected.path, f.desired.path]);
    expect(commands[0].options.env.PATH.startsWith(`${f.root}:`)).toBe(true);
  });

  it("leaves preflight-only recovery alone before the original service snapshot exists", async () => {
    const f = fixture();
    f.failures.push("preflight");
    await expect(f.activate()).rejects.toThrow("Activation failed");
    expect(existsSync(join(f.recovery(), "service.plist"))).toBe(false);
    expect((await f.activate(f.recovery())).status).toBe("failed-before-shutdown");
    expect(f.events).not.toContain("stop");
    expect(readFileSync(f.target.plistPath)).toEqual(f.original);
  });

  it.each(["doctor", "start", "health"])("restores exact service and old interpreter after %s failure", async (failure) => {
    const f = fixture();
    f.failures.push(failure);
    await expect(f.activate()).rejects.toThrow("Activation failed");
    expect(readFileSync(f.target.plistPath)).toEqual(f.original);
    const health = f.calls.filter(({ args }) => args.includes("health"));
    expect(health.at(-1)?.command).toBe(f.expected.path);
    expect(readFileSync(join(f.target.installDir, "openclaw.mjs"), "utf8")).toBe("old runtime");
    expect(JSON.parse(readFileSync(join(f.recovery(), "failure.json"), "utf8")).message).toBe(`synthetic ${failure} failure`);
  });

  it.each(["recover", "rollback"])("recovers interrupted explicit rollback using old health and retained candidate sandbox Node (%s)", async (action) => {
    const f = fixture();
    const activated = await f.activate();
    const before = f.calls.length;
    expect((await f.activate(activated.recoveryDir)).status).toBe("healthy");
    expect(f.calls.slice(before).every(({ args }) => args[0] === "-p")).toBe(true);
    f.failures.push("health");
    await expect(f.activate(activated.recoveryDir, "rollback")).rejects.toThrow("Rollback failed");
    expect(readFileSync(f.target.plistPath)).toEqual(f.original);
    const failedService = readFileSync(join(activated.recoveryDir, "failed-service.plist"));
    const replayStart = f.calls.length;
    expect((await f.activate(activated.recoveryDir, action)).status).toBe("rolled-back");
    const replay = f.calls.slice(replayStart);
    const sandbox = replay.filter(({ args }) => args.includes("sandbox"));
    expect(sandbox).toHaveLength(2);
    expect(sandbox.every(({ command, args }) => command === f.desired.path && args[0] === join(activated.recoveryDir, "candidate/openclaw.mjs"))).toBe(true);
    expect(replay.find(({ args }) => args.includes("health"))?.command).toBe(f.expected.path);
    expect(readFileSync(join(activated.recoveryDir, "failed-service.plist"))).toEqual(failedService);
    expect(readFileSync(f.target.plistPath)).toEqual(f.original);
  });

  it("recovers failed activation after package restoration was interrupted without the archive", async () => {
    const f = fixture();
    f.failures.push("health", "restore-package");
    await expect(f.activate()).rejects.toThrow("Activation and rollback failed");
    rmSync(f.receipt.artifact.path);
    expect((await f.activate(f.recovery())).status).toBe("rolled-back");
    expect(readFileSync(f.target.plistPath)).toEqual(f.original);
    expect(f.calls.filter(({ args }) => args.includes("health")).at(-1)?.command).toBe(f.expected.path);
  });

  it("refuses changed retained interpreter identity on recovery before stopping", async () => {
    const f = fixture();
    const activated = await f.activate();
    writeFileSync(f.expected.path, "changed retained Node");
    f.events.length = 0;
    await expect(f.activate(activated.recoveryDir, "rollback")).rejects.toThrow("digest");
    expect(f.events).not.toContain("stop");
    expect(plist(f.target.plistPath).ProgramArguments[4]).toBe(f.desired.path);
  });

  it("binds an opt ancestor alias to its canonical binary and restores the exact literal service", async () => {
    const f = fixture(true, true, true, true);
    await systemOperations({ ...f.target, browser: undefined }, f.root, f.execute).preflight();
    expect(f.calls.find(({ args }) => args.includes("--version"))?.command).toBe(f.expected.realPath);
    const activated = await f.activate();
    const journal = JSON.parse(readFileSync(join(activated.recoveryDir, "recovery.json"), "utf8"));
    expect(journal.nodeMigration.expected.path).toBe(f.expected.path);
    expect(journal.nodeMigration.expected.realPath).toBe(f.expected.realPath);
    expect((await f.activate(activated.recoveryDir, "rollback")).status).toBe("rolled-back");
    expect(readFileSync(f.target.plistPath)).toEqual(f.original);
    expect(plist(f.target.plistPath).ProgramArguments[4]).toBe(f.expected.path);
    expect(realpathSync(f.expected.path)).toBe(f.expected.realPath);
    expect(f.calls.filter(({ args }) => args.includes("health")).at(-1)?.command).toBe(f.expected.realPath);
  });

  it.each(["unbound", "mismatch", "retarget-before-stop", "retarget-recovery"])("rejects %s old interpreter resolution without stopping", async (failure) => {
    const f = fixture(true, true, false, true);
    const other = join(f.root, "cellar/node-other");
    mkdirSync(join(other, "bin"), { recursive: true });
    cpSync(f.expected.realPath!, join(other, "bin/node"));
    const retarget = () => {
      rmSync(join(f.root, "opt/node"));
      symlinkSync(other, join(f.root, "opt/node"));
    };
    if (failure === "unbound") delete f.expected.realPath;
    if (failure === "mismatch") f.expected.realPath = join(other, "bin/node");
    if (failure === "retarget-before-stop") {
      const originalGet = f.metadata.get.bind(f.metadata);
      f.metadata.get = (path) => {
        const value = originalGet(path);
        if (path === f.desired.path) retarget();
        return value;
      };
    }
    let recovery: string | undefined;
    if (failure === "retarget-recovery") {
      recovery = (await f.activate()).recoveryDir;
      retarget();
      f.events.length = 0;
    }
    await expect(f.activate(recovery, recovery ? "rollback" : undefined)).rejects.toThrow();
    expect(f.events).not.toContain("stop");
    if (!recovery) expect(readFileSync(f.target.plistPath)).toEqual(f.original);
  });

  it("rejects an alias whose selected canonical old binary is inside a replaced runtime", async () => {
    const f = fixture(true, true, false, true);
    const realPath = join(f.target.installDir, "bin/node");
    mkdirSync(join(f.target.installDir, "bin"));
    cpSync(f.expected.realPath!, realPath);
    rmSync(join(f.root, "opt/node"));
    symlinkSync(f.target.installDir, join(f.root, "opt/node"));
    f.expected.realPath = realPath;
    await expect(f.activate()).rejects.toThrow("outside replaced runtime");
    expect(f.events).not.toContain("stop");
  });
});
