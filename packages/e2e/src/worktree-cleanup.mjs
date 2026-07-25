export function cleanupWorktree(params) {
  const errors = [];
  if (params.worktreeCreated) {
    try {
      params.runCommand("git", [
        "-C",
        params.source,
        "worktree",
        "remove",
        "--force",
        params.candidate,
      ]);
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    params.removeDirectory(params.stateRoot);
  } catch (error) {
    errors.push(error);
  }
  try {
    params.runCommand("git", ["-C", params.source, "worktree", "prune"]);
  } catch (error) {
    errors.push(error);
  }
  return errors;
}
