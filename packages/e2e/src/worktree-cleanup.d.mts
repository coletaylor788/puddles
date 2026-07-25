export type CleanupWorktreeParams = {
  source: string;
  candidate: string;
  stateRoot: string;
  worktreeCreated: boolean;
  runCommand: (command: string, args: string[]) => void;
  removeDirectory: (path: string) => void;
};

export declare function cleanupWorktree(params: CleanupWorktreeParams): unknown[];
