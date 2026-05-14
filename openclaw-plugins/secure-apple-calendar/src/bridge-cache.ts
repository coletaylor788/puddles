import { connectMcpBridge, type McpBridge } from "./mcp-bridge.js";

/**
 * Per-config-dir spawn spec for an apple-pim MCP bridge. The cache shares one
 * bridge across all agents that resolve to the same config dir, so two agents
 * pointing at the global default share a single subprocess.
 *
 * Why per-config-dir, not per-agent: the apple-pim MCP server reads
 * `APPLE_PIM_CONFIG_DIR` at spawn time (not per call), so each unique config
 * dir needs its own subprocess. Agents with the same config dir can safely
 * share — the dir alone determines the server's allow/blocklist behavior.
 */
export interface BridgeSpec {
  command: string;
  args: string[];
  cwd?: string;
  /** Plugin-config-level env overrides (`applePimMcpEnv`), merged into process.env. */
  baseEnv?: Record<string, string>;
  /** Resolved per-agent (or global) config dir. Becomes APPLE_PIM_CONFIG_DIR. */
  configDir?: string;
}

const cache = new Map<string, Promise<McpBridge>>();

function cacheKey(spec: BridgeSpec): string {
  // A missing configDir means "let apple-pim use its own default
  // (~/.config/apple-pim/)", which is one logical bridge.
  return spec.configDir ?? "<default>";
}

/**
 * Spawn or reuse the bridge for the given spec. Returns the cached promise so
 * concurrent first-callers share one spawn. If the underlying transport
 * closes (subprocess crash), the entry is evicted and the next caller
 * respawns.
 */
export function getBridge(spec: BridgeSpec): Promise<McpBridge> {
  const key = cacheKey(spec);
  const existing = cache.get(key);
  if (existing) return existing;

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(spec.baseEnv ?? {}),
  };
  if (spec.configDir) env.APPLE_PIM_CONFIG_DIR = spec.configDir;

  let promise: Promise<McpBridge>;
  promise = connectMcpBridge({
    command: spec.command,
    args: spec.args,
    cwd: spec.cwd,
    env,
    onClose: () => {
      // Only evict if we still own this slot — a respawn may have replaced us.
      if (cache.get(key) === promise) cache.delete(key);
    },
  }).catch((err) => {
    // First-spawn failure: don't pin a rejected promise. Next call retries.
    if (cache.get(key) === promise) cache.delete(key);
    throw err;
  });

  cache.set(key, promise);
  return promise;
}

/** Close all cached bridges and clear the cache. Used at gateway shutdown. */
export async function shutdownAll(): Promise<void> {
  const promises = [...cache.values()];
  cache.clear();
  const settled = await Promise.allSettled(promises);
  await Promise.allSettled(
    settled
      .filter((r): r is PromiseFulfilledResult<McpBridge> => r.status === "fulfilled")
      .map((r) => r.value.close()),
  );
}

/** Test-only: drop all cached entries without closing them. */
export function __resetCacheForTests(): void {
  cache.clear();
}

/** Test-only: snapshot of active cache keys. */
export function __cacheKeysForTests(): string[] {
  return [...cache.keys()];
}
