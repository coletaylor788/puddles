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
  const archive = join(root, "runtime.tar.gz");
  // Read the two fixture files once. Asking tar to reopen the same deep path
  // 7,500 times adds filesystem metadata work unrelated to listing/extraction.
  execFileSync("python3", ["-c", `
import io, pathlib, sys, tarfile
source, entry, output = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
with tarfile.open(output, "w:gz") as archive:
    archive.add(source / "runtime-identity.json", arcname="runtime-identity.json")
    member = archive.gettarinfo(source / entry, arcname=entry)
    content = (source / entry).read_bytes()
    for _ in range(7500):
        archive.addfile(member, io.BytesIO(content))
`, source, entry, archive], { timeout: 15_000 });
  // Bound each real tar operation before the test deadline so its process has
  // exited before afterEach removes the fixture, including on a slow host.
  const run = (command: string, args: string[], options = {}) =>
    runCommand(command, args, { ...options, timeoutMs: 30_000, killGraceMs: 1_000 });
  await expect(run("tar", ["-tzf", archive], { capture: true, quiet: true }))
    .rejects.toThrow("Command output exceeded its capture bound");
  const installed = await installRuntime({ ...identity, path: archive, sha256: fileDigest(archive) }, join(root, "installed"), run);
  expect(readFileSync(join(installed, entry.slice("runtime/".length)), "utf8")).toBe("synthetic runtime content\n");
  expect(treeDigest(installed, { portable: true })).toBe(identity.runtimeSha256);
}, 120_000);
