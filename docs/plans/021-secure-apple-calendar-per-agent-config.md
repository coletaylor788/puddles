# Plan 021: `secure-apple-calendar` per-agent config (factory pattern)

**Status:** ✅ Complete (2026-05-13)
**Author:** Cole + Puddles
**Blocks:** Plan 022 (`household`) — household needs per-agent calendar
filtering to be useful with `calendar_read`/`calendar_write`.

---

## Summary

Migrate `secure-apple-calendar` from a static single-bridge MCP plugin to the
**factory pattern** that `apple-pim-cli` already uses. Each OpenClaw agent gets
its own MCP bridge, lazily spawned with `APPLE_PIM_CONFIG_DIR` env pointing at
that agent's workspace. The Swift CLIs underneath honor the per-agent
allow/blocklist transparently.

**Result:** `calendar_read`/`calendar_write` keep all current security wrappers
(InjectionGuard, SecretRedactor, ContactsEgressGuard, audit log) AND gain
per-agent calendar filtering for free, governed by the same workspace config
file `apple-pim-cli` already reads.

---

## Goals

- Per-agent calendar allow/blocklist enforcement for `calendar_read` and
  `calendar_write`, equivalent to what `apple-pim-cli` already provides for its
  tools.
- Single source of truth: `~/.openclaw/agents/<agentId>/workspace/apple-pim/config.json`
  governs both `apple-pim-cli` and `secure-apple-calendar`.
- Tool names stay `calendar_read` / `calendar_write` (no per-profile name
  explosion).
