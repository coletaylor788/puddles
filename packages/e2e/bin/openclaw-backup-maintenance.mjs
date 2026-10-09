#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, openSync, closeSync, readFileSync, realpathSync, readdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicJson, fileDigest, jsonDigest } from "../src/native-state.mjs";
import { readCoordination } from "../src/deploy-coordination.mjs";
import { retryCoordinate } from "./openclaw-deployment-slot.mjs";

const read = path => JSON.parse(readFileSync(path, "utf8"));
const bin = dirname(fileURLToPath(import.meta.url));

export function maintenanceInputs(root, policy) {
  const latest = read(join(root, "latest-activation.json"));
  const context = read(join(root, "retention-context.json"));
  if (context.schemaVersion !== 1 || context.transaction !== latest.transaction ||
      (typeof context.target?.backupRoot !== "string" || realpathSync(context.target.backupRoot) !== realpathSync(root)) || context.target.purpose !== "production") {
    throw new Error("Current release has no matching retention context");
  }
  return { target: context.target, policy: { ...policy, replacement: { kind: "activation", receipt: context.receipt } } };
}

// Only an unchanged, plan-free preflight can be released after a failed child.
// The controller must independently attest that its entire child group joined.
function retentionState(root) {
  if (existsSync(join(root, "lock")) || existsSync(join(root, "retention-plan.json")) ||
      readdirSync(root).some(name => name.startsWith(".retiring-"))) return null;
  return readdirSync(root).filter(name => /^retention-activation-.*\.json$/.test(name))
    .sort().map(name => [name, fileDigest(join(root, name))]);
}

export async function maintain(config, dependencies = {}) {
  const coordinate = dependencies.coordinate ?? retryCoordinate;
  const status = dependencies.status ?? readCoordination;
  const execute = dependencies.execute ?? runController;
  const timeoutMs = config.timeoutMs ?? 60 * 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 4 * 60 * 60_000) throw new Error("Maintenance timeout is invalid");
  const root = realpathSync(config.backupRoot);
  const work = realpathSync(config.workDir);
  const state = status(config.coordination);
  if (state.environments.PROD.owner || state.environments.PROD.queue.length) return { status: "busy" };
  const inputs = maintenanceInputs(root, read(config.policy));
  const requestId = `backup-retention:${randomUUID()}`;
  const ticket = await coordinate(config.coordination, "enqueue", {
    environment: "PROD", requestId, runId: requestId, agent: config.agent,
    worktree: work, purpose: "maintenance", ready: true,
  });
  const lease = { environment: "PROD", requestId, token: ticket.token };
  try { await coordinate(config.coordination, "claim", lease); }
  catch (error) {
    await coordinate(config.coordination, "cancel", lease);
    throw error;
  }
  const leasePath = join(work, "lease.json");
  const targetPath = join(work, "target.json");
  const policyPath = join(work, "policy.json");
  const log = join(work, "last-run.log");
  const evidence = join(work, "last-result.json");
  const joinedEvidence = join(work, "controller-joined.json");
  let before = null;
  let controllerStarted = false;
  try {
    before = retentionState(root);
    atomicJson(leasePath, lease);
    atomicJson(targetPath, inputs.target);
    atomicJson(policyPath, inputs.policy);
    rmSync(joinedEvidence, { force: true });
    controllerStarted = true;
    await execute(process.execPath, [join(bin, "openclaw-deployment-slot.mjs"), "run", leasePath,
      config.coordination, process.execPath, join(bin, "openclaw-backup-retention.mjs"), "run", targetPath, policyPath], log, timeoutMs, joinedEvidence);
    // The controller has exited after joining its child group. A leftover
    // backup lock cannot be assumed to belong to this process.
    if (existsSync(join(root, "lock"))) throw new Error("Backup lock remains; retain maintenance ownership for inspection");
    atomicJson(evidence, { status: "passed", transaction: inputs.target && read(join(root, "latest-activation.json")).transaction, finishedAt: new Date().toISOString() });
    atomicJson(join(root, "retention-health.json"), read(evidence));
    await coordinate(config.coordination, "release", { ...lease, result: "passed", cleanupEvidence: evidence });
    return read(evidence);
  } catch (error) {
    let readOnlyFailure = false;
    try {
      const joined = read(joinedEvidence);
      const after = retentionState(root);
      readOnlyFailure = controllerStarted && joined.schemaVersion === 1 && joined.requestId === requestId &&
        joined.joined === true && Number.isSafeInteger(joined.controllerPid) && joined.controllerPid > 0 &&
        before !== null && after !== null && jsonDigest(before) === jsonDigest(after);
    } catch { /* Missing or unreadable evidence retains ownership. */ }
    const result = { status: readOnlyFailure ? "blocked" : "failed", message: error.message,
      readOnlyFailure, leaseRetained: controllerStarted && !readOnlyFailure, finishedAt: new Date().toISOString() };
    atomicJson(evidence, result);
    atomicJson(join(root, "retention-health.json"), result);
    if (!controllerStarted || readOnlyFailure) await coordinate(config.coordination, "release", {
      ...lease, result: readOnlyFailure ? "blocked-read-only" : "failed-before-start", cleanupEvidence: evidence });
    // A failed or killed controller needs explicit inspection and recovery.
    // Never make an unattended timer steal or clear a production lock.
    throw error;
  }
}

async function runController(command, args, log, timeoutMs, joinedEvidence) {
  const fd = openSync(log, "w", 0o600);
  const child = spawn(command, args, { stdio: ["ignore", fd, fd],
    env: { ...process.env, PUDDLES_DEPLOY_JOIN_EVIDENCE: joinedEvidence } });
  closeSync(fd);
  let timedOut = false;
  let escalation;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    escalation = setTimeout(() => child.kill("SIGKILL"), 15_000);
  }, timeoutMs);
  const handlers = ["SIGTERM", "SIGINT", "SIGHUP"].map(signal => [signal, () => child.kill(signal)]);
  handlers.forEach(([name, fn]) => process.on(name, fn));
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (timedOut) throw new Error(`Backup maintenance timed out; inspect ${log}`);
    if (code !== 0) throw new Error(`Backup maintenance controller failed (${code}); inspect ${log}`);
  } finally { clearTimeout(timeout); clearTimeout(escalation); handlers.forEach(([name, fn]) => process.removeListener(name, fn)); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: openclaw-backup-maintenance.mjs CONFIG_JSON");
    console.log(JSON.stringify(await maintain(read(process.argv[2]))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
