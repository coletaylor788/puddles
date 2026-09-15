import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { canonicalValueDigest, executeStateMigration } from "../src/native-state-migration.mjs";
import { digest, fileDigest, treeDigest } from "../src/native-state.mjs";

const [runtime, root, mode, legacyFixture] = process.argv.slice(2);
let networkAttempts = 0;
const denyNetwork = () => {
  networkAttempts++;
  throw new Error("Network is forbidden in the stopped-state fixture");
};
globalThis.fetch = denyNetwork;
http.request = http.get = https.request = https.get = denyNetwork;
net.connect = net.createConnection = net.Socket.prototype.connect = denyNetwork;
const require = createRequire(join(runtime, "package.json"));
const sdk = await import(pathToFileURL(require.resolve("openclaw/plugin-sdk/cron-store-runtime")).href);
const configSdk = await import(pathToFileURL(require.resolve("openclaw/plugin-sdk/config-mutation")).href);
const stateDir = process.env.OPENCLAW_STATE_DIR;
const configPath = process.env.OPENCLAW_CONFIG_PATH;
const memory = { search: { provider: "none", fallback: "none", extraPaths: ["~/synthetic-extra"] } };
const agents = mode === "legacy-config"
  ? { list: Array.from({ length: 8 }, (_, index) => ({
      id: `agent-${index + 1}`,
      ...(index === 0 ? { workspace: "~/synthetic-workspace" } : {}),
    })) }
  : { ownership: "explicit", entries: { fixture: { workspace: "~/synthetic-workspace" } } };
const original = {
  agents,
  memory: mode === "include" ? { $include: "memory.json" } : memory,
  ...(mode === "legacy-config"
    ? { cron: { store: join(stateDir, "cron", "legacy-jobs.json") } }
    : {}),
  ...(mode === "legacy-config"
    ? {
        plugins: {
          entries: {
            "active-memory": { config: { qmd: { enabled: true } } },
            canvas: {
              config: {
                host: {
                  enabled: true,
                  root: join(stateDir, "legacy-canvas"),
                  liveReload: true,
                },
              },
            },
          },
        },
      }
    : {}),
  models: { providers: { fixture: {
    baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions",
    apiKey: { source: "env", provider: "default", id: "FIXTURE_KEY" },
    models: [{ id: "synthetic", name: "Synthetic" }],
  } } },
};
writeFileSync(configPath, JSON.stringify(original));
if (mode === "include") writeFileSync(join(stateDir, "memory.json"), JSON.stringify(memory));
const storePath = sdk.resolveCronJobsStorePathFromConfig(original, process.env);
const initial = {
  id: "selected", name: "Synthetic job", enabled: true, createdAtMs: 1, updatedAtMs: 1,
  schedule: { kind: "cron", expr: "0 4 * * *", tz: "UTC" },
  sessionTarget: "isolated", wakeMode: "next-heartbeat",
  payload: { kind: "agentTurn", message: "Synthetic task", model: "fixture/synthetic" },
  delivery: { mode: "announce", channel: "imessage", to: "synthetic", bestEffort: true, futureField: "keep" },
  failureAlert: { after: 1, channel: "imessage", to: "synthetic" },
  futureField: { preserve: true }, state: {},
};
let before;
if (mode === "legacy") {
  const compressed = readFileSync(legacyFixture);
  assert.equal(digest(compressed), "c775499d9a46462ae2368090a0c4ec75877784c40694046dd3af63df77b8737c");
  mkdirSync(join(stateDir, "state"), { recursive: true });
  const databasePath = join(stateDir, "state/openclaw.sqlite");
  writeFileSync(databasePath, gunzipSync(compressed));
  const database = new DatabaseSync(databasePath);
  try {
    const insert = database.prepare(`INSERT INTO cron_jobs (
      store_key, job_id, name, enabled, created_at_ms, schedule_kind, schedule_expr, schedule_tz,
      session_target, wake_mode, payload_kind, payload_message, job_json, state_json,
      sort_order, updated_at
    ) VALUES (?, ?, ?, 1, 1, 'cron', '0 4 * * *', 'UTC', 'isolated', 'next-heartbeat',
      'agentTurn', ?, ?, '{}', ?, 1)`);
    const jobs = [initial, { ...initial, id: "other" }];
    for (const [index, job] of jobs.entries()) insert.run(storePath, job.id, job.name, job.payload.message, JSON.stringify(job), index);
    before = { version: 1, jobs };
  } finally {
    database.close();
  }
} else {
  await sdk.saveCronJobsStoreChanges(storePath, { version: 1, jobs: [] }, {
    version: 1, jobs: [initial, { ...initial, id: "other" }],
  });
  before = (await sdk.loadCronJobsStoreWithConfigJobsReadOnly(storePath, process.env)).store;
}
const selected = before.jobs.find((job) => job.id === "selected");
const configOperations = [{
    kind: "set", path: ["memory", "search", "provider"],
    expected: { exists: true, sha256: canonicalValueDigest("none") }, value: "local",
  }];
