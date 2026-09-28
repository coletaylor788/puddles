import { runCommand } from "./process-runner.mjs";

// Run in the task's tooling checkout before registering the resulting batch on
// the mini. Fetch once, pin each head, and never chase moving main during TEST.
export async function snapshotMergedBatch(spec, run = runCommand) {
  if (!spec.agent?.id || !spec.agent.contact || !Array.isArray(spec.repositories) || !spec.repositories.length) {
    throw new Error("Batch selection requires an initiating agent and repositories");
  }
  const sources = [];
  for (const repository of spec.repositories) {
    if (!repository.id || !repository.root?.startsWith("/") ||
        !/^[a-f0-9]{40}$/.test(repository.base ?? "") ||
        !/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(repository.defaultBranch ?? "main")) {
      throw new Error("Select a repository worktree, default branch, and previous deployed base");
    }
    const git = async (...args) => (await run("git", ["-C", repository.root, ...args], {
      capture: true, quiet: true, timeoutMs: 60_000,
    })).trim();
    const branch = repository.defaultBranch ?? "main";
    await git("fetch", "origin", `refs/heads/${branch}:refs/remotes/origin/${branch}`);
    const head = await git("rev-parse", `refs/remotes/origin/${branch}^{commit}`);
    const tree = await git("rev-parse", `${head}^{tree}`);
    await git("merge-base", "--is-ancestor", repository.base, head);
    const revisions = (await git("rev-list", "--reverse", `${repository.base}..${head}`)).split("\n").filter(Boolean);
    const commits = revisions.map((sha) => {
      const agent = repository.owners?.[sha];
      if (!agent?.id || !agent.contact) throw new Error(`Resolve the feature owner and contact for merged commit ${sha}`);
      return { sha, agent };
    });
    sources.push({ id: repository.id, head, tree, base: repository.base, commits });
  }
  return { agent: spec.agent, sources,
    ...(spec.predecessor ? { predecessor: spec.predecessor, previousToken: spec.previousToken,
      revertEvidence: spec.revertEvidence, reverts: spec.reverts ?? [],
      repairEvidence: spec.repairEvidence, repairs: spec.repairs ?? [] } : {}) };
}
