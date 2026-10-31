import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";
// @ts-expect-error Executable JS lifecycle helpers are tested at runtime.
import { cleanupFixtureResources, fixtureProcessGroup, stopFixtureProcess, trackFixtureProcess } from "../src/native-fixture-process.mjs";

const leader = { pid: 43210, uid: process.getuid!(), start: "synthetic original start" };
function fixture() {
  const child = Object.assign(new EventEmitter(), { pid: leader.pid, exitCode: null as number | null, signalCode: null });
  let members = [{ ...leader }];
  const signals: string[] = [];
  const close = () => { child.exitCode = 0; child.emit("close"); };
  return { child, signals, close, handle: { child, identity: { ...leader } },
    readGroup: () => members, readProcesses: () => members.map(row => ({ ...row, parentPid: row.pid === leader.pid ? 1 : leader.pid, group: leader.pid })), setMembers: (next: typeof members) => { members = next; } };
}

it("does not signal an exited group after graceful fixture shutdown", async () => {
  const f = fixture();
  await stopFixtureProcess(f.handle, { readGroup: f.readGroup, readProcesses: f.readProcesses, signal: (_pid: number, kind: string) => {
    f.signals.push(kind); f.setMembers([]); f.close();
  } });
  expect(f.signals).toEqual(["SIGTERM"]);
});

it("accepts macOS EPERM only when the verified group disappeared during signaling", async () => {
  const f = fixture();
  await stopFixtureProcess(f.handle, { readGroup: f.readGroup, readProcesses: f.readProcesses, signal: () => {
    f.setMembers([]); f.close(); throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
  } });
});

it("keeps permission failures for a group that still exists", async () => {
  const f = fixture();
  await expect(stopFixtureProcess(f.handle, { readGroup: f.readGroup, readProcesses: f.readProcesses, signal: () => {
    throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
  } })).rejects.toThrow("kill EPERM");
});

it("does not signal or wait on an exited, unreaped fixture process", () => {
  const helper = new URL("../src/native-fixture-process.mjs", import.meta.url).href;
  const probe = `
    import assert from 'node:assert/strict';
    import { fixtureProcessGroup, stopFixtureProcess } from ${JSON.stringify(helper)};
    const pid = Number(process.argv[1]);
    assert.deepEqual(fixtureProcessGroup(pid), []);
    await stopFixtureProcess({ child: { pid, exitCode: 0, signalCode: null },
      descendantIdentities: new Map([[pid, { pid, uid: process.getuid(), start: 'exited child' }]]) },
      { graceMs: 0, signal: () => { throw new Error('Signaled an exited fixture'); } });
  `;
  // Node reaps its own children automatically. Keep an actual zombie under a
  // small parent so the production ps parser sees it until the probe finishes.
  execFileSync(process.env.GMAIL_MCP_PYTHON ?? "python3", ["-c", `
import os, subprocess, sys, time
pid = os.fork()
if pid == 0:
    os.setsid()
    os._exit(0)
try:
    deadline = time.monotonic() + 2
    while True:
        state = subprocess.check_output(['ps', '-p', str(pid), '-o', 'stat='], text=True).strip()
        if state.startswith('Z'):
            break
        if time.monotonic() >= deadline:
            raise RuntimeError('Fixture child did not exit')
        time.sleep(.01)
    subprocess.run([sys.argv[1], '--input-type=module', '-e', sys.argv[2], str(pid)], check=True, timeout=5)
finally:
    os.waitpid(pid, 0)
`, process.execPath, probe], { timeout: 10000, stdio: "pipe" });
});

it("refuses a reused process group before escalation", async () => {
  const f = fixture();
  await expect(stopFixtureProcess(f.handle, { readGroup: f.readGroup, readProcesses: f.readProcesses, signal: (_pid: number, kind: string) => {
    f.signals.push(kind); f.setMembers([{ ...leader, start: "another process" }]); f.close();
  } })).rejects.toThrow("identity changed");
  expect(f.signals).toEqual(["SIGTERM"]);
});

it("still escalates for a verified surviving fixture descendant", async () => {
  const f = fixture(), descendant = { ...leader, pid: leader.pid + 1 };
  f.setMembers([{ ...leader }, descendant]);
  await stopFixtureProcess(f.handle, { readGroup: f.readGroup, readProcesses: f.readProcesses, signal: (_pid: number, kind: string) => {
    f.signals.push(kind);
    if (kind === "SIGTERM") { f.setMembers([descendant]); f.close(); }
    else f.setMembers([]);
  } });
  expect(f.signals).toEqual(["SIGTERM", "SIGKILL"]);
});

it("never signals a process group with another owner", async () => {
  const f = fixture(); f.setMembers([{ ...leader }, { ...leader, pid: leader.pid + 1, uid: leader.uid + 1 }]);
  await expect(stopFixtureProcess(f.handle, { readGroup: f.readGroup, readProcesses: f.readProcesses, signal: () => f.signals.push("bad") }))
    .rejects.toThrow("another owner");
  expect(f.signals).toEqual([]);
});

