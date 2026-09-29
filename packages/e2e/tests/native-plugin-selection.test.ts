import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
// @ts-expect-error Runtime JS API.
import { assertBundledPluginSelections, capturePluginRetirements, retirePluginSelections, validatePluginRetirements } from "../src/native-plugin-selection.mjs";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plugin-retirement-"))); roots.push(root);
  const stateDir = join(root, "state"), runtime = join(root, "runtime");
  const packageDir = join(stateDir, "npm/projects/previous/node_modules/fixture-plugin");
  const markerPath = join(stateDir, "npm/projects/previous/.retained/plugin.json");
  const bundled = join(runtime, "dist/extensions/fixture-plugin");
  mkdirSync(packageDir, { recursive: true }); mkdirSync(bundled, { recursive: true });
  writeFileSync(join(packageDir, "package.json"), '{"name":"fixture-plugin","version":"1"}');
  writeFileSync(join(bundled, "openclaw.plugin.json"), '{"id":"fixture-plugin"}');
  let records: any = { "fixture-plugin": { source: "npm", artifactKind: "npm-pack", installPath: packageDir, version: "1" }, other: { source: "npm", version: "2" } };
  let owned = false; const events: string[] = [];
  const api = {
    clear() {}, inspect() { return { status: "valid" }; }, read() { return structuredClone(records); },
    retainedInfo() { return { markerPath }; },
    async withLease(_options: unknown, run: any) { owned = true; try { return await run({ assertOwned() { expect(owned).toBe(true); } }); } finally { owned = false; } },
    async markRetained({ assertCurrent }: any) { expect(owned).toBe(true); assertCurrent(); events.push("retain"); mkdirSync(join(markerPath, ".."), { recursive: true }); writeFileSync(markerPath, "retained"); return true; },
    async write(next: unknown) { expect(owned).toBe(true); events.push("write"); records = structuredClone(next); },
  };
  return { stateDir, runtime, config: {}, ids: ["fixture-plugin"], api, packageDir, markerPath, events, getRecords: () => records };
}

