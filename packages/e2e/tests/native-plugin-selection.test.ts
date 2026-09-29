import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// @ts-expect-error Runtime JS API.
import { capturePluginRetirements, retirePluginSelections, validatePluginRetirements } from "../src/native-plugin-selection.mjs";

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
