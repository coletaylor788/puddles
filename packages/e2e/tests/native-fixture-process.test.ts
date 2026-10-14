import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";
// @ts-expect-error Executable JS lifecycle helpers are tested at runtime.
import { cleanupFixtureResources, stopFixtureProcess, trackFixtureProcess } from "../src/native-fixture-process.mjs";

const leader = { pid: 43210, uid: process.getuid!(), start: "synthetic original start" };
function fixture() {
  const child = Object.assign(new EventEmitter(), { pid: leader.pid, exitCode: null as number | null, signalCode: null });
  let members = [{ ...leader }];
  const signals: string[] = [];
  const close = () => { child.exitCode = 0; child.emit("close"); };
  return { child, signals, close, handle: { child, identity: { ...leader } },
    readGroup: () => members, setMembers: (next: typeof members) => { members = next; } };
}

it("does not signal an exited group after graceful fixture shutdown", async () => {
  const f = fixture();
  await stopFixtureProcess(f.handle, { readGroup: f.readGroup, signal: (_pid: number, kind: string) => {
    f.signals.push(kind); f.setMembers([]); f.close();
  } });
  expect(f.signals).toEqual(["SIGTERM"]);
});

it("accepts macOS EPERM only when the verified group disappeared during signaling", async () => {
  const f = fixture();
  await stopFixtureProcess(f.handle, { readGroup: f.readGroup, signal: () => {
    f.setMembers([]); f.close(); throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
  } });
});

it("keeps permission failures for a group that still exists", async () => {
  const f = fixture();
  await expect(stopFixtureProcess(f.handle, { readGroup: f.readGroup, signal: () => {
    throw Object.assign(new Error("kill EPERM"), { code: "EPERM" });
  } })).rejects.toThrow("kill EPERM");
});

it("refuses a reused process group before escalation", async () => {
  const f = fixture();
  await expect(stopFixtureProcess(f.handle, { readGroup: f.readGroup, signal: (_pid: number, kind: string) => {
    f.signals.push(kind); f.setMembers([{ ...leader, start: "another process" }]); f.close();
  } })).rejects.toThrow("identity changed");
  expect(f.signals).toEqual(["SIGTERM"]);
});

it("still escalates for a verified surviving fixture descendant", async () => {
  const f = fixture(), descendant = { ...leader, pid: leader.pid + 1 };
  f.setMembers([{ ...leader }, descendant]);
  await stopFixtureProcess(f.handle, { readGroup: f.readGroup, signal: (_pid: number, kind: string) => {
    f.signals.push(kind);
    if (kind === "SIGTERM") { f.setMembers([descendant]); f.close(); }
    else f.setMembers([]);
  } });
  expect(f.signals).toEqual(["SIGTERM", "SIGKILL"]);
});

it("never signals a process group with another owner", async () => {
  const f = fixture(); f.setMembers([{ ...leader }, { ...leader, pid: leader.pid + 1, uid: leader.uid + 1 }]);
  await expect(stopFixtureProcess(f.handle, { readGroup: f.readGroup, signal: () => f.signals.push("bad") }))
    .rejects.toThrow("another owner");
  expect(f.signals).toEqual([]);
});

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