describe("sealed plugin selection retirement", () => {
  it("preserves a sealed record when Doctor only reorders JSON properties", async () => {
    const f = fixture();
    f.getRecords()["fixture-plugin"].metadata = { a: { first: 1, second: 2 }, b: ["first", "second"] };
    const bindings = await capturePluginRetirements(f, f.api);
    const record = f.getRecords()["fixture-plugin"];
    record.metadata = { b: ["first", "second"], a: { second: 2, first: 1 } };
    f.getRecords()["fixture-plugin"] = Object.fromEntries(Object.entries(record).reverse());
    await expect(retirePluginSelections({ ...f, bindings, apply: true }, f.api)).resolves.toBeUndefined();
    expect(f.getRecords()).toEqual({ other: { source: "npm", version: "2" } });
  });
  it.each(["nested value", "array order"])("refuses a changed %s despite canonical property ordering", async kind => {
    const f = fixture();
    const metadata = { nested: { value: "original" }, ordered: ["first", "second"] };
    f.getRecords()["fixture-plugin"].metadata = metadata;
    const bindings = await capturePluginRetirements(f, f.api);
    if (kind === "nested value") metadata.nested.value = "changed";
    else metadata.ordered.reverse();
    await expect(retirePluginSelections({ ...f, bindings, apply: true }, f.api)).rejects.toThrow();
    expect(f.events).toEqual([]);
  });
  it("checks actual bundled selection independently of captured retirements", async () => {
    const f = fixture(); const id = f.ids[0];
    const source = join(f.runtime, "dist/extensions", id, "index.js"); writeFileSync(source, "// fixture");
    const plugin = { id, enabled: true, origin: "bundled", trust: { reason: "bundled" }, status: "loaded", source };
    let payload: any = { plugin, install: null };
    const execute = async (_command: string, args: string[], options: any) => {
      expect(args.slice(1)).toEqual(["plugins", "inspect", id, "--json"]);
      expect(options.env.OPENCLAW_STATE_DIR).toBe(f.stateDir);
      return JSON.stringify(payload);
    };
    await assertBundledPluginSelections(f, execute);
    for (const changed of [{ origin: "global" }, { trust: { reason: "origin-path" } }, { enabled: false }, { source: join(f.packageDir, "package.json") }]) {
      payload = { plugin: { ...plugin, ...changed }, install: null };
      await expect(assertBundledPluginSelections(f, execute)).rejects.toThrow(/not selected/);
    }
    payload = { plugin, install: { source: "npm" } };
    await expect(assertBundledPluginSelections(f, execute)).rejects.toThrow(/not selected/);
  });
  it("captures a schema-one SQLite selection from committed WAL without touching the source", async () => {
    const f = fixture();
    const expected = await capturePluginRetirements(f, f.api);
    mkdirSync(join(f.stateDir, "state"));
    const path = join(f.stateDir, "state/openclaw.sqlite");
    const db = new DatabaseSync(path);
    try {
      db.exec("PRAGMA journal_mode=WAL; PRAGMA user_version=1; CREATE TABLE installed_plugin_index(index_key TEXT PRIMARY KEY, install_records_json TEXT, plugins_json TEXT, diagnostics_json TEXT)");
      db.prepare("INSERT INTO installed_plugin_index VALUES (?, ?, '[]', '[]')").run("installed-plugin-index", JSON.stringify(f.getRecords()));
      const before = [path, `${path}-wal`, `${path}-shm`].map(p => readFileSync(p));
      const reader = { ...f.api, read: () => ({}) };
      expect(await capturePluginRetirements(f, reader)).toEqual(expected);
      expect([path, `${path}-wal`, `${path}-shm`].map(p => readFileSync(p))).toEqual(before);
      db.prepare("UPDATE installed_plugin_index SET install_records_json = ?").run('{"fixture-plugin":{"version":"conflict"}}');
      await expect(capturePluginRetirements(f, f.api)).rejects.toThrow(/disagree/);
      db.prepare("UPDATE installed_plugin_index SET install_records_json = ?").run('[]');
      await expect(capturePluginRetirements(f, reader)).rejects.toThrow(/Invalid legacy/);
    } finally { db.close(); }
  });
  it("captures legacy JSON records and rejects conflicting or malformed sidecars", async () => {
    const f = fixture(); const expected = await capturePluginRetirements(f, f.api);
    mkdirSync(join(f.stateDir, "plugins"));
    const path = join(f.stateDir, "plugins/installs.json");
    writeFileSync(path, JSON.stringify({ installRecords: f.getRecords(), plugins: [], diagnostics: [] }));
    expect(await capturePluginRetirements(f, { ...f.api, read: () => ({}) })).toEqual(expected);
    writeFileSync(path, JSON.stringify({ installRecords: { "fixture-plugin": { version: "conflict" } }, plugins: [], diagnostics: [] }));
    await expect(capturePluginRetirements(f, f.api)).rejects.toThrow(/disagree/);
    writeFileSync(path, '{"installRecords":[]}');
    await expect(capturePluginRetirements(f, f.api)).rejects.toThrow(/Invalid legacy/);
  });
  it("preflights without mutation and retains old files while preserving unrelated records under the lifecycle lease", async () => {
    const f = fixture(); const bindings = await capturePluginRetirements(f, f.api);
    await retirePluginSelections({ ...f, bindings }, f.api);
    expect(f.events).toEqual([]); expect(existsSync(f.markerPath)).toBe(false);
    await retirePluginSelections({ ...f, bindings, apply: true }, f.api);
    expect(f.events).toEqual(["retain", "write"]);
    expect(f.getRecords()).toEqual({ other: { source: "npm", version: "2" } });
    expect(readFileSync(join(f.packageDir, "package.json"), "utf8")).toContain('"version":"1"');
  });
  it("captures no retirement when the external selection is absent, even with a reader-only seed", async () => {
    const f = fixture(); const bindings = await capturePluginRetirements(f, f.api);
    await retirePluginSelections({ ...f, bindings, apply: true }, f.api);
    expect(await capturePluginRetirements(f, f.api)).toEqual([]);
    rmSync(join(f.runtime, "dist/extensions/fixture-plugin"), { recursive: true });
    expect(await capturePluginRetirements(f, f.api)).toEqual([]);
  });
  it.each(["record", "package", "marker", "replacement", "legacy"])("refuses %s drift before any mutation", async kind => {
    const f = fixture(); const bindings = await capturePluginRetirements(f, f.api);
    if (kind === "record") f.getRecords()["fixture-plugin"].version = "changed";
    if (kind === "package") writeFileSync(join(f.packageDir, "extra"), "changed");
    if (kind === "marker") { mkdirSync(join(f.markerPath, ".."), { recursive: true }); writeFileSync(f.markerPath, "changed"); }
    if (kind === "replacement") rmSync(join(f.runtime, "dist/extensions/fixture-plugin"), { recursive: true });
    if (kind === "legacy") f.config = { plugins: { installs: { "fixture-plugin": f.getRecords()["fixture-plugin"] } } };
    await expect(retirePluginSelections({ ...f, bindings, apply: true }, f.api)).rejects.toThrow();
    expect(f.events).toEqual([]);
  });
  it("rejects paths outside the state snapshot and duplicate selections", async () => {
    const f = fixture(); const bindings = await capturePluginRetirements(f, f.api);
    expect(() => validatePluginRetirements([...bindings, ...bindings])).toThrow();
    expect(() => validatePluginRetirements([{ ...bindings[0], packagePath: "../live" }])).toThrow();
    f.getRecords()["fixture-plugin"].installPath = f.runtime;
    await expect(capturePluginRetirements(f, f.api)).rejects.toThrow(/escapes/);
  });
});
