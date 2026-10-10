import { afterEach, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { createRehearsalTarget } from "../src/native-target.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rehearsal-links-")));
  roots.push(root);
  const install = join(root, "seed/install"), state = join(root, "seed/state");
  mkdirSync(install, { recursive: true });
  mkdirSync(state, { recursive: true });
  writeFileSync(join(install, "runtime.js"), "original runtime");
  writeFileSync(join(root, "seed/service.plist"), "synthetic service");
  const seed = join(root, "seed.json");
  writeFileSync(seed, JSON.stringify({ schema: "puddles.openclaw-rehearsal-seed/v1",
    installDir: install, stateDir: state, plistPath: join(root, "seed/service.plist") }));
  const targetRoot = join(root, "target");
  const target = { purpose: "rehearsal", isolation: { schema: "puddles.openclaw-rehearsal-target/v1", root: targetRoot },
    installDir: join(targetRoot, "install"), stateDir: join(targetRoot, "state"),
    plistPath: join(targetRoot, "service.plist"), backupRoot: join(targetRoot, "backups") };
  const peer = join(state, "npm/projects/plugin/node_modules/plugin/node_modules/openclaw");
  mkdirSync(dirname(peer), { recursive: true });
  return { root, install, state, seed, targetRoot, target, peer };
}

it("relocates a managed plugin's sibling runtime peer and relative alias into the isolated target", () => {
  const f = fixture();
  symlinkSync(relative(dirname(f.peer), f.install), f.peer);
  symlinkSync(relative(f.state, f.peer), join(f.state, "runtime-alias"));
  createRehearsalTarget(f.target, f.seed);
  const copiedPeer = join(f.target.stateDir, relative(f.state, f.peer));
  expect(realpathSync(copiedPeer)).toBe(f.target.installDir);
  expect(realpathSync(join(f.target.stateDir, "runtime-alias"))).toBe(f.target.installDir);
  writeFileSync(join(copiedPeer, "runtime.js"), "isolated runtime");
  expect(readFileSync(join(f.install, "runtime.js"), "utf8")).toBe("original runtime");
  expect(readFileSync(join(f.target.installDir, "runtime.js"), "utf8")).toBe("isolated runtime");
});

it("keeps relative links within a seed tree portable", () => {
  const f = fixture();
  symlinkSync("runtime.js", join(f.install, "entry.js"));
  createRehearsalTarget(f.target, f.seed);
  expect(realpathSync(join(f.target.installDir, "entry.js"))).toBe(join(f.target.installDir, "runtime.js"));
});

it.each(["install", "state"])("rejects an absolute link back into the original %s tree", (name) => {
  const f = fixture();
  symlinkSync(name === "install" ? f.install : f.state, f.peer);
  expect(() => createRehearsalTarget(f.target, f.seed)).toThrow("link outside");
  expect(existsSync(f.targetRoot)).toBe(false);
});

it("rejects a relative link to an undeclared sibling of the two seed trees", () => {
  const f = fixture();
  const unrelated = join(f.root, "seed/unrelated");
  mkdirSync(unrelated);
  symlinkSync(relative(dirname(f.peer), unrelated), f.peer);
  expect(() => createRehearsalTarget(f.target, f.seed)).toThrow("link outside");
  expect(existsSync(f.targetRoot)).toBe(false);
});

it("rejects a valid source link when the target layout would no longer reach its copied referent", () => {
  const f = fixture();
  symlinkSync(relative(dirname(f.peer), f.install), f.peer);
  f.target.installDir = join(f.targetRoot, "different/runtime");
  expect(() => createRehearsalTarget(f.target, f.seed)).toThrow("does not relocate");
  expect(existsSync(f.targetRoot)).toBe(false);
  expect(readFileSync(join(f.install, "runtime.js"), "utf8")).toBe("original runtime");
});

it("rejects relocation to the wrong copied tree even when that path exists inside the target", () => {
  const f = fixture();
  symlinkSync(relative(dirname(f.peer), f.install), f.peer);
  f.target.installDir = join(f.targetRoot, "state");
  f.target.stateDir = join(f.targetRoot, "install");
  expect(() => createRehearsalTarget(f.target, f.seed)).toThrow("does not relocate");
  expect(existsSync(f.targetRoot)).toBe(false);
});
