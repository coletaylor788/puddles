import { createRequire } from "node:module";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { digest, fileDigest, inside } from "./native-state.mjs";

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const prefix = (parent, child) => parent.length <= child.length && parent.every((part, index) => part === child[index]);
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
const hexDigest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function keys(value, allowed, required = allowed) {
  if (!record(value) || Object.keys(value).some((key) => !allowed.includes(key)) ||
      required.some((key) => !Object.hasOwn(value, key))) throw new Error("Invalid migration object fields");
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (record(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value).sort().map((key) => {
      if (forbidden.has(key)) throw new Error("Forbidden migration value key");
      return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
    }).join(",")}}`;
  }
  throw new Error("Migration values must be finite JSON");
}

export const canonicalValueDigest = (value) => digest(canonicalJson(value));

export function validateMigrationManifest(manifest) {
  keys(manifest, ["schemaVersion", "configOperations", "cronOperation"], ["schemaVersion", "configOperations"]);
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.configOperations) ||
      manifest.configOperations.length > 64 || (!manifest.configOperations.length && !manifest.cronOperation)) {
    throw new Error("Invalid migration version or operation count");
  }
  const paths = [];
  for (const operation of manifest.configOperations) {
    keys(operation, operation.kind === "set" ? ["kind", "path", "expected", "value"] : ["kind", "path", "expected"]);
    if (!["set", "unset"].includes(operation.kind) || !Array.isArray(operation.path) ||
        !operation.path.length || operation.path.length > 32 ||
        operation.path.some((part) => typeof part !== "string" || !part || forbidden.has(part) ||
          /^\d+$/.test(part) || /[\u0000-\u001f\u007f]/.test(part) || part === "$include") ||
        [["env"], ["cron", "store"]].some((reserved) => prefix(reserved, operation.path) || prefix(operation.path, reserved))) {
      throw new Error("Invalid or reserved migration config path");
    }
    if (paths.some((path) => prefix(path, operation.path) || prefix(operation.path, path))) {
      throw new Error("Overlapping migration config paths");
    }
    paths.push(operation.path);
    keys(operation.expected, operation.expected?.exists === true ? ["exists", "sha256"] : ["exists"]);
    if (typeof operation.expected.exists !== "boolean" ||
        operation.expected.exists && !hexDigest(operation.expected.sha256) ||
        operation.kind === "unset" && !operation.expected.exists) throw new Error("Invalid migration precondition");
    if (operation.kind === "set") canonicalJson(operation.value);
  }
  if (manifest.cronOperation !== undefined) {
    keys(manifest.cronOperation, ["kind", "jobId", "expectedRevision"]);
    const { kind, jobId, expectedRevision } = manifest.cronOperation;
    if (kind !== "silence-delivery" || typeof jobId !== "string" || !jobId || jobId.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(jobId) || !/^sha256:[A-Za-z0-9_-]{43}$/.test(expectedRevision)) {
      throw new Error("Invalid one-job migration");
    }
  }
  return manifest;
}

export function readMigrationManifest(path, sha256) {
  if (!isAbsolute(path) || !hexDigest(sha256)) throw new Error("Invalid migration manifest identity");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || realpathSync(path) !== path || stat.size > 256 * 1024) {
    throw new Error("Migration manifest must be a bounded canonical file");
  }
  const bytes = readFileSync(path);
  if (digest(bytes) !== sha256) throw new Error("Migration manifest digest changed");
  return validateMigrationManifest(JSON.parse(bytes.toString("utf8")));
}

function statePath(stateDir, path, required = false) {
  if (!inside(stateDir, resolve(path)) || resolve(path) === stateDir) throw new Error("Migration path escapes snapshotted state");
  let current = stateDir;
  for (const part of relative(stateDir, resolve(path)).split("/")) {
    current = join(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat) {
      if (required) throw new Error("Required migration state is missing");
      continue;
    }
    if (stat.isSymbolicLink() || stat.isFile() && stat.nlink !== 1 ||
        (!stat.isFile() && !stat.isDirectory())) throw new Error("Migration state must not traverse links or special files");
  }
  return resolve(path);
}

function configDraft(source, operations) {
  const draft = structuredClone(source);
  for (const operation of operations) {
    let parent = source;
    let missing = false;
    for (const part of operation.path.slice(0, -1)) {
      if (missing) break;
      if (!record(parent)) throw new Error("Migration config ancestor is not an object");
      if (!Object.hasOwn(parent, part)) missing = true;
      else parent = parent[part];
    }
    if (!missing && !record(parent)) throw new Error("Migration config ancestor is not an object");
    const leaf = operation.path.at(-1);
    const exists = !missing && Object.hasOwn(parent, leaf);
    if (exists !== operation.expected.exists || exists && canonicalValueDigest(parent[leaf]) !== operation.expected.sha256) {
      throw new Error("Migration config precondition changed");
    }
  }
  for (const operation of operations) {
    let parent = draft;
    for (const part of operation.path.slice(0, -1)) {
      if (!Object.hasOwn(parent, part)) parent[part] = {};
      parent = parent[part];
    }
    if (operation.kind === "set") parent[operation.path.at(-1)] = structuredClone(operation.value);
    else delete parent[operation.path.at(-1)];
  }
  return draft;
}

function configBoundary(snapshot, operations, stateDir, sdk) {
  const expectedPath = join(stateDir, "openclaw.json");
  if (!snapshot.exists || snapshot.path !== expectedPath || !record(snapshot.sourceConfig) || snapshot.readError ||
      snapshot.raw === null || !record(snapshot.parsed)) throw new Error("Migration config snapshot is unavailable");
  const paths = [expectedPath, ...(snapshot.includedPaths ?? [])];
  for (const path of paths) {
    statePath(stateDir, path, true);
    if (!lstatSync(path).isFile()) throw new Error("Migration config must be a regular file");
    for (const suffix of [".bak", ".bak.1", ".bak.2", ".bak.3", ".bak.4", ".pre-update", ".lock"]) {
      statePath(stateDir, `${path}${suffix}`);
    }
  }
  const provenance = snapshot.includeProvenance ?? [];
  if (provenance.some((entry) => !entry.path.length || entry.kind !== "single" || entry.hasSiblingOverrides ||
      entry.hasArrayAncestor || !entry.targetPath)) throw new Error("Unsupported migration include ownership");
  if (operations.length && provenance.length) {
    const boundary = sdk.resolveIncludeWriteBoundary({
      provenance, changed: { rootChanged: false, paths: operations.map((operation) => operation.path) },
    });
    if (!boundary || !inside(dirname(expectedPath), boundary.includePath)) throw new Error("Migration must stay within one internal include owner");
    statePath(stateDir, boundary.includePath, true);
  }
  return configDraft(snapshot.sourceConfig, operations);
}

export function silenceCronJob(job) {
  if (!record(job.delivery) || !["none", "announce", "webhook"].includes(job.delivery.mode)) {
    throw new Error("Migration job delivery is unsupported");
  }
  const delivery = { ...job.delivery, mode: "none" };
  const routes = ["channel", "to", "threadId", "accountId", "completionDestination", "failureDestination"];
  for (const key of Object.keys(delivery)) {
    if (!["mode", "bestEffort", ...routes].includes(key) && /channel|destination|webhook|url|recipient|route|account|thread|target/i.test(key)) {
      throw new Error("Unknown routing field in migration job");
    }
  }
  for (const key of routes) delete delivery[key];
  return { ...structuredClone(job), delivery, failureAlert: false };
}

async function loadSdk(runtime, phase) {
  const require = createRequire(join(runtime, "package.json"));
  const sdk = {};
  const names = ["config-mutation", "cron-store-runtime", "state-paths"];
  if (phase === "schema") names.push("doctor-repair-runtime");
  for (const name of names) {
    const path = require.resolve(`openclaw/plugin-sdk/${name}`);
    if (!inside(realpathSync(runtime), realpathSync(path))) throw new Error("Migration SDK resolved outside candidate runtime");
    Object.assign(sdk, await import(pathToFileURL(path).href));
  }
  return sdk;
}

export async function executeStateMigration({ phase, runtime, stateDir, manifestPath, sha256 }, sdkLoader = loadSdk) {
  if (!["preflight", "schema", "config", "cron"].includes(phase) || !isAbsolute(runtime) ||
      !isAbsolute(stateDir) || realpathSync(stateDir) !== stateDir ||
      process.env.OPENCLAW_STATE_DIR !== stateDir || process.env.OPENCLAW_CONFIG_PATH !== join(stateDir, "openclaw.json")) {
    throw new Error("Migration requires an explicit canonical stopped-state target");
  }
  const manifest = readMigrationManifest(manifestPath, sha256);
  const sdk = await sdkLoader(runtime, phase);
  const assertSelection = () => {
    if (sdk.resolveStateDir(process.env) !== stateDir || process.env.OPENCLAW_CONFIG_PATH !== join(stateDir, "openclaw.json")) {
      throw new Error("Migration state selection changed");
    }
    const database = sdk.resolveOpenClawStateSqlitePath(process.env);
    statePath(stateDir, database, Boolean(manifest.cronOperation));
    const databaseStat = lstatSync(database, { throwIfNoEntry: false });
    if (databaseStat && !databaseStat.isFile()) throw new Error("Migration database must be a regular file");
    statePath(stateDir, `${database}-wal`);
    statePath(stateDir, `${database}-shm`);
    statePath(stateDir, join(stateDir, "config-journal-fingerprint.key"));
  };
  assertSelection();
  const { snapshot } = await sdk.readConfigFileSnapshotForWrite({ observe: false });
  assertSelection();
  for (const source of [snapshot.sourceConfigBeforeMigrations, snapshot.sourceConfig].filter(record)) {
    statePath(stateDir, sdk.resolveCronJobsStorePathFromConfig(source, process.env));
  }
  if (phase === "preflight") {
    configBoundary(snapshot, manifest.configOperations, stateDir, sdk);
    return;
  }
  if (phase === "schema") {
    configBoundary(snapshot, manifest.configOperations, stateDir, sdk);
    const result = sdk.repairOpenClawStateDatabaseSchema({ env: process.env });
    if (result.warnings.length) throw new Error("Stopped-state schema repair reported warnings");
    assertSelection();
  }
  if (phase === "config" && manifest.configOperations.length) {
    await sdk.mutateConfigFile({
      base: "source",
      afterWrite: { mode: "none", reason: "stopped release migration" },
      writeOptions: { skipRuntimeSnapshotRefresh: true, skipOutputLogs: true },
      mutate(draft, context) {
        assertSelection();
        const next = configBoundary(context.snapshot, manifest.configOperations, stateDir, sdk);
        for (const key of Object.keys(draft)) delete draft[key];
        Object.assign(draft, next);
      },
    });
    assertSelection();
  }
  if (phase === "cron" && manifest.cronOperation) {
    configBoundary(snapshot, [], stateDir, sdk);
    const storePath = statePath(stateDir, sdk.resolveCronJobsStorePathFromConfig(snapshot.sourceConfig, process.env));
    const loaded = await sdk.loadCronJobsStoreWithConfigJobsReadOnly(storePath, process.env);
    const matches = loaded.store.jobs.filter((job) => job.id === manifest.cronOperation.jobId);
    if (matches.length !== 1 || loaded.invalidConfigRows?.some((row) => row.id === manifest.cronOperation.jobId) ||
        sdk.resolveCronJobConfigRevision(matches[0]) !== manifest.cronOperation.expectedRevision) {
      throw new Error("Migration job is missing or its reviewed revision changed");
    }
    const replacement = silenceCronJob(matches[0]);
    const next = { ...loaded.store, jobs: loaded.store.jobs.map((job) => job.id === replacement.id ? replacement : job) };
    await sdk.saveCronJobsStoreChanges(storePath, loaded.store, next);
    assertSelection();
  }
  if (fileDigest(manifestPath) !== sha256) throw new Error("Migration manifest changed during execution");
}
