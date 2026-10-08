import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { acquireLock, atomicJson, inside, jsonDigest } from "./native-state.mjs";
import { coordinate, readCoordination, assertBatchArtifact } from "./deploy-coordination.mjs";
import { verifyBuildReceipt, verifySourceGate } from "./native-release.mjs";
import { initializeDevelopmentTask, completeDevelopmentTask } from "./native-task-storage.mjs";
import { runCommand, stopActiveCommand } from "./process-runner.mjs";

const read = path => JSON.parse(readFileSync(path, "utf8"));
const environments = ["DEV", "TEST", "PROD"];
const slotCommand = fileURLToPath(new URL("../bin/openclaw-deployment-slot.mjs", import.meta.url));

export function planApproval(path) {
  const text = readFileSync(path, "utf8");
  const human = text.split(/^## Human section\s*$/m)[1]?.split(/^## /m)[0];
  const status = human?.split(/^### Status\s*$/m)[1]?.split(/^### /m)[0];
  const approvals = [...(status ?? "").matchAll(/^\*\*Approval:\*\* (Proposed|DEV approved|Production approved)\s*$/gm)];
  const references = [...(status ?? "").matchAll(/^\*\*Approval reference:\*\* (\S[^\r\n]*)$/gm)];
  if (approvals.length !== 1 || references.length !== 1) throw new Error("Plan Status requires one approval and its requester reference");
  return { level: approvals[0][1], reference: references[0][1] };
}

function validate(config) {
  if (config.schemaVersion !== 1 || !config.runId || !config.agent?.id || !config.agent.contact ||
      !config.task?.owner || !config.batch?.id || !config.batch.token) throw new Error("Release progression requires its run, owner, task, and registered batch");
  for (const path of [config.plan, config.coordination, config.directory, config.worktree,
    config.task.root, config.candidate?.build, config.candidate?.sourceGate]) {
    if (!isAbsolute(path ?? "")) throw new Error("Controller paths must be absolute");
  }
  if (inside(config.task.root, config.directory) || inside(config.directory, config.task.root)) {
    throw new Error("Controller journal must be separate from disposable task storage");
  }
  if (!Array.isArray(config.stages) || ![1, 3].includes(config.stages.length) ||
      config.stages.some((stage, i) => stage.environment !== environments[i])) {
    throw new Error("Release stages must be DEV or DEV, TEST, PROD in order");
  }
  for (const stage of config.stages) {
    for (const name of ["execute", "verify", "recover", "cleanup", "verifyCleanup", ...(stage.prepare ? ["prepare"] : [])]) {
      const command = stage[name];
      if (!command || !isAbsolute(command.command ?? "") || !isAbsolute(command.cwd ?? "") ||
          !Array.isArray(command.args) || command.args.some(arg => typeof arg !== "string") ||
          !Number.isSafeInteger(command.timeoutMs) || command.timeoutMs <= 0 || command.timeoutMs > 6 * 60 * 60_000) {
        throw new Error(`Invalid bounded ${stage.environment} ${name} command`);
      }
    }
    if (stage.environment === "TEST" && !isAbsolute(stage.proof ?? "")) throw new Error("TEST requires its target proof");
    if (stage.environment === "PROD" && !isAbsolute(stage.recoveryJournal ?? "")) throw new Error("PROD requires its activation journal");
  }
}

// The descriptor selects reviewed existing producers, verifiers, and cleanup
// commands. It is local configuration, not an executable plan scraped from text.
export async function progressRelease(config, { execute = runCommand, wait = delay } = {}) {
  validate(config);
  const initialApproval = planApproval(config.plan);
  if (initialApproval.level === "Proposed" && !existsSync(join(config.directory, "progress.json"))) {
    throw new Error("Plan does not approve implementation");
  }
  mkdirSync(config.directory, { recursive: true, mode: 0o700 });
  if (realpathSync(config.directory) !== config.directory) throw new Error("Controller directory must be canonical");
  const unlock = acquireLock(config.directory);
  const statePath = join(config.directory, "progress.json");
  const key = jsonDigest(config);
  let state;
  let interrupted = false;
  const stop = () => { interrupted = true; void stopActiveCommand("SIGTERM", 25_000); };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, stop);
  const save = () => atomicJson(statePath, state);
  const update = async (operation, input) => {
    for (let attempt = 0; ; attempt++) {
      try { return coordinate(config.coordination, operation, input); }
      catch (error) {
        if (error.code !== "COORDINATION_BUSY" || attempt >= 19) throw error;
        await wait(100);
      }
    }
  };
  const candidate = () => {
    const build = verifyBuildReceipt(read(config.candidate.build));
    verifySourceGate(read(config.candidate.sourceGate), build.buildId);
    const batch = readCoordination(config.coordination).batches[config.batch.id];
    if (!batch || batch.owner.id !== config.agent.id || batch.token !== config.batch.token) throw new Error("Batch ownership changed");
    assertBatchArtifact({ batch, environment: "DEV" }, build);
    if (state.buildId && state.buildId !== build.buildId) throw new Error("Pinned candidate changed; start a replacement run at DEV");
    state.buildId = build.buildId;
    save();
    return build;
  };
  const cancelWaiting = async record => {
    const slot = readCoordination(config.coordination).environments[record.environment];
    if (slot.owner?.requestId === record.lease.requestId && slot.owner.token === record.lease.token) {
      record.phase = "running"; // Preserve acquired ownership for recovery.
    } else if (slot.queue.some(ticket => ticket.requestId === record.lease.requestId && ticket.token === record.lease.token)) {
      await update("cancel", record.lease);
      record.lease = null;
    }
    save();
  };
  const invoke = async (stage, record, name, leased = true) => {
    const command = stage[name];
    mkdirSync(join(config.task.root, "controller-logs"), { recursive: true, mode: 0o700 });
    const logPath = join(config.task.root, "controller-logs", `${stage.environment}-${name}.log`);
    const env = { ...process.env, ...command.env, PUDDLES_STORAGE_ROOT: config.task.root, PUDDLES_STORAGE_OWNER: config.task.owner };
    if (leased) {
      const leasePath = join(config.directory, `${stage.environment}-lease.json`);
      atomicJson(leasePath, record.lease);
      await execute(process.execPath, [slotCommand, "run", leasePath, config.coordination,
        command.command, ...command.args], { cwd: command.cwd, env, logPath, quiet: true, timeoutMs: command.timeoutMs, killGraceMs: 25_000 });
    } else {
      await execute(command.command, command.args, { cwd: command.cwd, env, logPath, quiet: true, timeoutMs: command.timeoutMs });
    }
  };
  const retire = async (stage, record, recovered = false) => {
    record.phase = recovered ? "recovering" : "cleaning"; save();
    if (recovered) {
      await update("heartbeat", { ...record.lease, phase: "recovering", recovery: statePath });
      if (readCoordination(config.coordination).batches[config.batch.id]?.status !== "failed") {
        await update("batch-fail", { batchId: config.batch.id, batchToken: config.batch.token,
          agent: config.agent, evidence: `${statePath}#${stage.environment}:recovery-required` });
      }
      await invoke(stage, record, "recover");
    }
    await invoke(stage, record, "cleanup");
    await invoke(stage, record, "verifyCleanup");
    record.result = recovered ? "recovered" : "healthy";
    record.phase = "releasing"; save();
    await release(stage, record);
  };
  const release = async (stage, record) => {
    const current = readCoordination(config.coordination).environments[stage.environment];
    if (current.owner?.requestId === record.lease.requestId) {
      await update("release", { ...record.lease, result: record.result, transaction: record.transaction,
        cleanupEvidence: `${statePath}#${stage.environment}:cleanup-and-verification-passed` });
    } else if (current.previous?.requestId !== record.lease.requestId || current.previous?.token !== record.lease.token) {
      throw new Error("Slot release has no matching terminal ownership evidence");
    }
    record.phase = record.result === "healthy" ? "passed" : "failed"; save();
  };
  try {
    state = existsSync(statePath) ? read(statePath) : { schemaVersion: 1, key, stages: [], status: "running" };
    if (state.key !== key) throw new Error("Controller inputs changed; use a replacement run");
    if (state.status === "completed") return state;
    if (state.status === "cleanup-pending") {
      completeDevelopmentTask(config.task.root, config.task.owner);
      state.status = "completed"; save(); return state;
    }
    initializeDevelopmentTask(config.task.root, config.task.owner, config.task);
    save();
    for (const [index, stage] of config.stages.entries()) {
      let record = state.stages[index];
      if (record?.phase === "queued" && record.lease) {
        const owner = readCoordination(config.coordination).environments[stage.environment].owner;
        if (owner?.requestId === record.lease.requestId && owner.token === record.lease.token) {
          record.phase = "running"; save();
        }
      }
      if (record?.phase === "releasing") await release(stage, record);
      if (record?.phase === "passed") continue;
      if (record?.phase === "failed") throw new Error("Recovered failed stage needs engineering review and a replacement run");
      // Any uncertain command is recovered before another deployment attempt.
      if (record?.lease && ["running", "verifying", "recovering", "cleaning"].includes(record.phase)) {
        await retire(stage, record, record.phase !== "cleaning");
        if (record.phase === "failed") throw new Error("Interrupted stage recovered; inspect before retrying");
        continue;
      }
      const approval = planApproval(config.plan);
      if (approval.level === "Proposed" || stage.environment !== "DEV" && approval.level !== "Production approved") {
        if (record?.phase === "queued" && record.lease) await cancelWaiting(record);
        state.status = "awaiting-approval"; save(); return state;
      }
      if (interrupted) throw new Error("Release progression interrupted");
      record ??= { environment: stage.environment, phase: "preparing", approval };
      state.stages[index] = record; state.status = "running"; save();
      if (record.phase === "preparing") {
        if (stage.prepare) await invoke(stage, record, "prepare", false);
        candidate();
        record.phase = "queued"; save();
      }
      const ticket = await update("enqueue", { environment: stage.environment,
        requestId: `${config.runId}:${stage.environment}`, agent: config.agent, runId: config.runId,
        worktree: config.worktree, batchId: config.batch.id, batchToken: config.batch.token, ready: true });
      record.lease = { environment: stage.environment, requestId: ticket.requestId, token: ticket.token }; save();
      while (true) {
        if (interrupted) throw new Error("Release progression interrupted while queued");
        const approved = planApproval(config.plan);
        if (approved.level === "Proposed" || stage.environment !== "DEV" && approved.level !== "Production approved") {
          await cancelWaiting(record);
          state.status = "awaiting-approval"; save(); return state;
        }
        const slots = readCoordination(config.coordination);
        const slot = slots.environments[stage.environment];
        if (slot.owner?.requestId === ticket.requestId && slot.owner.token === ticket.token) break;
        if (!slot.owner && slot.queue.find(item => item.ready)?.requestId === ticket.requestId) {
          candidate();
          await update("claim", { ...record.lease, expectedHealthy: slots.lastHealthy?.transaction ?? null });
          break;
        }
        await wait(1000);
      }
      record.phase = "running"; save();
      try {
        await invoke(stage, record, "execute");
        if (interrupted) throw new Error("Release interrupted");
        record.phase = "verifying"; save();
        await invoke(stage, record, "verify");
        const build = candidate();
        if (stage.environment === "TEST") await update("tested", { ...record.lease, build: config.candidate.build, proof: stage.proof });
        if (stage.environment === "PROD") {
          const journal = read(stage.recoveryJournal);
          const owner = readCoordination(config.coordination).environments.PROD.owner;
          if (journal.status !== "healthy" || journal.artifact !== build.artifact.sha256 || !journal.transaction ||
              journal.coordination?.requestId !== owner.requestId || journal.coordination?.attemptId !== owner.attemptId ||
              journal.coordination?.baseline !== owner.baseline) throw new Error("Production journal does not prove this candidate and attempt healthy");
          record.transaction = journal.transaction;
        }
      } catch (error) {
        await retire(stage, record, true);
        throw error;
      }
      await retire(stage, record);
    }
    state.status = "cleanup-pending"; save();
    completeDevelopmentTask(config.task.root, config.task.owner);
    state.status = "completed"; save(); return state;
  } catch (error) {
    // Waiting is disposable. A stopped waiter must not block the shared FIFO.
    // If claim already succeeded, preserve its lease for interrupted recovery.
    if (state?.key === key) {
      for (const record of state.stages.filter(record => record.phase === "queued" && record.lease)) {
        await cancelWaiting(record);
      }
    }
    throw error;
  } finally {
    for (const signal of signals) process.removeListener(signal, stop);
    unlock();
  }
}