it.each(["alive", "reused"])("rejects a detached descendant that is %s after gateway exit", async mode => {
  const f = fixture();
  const descendant = { ...leader, pid: leader.pid + 1, parentPid: leader.pid, group: leader.pid + 1 };
  let rows = [{ ...leader, parentPid: 1, group: leader.pid }, descendant];
  const options = {
    readGroup: f.readGroup, readProcesses: () => rows, graceMs: 0,
    signal: () => {
      f.setMembers([]); f.close();
      rows = [{ ...descendant, parentPid: 1, ...(mode === "reused" ? { start: "another process" } : {}) }];
    },
  };
  const failure = mode === "reused" ? "descendant identity changed" : "descendants did not stop";
  await expect(stopFixtureProcess(f.handle, options)).rejects.toThrow(failure);
  await expect(stopFixtureProcess(f.handle, options)).rejects.toThrow(failure);
  rows = [];
  await stopFixtureProcess(f.handle, options);
});

it("waits for a detached fixture writer after the gateway leader closes", async () => {
  const root = mkdtempSync(join(tmpdir(), "fixture-detached-writer-"));
  const ready = join(root, "ready"), stop = join(root, "stop"), output = join(root, "last-write");
  const leaf = `const fs=require('node:fs'); fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
    const poll=setInterval(()=>{ if(fs.existsSync(${JSON.stringify(stop)})) {
      clearInterval(poll); setTimeout(()=>{fs.writeFileSync(${JSON.stringify(output)}, 'closed'); process.exit(0);},150);
    }},10);`;
  const parent = `const fs=require('node:fs'); const c=require('node:child_process').spawn(process.execPath,
    ['-e',${JSON.stringify(leaf)}],{detached:true,stdio:'ignore'}); c.unref();
    process.on('SIGTERM',()=>{fs.writeFileSync(${JSON.stringify(stop)}, 'stop');process.exit(0);});
    console.log(c.pid);
    setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ["-e", parent], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let leafPid: number | undefined;
  const handle = trackFixtureProcess(child);
  let leafIdentity: { pid: number; uid: number; start: string } | undefined;
  try {
    leafPid = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Fixture child PID was not published")), 2000);
      const finish = (error?: Error, pid?: number) => {
        clearTimeout(timer);
        error ? reject(error) : resolve(pid!);
      };
      child.stdout.once("data", data => finish(undefined, Number(String(data).trim())));
      child.once("error", error => finish(error));
      child.once("close", () => finish(new Error("Fixture parent closed before readiness")));
    });
    expect(Number.isSafeInteger(leafPid) && leafPid > 0).toBe(true);
    leafIdentity = trackFixtureProcess({ pid: leafPid }).identity;
    expect(leafIdentity).toBeDefined();
    const deadline = Date.now() + 2000;
    while (!existsSync(ready)) {
      if (Date.now() >= deadline) throw new Error("Detached fixture child did not become ready");
      await delay(10);
    }
    await stopFixtureProcess(handle);
    expect(child.exitCode).toBe(0);
    expect(existsSync(output)).toBe(true);
    expect(readFileSync(output, "utf8")).toBe("closed");
    expect(() => process.kill(leafPid!, 0)).toThrow();
  } finally {
    // This also handles startup failures before the leaf publishes readiness.
    await stopFixtureProcess(handle);
    if (leafIdentity) {
      const remaining = fixtureProcessGroup(leafIdentity.pid);
      if (remaining.length) {
        expect(remaining).toEqual([leafIdentity]);
        try { process.kill(leafIdentity.pid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
        const deadline = Date.now() + 2000;
        while (fixtureProcessGroup(leafIdentity.pid).length) {
          if (Date.now() >= deadline) throw new Error("Owned detached test child did not stop");
          await delay(10);
        }
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);

it("closes every provider server even when process shutdown and another cleanup fail", async () => {
  const servers = [createServer(), createServer()];
  await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  })));
  const stopError = new Error("stop failed"), providerError = new Error("provider failed");
  const result = cleanupFixtureResources([
    () => { throw stopError; },
    () => { throw providerError; },
    ...servers.map(server => () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))),
  ]);
  await expect(result).rejects.toMatchObject({ errors: [stopError, providerError] });
  await expect(result).rejects.toThrow("stop failed; Error: provider failed");
  expect(servers.every(server => !server.listening)).toBe(true);
});

it("captures and stops a real detached fixture process", async () => {
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>process.exit(0)); console.log('ready'); setInterval(()=>{},1000)"],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise<void>((resolve, reject) => { child.stdout.once("data", () => resolve()); child.once("error", reject); });
  try {
    const handle = trackFixtureProcess(child);
    await stopFixtureProcess(handle);
    expect(child.exitCode).toBe(0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
      child.kill("SIGKILL"); await closed;
    }
  }
}, 10000);
