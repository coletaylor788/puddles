import { afterEach, describe, expect, it, vi } from "vitest";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Native lifecycle helpers execute directly as JavaScript.
import { canonicalValueDigest, executeStateMigration, silenceCronJob, validateMigrationManifest } from "../src/native-state-migration.mjs";
// @ts-expect-error Native lifecycle helpers execute directly as JavaScript.
import { fileDigest } from "../src/native-state.mjs";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "state-migration-test-")));
  roots.push(root);
  const stateDir = join(root, "state");
  mkdirSync(join(stateDir, "state"), { recursive: true });
  const configPath = join(stateDir, "openclaw.json");
  const database = join(stateDir, "state/openclaw.sqlite");
  writeFileSync(database, "synthetic database");
  type SourceConfig = {
    plugins: { entries: { fixture: { config: { selected: string; secret: { source: string; provider: string; id: string }; unknown: number } } } };
    cron?: { store?: string };
  };
  const source: SourceConfig = { plugins: { entries: { fixture: { config: { selected: "before", secret: { source: "env", provider: "default", id: "FIXTURE_SECRET" }, unknown: 7 } } } } };
  writeFileSync(configPath, JSON.stringify(source));
  const snapshot = { path: configPath, hash: "source-hash", exists: true, valid: true,
    raw: JSON.stringify(source), parsed: source, sourceConfig: source,
    sourceConfigBeforeMigrations: undefined as SourceConfig | undefined,
    includedPaths: [] as string[], includeProvenance: [] as object[] };
  const operation = { kind: "set", path: ["plugins", "entries", "fixture", "config", "selected"],
    expected: { exists: true, sha256: canonicalValueDigest("before") }, value: "after" };
  const job = { id: "synthetic-job", owner: { agentId: "synthetic-owner" }, enabled: true,
    schedule: { kind: "cron", expr: "0 4 * * *", tz: "UTC" }, payload: { kind: "agentTurn", message: "Synthetic task" },
    model: "unchanged", profile: "unchanged", unknown: { preserve: true }, state: { lastRunAtMs: 1 },
    delivery: { mode: "announce", to: "synthetic", channel: "fixture", accountId: "fixture", threadId: 1,
      completionDestination: { to: "synthetic" }, failureDestination: { to: "synthetic" }, bestEffort: true, unknown: "keep" },
    failureAlert: { to: "synthetic", channel: "fixture" } };
  const revision = `sha256:${"a".repeat(43)}`;
  const manifest = { schemaVersion: 1, configOperations: [operation],
    cronOperation: { kind: "silence-delivery", jobId: job.id, expectedRevision: revision } };
  const manifestPath = join(root, "migration.json");
  const selected = () => {
    writeFileSync(manifestPath, JSON.stringify(manifest));
    return { runtime: root, stateDir, manifestPath, sha256: fileDigest(manifestPath) };
  };
  const sdk = {
    resolveStateDir: () => process.env.OPENCLAW_STATE_DIR,
    resolveOpenClawStateSqlitePath: () => database,
    resolveCronJobsStorePathFromConfig: vi.fn((config?: { cron?: { store?: string } }) =>
      config?.cron?.store ?? join(stateDir, "cron/jobs.json")),
    resolveIncludeWriteBoundary: vi.fn((): null | { includePath: string } => null),
    readConfigFileSnapshotForWrite: vi.fn(async () => ({ snapshot })),
    repairOpenClawStateDatabaseSchema: vi.fn(() => ({ changes: [], warnings: [] as string[] })),
    previewLegacyConfigRepair: vi.fn((_snapshot): {
      sourceConfig: SourceConfig;
      expectedConfig: SourceConfig;
      changes: string[];
    } | null => null),
    repairLegacyConfigForStoppedState: vi.fn(async () => ({
      snapshot, repaired: false, changes: [] as string[],
    })),
    mutateConfigFile: vi.fn(async (options: { mutate: (draft: typeof source, context: { snapshot: typeof snapshot }) => void }) => {
      const draft = structuredClone(snapshot.sourceConfig);
      options.mutate(draft, { snapshot });
      snapshot.sourceConfig = draft;
      writeFileSync(configPath, JSON.stringify(draft));
    }),
    loadCronJobsStoreWithConfigJobsReadOnly: vi.fn(async (_storePath?: string) => ({
      store: { version: 1, jobs: [job] }, invalidConfigRows: [], jobsFingerprint: "jobs-fingerprint",
    })),
    materializeCronConfigJobsForMigration: vi.fn(async () => ({
      before: { version: 1, jobs: [job] }, after: { version: 1, jobs: [job] }, materialized: 1,
    })),
    resolveCronJobConfigRevision: vi.fn(() => revision),
    saveCronJobsStoreChanges: vi.fn(async () => {}),
    loadCronStore: vi.fn(() => { throw new Error("Mutating load forbidden"); }),
    saveCronStore: vi.fn(() => { throw new Error("Whole-store write forbidden"); }),
  };
  vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  vi.stubEnv("OPENCLAW_CONFIG_PATH", configPath);
  const run = (phase: string) => executeStateMigration({ phase, ...selected() }, async () => sdk);
  return { root, stateDir, configPath, database, manifest, manifestPath, selected, snapshot, sdk, run, job };
}