if (mode === "legacy-config") {
  configOperations.push({
    kind: "set",
    path: ["plugins", "entries", "active-memory"],
    expected: { exists: true, sha256: canonicalValueDigest({ config: {} }) },
    value: { enabled: true, config: {} },
  });
}
const manifest = {
  schemaVersion: 1,
  configOperations,
  cronOperation: { kind: "silence-delivery", jobId: "selected", expectedRevision: sdk.resolveCronJobConfigRevision(selected) },
};
const manifestPath = join(root, "migration.json");
writeFileSync(manifestPath, JSON.stringify(manifest));
const options = { runtime, stateDir, manifestPath, sha256: fileDigest(manifestPath) };
const digestBefore = treeDigest(stateDir);
if (mode === "legacy") {
  const { snapshot } = await configSdk.readConfigFileSnapshotForWrite({
    observe: false,
    pluginValidation: "core-only",
  });
  assert.equal(treeDigest(stateDir), digestBefore, "config snapshot must not mutate target state");
  configSdk.previewLegacyConfigRepair(snapshot);
  assert.equal(treeDigest(stateDir), digestBefore, "config preview must not mutate target state");
  await sdk.loadCronJobsStoreWithConfigJobsReadOnly(storePath, process.env);
  assert.equal(treeDigest(stateDir), digestBefore, "cron snapshot must not mutate target state");
}
const expectedBuiltIn = await executeStateMigration({ ...options, phase: "preflight" });
assert.equal(treeDigest(stateDir), digestBefore, "preflight must not mutate target state");
await executeStateMigration({ ...options, phase: "schema" });
await executeStateMigration({ ...options, phase: "builtin-config", expectedBuiltIn });
await executeStateMigration({ ...options, phase: "config" });
const written = JSON.parse(readFileSync(configPath, "utf8"));
if (mode === "legacy-config") {
  assert.equal(written.agents.ownership, "explicit");
  assert.equal(Object.keys(written.agents.entries).length, 8);
  assert.equal(written.agents.entries["agent-1"].workspace, "~/synthetic-workspace");
  assert.equal(
    Object.values(written.agents.entries).some((entry) => entry.default === true),
    false,
    "canonical roster must not retain default markers",
  );
  assert.deepEqual(written.plugins.entries["active-memory"].config, {});
  assert.equal(written.plugins.entries["active-memory"].enabled, true);
  assert.deepEqual(written.plugins.entries.canvas.config.host, { enabled: true });
} else {
  assert.deepEqual(written.agents, original.agents, "authored tilde paths must survive");
}
assert.deepEqual(written.models, original.models, "authored secret references must survive");
if (mode === "include") {
  assert.deepEqual(written.memory, { $include: "memory.json" });
  assert.equal(JSON.parse(readFileSync(join(stateDir, "memory.json"), "utf8")).search.provider, "local");
} else {
  assert.equal(written.memory.search.provider, "local");
  assert.deepEqual(written.memory.search.extraPaths, memory.search.extraPaths);
}
const activeStorePath = sdk.resolveCronJobsStorePathFromConfig(written, process.env);
if (mode === "legacy-config") {
  assert.notEqual(activeStorePath, storePath, "legacy cron store path must be retired");
}
const concurrent = structuredClone(before);
const migrated = (await sdk.loadCronJobsStoreWithConfigJobsReadOnly(activeStorePath, process.env)).store;
assert.equal(sdk.resolveCronJobConfigRevision(migrated.jobs.find((job) => job.id === "selected")),
  manifest.cronOperation.expectedRevision, "schema repair must not silently rebaseline the job");
concurrent.jobs.find((job) => job.id === "other").name = "Concurrent unrelated change";
concurrent.jobs.find((job) => job.id === "selected").state.lastRunAtMs = 50;
concurrent.jobs.push({ ...initial, id: "new" });
if (mode === "conflict") concurrent.jobs.find((job) => job.id === "selected").name = "Concurrent selected change";
await sdk.saveCronJobsStoreChanges(activeStorePath, before, concurrent);
if (mode === "conflict") {
  await assert.rejects(executeStateMigration({ ...options, phase: "cron" }), /revision changed/);
} else {
  await executeStateMigration({ ...options, phase: "cron" });
}
const after = (await sdk.loadCronJobsStoreWithConfigJobsReadOnly(activeStorePath, process.env)).store;
const actual = after.jobs.find((job) => job.id === "selected");
if (mode === "conflict") {
  assert.equal(actual.delivery.mode, "announce");
  assert.equal(actual.name, "Concurrent selected change");
} else {
  assert.deepEqual(actual.delivery, { mode: "none", bestEffort: true, futureField: "keep" });
  assert.equal(actual.failureAlert, false);
  for (const field of ["schedule", "payload", "enabled", "futureField"]) assert.deepEqual(actual[field], selected[field]);
}
assert.equal(actual.state.lastRunAtMs, 50);
assert.equal(after.jobs.find((job) => job.id === "other").name, "Concurrent unrelated change");
assert.ok(after.jobs.some((job) => job.id === "new"));
assert.equal(networkAttempts, 0, "offline migration must not attempt network activity");
