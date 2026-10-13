#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const PREDECESSOR_IDENTITY_SCHEMA = "puddles.openclaw-predecessor-process-groups/v1";

function predecessorProcessStartTime(pid) {
  if (process.platform === "darwin") {
    try {
      const startedAt = execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(pid)], {
        encoding: "utf8",
        env: { LC_ALL: "C", TZ: "UTC" },
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1000,
        killSignal: "SIGKILL",
      }).trim();
      const startedAtMs = Date.parse(`${startedAt} UTC`);
      return Number.isFinite(startedAtMs) ? Math.floor(startedAtMs / 1000) : null;
    } catch {
      return null;
    }
  }
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const commEndIndex = stat.lastIndexOf(")");
      if (commEndIndex < 0) return null;
      const startTime = Number(stat.slice(commEndIndex + 1).trimStart().split(/\s+/)[19]);
      return Number.isInteger(startTime) && startTime >= 0 ? startTime : null;
    } catch {
      return null;
    }
  }
  return null;
}

function processRows() {
  try {
    return execFileSync("/bin/ps", ["-axo", "pid=,ppid=,pgid="], {
      encoding: "utf8",
      env: { LC_ALL: "C" },
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
      killSignal: "SIGKILL",
    }).trim().split("\n").map((line) => {
      const [pid, parentPid, processGroupId] = line.trim().split(/\s+/).map(Number);
      return { pid, parentPid, processGroupId };
    }).filter(({ pid, parentPid, processGroupId }) =>
      Number.isSafeInteger(pid) && pid > 0 &&
      Number.isSafeInteger(parentPid) && parentPid >= 0 &&
      Number.isSafeInteger(processGroupId) && processGroupId > 0);
  } catch {
    throw new Error("Cannot inspect predecessor gateway process groups");
  }
}

function capturePredecessorIdentity(pid) {
  const startTime = predecessorProcessStartTime(pid);
  if (startTime === null) throw new Error("Cannot establish gateway process identity");
  const rows = processRows();
  const descendants = new Set([pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (descendants.has(row.parentPid) && !descendants.has(row.pid)) {
        descendants.add(row.pid);
        changed = true;
      }
    }
  }
  const processGroups = [...new Set(rows
    .filter((row) => descendants.has(row.pid) && descendants.has(row.processGroupId))
    .map((row) => row.processGroupId))]
    .sort((left, right) => left - right)
    .map((groupPid) => {
      const groupStartTime = predecessorProcessStartTime(groupPid);
      if (groupStartTime === null) throw new Error("Cannot establish gateway process group identity");
      return { pid: groupPid, startTime: groupStartTime };
    });
  if (processGroups.length === 0) throw new Error("Cannot establish gateway process group ownership");
  return { schema: PREDECESSOR_IDENTITY_SCHEMA, pid, startTime, processGroups };
}

function validatePredecessorIdentity(owner) {
  if (owner.schema !== PREDECESSOR_IDENTITY_SCHEMA ||
      !Array.isArray(owner.processGroups) || owner.processGroups.length === 0 ||
      owner.processGroups.some((group) => !Number.isSafeInteger(group?.pid) || group.pid <= 0 ||
        !Number.isFinite(group.startTime))) {
    throw new Error("Invalid predecessor gateway process identity");
  }
}

async function joinPredecessorIdentity(owner, timeoutMs) {
  validatePredecessorIdentity(owner);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const rows = processRows();
    const activeGroups = new Set(rows.map((row) => row.processGroupId));
    let active = predecessorProcessStartTime(owner.pid) === owner.startTime;
    for (const group of owner.processGroups) {
      if (!activeGroups.has(group.pid)) continue;
      const current = predecessorProcessStartTime(group.pid);
      if (current !== null && current !== group.startTime) {
        throw new Error("Predecessor gateway process group identity changed");
      }
      active = true;
    }
    if (!active) return;
    if (Date.now() >= deadline) {
      throw new Error("Predecessor gateway process groups did not exit before deadline");
    }
    await delay(100);
  }
}

const [phase, runtime, value, identity] = process.argv.slice(2);
if (!["capture", "join"].includes(phase) || !runtime || !value) {
  throw new Error("Expected capture <runtime> <pid> or join <runtime> <state> <identity>");
}
const require = createRequire(join(resolve(runtime), "package.json"));
const api = await import(pathToFileURL(require.resolve("openclaw/plugin-sdk/process-runtime")).href);
const hasIdentityApi = typeof api.requireServiceProcessIdentity === "function";
const hasJoinApi = typeof api.stopGatewayAndJoinLocalServices === "function";
if (hasIdentityApi !== hasJoinApi) throw new Error("Installed runtime has an incomplete stopped service API");
if (phase === "capture") {
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid gateway PID");
  const owner = hasIdentityApi
    ? api.requireServiceProcessIdentity(pid)
    : capturePredecessorIdentity(pid);
  if (!Number.isSafeInteger(owner?.pid) || owner.pid !== pid || !Number.isFinite(owner.startTime)) {
    throw new Error("Cannot establish gateway process identity");
  }
  process.stdout.write(JSON.stringify(owner));
} else {
  const owner = JSON.parse(identity ?? "null");
  if (owner !== null && (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
      !Number.isFinite(owner.startTime))) throw new Error("Invalid gateway process identity");
  if (hasJoinApi) {
    await api.stopGatewayAndJoinLocalServices(resolve(value), owner, 30_000);
  } else if (owner !== null) {
    await joinPredecessorIdentity(owner, 30_000);
  }
}
