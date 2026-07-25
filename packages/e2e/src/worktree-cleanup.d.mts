export type CleanupWorktreeParams = {
  source: string;
  candidate: string;
  stateRoot: string;
  worktreeCreated: boolean;
  runCommand: (command: string, args: string[]) => Promise<unknown>;
  captureCommand: (command: string, args: string[]) => Promise<string>;
  removeDirectory: (path: string) => void | Promise<void>;
};

export declare function cleanupWorktree(params: CleanupWorktreeParams): Promise<unknown[]>;
