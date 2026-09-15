import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Native lifecycle exports are executable JavaScript.
import { integrateCandidate } from "../bin/openclaw-integrate.mjs";
// @ts-expect-error Native release modules are executable JavaScript.
import { certifyRelease, createBuildReceipt, createSourceGate, createTargetProof, promoteRelease } from "../src/native-release.mjs";
// @ts-expect-error Native lifecycle exports are executable JavaScript.
import { fileDigest, jsonDigest } from "../src/native-state.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function passedStage(root: string, name: string) {
  const inputs = { fixture: name };
  const key = jsonDigest(inputs);
  mkdirSync(join(root, "stages"), { recursive: true });
  writeFileSync(join(root, "stages", `${name}.json`), JSON.stringify({
    schemaVersion: 1, name, status: "passed", inputs, key, outputs: {},
  }));
  return key;
}

function setup(changeBase = false, changedTree = false) {
  const root = mkdtempSync(join(tmpdir(), "native-integrate-"));
  roots.push(root);
  const path = join(root, "release.json");
  const head = "a".repeat(40);
  const tree = "b".repeat(40);
  const base = "c".repeat(40);
  const archive = join(root, "runtime.tar.gz");
  writeFileSync(archive, "runtime");
  const artifact = {
    path: archive,
    sha256: fileDigest(archive),
    runtimeSha256: "2".repeat(64),
    schemaVersion: 1,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  };
  const build = createBuildReceipt({
    repository: { head, tree },
    source: {
      ref: "d".repeat(40),
      sha256: "3".repeat(64),
      buildInputsSha256: "4".repeat(64),
      patchesSha256: "5".repeat(64),
      extensionSha256: "none",
    },
    composition: { extensionSha256: "none" },
    artifact,
    additionalArtifacts: [],
    preparedFiles: [],
    tools: {
      node: process.version,
      nodeBinary: "6".repeat(64),
      platform: process.platform,
      arch: process.arch,
      manager: "synthetic",
      npm: "synthetic",
    },
    proofs: {
      prepare: "7".repeat(64),
      dependencies: "8".repeat(64),
      build: "9".repeat(64),
      package: "0".repeat(64),
    },
  });
  passedStage(root, "regressions");
  passedStage(root, "install");
  passedStage(root, "runtime");
  const success = join(root, "success");
  const rollback = join(root, "rollback");
  for (const [directory, status] of [[success, "healthy"], [rollback, "rolled-back"]] as const) {
    mkdirSync(directory);
    writeFileSync(join(directory, "recovery.json"), JSON.stringify({
      schemaVersion: 1,
      transaction: status,
      status,
      target: "1".repeat(64),
      artifact: artifact.sha256,
    }));
  }
  writeFileSync(join(rollback, "failure.json"), "{}");
  const sourceGate = createSourceGate(build, root, { tests: ["synthetic"] });
  const targetProof = createTargetProof(build, root, success, rollback);
  const certification = certifyRelease(build, sourceGate, targetProof);
  const release = promoteRelease(build, sourceGate, targetProof, certification);
  writeFileSync(path, JSON.stringify(release));
  const calls: string[][] = [];
  let reads = 0;
  const run = async (command: string, args: string[]) => {
    expect(command).toBe("gh");
    calls.push(args);
    const endpoint = args[1];
    if (endpoint.endsWith("/pulls/123")) {
      reads++;
      return JSON.stringify({
        state: "open",
        draft: false,
        mergeable: true,
        mergeable_state: "clean",
        head: { sha: head },
        base: { ref: "main", sha: changeBase && reads > 1 ? "e".repeat(40) : base },
      });
    }
    if (endpoint.endsWith("/merge")) return JSON.stringify({ merged: true, sha: "f".repeat(40) });
    if (endpoint.includes("/git/commits/")) {
      return JSON.stringify({ tree: { sha: changedTree ? "0".repeat(40) : tree } });
    }
    if (endpoint.includes("/compare/")) return JSON.stringify({ status: "ahead" });
    return JSON.stringify({ default_branch: "main", allow_squash_merge: true });
  };
  return { path, root, calls, run, release, build, sourceGate, targetProof, certification };
}

describe("source integration before activation", () => {
  it("binds merge to the exact eligible head and records the resulting tree", async () => {
    const fixture = setup();
    await integrateCandidate(fixture.path, "example/public-repo", 123, fixture.run);
    expect(fixture.calls.find((args) => args.includes("PUT"))).toContain(`sha=${"a".repeat(40)}`);
    expect(JSON.parse(readFileSync(join(fixture.root, "integration.json"), "utf8")).tree).toBe("b".repeat(40));
  });

  it("does not merge if the base changed during eligibility checks", async () => {
    const fixture = setup(true);
    await expect(integrateCandidate(fixture.path, "example/public-repo", 123, fixture.run)).rejects.toThrow("changed");
    expect(fixture.calls.some((args) => args.includes("PUT"))).toBe(false);
  });

  it("blocks activation if integration produces a different tree", async () => {
    const fixture = setup(false, true);
    await expect(integrateCandidate(fixture.path, "example/public-repo", 123, fixture.run))
      .rejects.toThrow("activation is blocked");
  });

  it("rejects noneligible build and certification receipts before GitHub access", async () => {
    const fixture = setup();
    writeFileSync(fixture.path, JSON.stringify(fixture.build));
    await expect(integrateCandidate(fixture.path, "example/public-repo", 123, fixture.run))
      .rejects.toThrow("production-eligible");
    writeFileSync(fixture.path, JSON.stringify(fixture.certification));
    await expect(integrateCandidate(fixture.path, "example/public-repo", 123, fixture.run))
      .rejects.toThrow("production-eligible");
    expect(fixture.calls).toEqual([]);
  });

  it("allows transport path relocation without changing immutable release identity", async () => {
    const fixture = setup();
    const relocated = join(fixture.root, "transported.tar.gz");
    writeFileSync(relocated, readFileSync(fixture.build.artifact.path));
    fixture.release.artifact.path = relocated;
    fixture.release.evidence.build.artifact.path = relocated;
    writeFileSync(fixture.path, JSON.stringify(fixture.release));
    await integrateCandidate(fixture.path, "example/public-repo", 123, fixture.run);
    expect(fixture.calls.some((args) => args.includes("PUT"))).toBe(true);
  });

  it("rejects edited source, target, certification, and artifact evidence", async () => {
    const fixture = setup();
    for (const mutate of [
      () => { fixture.release.evidence.sourceGate.inventory.tests = ["edited"]; },
      () => { fixture.release.evidence.targetProof.deployment.success.status = "rolled-back"; },
      () => { fixture.release.evidence.certification.sourceGateSha256 = "0".repeat(64); },
      () => { fixture.release.artifact.sha256 = "0".repeat(64); },
    ]) {
      const current = structuredClone(fixture.release);
      mutate();
      writeFileSync(fixture.path, JSON.stringify(fixture.release));
      await expect(integrateCandidate(fixture.path, "example/public-repo", 123, fixture.run)).rejects.toThrow();
      fixture.release = current;
    }
    expect(fixture.calls).toEqual([]);
  });
});
