import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir, hostname } from "node:os";
import { verifyBuildReceipt, verifyTargetProof } from "./native-release.mjs";
import { atomicJson, jsonDigest } from "./native-state.mjs";

export const coordinationPath = () => join(homedir(), ".puddles/deploy-coordination/slots.json");
const schema = "puddles.deployment-coordination/v1";
const environments = ["DEV", "TEST", "PROD"];
const timestamp = () => new Date().toISOString();
const nonempty = (value) => typeof value === "string" && value.length > 0;
const sha = (value) => /^[a-f0-9]{40}$/.test(value ?? "");
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function agent(value) {
  requireValue(value && nonempty(value.id) && nonempty(value.contact), "Agent id and routable contact are required");
  return value;
}
function canonical(path) {
  requireValue(isAbsolute(path ?? ""), "Coordination path must be absolute");
  requireValue(realpathSync(dirname(path)) === dirname(path), "Coordination parent must be canonical");
  if (existsSync(path)) requireValue(realpathSync(path) === path, "Coordination file must not be a link");
  return path;
}
export function processIdentity(pid = process.pid) {
  requireValue(Number.isSafeInteger(pid) && pid > 0, "Invalid process identity");
  try {
    const start = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8", timeout: 5000 }).trim();
    requireValue(start, "Process start identity is unavailable");
    return { pid, start, host: hostname() };
  } catch (error) {
    if (error.status === 1) return null;
    throw error;
  }
}
function stopped(identity) {
  requireValue(identity?.host === hostname(), "Inspect process ownership on the recorded host");
  const current = processIdentity(identity.pid);
  return !current || current.start !== identity.start;
}
export function readCoordination(path = coordinationPath()) {
  const state = JSON.parse(readFileSync(canonical(path), "utf8"));
  requireValue(state.schema === schema && state.host === hostname() && Number.isSafeInteger(state.generation) &&
    state.generation >= 0 && environments.every((name) => state.environments?.[name] &&
      Array.isArray(state.environments[name].queue)) && state.batches && Array.isArray(state.notifications),
  "Invalid coordination state; preserve it for recovery");
  return state;
}
function transaction(path, action, expectedGeneration) {
  canonical(path);
  const lock = `${path}.lock`;
  try { mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code === "EEXIST") {
      const busy = new Error("Coordination update is busy; retry after reading status");
      busy.code = "COORDINATION_BUSY";
      throw busy;
    }
    throw error;
  }
  try {
    atomicJson(join(lock, "owner.json"), processIdentity());
    const state = readCoordination(path);
    requireValue(expectedGeneration === undefined || state.generation === expectedGeneration, "Coordination generation changed");
    const result = action(state);
    state.generation++;
    state.updatedAt = timestamp();
    atomicJson(path, state);
    return result;
  } finally { rmSync(lock, { recursive: true }); }
}
export function initializeCoordination(path, targets) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  canonical(path);
  const lock = `${path}.lock`;
  mkdirSync(lock, { mode: 0o700 });
  try {
    atomicJson(join(lock, "owner.json"), processIdentity());
    requireValue(!existsSync(path), "Coordination is already initialized");
    requireValue(environments.every((name) => targets?.[name]?.host === hostname() &&
      Number.isSafeInteger(targets[name].port) && targets[name].port > 0), "Declare all three target hosts and ports");
    requireValue(new Set(environments.map((name) => targets[name].port)).size === 3, "Environment ports must be distinct");
    const state = { schema, host: hostname(), generation: 0, updatedAt: timestamp(),
      environments: Object.fromEntries(environments.map((name) => [name, { target: targets[name], owner: null, queue: [] }])),
      batches: {}, notifications: [], promotionHolds: {}, disqualified: {}, lastHealthy: null };
    atomicJson(path, state);
    return state;
  } finally { rmSync(lock, { recursive: true }); }
}
function slot(state, name) {
  requireValue(environments.includes(name), "Environment must be DEV, TEST, or PROD");
  return state.environments[name];
}
function owned(state, name, requestId, token) {
  const current = slot(state, name).owner;
  requireValue(current && current.requestId === requestId && current.token === token, "Deployment slot is owned by another request");
  return current;
}
function notice(state, recipient, kind, detail) {
  state.notifications.push({ id: randomUUID(), recipient: agent(recipient), kind, detail, createdAt: timestamp(), acknowledgedAt: null });
}
function batchOwned(state, id, actor, token) {
  const batch = state.batches[id];
  requireValue(batch && batch.owner.id === agent(actor).id && batch.token === token, "Only the registered batch owner may advance this batch");
  return batch;
}
function validateSources(sources) {
  requireValue(Array.isArray(sources) && sources.length > 0 && new Set(sources.map((source) => source.id)).size === sources.length,
    "Batch requires unique merged source repositories");
  for (const source of sources) {
    requireValue(nonempty(source.id) && sha(source.head) && sha(source.tree) && sha(source.base) &&
      Array.isArray(source.commits) && source.commits.every((commit) => sha(commit.sha) && agent(commit.agent)),
    "Batch requires merged heads, trees, bases, and commit owners");
  }
}

