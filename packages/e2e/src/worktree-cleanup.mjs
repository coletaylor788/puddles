export async function cleanupWorktree(params) {
  const errors = [];
  if (params.worktreeCreated) {
    try {
      await params.runCommand("git", [
        "-C",
        params.source,
        "worktree",
        "remove",
        "--force",
        "--force",
        params.candidate,
      ]);
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await params.removeDirectory(params.stateRoot);
  } catch (error) {
    errors.push(error);
  }
  try {
    await params.runCommand("git", [
      "-C",
      params.source,
      "worktree",
      "prune",
      "--expire",
      "now",
    ]);
  } catch (error) {
    errors.push(error);
  }
  try {
    const worktrees = await params.captureCommand("git", [
      "-C",
      params.source,
      "worktree",
      "list",
      "--porcelain",
    ]);
    if (worktrees.split("\n").includes(`worktree ${params.candidate}`)) {
      throw new Error(`Candidate worktree is still registered: ${params.candidate}`);
    }
  } catch (error) {
    errors.push(error);
  }
  return errors;
}
