export function resolveExternalRunDirectory(
  requested: string,
  protectedRoots: string[],
): string;

export function assertPullRequestReady(
  state: {
    headRefOid?: string;
    baseRefOid?: string;
    isDraft?: boolean;
    state?: string;
    mergeable?: string;
    reviewDecision?: string;
    statusCheckRollup?: Array<{ conclusion?: string; state?: string }>;
  },
  expectedHead: string,
  expectedBase: string,
  requireChecks?: boolean,
): void;