describe("digest-bound stopped-state operations", () => {
  it("shares deterministic JSON value digests without accepting non-JSON values", () => {
    expect(canonicalValueDigest({ b: 2, a: [1, false] })).toBe(canonicalValueDigest({ a: [1, false], b: 2 }));
    expect(canonicalValueDigest("1")).not.toBe(canonicalValueDigest(1));
    for (const value of [undefined, NaN, Infinity, new Date(), { value: undefined }, JSON.parse('{"__proto__":1}')]) {
      expect(() => canonicalValueDigest(value)).toThrow();
    }
  });

  it.each(["command", "version", "overlap", "array", "prototype", "include", "environment", "store", "missing-unset", "unknown-expected"])(
    "rejects %s in the reviewed manifest",
    (failure) => {
      const f = fixture();
      const manifest = structuredClone(f.manifest);
      if (failure === "command") Object.assign(manifest, { command: "forbidden" });
      if (failure === "version") manifest.schemaVersion = 2;
      if (failure === "overlap") manifest.configOperations.push(structuredClone(manifest.configOperations[0]));
      if (failure === "array") manifest.configOperations[0].path = ["agents", "list", "0", "name"];
      if (failure === "prototype") manifest.configOperations[0].path = ["__proto__", "value"];
      if (failure === "include") manifest.configOperations[0].path = ["plugins", "$include"];
      if (failure === "environment") manifest.configOperations[0].path = ["env", "vars"];
      if (failure === "store") manifest.configOperations[0].path = ["cron"];
      if (failure === "missing-unset") Object.assign(manifest.configOperations[0], { kind: "unset", expected: { exists: false } });
      if (failure === "unknown-expected") Object.assign(manifest.configOperations[0].expected, { value: "before" });
      expect(() => validateMigrationManifest(manifest)).toThrow();
    },
  );

  it("preflights without writing config or loading mutable cron state", async () => {
    const f = fixture();
    const before = readFileSync(f.configPath);
    await f.run("preflight");
    expect(readFileSync(f.configPath)).toEqual(before);
    expect(f.sdk.mutateConfigFile).not.toHaveBeenCalled();
    expect(f.sdk.readConfigFileSnapshotForWrite).toHaveBeenCalledWith({ observe: false, pluginValidation: "core-only" });
    expect(f.sdk.repairOpenClawStateDatabaseSchema).not.toHaveBeenCalled();
    expect(f.sdk.saveCronJobsStoreChanges).not.toHaveBeenCalled();
    expect(f.sdk.loadCronStore).not.toHaveBeenCalled();
    expect(f.sdk.saveCronStore).not.toHaveBeenCalled();
  });

  it("binds and materializes the complete effective job set before selected config writes", async () => {
    const f = fixture();
    const selected = f.selected();
    const expectedBuiltIn = await executeStateMigration(
      { phase: "preflight", ...selected },
      async () => f.sdk,
    );
    const result = await executeStateMigration(
      { phase: "builtin-config", ...selected, expectedBuiltIn },
      async () => f.sdk,
    );
    expect(f.sdk.materializeCronConfigJobsForMigration).toHaveBeenCalledWith(
      join(f.stateDir, "cron/jobs.json"),
      join(f.stateDir, "cron/jobs.json"),
      "jobs-fingerprint",
      "jobs-fingerprint",
    );
    expect(result).toMatchObject({
      config: { sha256: canonicalValueDigest(f.snapshot.sourceConfig) },
      cron: {
        jobsSha256: canonicalValueDigest({ version: 1, jobs: [f.job] }.jobs),
        selectedRevision: `sha256:${"a".repeat(43)}`,
      },
    });
  });

  it("allows unrelated config and cron runtime-state drift after live preflight", async () => {
    const f = fixture();
    f.sdk.loadCronJobsStoreWithConfigJobsReadOnly.mockImplementation(async () => ({
      store: { version: 1, jobs: [f.job] },
      invalidConfigRows: [],
      jobsFingerprint: `runtime-${f.job.state.lastRunAtMs}`,
    }));
    const selected = f.selected();
    const expectedBuiltIn = await executeStateMigration(
      { phase: "preflight", ...selected },
      async () => f.sdk,
    );
    expect(expectedBuiltIn.config).not.toHaveProperty("sourceHash");
    expect(expectedBuiltIn.cron).not.toHaveProperty("sourceJobsFingerprint");
    expect(expectedBuiltIn.cron).not.toHaveProperty("targetJobsFingerprint");
    expect(expectedBuiltIn.cron).not.toHaveProperty("jobsSha256");
    f.snapshot.hash = "changed-source";
    f.snapshot.sourceConfig.plugins.entries.fixture.config.unknown = 8;
    f.job.state.lastRunAtMs = 2;
    await expect(executeStateMigration(
      { phase: "builtin-config", ...selected, expectedBuiltIn },
      async () => f.sdk,
    )).resolves.toMatchObject({
      cron: { selectedRevision: `sha256:${"a".repeat(43)}` },
    });
    expect(f.sdk.materializeCronConfigJobsForMigration).toHaveBeenCalledOnce();
    expect(f.sdk.materializeCronConfigJobsForMigration).toHaveBeenCalledWith(
      join(f.stateDir, "cron/jobs.json"),
      join(f.stateDir, "cron/jobs.json"),
      "runtime-2",
      "runtime-2",
    );
  });

  it("rejects selected job definition drift after live preflight", async () => {
    const f = fixture();
    const selected = f.selected();
    const expectedBuiltIn = await executeStateMigration(
      { phase: "preflight", ...selected },
      async () => f.sdk,
    );
    f.sdk.resolveCronJobConfigRevision.mockReturnValue(`sha256:${"b".repeat(43)}`);
    await expect(executeStateMigration(
      { phase: "builtin-config", ...selected, expectedBuiltIn },
      async () => f.sdk,
    )).rejects.toThrow("reviewed revision changed");
    expect(f.sdk.materializeCronConfigJobsForMigration).not.toHaveBeenCalled();
  });

  it("rejects changed maintained migration semantics after live preflight", async () => {
    const f = fixture();
    type LegacyConfig = typeof f.snapshot.sourceConfig & { legacy?: string; normalized?: string };
    const source = f.snapshot.sourceConfig as LegacyConfig;
    source.legacy = "before";
    f.snapshot.sourceConfigBeforeMigrations = structuredClone(source);
    f.sdk.previewLegacyConfigRepair.mockImplementation(() => {
      const expected = { ...source, normalized: source.legacy };
      return { sourceConfig: expected, expectedConfig: expected, changes: ["Normalized legacy"] };
    });
    const selected = f.selected();
    const expectedBuiltIn = await executeStateMigration(
      { phase: "preflight", ...selected },
      async () => f.sdk,
    );
    source.legacy = "changed";
    await expect(executeStateMigration(
      { phase: "builtin-config", ...selected, expectedBuiltIn },
      async () => f.sdk,
    )).rejects.toThrow("inputs changed");
    expect(f.sdk.materializeCronConfigJobsForMigration).not.toHaveBeenCalled();
  });

  it("applies complete stopped plugin migrations beyond the state-free preflight", async () => {
    const f = fixture();
    const source = f.snapshot.sourceConfig;
    const coreConfig = { ...source, coreNormalized: true };
    const fullConfig = { ...coreConfig, pluginNormalized: true };
    f.sdk.previewLegacyConfigRepair.mockImplementation((_snapshot, options?: {
      pluginContracts?: boolean;
    }) => ({
      sourceConfig: options?.pluginContracts ? fullConfig : coreConfig,
      expectedConfig: options?.pluginContracts ? fullConfig : coreConfig,
      changes: options?.pluginContracts
        ? ["Normalized core", "Normalized plugin"]
        : ["Normalized core"],
    }));
    f.sdk.repairLegacyConfigForStoppedState.mockResolvedValue({
      snapshot: { ...f.snapshot, sourceConfig: fullConfig },
      repaired: true,
      changes: ["Normalized core", "Normalized plugin"],
    });
    const selected = f.selected();
    const expectedBuiltIn = await executeStateMigration(
      { phase: "preflight", ...selected },
      async () => f.sdk,
    );
    const result = await executeStateMigration(
      { phase: "builtin-config", ...selected, expectedBuiltIn },
      async () => f.sdk,
    );
    expect(f.sdk.previewLegacyConfigRepair).toHaveBeenCalledWith(
      f.snapshot,
      { pluginContracts: true },
    );
    expect(result.config.sha256).toBe(canonicalValueDigest(fullConfig));
  });

  it("moves effective jobs to the post-migration store before retiring its legacy path", async () => {
    const f = fixture();
    const legacyStore = join(f.stateDir, "cron/legacy-jobs.json");
    const targetStore = join(f.stateDir, "cron/jobs.json");
    const legacyConfig = { ...f.snapshot.sourceConfig, cron: { store: legacyStore } };
    const migratedConfig = structuredClone(f.snapshot.sourceConfig);
    f.snapshot.sourceConfigBeforeMigrations = legacyConfig;
    f.snapshot.sourceConfig = migratedConfig;
    f.sdk.previewLegacyConfigRepair.mockReturnValue({
      sourceConfig: migratedConfig,
      expectedConfig: migratedConfig,
      changes: ["Removed cron.store"],
    });
    f.sdk.resolveCronJobsStorePathFromConfig.mockImplementation(
      (config?: { cron?: { store?: string } }) => config?.cron?.store ?? targetStore,
    );
    let materialized = false;
    f.sdk.loadCronJobsStoreWithConfigJobsReadOnly.mockImplementation(async (storePath?: string) => {
      const source = storePath === legacyStore || materialized;
      return {
        store: { version: 1, jobs: source ? [f.job] : [] },
        invalidConfigRows: [],
        jobsFingerprint: source ? "source-fingerprint" : "target-fingerprint",
      };
    });
    f.sdk.materializeCronConfigJobsForMigration.mockImplementation(async () => {
      materialized = true;
      return {
        before: { version: 1, jobs: [f.job] },
        after: { version: 1, jobs: [f.job] },
        materialized: 1,
      };
    });
    f.sdk.repairLegacyConfigForStoppedState.mockResolvedValue({
      snapshot: { ...f.snapshot, hash: "migrated-hash", sourceConfig: migratedConfig },
      repaired: true,
      changes: ["Removed cron.store"],
    });
    const selected = f.selected();
    const expectedBuiltIn = await executeStateMigration(
      { phase: "preflight", ...selected },
      async () => f.sdk,
    );
    expect(expectedBuiltIn.cron).toEqual({
      sourceStoreSha256: canonicalValueDigest(legacyStore),
      targetStoreSha256: canonicalValueDigest(targetStore),
      selectedRevision: `sha256:${"a".repeat(43)}`,
    });
    const result = await executeStateMigration(
      { phase: "builtin-config", ...selected, expectedBuiltIn },
      async () => f.sdk,
    );
    expect(f.sdk.materializeCronConfigJobsForMigration).toHaveBeenCalledWith(
      legacyStore,
      targetStore,
      "source-fingerprint",
      "target-fingerprint",
    );
    expect(result.cron.selectedRevision).toBe(`sha256:${"a".repeat(43)}`);
  });

  it("uses the fresh source writer, preserves unrelated references, and suppresses runtime work", async () => {
    const f = fixture();
    await f.run("preflight");
    f.snapshot.sourceConfig.plugins.entries.fixture.config.unknown = 8;
    await f.run("config");
    expect(f.snapshot.sourceConfig.plugins.entries.fixture.config).toEqual({
      selected: "after", unknown: 8, secret: { source: "env", provider: "default", id: "FIXTURE_SECRET" },
    });
    expect(f.sdk.mutateConfigFile.mock.calls[0][0]).toMatchObject({
      base: "source", afterWrite: { mode: "none" },
      writeOptions: { skipRuntimeSnapshotRefresh: true, skipOutputLogs: true },
    });
    expect(f.sdk.readConfigFileSnapshotForWrite).toHaveBeenLastCalledWith({ observe: false, pluginValidation: "full" });
  });

  it("rejects changed leaf preconditions without partial writes", async () => {
    const f = fixture();
    await f.run("preflight");
    f.snapshot.sourceConfig.plugins.entries.fixture.config.selected = "concurrent";
    const before = readFileSync(f.configPath);
    await expect(f.run("config")).rejects.toThrow("precondition");
    expect(readFileSync(f.configPath)).toEqual(before);
  });

  it("keeps schema repair explicit and rejects later selected-config drift", async () => {
    const f = fixture();
    await f.run("schema");
    expect(f.sdk.repairOpenClawStateDatabaseSchema).toHaveBeenCalledWith({ env: process.env });
    f.snapshot.sourceConfig.plugins.entries.fixture.config.selected = "concurrent";
    await expect(f.run("config")).rejects.toThrow("precondition");
  });

  it("surfaces schema warnings instead of continuing to mutation", async () => {
    const f = fixture();
    f.sdk.repairOpenClawStateDatabaseSchema.mockReturnValue({ changes: [], warnings: ["synthetic warning"] });
    await expect(f.run("schema")).rejects.toThrow("warnings");
    expect(f.sdk.mutateConfigFile).not.toHaveBeenCalled();
  });

  it("rejects scalar parents instead of replacing them with objects", async () => {
    const f = fixture();
    f.manifest.configOperations[0].path.push("child");
    await expect(f.run("preflight")).rejects.toThrow("ancestor");
  });

  it("creates missing object parents only after checking every selected leaf", async () => {
    const f = fixture();
    Object.assign(f.manifest, { configOperations: [
      { kind: "set", path: ["memory", "search", "provider"], expected: { exists: false }, value: "local" },
      f.manifest.configOperations[0],
    ] });
    f.snapshot.sourceConfig.plugins.entries.fixture.config.selected = "concurrent";
    const original = readFileSync(f.configPath);
    await expect(f.run("config")).rejects.toThrow("precondition");
    expect(readFileSync(f.configPath)).toEqual(original);
    f.snapshot.sourceConfig.plugins.entries.fixture.config.selected = "before";
    await f.run("config");
    expect(JSON.parse(readFileSync(f.configPath, "utf8")).memory).toEqual({ search: { provider: "local" } });
  });

  it("rejects a retired external cron path before schema migration can preserve it", async () => {
    const f = fixture();
    Object.assign(f.snapshot, { sourceConfigBeforeMigrations: { cron: { store: join(f.root, "outside/jobs.json") } } });
    await expect(f.run("preflight")).rejects.toThrow("escapes");
    expect(f.sdk.repairOpenClawStateDatabaseSchema).not.toHaveBeenCalled();
  });

  it.each(["shared", "external", "merged"])("rejects unsupported %s include ownership", async (kind) => {
    const f = fixture();
    const include = kind === "external" ? join(f.root, "outside.json") : join(f.stateDir, "included.json");
    writeFileSync(include, "{}");
    f.snapshot.includedPaths.push(include);
    f.snapshot.includeProvenance.push({ path: ["plugins"], kind: kind === "merged" ? "multiple" : "single", targetPath: include });
    await expect(f.run("preflight")).rejects.toThrow();
    expect(f.sdk.mutateConfigFile).not.toHaveBeenCalled();
  });

  it("permits the maintained sole internal include boundary", async () => {
    const f = fixture();
    const include = join(f.stateDir, "plugins.json");
    writeFileSync(include, "{}");
    f.snapshot.includedPaths.push(include);
    f.snapshot.includeProvenance.push({ path: ["plugins"], kind: "single", targetPath: include });
    f.sdk.resolveIncludeWriteBoundary.mockReturnValue({ includePath: include });
    await f.run("preflight");
    expect(f.sdk.resolveIncludeWriteBoundary).toHaveBeenCalledOnce();
  });

  it.each(["symlink", "hardlink", "missing-db", "outside-db", "directory-db"])("rejects unsafe %s state before mutation", async (kind) => {
    const f = fixture();
    if (kind === "symlink" || kind === "hardlink") {
      const other = join(f.root, "outside");
      writeFileSync(other, "outside");
      rmSync(f.database);
      if (kind === "symlink") symlinkSync(other, f.database);
      else linkSync(other, f.database);
    }
    if (kind === "missing-db") rmSync(f.database);
    if (kind === "directory-db") { rmSync(f.database); mkdirSync(f.database); }
    if (kind === "outside-db") f.sdk.resolveOpenClawStateSqlitePath = () => join(f.root, "outside");
    await expect(f.run("preflight")).rejects.toThrow();
    expect(f.sdk.mutateConfigFile).not.toHaveBeenCalled();
  });

  it("silences only routing and failure delivery, preserving the job definition", async () => {
    const f = fixture();
    const next = silenceCronJob(f.job);
    expect(next).toEqual({ ...f.job, delivery: { mode: "none", bestEffort: true, unknown: "keep" }, failureAlert: false });
    await f.run("cron");
    expect(f.sdk.loadCronJobsStoreWithConfigJobsReadOnly).toHaveBeenCalledOnce();
    expect(f.sdk.saveCronJobsStoreChanges).toHaveBeenCalledWith(join(f.stateDir, "cron/jobs.json"),
      { version: 1, jobs: [f.job] }, { version: 1, jobs: [next] });
  });

  it.each(["missing", "revision", "unknown-route"])("rejects %s job state without writes or revision rebaselining", async (kind) => {
    const f = fixture();
    if (kind === "missing") f.sdk.loadCronJobsStoreWithConfigJobsReadOnly.mockResolvedValue({
      store: { version: 1, jobs: [] }, invalidConfigRows: [], jobsFingerprint: "jobs-fingerprint",
    });
    if (kind === "revision") f.sdk.resolveCronJobConfigRevision.mockReturnValue(`sha256:${"b".repeat(43)}`);
    if (kind === "unknown-route") Object.assign(f.job.delivery, { alternateWebhook: "https://example.invalid" });
    await expect(f.run("cron")).rejects.toThrow();
    expect(f.sdk.saveCronJobsStoreChanges).not.toHaveBeenCalled();
  });

  it("rejects changed manifest bytes before loading candidate code", async () => {
    const f = fixture();
    const selected = f.selected();
    writeFileSync(f.manifestPath, "{}");
    const load = vi.fn();
    await expect(executeStateMigration({ phase: "preflight", ...selected }, load)).rejects.toThrow("digest");
    expect(load).not.toHaveBeenCalled();
  });
});
