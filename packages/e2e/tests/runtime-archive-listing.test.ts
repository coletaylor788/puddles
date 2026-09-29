import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { installRuntime } from "../src/native-package.mjs";
// @ts-expect-error JS lifecycle exports are tested at runtime.
import { fileDigest, treeDigest } from "../src/native-state.mjs";
import { runCommand } from "../src/process-runner.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("installs a real runtime archive whose listing exceeds the generic command capture limit", async () => {
  const root = mkdtempSync(join(tmpdir(), "runtime-archive-listing-"));
  roots.push(root);
  const source = join(root, "source");
  const entry = ["runtime", ...Array.from({ length: 6 }, (_, i) => `${i}-${"x".repeat(98)}`), "value.txt"].join("/");
  mkdirSync(dirname(join(source, entry)), { recursive: true });
  writeFileSync(join(source, entry), "synthetic runtime content\n");
  const identity = { schemaVersion: 1, platform: process.platform, arch: process.arch,
    node: process.version, runtimeSha256: treeDigest(join(source, "runtime"), { portable: true }) };
  writeFileSync(join(source, "runtime-identity.json"), JSON.stringify(identity));
  // Repeated members keep this fixture small while exercising a real tar listing
  // larger than 4 MiB. Extraction still produces the exact declared runtime.
  const members = `runtime-identity.json\n${`${entry}\n`.repeat(7500)}`;
  expect(Buffer.byteLength(members)).toBeGreaterThan(4 * 1024 * 1024);
  const list = join(root, "members.txt");
  writeFileSync(list, members);
  const archive = join(root, "runtime.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", source, "-T", list], { timeout: 15_000 });
  await expect(runCommand("tar", ["-tzf", archive], { capture: true, quiet: true }))
    .rejects.toThrow("Command output exceeded its capture bound");
  const installed = await installRuntime({ ...identity, path: archive, sha256: fileDigest(archive) }, join(root, "installed"));
  expect(readFileSync(join(installed, entry.slice("runtime/".length)), "utf8")).toBe("synthetic runtime content\n");
  expect(treeDigest(installed, { portable: true })).toBe(identity.runtimeSha256);
}, 20_000);
