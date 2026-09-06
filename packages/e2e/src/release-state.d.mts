export declare function sha256File(path: string): string;
export declare function candidateTreeSha256(path: string): string;
export declare function directoryTreeSha256(path: string): string;
export declare function atomicWriteJson(path: string, value: unknown): void;
export declare function argvSha256(argv: string[]): string;
export declare function assertSha256(value: string, label: string): void;
export declare function assertGitSha(value: string, label: string): void;
export declare function stageCanResume(
  state: {
    schemaVersion?: number;
    status?: string;
    argvSha256?: string;
    inputs?: unknown;
    outputs?: Record<string, string>;
  },
  expected: { argv: string[]; inputs: unknown },
): boolean;
export declare function createRunId(): string;