export function coordinate(path, operation, input) {
  // Validate potentially large retained artifacts before taking the metadata lock.
  let testedBuild;
  let targetProof;
  if (operation === "tested") {
    requireValue(nonempty(input.build) && nonempty(input.proof), "TEST requires retained build and target proof paths");
    testedBuild = verifyBuildReceipt(JSON.parse(readFileSync(input.build, "utf8")));
    targetProof = verifyTargetProof(JSON.parse(readFileSync(input.proof, "utf8")), testedBuild.buildId);
  }
  return transaction(path, (state) => {
    const now = timestamp();
    if (operation === "batch") {
      agent(input.agent); validateSources(input.sources);
      const id = jsonDigest(input.sources.map(({ id, head, tree }) => ({ id, head, tree })));
      if (state.batches[id]) {
        const existing = state.batches[id];
        notice(state, input.agent, "coordinate-with-batch-owner", { batchId: id, owner: existing.owner });
        return { ...existing, token: existing.owner.id === input.agent.id ? existing.token : undefined };
      }
      const batch = { id, owner: input.agent, token: randomUUID(), sources: input.sources, status: "selected",
        createdAt: now, updatedAt: now, attempts: [], buildId: null, proof: null, predecessor: input.predecessor ?? null,
        reverts: input.reverts ?? [], invalidatedBy: [] };
      if (batch.predecessor) {
        const previous = batchOwned(state, batch.predecessor, input.agent, input.previousToken);
        requireValue(previous.status === "failed" && nonempty(input.revertEvidence), "Retry needs a failed batch and recorded repair or revert evidence");
        previous.successor = id;
        previous.revertEvidence = input.revertEvidence;
      }
      for (const [bad, failure] of Object.entries(state.disqualified)) {
        const source = batch.sources.find((source) => source.id === failure.repository);
        if (!source?.commits.some((commit) => commit.sha === bad)) continue;
        const revert = batch.reverts.find((record) => record.commit === bad)?.revert ?? failure.revert;
        if (!sha(revert) || !source.commits.some((commit) => commit.sha === revert)) batch.invalidatedBy.push(bad);
      }
      for (const record of batch.reverts) {
        const failure = state.disqualified[record.commit];
        const source = batch.sources.find((source) => source.id === failure?.repository);
        requireValue(failure && sha(record.revert) && source?.commits.some((commit) => commit.sha === record.revert),
          "A correction must identify the merged revert in the new batch");
        const original = state.batches[failure.batchId].sources.flatMap((source) => source.commits).find((commit) => commit.sha === record.commit);
        notice(state, original.agent, "repair-reverted-change", { batchId: id, owner: input.agent,
          commit: record.commit, revert: record.revert, evidence: input.revertEvidence });
      }
      state.batches[id] = batch;
      const participants = new Map(input.sources.flatMap((source) => source.commits.map((commit) => [commit.agent.id, commit.agent])));
      for (const participant of participants.values()) notice(state, participant, "batch-owner", { batchId: id, owner: input.agent });
      return batch;
    }
    if (operation === "batch-fail") {
      const batch = batchOwned(state, input.batchId, input.agent, input.batchToken);
      requireValue(nonempty(input.evidence), "Failure evidence is required");
      batch.status = "failed"; batch.updatedAt = now;
      batch.attempts.push({ status: "failed", evidence: input.evidence, at: now, responsible: input.responsible ?? [] });
      state.promotionHolds[batch.id] = { owner: batch.owner, evidence: input.evidence, at: now };
      for (const responsible of input.responsible ?? []) {
        const source = batch.sources.find((source) => source.commits.some((commit) => commit.sha === responsible));
        const commit = source?.commits.find((commit) => commit.sha === responsible);
        requireValue(commit, "Responsible commit is not part of this batch");
        state.disqualified[responsible] = { repository: source.id, batchId: batch.id, evidence: input.evidence };
        for (const candidate of Object.values(state.batches)) {
          if (candidate.sources.some((source) => source.commits.some((commit) => commit.sha === responsible)) &&
              !candidate.invalidatedBy.includes(responsible)) candidate.invalidatedBy.push(responsible);
        }
        notice(state, commit.agent, "batch-regression", { batchId: batch.id, owner: batch.owner, commit: responsible, evidence: input.evidence,
          revert: input.revertEvidence ?? null });
      }
      return batch;
    }
    if (operation === "recover-batch") {
      const batch = batchOwned(state, input.batchId, input.previousAgent, input.batchToken);
      requireValue(nonempty(input.evidence), "Record contact and ownership inspection before batch recovery");
      requireValue(!environments.some((name) => state.environments[name].owner?.batchId === batch.id),
        "Recover or release the batch's active environment first");
      const previous = batch.owner;
      batch.owner = agent(input.agent); batch.token = randomUUID(); batch.recoveryEvidence = input.evidence;
      for (const name of environments) {
        const environment = slot(state, name);
        environment.queue = environment.queue.filter((ticket) => ticket.batchId !== batch.id);
      }
      notice(state, previous, "batch-owner-recovered", { batchId: batch.id, owner: batch.owner });
      return batch;
    }
    if (operation === "enqueue") {
      const environment = slot(state, input.environment);
      agent(input.agent);
      requireValue(nonempty(input.requestId) && nonempty(input.runId) && nonempty(input.worktree), "Request ID, run ID, and worktree are required");
      const previous = [environment.owner, ...environment.queue].find((ticket) => ticket?.requestId === input.requestId);
      if (previous) {
        requireValue(previous.agent.id === input.agent.id && previous.runId === input.runId, "Request ID already belongs to another run");
        return previous;
      }
      if (input.environment !== "DEV" && input.purpose !== "maintenance") {
        batchOwned(state, input.batchId, input.agent, input.batchToken);
      }
      const ticket = { requestId: input.requestId, token: randomUUID(), agent: input.agent, runId: input.runId,
        worktree: input.worktree, batchId: input.batchId ?? null, batchToken: input.batchToken ?? null, purpose: input.purpose ?? "deployment",
        queuedAt: now, ready: input.ready !== false, reason: input.reason ?? null, phase: "queued", process: null };
      environment.queue.push(ticket);
      return ticket;
    }
    if (["ready", "cancel"].includes(operation)) {
      const environment = slot(state, input.environment);
      const ticket = environment.queue.find((ticket) => ticket.requestId === input.requestId && ticket.token === input.token);
      requireValue(ticket, "Queued request ownership does not match");
      if (operation === "cancel") environment.queue = environment.queue.filter((item) => item !== ticket);
      else { ticket.ready = input.ready === true; ticket.reason = input.reason ?? null; }
      return ticket;
    }
    if (operation === "claim") {
      const environment = slot(state, input.environment);
      requireValue(!environment.owner, "Environment is in use");
      const ticket = environment.queue.find((ticket) => ticket.ready);
      requireValue(ticket && ticket.requestId === input.requestId && ticket.token === input.token, "Wait for the oldest ready request");
      requireValue(!environments.some((name) => state.environments[name].owner?.agent.id === ticket.agent.id), "Release the other environment before claiming this one");
      if (input.environment !== "DEV" && ticket.purpose !== "maintenance") batchOwned(state, ticket.batchId, ticket.agent, ticket.batchToken);
      if (input.environment === "PROD" && ticket.purpose !== "maintenance") {
        requireValue(Object.keys(state.promotionHolds).length === 0, "Production promotion is on hold");
        requireValue(state.batches[ticket.batchId]?.status === "tested", "Batch has not passed TEST");
        requireValue(!state.batches[ticket.batchId].invalidatedBy.length, "Batch contains a disqualified commit; select corrected main");
        requireValue(input.expectedHealthy === (state.lastHealthy?.transaction ?? null), "Production baseline changed; repeat affected TEST proof");
        const batch = state.batches[ticket.batchId];
        requireValue(batch.testBaseline === (state.lastHealthy?.transaction ?? null), "Production baseline changed since TEST; repeat TEST");
        for (const previous of state.lastHealthy?.sources ?? []) {
          const next = batch.sources.find((source) => source.id === previous.id);
          requireValue(next && (next.head === previous.head || next.base === previous.head ||
            next.commits.some((commit) => commit.sha === previous.head)), "Batch is superseded by newer production source");
        }
      }
      environment.queue = environment.queue.filter((item) => item !== ticket);
      environment.owner = { ...ticket, phase: "claimed", acquiredAt: now, heartbeatAt: now, progressAt: now,
        expectedCompletion: input.expectedCompletion ?? null, process: null,
        baseline: state.lastHealthy?.transaction ?? null };
      return environment.owner;
    }
    if (operation === "recover-owner") {
      const current = owned(state, input.environment, input.requestId, input.token);
      requireValue(!current.process || stopped(current.process), "Verify the recorded deployment process has stopped before recovery");
      requireValue(nonempty(input.evidence), "Recovery requires process-group and journal inspection evidence");
      agent(input.agent);
      current.previousOwner = current.agent; current.agent = input.agent; current.token = randomUUID();
      current.phase = "recovering"; current.process = null; current.recoveryEvidence = input.evidence;
      current.heartbeatAt = now;
      if (current.batchId) {
        const batch = state.batches[current.batchId];
        batch.owner = input.agent; batch.token = randomUUID();
        current.batchToken = batch.token;
        for (const name of environments) slot(state, name).queue = slot(state, name).queue.filter((ticket) => ticket.batchId !== batch.id);
        notice(state, current.previousOwner, "batch-owner-recovered", { batchId: batch.id, owner: input.agent });
      }
      return current;
    }
    if (operation === "ack") {
      const notification = state.notifications.find((item) => item.id === input.id && item.recipient.id === agent(input.agent).id);
      requireValue(notification, "Notification recipient does not match");
      notification.acknowledgedAt = now;
      return notification;
    }
    const current = owned(state, input.environment, input.requestId, input.token);
    if (operation === "bind-process") {
      requireValue(!current.process || stopped(current.process), "A deployment controller is already running");
      requireValue(input.process && processIdentity(input.process.pid)?.start === input.process.start && input.process.host === hostname(), "Controller process identity differs");
      current.process = input.process;
    } else if (operation === "heartbeat") {
      current.heartbeatAt = now;
      if (input.phase && input.phase !== current.phase) { current.phase = input.phase; current.progressAt = now; }
      if (input.expectedCompletion) current.expectedCompletion = input.expectedCompletion;
      if (input.recovery) current.recovery = input.recovery;
    } else if (operation === "tested") {
      requireValue(input.environment === "TEST" && testedBuild, "TEST requires a build identity and proof path");
      const batch = state.batches[current.batchId];
      requireValue(batch && batch.owner.id === current.agent.id, "Only the batch owner can publish TEST success");
      requireValue(!batch.invalidatedBy.length, "Batch contains a disqualified commit; select corrected main");
      assertBatchArtifact({ batch, environment: "TEST" }, testedBuild);
      batch.status = "tested"; batch.buildId = testedBuild.buildId; batch.proof = input.proof; batch.updatedAt = now;
      for (const record of Object.values(targetProof.deployment)) requireValue(
        record.coordination?.requestId === current.requestId && record.coordination?.baseline === current.baseline,
        "TEST proof belongs to a different attempt or production baseline; rerun physical rehearsal");
      batch.testBaseline = current.baseline;
      for (const record of batch.reverts) state.disqualified[record.commit].revert = record.revert;
      for (let predecessor = batch.predecessor; predecessor; predecessor = state.batches[predecessor]?.predecessor) {
        delete state.promotionHolds[predecessor];
      }
      delete state.promotionHolds[batch.id];
    } else if (operation === "release") {
      requireValue(nonempty(input.result) && nonempty(input.cleanupEvidence), "Record outcome and cleanup or recovery before releasing");
      requireValue(!current.process || stopped(current.process), "Deployment controller must stop before release");
      const environment = slot(state, input.environment);
      if (input.environment === "PROD" && input.result === "healthy" && current.batchId) {
        requireValue(nonempty(input.transaction), "Healthy production requires its transaction identity");
        const batch = state.batches[current.batchId];
        requireValue(batch.status === "tested", "Only a tested batch may become healthy production");
        batch.status = "deployed";
        state.lastHealthy = { batchId: batch.id, sources: batch.sources, buildId: batch.buildId, transaction: input.transaction, at: now };
      }
      environment.previous = { ...current, result: input.result, cleanupEvidence: input.cleanupEvidence, releasedAt: now };
      environment.owner = null;
      const next = environment.queue.find((ticket) => ticket.ready);
      if (next) notice(state, next.agent, "slot-available", { environment: input.environment, requestId: next.requestId, previousResult: input.result });
    } else throw new Error("Unknown coordination operation");
    return current;
  }, input.expectedGeneration);
}

