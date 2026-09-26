import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import {
  chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Native release modules are executable JavaScript.
import { certifyRelease, createBuildReceipt, createSourceGate, createTargetProof, exportReleaseBundle, importReleaseBundle, promoteRelease, verifyBuildReceipt } from "../src/native-release.mjs";
// @ts-expect-error Native lifecycle modules are executable JavaScript.
import { fileDigest, jsonDigest, treeDigest } from "../src/native-state.mjs";
// @ts-expect-error Native retention modules are executable JavaScript.
import { initializeArtifactPool } from "../src/native-retention.mjs";

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function root() {
  const path = mkdtempSync(join(tmpdir(), "native-release-test-"));
  roots.push(path);
  return path;
}
function artifact(directory: string, name: string, bytes: string) {
  const packageRoot = join(directory, `${name}-package`);
  const runtime = join(packageRoot, "runtime");
  mkdirSync(runtime, { recursive: true });
  writeFileSync(join(runtime, "content"), bytes);
  const runtimeSha256 = treeDigest(runtime, { portable: true });
  writeFileSync(join(packageRoot, "runtime-identity.json"), JSON.stringify({
    schemaVersion: 1, platform: process.platform, arch: process.arch,
    node: process.version, runtimeSha256,
  }));
  const path = join(directory, `${name}.tar.gz`);
  execFileSync("tar", ["-czf", path, "-C", packageRoot, "runtime", "runtime-identity.json"]);
  return {
    schemaVersion: 1,
    path,
    sha256: fileDigest(path),
    runtimeSha256,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  };
}
function build(directory: string, extensionSha256 = "none", preparedDirectory = false) {
  const rootArtifact = artifact(directory, "root", "runtime");
  const extraArtifact = artifact(directory, "extra", "additional");
  const prepared = join(directory, preparedDirectory ? "embedding-server" : "model.gguf");
  if (preparedDirectory) {
    mkdirSync(join(prepared, "bin"), { recursive: true });
    chmodSync(prepared, 0o755);
    chmodSync(join(prepared, "bin"), 0o755);
    writeFileSync(join(prepared, "bin", "serve"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(prepared, "config.json"), "{}\n", { mode: 0o644 });
    chmodSync(join(prepared, "bin", "serve"), 0o755);
    chmodSync(join(prepared, "config.json"), 0o644);
  } else {
    writeFileSync(prepared, "model");
  }
  return createBuildReceipt({
    repository: { head: "a".repeat(40), tree: "b".repeat(40) },
    source: {
      ref: "c".repeat(40),
      sha256: "d".repeat(64),
      buildInputsSha256: "e".repeat(64),
      patchesSha256: "f".repeat(64),
      extensionSha256,
    },
    composition: { extensionSha256 },
    tools: {
      node: process.version,
      nodeBinary: "1".repeat(64),
      platform: process.platform,
      arch: process.arch,
      manager: "12.3.4",
      npm: "11.8.0",
    },
    artifact: rootArtifact,
    additionalArtifacts: [{
      id: "managed-runtime",
      artifact: extraArtifact,
      attestation: {
        schema: "puddles.openclaw-extension-artifact/v1",
        sourceSha256: "d".repeat(64),
        packageInputsSha256: "2".repeat(64),
        toolchainSha256: "3".repeat(64),
        artifactSha256: extraArtifact.sha256,
        runtimeSha256: extraArtifact.runtimeSha256,
      },
    }],
    preparedFiles: [{
      id: preparedDirectory ? "embedding-server" : "embedding-model",
      type: preparedDirectory ? "directory" : "file",
      path: prepared,
      sha256: preparedDirectory ? treeDigest(prepared, { portable: true }) : fileDigest(prepared),
    }],
    proofs: {
      prepare: "4".repeat(64),
      dependencies: "5".repeat(64),
      build: "6".repeat(64),
      package: "7".repeat(64),
    },
    stateMigration: { sha256: "8".repeat(64) },
  });
}
function stage(directory: string, name: string, inputs = { fixture: name }) {
  const key = jsonDigest(inputs);
  mkdirSync(join(directory, "stages"), { recursive: true });
  writeFileSync(join(directory, "stages", `${name}.json`), JSON.stringify({
    schemaVersion: 1, name, inputs, key, status: "passed", outputs: {},
  }));
  return key;
}
function recovery(directory: string, name: string, receipt: ReturnType<typeof build>, status: "healthy" | "rolled-back") {
  const path = join(directory, name);
  mkdirSync(path);
  writeFileSync(join(path, "recovery.json"), JSON.stringify({
    schemaVersion: 1,
    status,
    transaction: name,
    target: "9".repeat(64),
    artifact: receipt.artifact.sha256,
  }));
  if (status === "rolled-back") writeFileSync(join(path, "failure.json"), JSON.stringify({ message: "expected drift" }));
  return path;
}

describe("portable OpenClaw release bundle", () => {
  it("preserves prepared directory permissions under an owner-only import umask", async () => {
    const directory = root();
    let bundle = "";
    const buildUmask = process.umask(0o022);
    try {
      const receipt = build(directory, "none", true);
      const receiptPath = join(directory, "build.json");
      writeFileSync(receiptPath, JSON.stringify(receipt));
      bundle = join(directory, "bundle.tar.gz");
      await exportReleaseBundle(receiptPath, bundle, "public");
    } finally {
      process.umask(buildUmask);
    }

    const previousUmask = process.umask(0o077);
    let imported;
    try {
      imported = await importReleaseBundle(bundle, join(root(), "imported"));
    } finally {
      process.umask(previousUmask);
    }

    const prepared = imported.receipt.preparedFiles[0].path;
    const mode = (path: string) => statSync(path).mode & 0o777;
    expect(mode(prepared)).toBe(0o755);
    expect(mode(join(prepared, "bin"))).toBe(0o755);
    expect(mode(join(prepared, "bin", "serve"))).toBe(0o755);
    expect(mode(join(prepared, "config.json"))).toBe(0o644);
    expect(() => verifyBuildReceipt(imported.receipt)).not.toThrow();
  });

  it("imports at a fresh path without builder source or dependencies and preserves immutable identities", async () => {
    const directory = root();
    const receipt = build(directory, "a".repeat(64));
    const receiptPath = join(directory, "build.json");
    writeFileSync(receiptPath, JSON.stringify(receipt));
    const bundle = join(directory, "bundle.tar.gz");
    await exportReleaseBundle(receiptPath, bundle, "local");
    const pool = join(root(), "pool");
    initializeArtifactPool(pool);
    vi.stubEnv("E2E_ARTIFACT_POOL", pool);
    const importedRoot = join(root(), "relocated");
    const imported = await importReleaseBundle(bundle, importedRoot);
    expect(imported.receipt.buildId).toBe(receipt.buildId);
    expect(imported.receipt.artifact.path).toBe(join(importedRoot, "assets/openclaw-runtime.tar.gz"));
    expect(imported.receipt.additionalArtifacts[0].attestation).toEqual(receipt.additionalArtifacts[0].attestation);
    expect(imported.receipt.preparedFiles[0].path).toBe(join(importedRoot, "prepared/embedding-model"));
    rmSync(directory, { recursive: true });
    expect(() => verifyBuildReceipt(imported.receipt)).not.toThrow();
    expect(JSON.parse(readFileSync(join(pool, "references/current.json"), "utf8")).objectIds)
      .toEqual([`success-${receipt.buildId.slice(0, 48)}`]);
  });

  it("rejects local composition from the public export profile", async () => {
    const directory = root();
    const receiptPath = join(directory, "build.json");
    writeFileSync(receiptPath, JSON.stringify(build(directory, "a".repeat(64))));
    await expect(exportReleaseBundle(receiptPath, join(directory, "public.tar.gz"), "public"))
      .rejects.toThrow("rejects local extension");
  });

  it("rejects corrupted assets and undeclared bundle files", async () => {
    const directory = root();
    const receiptPath = join(directory, "build.json");
    writeFileSync(receiptPath, JSON.stringify(build(directory)));
    const bundle = join(directory, "bundle.tar.gz");
    await exportReleaseBundle(receiptPath, bundle, "public");
    const unpacked = join(directory, "unpacked");
    mkdirSync(unpacked);
    execFileSync("tar", ["-xzf", bundle, "-C", unpacked]);
    writeFileSync(join(unpacked, "assets/openclaw-runtime.tar.gz"), "corrupt");
    const corrupt = join(directory, "corrupt.tar.gz");
    execFileSync("tar", ["-czf", corrupt, "-C", unpacked, "."]);
    await expect(importReleaseBundle(corrupt, join(directory, "corrupt-import"))).rejects.toThrow("differs");
    cpSync(bundle, corrupt);
    rmSync(unpacked, { recursive: true });
    mkdirSync(unpacked);
    execFileSync("tar", ["-xzf", corrupt, "-C", unpacked]);
    writeFileSync(join(unpacked, "undeclared"), "unexpected");
    const extra = join(directory, "extra.tar.gz");
    execFileSync("tar", ["-czf", extra, "-C", unpacked, "."]);
    await expect(importReleaseBundle(extra, join(directory, "extra-import"))).rejects.toThrow(/invalid path|undeclared/);
  });
});

describe("release proof chain", () => {
  it("derives source and deployment evidence from retained stages and journals", () => {
    const directory = root();
    const receipt = build(directory);
    const regression = stage(directory, "regressions");
    const install = stage(directory, "install");
    const runtime = stage(directory, "runtime");
    const source = createSourceGate(receipt, directory, { tests: ["synthetic"] });
    expect(source.stages.regressions).toBe(regression);
    const target = createTargetProof(
      receipt,
      directory,
      recovery(directory, "healthy", receipt, "healthy"),
      recovery(directory, "rollback", receipt, "rolled-back"),
    );
    expect(target.stages).toMatchObject({ install, runtime });
    const certification = certifyRelease(receipt, source, target);
    expect(certification.eligibility).toBe("certified-not-production");
    expect(promoteRelease(receipt, source, target, certification).eligibility).toBe("production");
  });

  it("rejects fabricated stage success and rollback summaries", () => {
    const directory = root();
    const receipt = build(directory);
    stage(directory, "regressions");
    stage(directory, "install");
    stage(directory, "runtime");
    const source = createSourceGate(receipt, directory, {});
    const success = recovery(directory, "healthy", receipt, "healthy");
    const rollback = recovery(directory, "rollback", receipt, "rolled-back");
    writeFileSync(join(rollback, "recovery.json"), JSON.stringify({
      schemaVersion: 1, status: "rolled-back", transaction: "rollback",
      target: "9".repeat(64), artifact: "0".repeat(64),
    }));
    expect(() => createTargetProof(receipt, directory, success, rollback)).toThrow("does not match");
    const stagePath = join(directory, "stages/regressions.json");
    const edited = JSON.parse(readFileSync(stagePath, "utf8"));
    edited.inputs = { fixture: "edited" };
    writeFileSync(stagePath, JSON.stringify(edited));
    expect(() => createSourceGate(receipt, directory, {})).toThrow("invalid");
    expect(() => certifyRelease(receipt, source, {
      schema: "puddles.openclaw-target-proof/v1",
      schemaVersion: 1,
      status: "passed",
      buildId: receipt.buildId,
      stages: {
        install: "1".repeat(64), runtime: "2".repeat(64),
        "deployment-success": "3".repeat(64), "deployment-rollback": "4".repeat(64),
      },
      deployment: { success: true, rollback: true },
    })).toThrow("deployment journals");
  });
});