- Backward compatible: agents without a per-agent config fall back to the global
  `~/.config/apple-pim/` (today's behavior).

## Non-goals

- Adding allow/blocklist enforcement at the plugin layer (we delegate to the
  Swift CLI's existing enforcement).
- Tool-description dynamic listing of allowed calendars (defer; agent learns
  via `list` action).
- Promoting reminders/contacts into `secure-apple-pim` (separate future work).

---

## Why factory pattern

Investigated this session and confirmed:

1. **OpenClaw `AgentTool.execute(toolCallId, params, signal, onUpdate)` has no
   agent identity in the call context.** A single static tool cannot dispatch
   per-agent at call time. Verified in
   `dist/extensions/codex/node_modules/@mariozechner/pi-agent-core/dist/types.d.ts:266`.

2. **OpenClaw rejects duplicate plugin IDs** (`duplicate plugin "..." found` in
   `dist-Do7vshyo.js`), so we cannot register the plugin N times with N
   different configs.

3. **`OpenClawPluginToolFactory` receives `ctx.workspaceDir`** for the calling
   agent. This is the only API surface that exposes per-agent identity to
   plugin tools.

4. **`apple-pim-cli` already uses this exact pattern** (see
   `/Users/puddles/git/Apple-PIM-Agent-Plugin/openclaw/src/index.ts` —
   `resolveWorkspaceConfigDir()` + `resolveEnvOverrides()`). We mirror its
   priority chain.

5. **The apple-pim MCP server inherits `APPLE_PIM_CONFIG_DIR` at spawn time**
   and propagates it to the Swift CLIs via `process.env`. Per-call `configDir`
   args are explicitly ignored. This means we MUST spawn one bridge per agent
   (per config dir), not pass config per call.

---

## Design

### High-level

```
┌─────────────────────────────────────────────────────────────────┐
│ secure-apple-calendar plugin (single registration)              │
│                                                                 │
│   register():                                                   │
│     api.registerTool(calendar_read_factory)                     │
│     api.registerTool(calendar_write_factory)                    │
│                                                                 │
│   factory(ctx):                                                 │
│     workspaceDir = ctx.workspaceDir                             │
│     bridge = bridgeCache.getOrSpawn(workspaceDir)               │
│     return wrapMcpTool(bridge, hooks, ...)                      │
│                                                                 │
│   bridgeCache:                                                  │
│     Map<resolvedConfigDir, McpBridge>                           │
│     spawn with env: { APPLE_PIM_CONFIG_DIR: <dir> }             │
└─────────────────────────────────────────────────────────────────┘
```

### Config-dir resolution priority

Mirror `apple-pim-cli`, but **do not expose `configDir` as a tool arg**: the
underlying apple-pim MCP server ignores per-call `configDir` anyway (env-only),
so accepting it from the agent would silently break the abstraction and let
the cache balloon to one bridge per caller-supplied dir.

1. `<ctx.workspaceDir>/apple-pim/` if `config.json` exists there
2. `pluginConfig.configDir` (gateway-level default for the whole plugin entry)
3. `process.env.APPLE_PIM_CONFIG_DIR` (env at gateway start)
4. Default — fall through to apple-pim's own `~/.config/apple-pim/`

The bridge cache is keyed on the **resolved** dir (or a sentinel for "default,
no env override"), so two agents pointing at the same dir share a bridge.

### What's per-agent vs shared

Only the **bridge** varies per agent. The LLM client, `ContactsTrustResolver`,
`trustedAttendeeDomains`, ingress hooks, egress guard, and audit logger are
constructed once in `register()` and shared across all factories. Rationale:
the security wrappers don't depend on per-agent identity — only the underlying
calendar filter does. If a future plan needs per-agent trusted domains or
audit paths, that's an additive change to the factory closure.

### Bridge lifecycle

- Cache holds **`Promise<McpBridge>`** (not the resolved bridge), so two
  concurrent first-calls for the same agent share one spawn instead of racing.
- Lazy spawn on first call.
- Kept alive for the gateway lifetime (cardinality is ~N agents; processes are
  cheap).
- On bridge crash / unexpected exit: hook `StdioClientTransport.onclose`
  (verified present in MCP SDK v1.29) to evict from cache; respawn on next call.
- On gateway shutdown: `shutdownAll()` closes all bridges.

### Backward compatibility

- If no `profiles` config and no per-agent workspace config exists, behavior
  is identical to today: one shared bridge with the global `~/.config/apple-pim/`.
- Existing `secure-apple-calendar` config keys (`applePimMcpCommand`,
  `applePimMcpArgs`, `applePimMcpEnv`, `trustedAttendeeDomains`, `model`,
  `auditLogPath`) all preserved.
- `applePimMcpEnv` is **merged** into the per-bridge env (not replaced) so
  users can still inject custom env vars.

---

## Implementation outline

### `openclaw-plugins/secure-apple-calendar/src/bridge-cache.ts` (new)

```ts
import { connectMcpBridge, type McpBridge } from "./mcp-bridge.js";

export interface BridgeSpec {
  command: string;
  args: string[];
  cwd?: string;
  baseEnv?: Record<string, string>;  // applePimMcpEnv from plugin config
  configDir?: string;                // resolved per-agent config dir
}

const cache = new Map<string, Promise<McpBridge>>();

function cacheKey(spec: BridgeSpec): string {
  return spec.configDir ?? "<default>";
}

export function getBridge(spec: BridgeSpec): Promise<McpBridge> {
  const key = cacheKey(spec);
  const existing = cache.get(key);
  if (existing) return existing;

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...(spec.baseEnv ?? {}),
  };
  if (spec.configDir) env.APPLE_PIM_CONFIG_DIR = spec.configDir;

  const promise = connectMcpBridge({
    command: spec.command,
    args: spec.args,
    cwd: spec.cwd,
    env,
    onClose: () => {
      // Evict only if still pointing at this entry (a respawn may have replaced us).
      if (cache.get(key) === promise) cache.delete(key);
    },
  }).catch((err) => {
    cache.delete(key);  // first-spawn failure: don't pin a rejected promise
    throw err;
  });

  cache.set(key, promise);
  return promise;
}

export async function shutdownAll(): Promise<void> {
  const bridges = await Promise.allSettled([...cache.values()]);
  cache.clear();
  await Promise.allSettled(
    bridges
      .filter((r): r is PromiseFulfilledResult<McpBridge> => r.status === "fulfilled")
      .map((r) => r.value.close()),
  );
}
```

### `openclaw-plugins/secure-apple-calendar/src/plugin.ts` (modified)

- Replace `api.registerTool(staticTool)` with `api.registerTool(factory)`.
- Factory:

```ts
function createCalendarReadFactory(pluginConfig, hooks, audit) {
  return (ctx) => {
    const workspaceConfigDir = resolveWorkspaceConfigDir(ctx.workspaceDir);
    const configDir =
      workspaceConfigDir ??
      pluginConfig.configDir ??
      process.env.APPLE_PIM_CONFIG_DIR;

    const bridgeSpec = {
      command: pluginConfig.applePimMcpCommand,
      args: pluginConfig.applePimMcpArgs ?? [],
      cwd: pluginConfig.applePimMcpCwd,
      baseEnv: pluginConfig.applePimMcpEnv,
      configDir,
    };

    return wrapMcpTool({
      mcpToolName: "calendar",
      openclawToolName: "calendar_read",
      allowedActions: READ_ACTIONS,
      callMcp: async (action, args) => {
        const bridge = await getBridge(bridgeSpec);
        return bridge.callTool("calendar", { action, ...args });
      },
      hooks,
      auditLogger: audit,
    });
  };
}
```

- Same pattern for `calendar_write`.
- Preserve `register()`'s synchronous nature (OpenClaw snapshots
  `api.registerTool` calls at register time — see existing comment in
  `plugin.ts:46-56`).

### `openclaw-plugins/secure-apple-calendar/src/mcp-bridge.ts`

- `env` already supported (verified: `mcp-bridge.ts:13`).
- Add `onClose` to `McpBridgeOptions` and forward to
  `StdioClientTransport.onclose` (verified hook present in MCP SDK v1.29
  `client/stdio.d.ts`).

### `openclaw-plugins/secure-apple-calendar/src/wrap-tool.ts` (minimal change)

- Replace the captured `bridge` reference with a `callMcp` function so the
  factory can swap bridges per call/agent without re-wrapping.

### Tests

`openclaw-plugins/secure-apple-calendar/tests/bridge-cache.test.ts` (new):

- Two factories with same workspaceDir → same bridge instance.
- Two factories with different workspaceDir → different bridges.
- Undefined workspaceDir → "default" bridge.
- Bridge crash → next call respawns.
- `shutdownAll()` closes all bridges and clears cache.

`openclaw-plugins/secure-apple-calendar/tests/plugin.test.ts` (existing, modify):

- Verify factory is registered (not static tool).
- Verify factory called per agent ctx.
- Verify env propagation: spawn called with `APPLE_PIM_CONFIG_DIR` set.

### README

Add section "Per-agent calendar filtering":

- Drop `~/.openclaw/agents/<agentId>/workspace/apple-pim/config.json`
- Use apple-pim's allow/blocklist schema
- Same file `apple-pim-cli` reads — single source of truth
- Falls back to global `~/.config/apple-pim/` if no per-agent config

---

## Mini deployment

After build + bundle:

1. `pnpm --filter secure-apple-calendar build`
2. Bundle / install on mini (existing process for plugin updates).
3. `openclaw config validate`
4. `launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway`
5. Verify with the existing main that calendar still works (no per-agent
   config → falls back to global, behavior unchanged).
6. Once Plan 022 ships, household gets its `apple-pim/config.json` and
   immediately picks up the per-agent filtering on `calendar_read`/`calendar_write`.

---

## Settled questions

1. **Tool description with allowed calendars?** Skip in v1. Agent calls `list`
   once, learns the names organically. apple-pim-cli works the same way.
2. **Fallback when no per-agent config?** Fall back to global. Preserves
   today's behavior, no surprise breakage on upgrade.
3. **Bridge cache lifetime?** Forever (until gateway shutdown or crash).
   Cardinality is tiny.
4. **Per-call `configDir` arg?** Dropped. apple-pim's MCP server ignores it
   anyway (env-only); exposing it would invite cache blow-up.
5. **What's per-agent vs shared?** Only the bridge varies per agent. Hooks,
   LLM, audit logger, trusted domains are shared (constructed once in
   `register()`). Future plans can split if needed.
6. **Factory invocation cardinality?** OpenClaw caches descriptors per agent
   ctx (verified in `tools-Cd7FN_oQ.js:649`'s `resolveCachedPluginTools`),
   so factories are not called per tool-call. Closure-captured `bridgeSpec`
   per agent is the right pattern.
7. **Spawn race?** Cache holds `Promise<McpBridge>`, not the resolved bridge,
   so concurrent first-calls share a single spawn.
8. **`workspaceDir` vs `agentDir`?** Use `workspaceDir` (matches the
   `<workspaceDir>/apple-pim/config.json` layout the user already uses with
   apple-pim-cli). `agentDir` is the parent and would force string concat.
9. **README must call out cache invalidation:** changes to per-agent
   `config.json` require gateway restart (no FS-watch in v1).

---

## Out of scope

- Per-tool profile split (different allowlists for read vs write per agent).
  If needed later, layer on top — but unlikely.
- Reminders/contacts security wrapping. Those stay in `apple-pim-cli` until
  promoted to `secure-apple-pim` in a future plan.
- Tool-name suffixing or multi-instance plugin loading (rejected — factory
  pattern eliminates the need).

---

## Files / changes

**New (this repo):**
- `docs/plans/021-secure-apple-calendar-per-agent-config.md` (this file)
- `openclaw-plugins/secure-apple-calendar/src/bridge-cache.ts`
- `openclaw-plugins/secure-apple-calendar/tests/bridge-cache.test.ts`

**Modified (this repo):**
- `openclaw-plugins/secure-apple-calendar/src/plugin.ts`
- `openclaw-plugins/secure-apple-calendar/src/wrap-tool.ts`
- `openclaw-plugins/secure-apple-calendar/src/mcp-bridge.ts` (if env support
  needs adding)
- `openclaw-plugins/secure-apple-calendar/tests/plugin.test.ts`
- `openclaw-plugins/secure-apple-calendar/tests/wrap-tool.test.ts` (if
  callMcp swap requires it)
- `openclaw-plugins/secure-apple-calendar/README.md`

**No mini config changes required for the plugin itself** — the migration is
backward compatible. New per-agent configs (e.g. household's) are added by
their respective agent setups.

---

## Open questions

None — all design questions settled this session.

---

## Checklist

### Implementation
- [x] `bridge-cache.ts` — new module
- [x] `mcp-bridge.ts` — `env` already supported; added `onClose` hook
- [x] `wrap-tool.ts` — no change needed (already accepts `McpCaller`)
- [x] `plugin.ts` — switched to factory registration; resolves per-agent configDir
- [x] Preserved all existing config keys + behavior

### Testing
- [x] `bridge-cache.test.ts` — cache hit/miss, env propagation, crash recovery, race
- [x] `plugin.split.test.ts` — factory registration, per-ctx dispatch, default-bridge sharing
- [x] `pnpm --filter secure-apple-calendar test` green (61/61)

### Cleanup
- [x] No dead static-tool code paths
- [x] No unused imports
- [x] Lint passes (`tsc --noEmit`)

### Documentation
- [x] README "Per-agent calendar filtering" section
- [ ] Cross-link from `docs/openclaw-setup/` page covering per-agent setup
- [x] Mark plan complete with date

### Deploy
- [x] Build + bundle (mini)
- [x] Deploy to mini (git pull + pnpm build)
- [x] Restart gateway (`launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway`)
- [x] Verify factory registration in gateway log
- [x] Smoke test: main calendar still works (no per-agent config →
      falls back to global)
- [x] Smoke test: `calendar_write` still works (regression check, since
      both tools moved to factory at once)
- [x] Smoke test: per-agent allowlist actually filters (verified 2026-05-13:
      main + reader configured with allowlist=[Personal, Work, US Holidays];
      `calendar_read action=list` returned only those three)

### Lessons learned
- **apple-pim's `PIMConfiguration` Codable struct requires ALL FOUR domain
  blocks** (`calendars`, `reminders`, `contacts`, `mail`) — they're
  non-optional. A config with only `calendars` fails Swift decoding with
  "data couldn't be read because it is missing" and apple-pim falls back
  to defaults *silently* (warning is to stderr only). Original README
  example only showed the calendar block, which decodes to nothing. Real
  schema: see `swift/Sources/PIMConfig/PIMConfiguration.swift` upstream.
- **No gateway restart needed when adding/changing a per-agent
  `config.json`** — the factory closure captures `existsSync()` at
  registration, but the cache key is the resolved path, so once a config
  is in place the env var is correct on next bridge spawn. (If a config
  is REMOVED, that's a different story — the factory would still send
  `APPLE_PIM_CONFIG_DIR`. Restart for the deletion case.)

### Commit & push
- [x] Commit + push (`b4a76de`)
