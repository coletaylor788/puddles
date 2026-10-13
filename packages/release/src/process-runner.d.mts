export type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  capture?: boolean;
  timeoutMs?: number;
  killGraceMs?: number;
  maxOutputBytes?: number;
  logPath?: string;
  quiet?: boolean;
  resourcePath?: string;
  resourceDiskPath?: string;
  resourceLabel?: string;
  resourceProfile?: {
    name: string;
    platform: string;
    arch: string;
    totalMemoryBytes: number;
    logicalCpuCount: number;
    testWorkers?: number;
  };
};

export declare function runCommand(
  command: string,
  args: string[],
  options?: RunCommandOptions,
): Promise<string>;

export declare function stopActiveCommand(signal: NodeJS.Signals, graceMs?: number): Promise<void>;

export declare function installSignalHandlers(params: {
  cleanup: () => Promise<unknown[]>;
  graceMs?: number;
}): void;

export declare function isHandlingSignal(): boolean;
