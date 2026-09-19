import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const spawnSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawnSync }));

// @ts-expect-error JS lifecycle exports are tested at runtime.
import { materializeRuntime, resolveRuntimeSelectionTimeoutMs } from "../src/native-package.mjs";

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

describe("runtime package selection timeout", () => {
  it("keeps the release default and bounds the explicit DEV override", () => {
    expect(resolveRuntimeSelectionTimeoutMs()).toBe(60_000);
    expect(resolveRuntimeSelectionTimeoutMs({ devSelectionTimeoutMs: 180_000 })).toBe(180_000);
    expect(resolveRuntimeSelectionTimeoutMs({ devSelectionTimeoutMs: 600_000 })).toBe(600_000);
    for (const value of [179_999, 600_001, 180_000.5, "180000", null]) {
      expect(() => resolveRuntimeSelectionTimeoutMs({ devSelectionTimeoutMs: value }))
        .toThrow("between 180000 and 600000");
    }
  });

  it("passes the DEV bound only to npm inventory selection", () => {
    const { root, source } = fixture();
    spawnSync.mockReturnValue({
      error: undefined,
      status: 0,
      stdout: JSON.stringify([{ files: [{ path: "index.js" }] }]),
    });

    materializeRuntime(source, join(root, "runtime"), { devSelectionTimeoutMs: 180_000 });

    expect(spawnSync).toHaveBeenCalledOnce();
    expect(spawnSync.mock.calls[0]?.[0]).toBe("npm");
    expect(spawnSync.mock.calls[0]?.[1]).toEqual([
      "pack", "--dry-run", "--json", "--ignore-scripts",
    ]);
    expect(spawnSync.mock.calls[0]?.[2]).toMatchObject({
      cwd: source,
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  });

  it("reports the selected DEV bound when npm inventory times out", () => {
    const { root, source } = fixture();
    spawnSync.mockReturnValue({
      error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
      status: null,
      stdout: "",
    });

    expect(() => materializeRuntime(
      source,
      join(root, "runtime"),
      { devSelectionTimeoutMs: 240_000 },
    )).toThrow("selection exceeded 240000ms");
    expect(existsSync(join(root, "runtime"))).toBe(true);
  });
});
