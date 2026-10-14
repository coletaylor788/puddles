import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export function fixtureProcessGroup(pid) {
  return execFileSync("ps", ["-axo", "pid=,pgid=,uid=,lstart="], {
    encoding: "utf8", timeout: 5000,
  }).split("\n").flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    return match && Number(match[2]) === pid
      ? [{ pid: Number(match[1]), uid: Number(match[3]), start: match[4] }] : [];
  });
}

export function trackFixtureProcess(child) {
  const identity = child.pid && fixtureProcessGroup(child.pid).find(row => row.pid === child.pid);
  return { child, identity };
}

export async function stopFixtureProcess({ child, identity }, {
  readGroup = fixtureProcessGroup, signal = process.kill.bind(process), graceMs = 5000,
} = {}) {
  if (!child?.pid) return;
  const members = readGroup(child.pid);
  if (!members.length) return;
  assert.ok(identity, "Fixture process identity was not captured");
  assert.deepEqual(members.find(row => row.pid === child.pid), identity,
    "Fixture process group no longer has its owned leader");
  assert.ok(members.every(row => row.uid === process.getuid()), "Fixture process group has another owner");
  const owned = new Map(members.map(row => [row.pid, row]));
  const currentOwned = () => {
    const current = readGroup(child.pid);
    for (const row of current) assert.deepEqual(row, owned.get(row.pid), "Fixture process group identity changed");
    return current;
  };
  const send = kind => {
    if (!currentOwned().length) return;
    try { signal(-child.pid, kind); }
    catch (error) {
      // A group can disappear between inspection and signaling on macOS.
      // Permission errors for a group that still exists remain failures.
      if (!["ESRCH", "EPERM"].includes(error.code) || currentOwned().length) throw error;
    }
  };
  const closed = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve() : new Promise(resolve => child.once("close", resolve));
  send("SIGTERM");
  let timer;
  await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, graceMs); })]);
  clearTimeout(timer);
  // Never send a second signal to an exited or reused process group.
  send("SIGKILL");
  await closed;
}

export async function cleanupFixtureResources(actions) {
  const errors = [];
  for (const action of actions) {
    try { await action(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Native fixture resource cleanup failed");
}
