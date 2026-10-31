import { spawnOwnedProcess } from "../../release/src/owned-process.mjs";
export const spawnFixtureProcess = spawnOwnedProcess;
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

function fixtureProcesses() {
  return execFileSync("ps", ["-axo", "pid=,ppid=,pgid=,uid=,stat=,lstart="], {
    encoding: "utf8", timeout: 5000,
  }).split("\n").flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    // Exited children awaiting reaping cannot write or receive signals. macOS
    // returns EPERM for a group containing only these zombies.
    return match && !match[5].startsWith("Z") ? [{ pid: Number(match[1]), parentPid: Number(match[2]), group: Number(match[3]),
      uid: Number(match[4]), start: match[6] }] : [];
  });
}

const processIdentity = ({ pid, uid, start }) => ({ pid, uid, start });

export function fixtureProcessGroup(pid) {
  return fixtureProcesses().filter(row => row.group === pid).map(processIdentity);
}

export function trackFixtureProcess(child) {
  const identity = child.pid && fixtureProcessGroup(child.pid).find(row => row.pid === child.pid);
  return { child, identity };
}

async function waitForFixtureDescendants(identities, readProcesses, graceMs) {
  if (!identities) return;
  const deadline = Date.now() + graceMs;
  for (;;) {
    const remaining = readProcesses().filter(row => identities.has(row.pid));
    for (const row of remaining) assert.deepEqual(processIdentity(row), identities.get(row.pid),
      "Fixture descendant identity changed");
    if (!remaining.length) return;
    assert.ok(Date.now() < deadline, "Fixture descendants did not stop before cleanup");
    await delay(25);
  }
}

export async function stopFixtureProcess(handle, {
  readGroup = fixtureProcessGroup, readProcesses = fixtureProcesses,
  signal = process.kill.bind(process), graceMs = 5000,
} = {}) {
  const { child, identity } = handle;
  if (!child?.pid) return;
  const members = readGroup(child.pid);
  if (!members.length) return await waitForFixtureDescendants(handle.descendantIdentities, readProcesses, graceMs);
  assert.ok(identity, "Fixture process identity was not captured");
  assert.deepEqual(members.find(row => row.pid === child.pid), identity,
    "Fixture process group no longer has its owned leader");
  assert.ok(members.every(row => row.uid === process.getuid()), "Fixture process group has another owner");
  // Native harness children may detach into their own groups. Capture them
  // before gateway exit reparents them, then wait without signaling those groups.
  const snapshot = readProcesses();
  assert.deepEqual(processIdentity(snapshot.find(row => row.pid === child.pid) ?? {}), identity,
    "Fixture process identity changed before descendant capture");
  const descendants = new Set([child.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of snapshot) {
      if ((descendants.has(row.parentPid) || row.group === child.pid) && !descendants.has(row.pid)) {
        descendants.add(row.pid); changed = true;
      }
    }
  }
  const descendantIdentities = new Map(snapshot.filter(row => descendants.has(row.pid))
    .map(row => [row.pid, processIdentity(row)]));
  assert.ok([...descendantIdentities.values()].every(row => row.uid === process.getuid()),
    "Fixture descendant has another owner");
  handle.descendantIdentities = descendantIdentities;
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
  await waitForFixtureDescendants(descendantIdentities, readProcesses, graceMs);
}

export async function cleanupFixtureResources(actions) {
  const errors = [];
  for (const action of actions) {
    try { await action(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors,
    `Native fixture resource cleanup failed: ${errors.map(String).join("; ")}`);
}
