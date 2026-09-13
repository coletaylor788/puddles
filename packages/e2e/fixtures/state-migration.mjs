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
const stateDir = process.env.OPENCLAW_STATE_DIR;
const configPath = process.env.OPENCLAW_CONFIG_PATH;
const memory = { search: { provider: "none", fallback: "none", extraPaths: ["~/synthetic-extra"] } };
const original = {
  agents: { ownership: "explicit", entries: { fixture: { workspace: "~/synthetic-workspace" } } },
  memory: mode === "include" ? { $include: "memory.json" } : memory,
  models: { providers: { fixture: {
    baseUrl: "http://127.0.0.1:9/v1", api: "openai-completions",
    apiKey: { source: "env", provider: "default", id: "FIXTURE_KEY" },
    models: [{ id: "synthetic", name: "Synthetic" }],
  } } },
};
writeFileSync(configPath, JSON.stringify(original));
if (mode === "include") writeFileSync(join(stateDir, "memory.json"), JSON.stringify(memory));
const storePath = sdk.resolveCronJobsStorePathFromConfig({}, process.env);
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
const manifest = {
  schemaVersion: 1,
  configOperations: [{
    kind: "set", path: ["memory", "search", "provider"],
    expected: { exists: true, sha256: canonicalValueDigest("none") }, value: "local",
  }],
  cronOperation: { kind: "silence-delivery", jobId: "selected", expectedRevision: sdk.resolveCronJobConfigRevision(selected) },
};
const manifestPath = join(root, "migration.json");
writeFileSync(manifestPath, JSON.stringify(manifest));
const options = { runtime, stateDir, manifestPath, sha256: fileDigest(manifestPath) };
const digestBefore = treeDigest(stateDir);
await executeStateMigration({ ...options, phase: "preflight" });
assert.equal(treeDigest(stateDir), digestBefore, "preflight must not mutate target state");
await executeStateMigration({ ...options, phase: "schema" });
await executeStateMigration({ ...options, phase: "config" });
const written = JSON.parse(readFileSync(configPath, "utf8"));
assert.deepEqual(written.agents, original.agents, "authored tilde paths must survive");
assert.deepEqual(written.models, original.models, "authored secret references must survive");
if (mode === "include") {
  assert.deepEqual(written.memory, { $include: "memory.json" });
  assert.equal(JSON.parse(readFileSync(join(stateDir, "memory.json"), "utf8")).search.provider, "local");
} else {
  assert.equal(written.memory.search.provider, "local");
  assert.deepEqual(written.memory.search.extraPaths, memory.search.extraPaths);
}
const concurrent = structuredClone(before);
const migrated = (await sdk.loadCronJobsStoreWithConfigJobsReadOnly(storePath, process.env)).store;
assert.equal(sdk.resolveCronJobConfigRevision(migrated.jobs.find((job) => job.id === "selected")),
  manifest.cronOperation.expectedRevision, "schema repair must not silently rebaseline the job");
concurrent.jobs.find((job) => job.id === "other").name = "Concurrent unrelated change";
concurrent.jobs.find((job) => job.id === "selected").state.lastRunAtMs = 50;
concurrent.jobs.push({ ...initial, id: "new" });
if (mode === "conflict") concurrent.jobs.find((job) => job.id === "selected").name = "Concurrent selected change";
await sdk.saveCronJobsStoreChanges(storePath, before, concurrent);
if (mode === "conflict") {
  await assert.rejects(executeStateMigration({ ...options, phase: "cron" }), /revision changed/);
} else {
  await executeStateMigration({ ...options, phase: "cron" });
}
const after = (await sdk.loadCronJobsStoreWithConfigJobsReadOnly(storePath, process.env)).store;
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
