#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicJson } from "../src/native-state.mjs";
import { verifyProductionRelease } from "../src/native-release.mjs";
import { verifyMergeEligibility } from "../src/merge-eligibility.mjs";
import { runCommand } from "../src/process-runner.mjs";

// This command finishes before activation starts. A remote race can block
// delivery, but never becomes a reason to roll back a healthy live runtime.
export async function integrateCandidate(receiptPath, repository, number, run = runCommand) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[1-9][0-9]*$/.test(String(number))) throw new Error("Integration requires an explicit repository and pull request");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const featureMerge = receipt.schema === "puddles.merge-eligibility/v1";
  if (featureMerge) verifyMergeEligibility(receipt);
  else verifyProductionRelease(receipt); // Retained releases remain resumable.
  if (!/^[a-f0-9]{40}$/.test(receipt.repository?.head ?? "") ||
      !/^[a-f0-9]{40}$/.test(receipt.repository?.tree ?? "")) throw new Error("A frozen cumulative candidate is required");
  const api = async (path, args = []) => JSON.parse(await run("gh", ["api", path, ...args], { capture: true, quiet: true, timeoutMs: 60_000 }));
  const pullPath = `repos/${repository}/pulls/${number}`;
  const repo = await api(`repos/${repository}`);
  const ready = (pull) => {
    if (pull.state !== "open" || pull.draft || !pull.mergeable || pull.mergeable_state !== "clean" ||
        pull.head.sha !== receipt.repository.head) throw new Error("Pull request is not the exact eligible candidate");
    if (pull.base.ref !== repo.default_branch) throw new Error("Integration must target the default branch");
    return pull;
  };
  const pull = ready(await api(pullPath));
  if (featureMerge) {
    const source = await api(`repos/${repository}/git/commits/${pull.head.sha}`);
    if (source.tree.sha !== receipt.repository.tree) throw new Error("Feature tree differs from validated source");
  } else {
    const comparison = await api(`repos/${repository}/compare/${pull.base.sha}...${pull.head.sha}`);
    if (!["ahead", "identical"].includes(comparison.status)) throw new Error("Candidate must include the current base");
  }
  let current = ready(await api(pullPath));
  if (featureMerge) {
    // Other feature owners may advance main. Refresh its server-side mergeability
    // without invalidating evidence for this unchanged feature head.
    for (let attempt = 0, previousBase = pull.base.sha;
      current.base.sha !== previousBase && attempt < 2; attempt++) {
      previousBase = current.base.sha;
      current = ready(await api(pullPath));
    }
  } else if (current.base.sha !== pull.base.sha) throw new Error("Remote integration state changed");
  const method = repo.allow_squash_merge ? "squash" : repo.allow_merge_commit ? "merge" : "rebase";
  const merged = await api(`${pullPath}/merge`, ["--method", "PUT", "-f", `sha=${pull.head.sha}`, "-f", `merge_method=${method}`]);
  if (merged.merged !== true || !/^[a-f0-9]{40}$/.test(merged.sha ?? "")) throw new Error("Integration was not confirmed");
  const commit = await api(`repos/${repository}/git/commits/${merged.sha}`);
  if (!/^[a-f0-9]{40}$/.test(commit.tree?.sha ?? "")) throw new Error("Merged tree identity is missing");
  if (!featureMerge && commit.tree.sha !== receipt.repository.tree) throw new Error("Integrated tree differs from rehearsed source; activation is blocked");
  const result = featureMerge ? {
    schemaVersion: 2, kind: "feature-merge", productionEligible: false, requiresMergedBatchValidation: true,
    validatedFeature: receipt.repository, observedBase: current.base.sha,
    commit: merged.sha, tree: commit.tree.sha,
  } : { schemaVersion: 1, head: pull.head.sha, base: pull.base.sha, commit: merged.sha, tree: commit.tree.sha };
  atomicJson(join(dirname(receiptPath), "integration.json"), result);
  return result;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    await integrateCandidate(...process.argv.slice(2));
    console.log("Source integration recorded. Feature merges require a separately validated merged batch before activation.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
