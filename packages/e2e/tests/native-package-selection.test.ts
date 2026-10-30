import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawnSync,
}));

// @ts-expect-error JS lifecycle exports are tested at runtime.
import { materializeRuntime, materializeRuntimeForDev, selectRuntimePackageFiles } from "../src/native-package.mjs";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "native-package-timeout-"));
  roots.push(root);
  const source = join(root, "source");
  mkdirSync(source);
  writeFileSync(join(source, "package.json"), JSON.stringify({
    name: "synthetic-runtime",
    version: "1.0.0",
    files: ["index.js"],
  }));
  writeFileSync(join(source, "index.js"), "export {};");
  return { root, source };
}

afterEach(() => {
  spawnSync.mockReset();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("runtime package selection", () => {
  it("keeps release materialization on its synchronous 60-second selection", () => {
    const { root, source } = fixture();
    spawnSync.mockReturnValue({
      error: undefined,
      status: 0,
      stdout: JSON.stringify([{ files: [{ path: "index.js" }] }]),
    });

    materializeRuntime(source, join(root, "runtime"));

    expect(spawnSync).toHaveBeenCalledOnce();
    expect(spawnSync.mock.calls[0]?.[0]).toBe("npm");
    expect(spawnSync.mock.calls[0]?.[1]).toEqual([
      "pack", "--dry-run", "--json", "--ignore-scripts",
    ]);
    expect(spawnSync.mock.calls[0]?.[2]).toMatchObject({
      cwd: source,
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  });

  it("reports the fixed release bound when synchronous inventory times out", () => {
    const { root, source } = fixture();
    spawnSync.mockReturnValue({
      error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
      status: null,
      stdout: "",
    });

    expect(() => materializeRuntime(source, join(root, "runtime")))
      .toThrow("selection exceeded 60000ms");
    expect(existsSync(join(root, "runtime"))).toBe(false);
  });

  it("uses npm's authoritative packlist before DEV materialization", async () => {
    const { root, source } = fixture();

    expect(await selectRuntimePackageFiles(source)).toContain("index.js");
    await materializeRuntimeForDev(source, join(root, "runtime"));

    expect(spawnSync).not.toHaveBeenCalled();
    expect(existsSync(join(root, "runtime/index.js"))).toBe(true);
  });

  it("packages sibling pnpm dependencies from the real plugin location without copying host peers", async () => {
    const { root, source } = fixture();
    const store = join(source, "node_modules/.pnpm/plugin/node_modules");
    const plugin = join(store, "plugin"), dependency = join(store, "fixture-dependency");
    mkdirSync(plugin, { recursive: true }); mkdirSync(dependency);
    writeFileSync(join(plugin, "package.json"), JSON.stringify({ name: "plugin", version: "1.0.0",
      files: ["index.js"], dependencies: { "fixture-dependency": "1.0.0" }, peerDependencies: { openclaw: "*" } }));
    writeFileSync(join(plugin, "index.js"), "export {};\n");
    writeFileSync(join(dependency, "package.json"), JSON.stringify({ name: "fixture-dependency", version: "1.0.0" }));
    writeFileSync(join(dependency, "index.js"), "module.exports = 'selected';\n");
    const link = join(source, "node_modules/plugin"); symlinkSync(plugin, link);
    const output = join(root, "runtime");
    await materializeRuntimeForDev(link, output);
    const selected = join(output, "node_modules/fixture-dependency");
    expect(realpathSync(selected).startsWith(realpathSync(output) + "/")).toBe(true);
    expect(readFileSync(join(selected, "index.js"), "utf8")).toContain("selected");
    expect(existsSync(join(output, "node_modules/openclaw"))).toBe(false);
  });
});