export function recoverMetadataLock(path, expected) {
  const lock = `${canonical(path)}.lock`;
  // Keep concurrent reclaimers from deleting a replacement owner's lock.
  const recoveryLock = `${path}.recover`;
  mkdirSync(recoveryLock, { mode: 0o700 });
  try {
    const owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
    requireValue(jsonDigest(owner) === jsonDigest(expected) && stopped(owner), "Metadata lock owner is still running or changed");
    rmSync(lock, { recursive: true });
  } finally { rmSync(recoveryLock, { recursive: true }); }
}

// Installed targets share this host record. CI fixtures use different ports and
// never acquire deployment slots. A target cannot opt out by omitting metadata.
export function assertDeploymentOwnership(target, expectedEnvironment, env = process.env) {
  const path = target.coordination?.path ?? env.PUDDLES_DEPLOY_COORDINATION ?? coordinationPath();
  if (!existsSync(path) && !target.coordination) return null;
  const state = readCoordination(path);
  const entry = Object.entries(state.environments).find(([, value]) => value.target.host === target.host && value.target.port === target.port);
  if (!entry && !target.coordination) return null;
  requireValue(entry && entry[0] === expectedEnvironment, "Target differs from its registered deployment environment");
  const current = owned(state, expectedEnvironment, env.PUDDLES_DEPLOY_REQUEST_ID, env.PUDDLES_DEPLOY_TOKEN);
  requireValue(current.process && !stopped(current.process), "Run the operation under the deployment controller");
  if (expectedEnvironment === "PROD" && current.purpose !== "maintenance" && current.phase !== "recovering") {
    requireValue(Object.keys(state.promotionHolds).length === 0, "Production promotion is on hold");
    requireValue(state.batches[current.batchId]?.status === "tested", "Production requires the tested batch");
    requireValue(!state.batches[current.batchId].invalidatedBy.length, "Batch contains a disqualified commit");
  }
  return { path, environment: expectedEnvironment, owner: current, batch: state.batches[current.batchId] ?? null };
}

export function assertBatchArtifact(ownership, receipt) {
  if (!ownership?.batch) return;
  const repositories = receipt.sourceRepositories ?? [{ id: "public", ...receipt.repository }];
  for (const source of ownership.batch.sources) {
    const actual = repositories.find(({ id }) => id === source.id);
    requireValue(actual && actual.head === source.head && actual.tree === source.tree,
      "Artifact does not belong to the selected merged batch");
  }
  if (ownership.environment === "PROD") requireValue(ownership.batch.buildId === receipt.buildId,
    "Production artifact differs from the successful TEST batch");
}
