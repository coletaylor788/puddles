#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicJson } from "../src/native-state.mjs";
import { runCommand } from "../src/process-runner.mjs";

// This command finishes before activation starts. A remote race can block
// delivery, but never becomes a reason to roll back a healthy live runtime.
export async function integrateCandidate(receiptPath, repository, number, run = runCommand) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[1-9][0-9]*$/.test(String(number))) throw new Error("Integration requires an explicit repository and pull request");
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (receipt.status !== "passed" || receipt.accumulated !== true ||
      !/^[a-f0-9]{40}$/.test(receipt.repository?.head ?? "") ||
      !/^[a-f0-9]{40}$/.test(receipt.repository?.tree ?? "")) throw new Error("A frozen cumulative candidate is required");
  for (const name of ["regressions", "runtime", "install"]) {
    const proof = JSON.parse(readFileSync(join(dirname(receiptPath), "stages", `${name}.json`), "utf8"));
    if (proof.status !== "passed" || proof.key !== receipt.proofs?.[name]) throw new Error("Candidate proof chain does not match");
  }
  const api = async (path, args = []) => JSON.parse(await run("gh", ["api", path, ...args], { capture: true, quiet: true, timeoutMs: 60_000 }));
  const pullPath = `repos/${repository}/pulls/${number}`;
  const pull = await api(pullPath);
  if (pull.state !== "open" || pull.draft || !pull.mergeable || pull.mergeable_state !== "clean" || pull.head.sha !== receipt.repository.head) throw new Error("Pull request is not the exact eligible candidate");
  const repo = await api(`repos/${repository}`);
  if (pull.base.ref !== repo.default_branch) throw new Error("Integration must target the default branch");
  const comparison = await api(`repos/${repository}/compare/${pull.base.sha}...${pull.head.sha}`);
  if (!["ahead", "identical"].includes(comparison.status)) throw new Error("Candidate must include the current base");
  const current = await api(pullPath);
  if (current.head.sha !== pull.head.sha || current.base.sha !== pull.base.sha ||
      current.mergeable_state !== "clean" || !current.mergeable) throw new Error("Remote integration state changed");
  const method = repo.allow_squash_merge ? "squash" : repo.allow_merge_commit ? "merge" : "rebase";
  const merged = await api(`${pullPath}/merge`, ["--method", "PUT", "-f", `sha=${pull.head.sha}`, "-f", `merge_method=${method}`]);
  if (merged.merged !== true) throw new Error("Integration was not confirmed");
  const commit = await api(`repos/${repository}/git/commits/${merged.sha}`);
  if (commit.tree.sha !== receipt.repository.tree) throw new Error("Integrated tree differs from rehearsed source; activation is blocked");
  const result = { schemaVersion: 1, head: pull.head.sha, base: pull.base.sha, commit: merged.sha, tree: commit.tree.sha };
  atomicJson(join(dirname(receiptPath), "integration.json"), result);
  return result;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  try {
    await integrateCandidate(...process.argv.slice(2));
    console.log("Exact source integration confirmed. Activation is a separate command.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
