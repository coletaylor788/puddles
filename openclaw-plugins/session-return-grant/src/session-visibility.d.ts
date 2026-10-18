// OpenClaw 2026.9.6 exports this SDK module without declarations. Keep this
// narrow contract aligned with docs/plugins/sdk-runtime/agent.md and verify
// registration against the actual installed SDK in the composed regression.
declare module "openclaw/plugin-sdk/session-visibility" {
  export const createSessionVisibilityChecker: {
    registerScopedAccessProvider(provider: (request: {
      action: string; requesterSessionKey: string; targetSessionKey: string;
    }) => { expectedSessionId: string } | undefined): () => void;
  };
  export function createAgentToAgentPolicy(config: unknown): {
    isAllowed(requesterAgentId: string, targetAgentId: string): boolean;
  };
}
