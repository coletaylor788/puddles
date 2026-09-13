// OpenClaw 2026.9.3 exports this facade but does not ship its declaration file.
declare module "openclaw/plugin-sdk/memory-host-search" {
  export interface ScopedMemoryManager {
    search(query: string, options?: {
      maxResults?: number; minScore?: number; sessionKey?: string;
      sources?: Array<"memory" | "sessions">; signal?: AbortSignal;
    }): Promise<Array<{
      path: string; source: "memory" | "sessions"; startLine: number;
      endLine: number; score: number; snippet: string;
    }>>;
    status(): { workspaceDir?: string; backend: string };
  }
  export function getActiveMemorySearchManager(params: {
    cfg: import("openclaw/plugin-sdk/memory-core-host-engine-foundation").OpenClawConfig;
    agentId: string;
    purpose?: "default" | "status";
  }): Promise<{ manager: ScopedMemoryManager | null; error?: string }>;
}
