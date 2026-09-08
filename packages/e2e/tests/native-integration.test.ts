import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Native lifecycle exports are executable JavaScript.
import { integrateCandidate } from "../bin/openclaw-integrate.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup(changeBase = false, changedTree = false) {
  const root = mkdtempSync(join(tmpdir(), "native-integrate-"));
  roots.push(root);
  const path = join(root, "candidate.json");
  const head = "a".repeat(40);
  const tree = "b".repeat(40);
  const base = "c".repeat(40);
  const proofs = { regressions: "test", runtime: "runtime", install: "install" };
  mkdirSync(join(root, "stages"));
  for (const [name, key] of Object.entries(proofs)) writeFileSync(join(root, "stages", `${name}.json`), JSON.stringify({ key, status: "passed" }));
  writeFileSync(path, JSON.stringify({ status: "passed", accumulated: true, repository: { head, tree }, proofs }));
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
});
