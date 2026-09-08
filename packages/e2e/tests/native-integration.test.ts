import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Native lifecycle exports are executable JavaScript.
import { integrateCandidate } from "../bin/openclaw-integrate.mjs";
// @ts-expect-error Native lifecycle exports are executable JavaScript.
import { jsonDigest } from "../src/native-state.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup(changeBase = false, changedTree = false) {
  const root = mkdtempSync(join(tmpdir(), "native-integrate-"));
  roots.push(root);
  const path = join(root, "candidate.json");
  const head = "a".repeat(40);
  const tree = "b".repeat(40);
  const base = "c".repeat(40);
  const artifact = { path: "/synthetic/runtime.tar.gz", sha256: "1".repeat(64), runtimeSha256: "2".repeat(64),
    schemaVersion: 1, platform: "darwin", arch: "arm64", node: "v22.23.2" };
  const proofs: Record<string, string> = {};
  mkdirSync(join(root, "stages"));
  for (const name of ["regressions", "runtime", "install"]) {
    const inputs = name === "runtime" ? { artifact, additionalArtifacts: [] } : name === "install" ? { artifact } : { source: "synthetic" };
    const key = jsonDigest(inputs);
    proofs[name] = key;
    writeFileSync(join(root, "stages", `${name}.json`), JSON.stringify({ inputs, key, status: "passed" }));
  }
  writeFileSync(path, JSON.stringify({ status: "passed", accumulated: true, repository: { head, tree }, artifact, proofs }));
  const calls: string[][] = [];
  let reads = 0;
  const run = async (command: string, args: string[]) => {
    expect(command).toBe("gh");
    calls.push(args);
    const endpoint = args[1];
    if (endpoint.endsWith("/pulls/123")) {
      reads++;
      return JSON.stringify({ state: "open", draft: false, mergeable: true, mergeable_state: "clean", head: { sha: head }, base: { ref: "main", sha: changeBase && reads > 1 ? "d".repeat(40) : base } });
    }
    if (endpoint.endsWith("/merge")) return JSON.stringify({ merged: true, sha: "e".repeat(40) });
    if (endpoint.includes("/git/commits/")) return JSON.stringify({ tree: { sha: changedTree ? "f".repeat(40) : tree } });
    if (endpoint.includes("/compare/")) return JSON.stringify({ status: "ahead" });
    return JSON.stringify({ default_branch: "main", allow_squash_merge: true });
  };
  return { path, root, calls, run };
}
describe("source integration before activation", () => {
  it("binds merge to exact head and records the confirmed resulting tree", async () => {
    const f = setup();
    await integrateCandidate(f.path, "example/public-repo", 123, f.run);
    expect(f.calls.find((args) => args.includes("PUT"))).toContain(`sha=${"a".repeat(40)}`);
    expect(JSON.parse(readFileSync(join(f.root, "integration.json"), "utf8")).tree).toBe("b".repeat(40));
    expect(f.calls.every((args) => !args.includes("deploy"))).toBe(true);
  });
  it("does not merge if the base changed during eligibility checks", async () => {
    const f = setup(true);
    await expect(integrateCandidate(f.path, "example/public-repo", 123, f.run)).rejects.toThrow("changed");
    expect(f.calls.some((args) => args.includes("PUT"))).toBe(false);
  });
  it("blocks activation if a race produced a different integrated tree", async () => {
    const f = setup(false, true);
    await expect(integrateCandidate(f.path, "example/public-repo", 123, f.run)).rejects.toThrow("activation is blocked");
  });
  it("rejects root or additional artifacts not covered by the retained proofs before integration", async () => {
    const f = setup();
    const receipt = JSON.parse(readFileSync(f.path, "utf8"));
    writeFileSync(f.path, JSON.stringify({ ...receipt, artifact: { ...receipt.artifact, sha256: "3".repeat(64) } }));
    await expect(integrateCandidate(f.path, "example/public-repo", 123, f.run)).rejects.toThrow("differs from rehearsal");
    writeFileSync(f.path, JSON.stringify({ ...receipt, additionalArtifacts: [{ id: "auxiliary", artifact: receipt.artifact }] }));
    await expect(integrateCandidate(f.path, "example/public-repo", 123, f.run)).rejects.toThrow("proof is missing");
    expect(f.calls).toEqual([]);
  });
  it("allows transport path changes without changing artifact identity or rewriting proof inputs", async () => {
    const f = setup();
    const receipt = JSON.parse(readFileSync(f.path, "utf8"));
    receipt.artifact.path = "/transported/runtime.tar.gz";
    writeFileSync(f.path, JSON.stringify(receipt));
    await integrateCandidate(f.path, "example/public-repo", 123, f.run);
    expect(f.calls.some((args) => args.includes("PUT"))).toBe(true);
  });
  it("accepts a fully bound additional artifact and rejects edited proof input metadata", async () => {
    const f = setup();
    const receipt = JSON.parse(readFileSync(f.path, "utf8"));
    const extra = { id: "auxiliary", artifact: { ...receipt.artifact, sha256: "3".repeat(64), runtimeSha256: "4".repeat(64) } };
    receipt.additionalArtifacts = [extra];
    const inputs = { id: extra.id, artifact: extra.artifact };
    const key = jsonDigest(inputs);
    receipt.proofs["install-additional-0"] = key;
    writeFileSync(join(f.root, "stages/install-additional-0.json"), JSON.stringify({ key, inputs, status: "passed" }));
    const runtimePath = join(f.root, "stages/runtime.json");
    const runtime = JSON.parse(readFileSync(runtimePath, "utf8"));
    runtime.inputs.additionalArtifacts = [extra];
    runtime.key = jsonDigest(runtime.inputs);
    receipt.proofs.runtime = runtime.key;
    writeFileSync(runtimePath, JSON.stringify(runtime));
    writeFileSync(f.path, JSON.stringify(receipt));
    await integrateCandidate(f.path, "example/public-repo", 123, f.run);
    f.calls.length = 0;
    runtime.inputs.additionalArtifacts[0].artifact.sha256 = "5".repeat(64);
    writeFileSync(runtimePath, JSON.stringify(runtime));
    await expect(integrateCandidate(f.path, "example/public-repo", 123, f.run)).rejects.toThrow("proof chain");
    expect(f.calls).toEqual([]);
  });
});
