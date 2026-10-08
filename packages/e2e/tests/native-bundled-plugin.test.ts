import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
// @ts-expect-error Runtime JS API.
import { bundleRuntimePlugins } from "../src/native-package.mjs";
// @ts-expect-error Runtime JS API.
import { atomicJson, fileDigest, treeDigest } from "../src/native-state.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const run = async (command: string, args: string[]) => execFileSync(command, args, { encoding: "utf8" });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bundle-plugin-")); roots.push(root);
  const host = join(root, "host"); mkdirSync(host);
  const input = join(root, "input"); const runtime = join(input, "runtime"); mkdirSync(runtime, { recursive: true });
  atomicJson(join(runtime, "package.json"), { name: "synthetic-plugin", version: "1", openclaw: { runtimeExtensions: ["./index.js"] } });
  atomicJson(join(runtime, "openclaw.plugin.json"), { id: "fixture" });
  writeFileSync(join(runtime, "index.js"), "export default {};\n");
  const identity = { schemaVersion: 1, platform: process.platform, arch: process.arch, node: process.version, runtimeSha256: treeDigest(runtime, { portable: true }) };
  atomicJson(join(input, "runtime-identity.json"), identity);
  const path = join(root, "plugin.tar.gz");
  execFileSync("tar", ["-czf", path, "-C", input, "runtime", "runtime-identity.json"]);
  return { root, host, artifact: { path, sha256: fileDigest(path), ...identity } };
}

it("bundles exact verified plugin bytes and provenance before sealing the host", async () => {
  const { root, host, artifact } = fixture();
  const before = treeDigest(host, { portable: true });
  await bundleRuntimePlugins(host, [{ id: "fixture", artifact }], run);
  expect(treeDigest(join(host, "dist/extensions/fixture"), { portable: true })).toBe(artifact.runtimeSha256);
  const ledger = JSON.parse(readFileSync(join(host, "puddles-bundled-plugins.json"), "utf8"));
  expect(ledger.plugins[0]).toMatchObject({ id: "fixture", artifact: { sha256: artifact.sha256, runtimeSha256: artifact.runtimeSha256 } });
  expect(ledger.plugins[0].artifact.path).toBeUndefined();
  expect(treeDigest(host, { portable: true })).not.toBe(before);
  expect(readdirSync(root).some(name => name.startsWith(".bundled-plugin-"))).toBe(false);
});

it("rejects a plugin ID mismatch and removes only its extraction staging", async () => {
  const { root, host, artifact } = fixture();
  await expect(bundleRuntimePlugins(host, [{ id: "different", artifact }], run)).rejects.toThrow("manifest identity");
  expect(existsSync(join(host, "puddles-bundled-plugins.json"))).toBe(false);
  expect(readdirSync(root).some(name => name.startsWith(".bundled-plugin-"))).toBe(false);
});

it("refuses to overwrite a host plugin or accept an altered archive", async () => {
  const { host, artifact } = fixture();
  mkdirSync(join(host, "dist/extensions/fixture"), { recursive: true });
  await expect(bundleRuntimePlugins(host, [{ id: "fixture", artifact }], run)).rejects.toThrow("collides");
  rmSync(join(host, "dist/extensions/fixture"), { recursive: true });
  writeFileSync(artifact.path, "altered archive");
  await expect(bundleRuntimePlugins(host, [{ id: "fixture", artifact }], run)).rejects.toThrow("digest changed");
});
