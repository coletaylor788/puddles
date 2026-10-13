import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cleanupWorktree } from "../src/worktree-cleanup.mjs";

describe("OpenClaw candidate cleanup", () => {
  it("attempts every cleanup step and preserves each failure", async () => {
    const removeFailure = new Error("worktree remove failed");
    const directoryFailure = new Error("directory removal failed");
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (args.includes("remove")) {
        throw removeFailure;
      }
    });
    const removeDirectory = vi.fn(() => {
      throw directoryFailure;
    });

    const captureCommand = vi.fn(async () => "");
    const errors = await cleanupWorktree({
      source: "/source",
      candidate: "/state/candidate",
      stateRoot: "/state",
      worktreeCreated: true,
      runCommand,
      captureCommand,
      removeDirectory,
    });

    expect(errors).toEqual([removeFailure, directoryFailure]);
    expect(runCommand.mock.calls).toEqual([
      [
        "git",
        [
          "-C",
          "/source",
          "worktree",
          "remove",
          "--force",
          "--force",
          "/state/candidate",
        ],
      ],
      ["git", ["-C", "/source", "worktree", "prune", "--expire", "now"]],
    ]);
    expect(removeDirectory).toHaveBeenCalledWith("/state");
    expect(captureCommand).toHaveBeenCalledWith("git", [
      "-C",
      "/source",
      "worktree",
      "list",
      "--porcelain",
    ]);
  });

  it("fails when the candidate remains registered after pruning", async () => {
    const errors = await cleanupWorktree({
      source: "/source",
      candidate: "/state/candidate",
      stateRoot: "/state",
      worktreeCreated: true,
      runCommand: vi.fn(async () => undefined),
      captureCommand: vi.fn(async () => "worktree /state/candidate\nHEAD abc123\n"),
      removeDirectory: vi.fn(),
    });

    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain("still registered");
  });

  it("removes a locked disposable worktree and its registration", async () => {
    const root = mkdtempSync(join(tmpdir(), "e2e-worktree-cleanup-"));
    const source = join(root, "source");
    const stateRoot = join(root, "state");
    const candidate = join(stateRoot, "candidate");
    const git = (args: string[]) =>
      execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

    try {
      mkdirSync(source);
      git(["init", source]);
      git(["-C", source, "config", "user.email", "e2e@example.invalid"]);
      git(["-C", source, "config", "user.name", "E2E"]);
      writeFileSync(join(source, "fixture.txt"), "fixture\n");
      git(["-C", source, "add", "fixture.txt"]);
      git(["-C", source, "commit", "-m", "fixture"]);
      git(["-C", source, "worktree", "add", "--detach", candidate, "HEAD"]);
      git(["-C", source, "worktree", "lock", candidate]);

      const errors = await cleanupWorktree({
        source,
        candidate,
        stateRoot,
        worktreeCreated: true,
        runCommand: async (_command, args) => {
          git(args);
        },
        captureCommand: async (_command, args) => git(args),
        removeDirectory: (path) => rmSync(path, { recursive: true, force: true }),
      });

      expect(errors).toEqual([]);
      expect(git(["-C", source, "worktree", "list", "--porcelain"])).not.toContain(
        `worktree ${candidate}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
