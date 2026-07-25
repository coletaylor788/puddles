import { describe, expect, it, vi } from "vitest";
import { cleanupWorktree } from "../src/worktree-cleanup.mjs";

describe("OpenClaw candidate cleanup", () => {
  it("attempts every cleanup step and preserves each failure", () => {
    const removeFailure = new Error("worktree remove failed");
    const directoryFailure = new Error("directory removal failed");
    const runCommand = vi.fn((command: string, args: string[]) => {
      if (args.includes("remove")) {
        throw removeFailure;
      }
    });
    const removeDirectory = vi.fn(() => {
      throw directoryFailure;
    });

    const errors = cleanupWorktree({
      source: "/source",
      candidate: "/state/candidate",
      stateRoot: "/state",
      worktreeCreated: true,
      runCommand,
      removeDirectory,
    });

    expect(errors).toEqual([removeFailure, directoryFailure]);
    expect(runCommand.mock.calls).toEqual([
      [
        "git",
        ["-C", "/source", "worktree", "remove", "--force", "/state/candidate"],
      ],
      ["git", ["-C", "/source", "worktree", "prune"]],
    ]);
    expect(removeDirectory).toHaveBeenCalledWith("/state");
  });
});
