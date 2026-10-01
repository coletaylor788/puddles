import { afterEach, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Executable lifecycle module.
import { snapshotMergedBatch } from "../src/merged-batch.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const agent = { id: "release-owner", contact: "thread:release-owner" };
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "merged-batch-"))); roots.push(root);
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  const run = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  run("init", "--bare", remote);
  run("clone", remote, work);
  const git = (...args: string[]) => run("-C", work, ...args);
  git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("switch", "-c", "main");
  const commit = (name: string) => {
    writeFileSync(join(work, "content"), name);
    git("add", "content");
    git("-c", "commit.gpgsign=false", "commit", "-m", name);
    return git("rev-parse", "HEAD");
  };
  const base = commit("deployed");
  const selected = commit("reviewed repair");
  const later = commit("unrelated later feature");
  git("push", "origin", "main");
  const repository = { id: "public", root: work, base, owners: { [selected]: agent, [later]: agent } };
  return { git, commit, base, selected, later, repository };
}

it("pins a reviewed merged ancestor and attributes only its included commits", async () => {
  const f = fixture();
  const result = await snapshotMergedBatch({ agent, repositories: [{ ...f.repository,
    reviewedHead: f.selected, owners: { [f.selected]: agent } }] });
  expect(result.sources).toEqual([{ id: "public", head: f.selected, base: f.base,
    tree: f.git("rev-parse", `${f.selected}^{tree}`), commits: [{ sha: f.selected, agent }] }]);
  const latest = await snapshotMergedBatch({ agent, repositories: [f.repository] });
  expect(latest.sources[0].head).toBe(f.later);
  expect(latest.sources[0].commits).toHaveLength(2);
});

it("rejects an unmerged local head and a merged head before the deployed base", async () => {
  const f = fixture();
  const unmerged = f.commit("unmerged change");
  await expect(snapshotMergedBatch({ agent, repositories: [{ ...f.repository,
    reviewedHead: unmerged, owners: { ...f.repository.owners, [unmerged]: agent } }] })).rejects.toThrow();
  await expect(snapshotMergedBatch({ agent, repositories: [{ ...f.repository,
    base: f.later, reviewedHead: f.selected }] })).rejects.toThrow();
});

it("requires exact reviewed SHAs and owner attribution even for an earlier merged head", async () => {
  const f = fixture();
  await expect(snapshotMergedBatch({ agent, repositories: [{ ...f.repository,
    reviewedHead: "main" }] })).rejects.toThrow("Select a repository");
  await expect(snapshotMergedBatch({ agent, repositories: [{ ...f.repository,
    reviewedHead: f.selected, owners: {} }] })).rejects.toThrow("Resolve the feature owner");
  f.git("-c", "tag.gpgsign=false", "tag", "-a", "reviewed", f.selected, "-m", "annotated tag");
  await expect(snapshotMergedBatch({ agent, repositories: [{ ...f.repository,
    reviewedHead: f.git("rev-parse", "reviewed") }] })).rejects.toThrow("commit object");
});
