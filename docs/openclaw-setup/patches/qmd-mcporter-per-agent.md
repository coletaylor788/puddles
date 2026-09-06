# Per-agent QMD mcporter configuration

**Status:** Verified on 2026.7.1 (`0790d9f`) in the managed patch pool.

## The bug

`memory.qmd.mcporter` routes QMD searches through a long-lived `qmd mcp` daemon
instead of spawning `qmd` per query. On a large corpus that is a 30–80×
speedup (0.23–0.66s vs 18–25s cold).

But mcporter config is **global only**, while QMD **collections are
agent-scoped**. Every agent resolves its collections as
`memory-root-<agentId>` / `memory-dir-<agentId>`, and each agent's index lives
under its own `XDG_CACHE_HOME` / `XDG_CONFIG_HOME`. A single mcporter server
definition pins one `qmd mcp` process to **one agent's** cache and config.

So with mcporter enabled, every agent whose collections that daemon doesn't
know about gets **empty results** — not an error. Observed on this host:

| agent | mcporter ON | mcporter OFF |
|---|---|---|
| `main` (daemon's owner) | works | works |
| `household` | **No matches** | works |
| `wiki-maintainer` | **No matches** | works |

The failure is silent by design. `qmd mcp` returns `{"results": []}` for an
unknown collection rather than raising, so
`tryRepairMissingCollectionSearch` / the unsupported-flag fallback in
`qmd-manager` never fire. Memory search simply returns nothing, forever, with
no log line.

The only workaround without this patch is disabling mcporter globally —
punishing the one agent that benefits most in order to keep the others
correct.

## Why upstream config can't express the fix

`backend-config.ts` merges per-agent overrides for the neighbouring key:

```ts
const mergedExtraCollections = [
  ...(params.cfg.agents?.defaults?.memorySearch?.qmd?.extraCollections ?? []),
  ...(agentEntry?.memorySearch?.qmd?.extraCollections ?? []),
];
```

…but reads mcporter straight from global config, ignoring `agentEntry`:

```ts
mcporter: resolveMcporterConfig(qmdCfg?.mcporter),
```

`agents.list[].memorySearch.qmd` accepts exactly one key (`extraCollections`)
under `.strict()`, so a per-agent `mcporter` block is a schema error before it
ever reaches the resolver.

## The change

Adds `agents.*.memorySearch.qmd.mcporter`, merged **field-by-field** over the
global block — per-agent wins, then `agents.defaults`, then `memory.qmd`.

- `packages/memory-host-sdk/src/host/backend-config.ts` — `resolveMcporterConfig`
  applies the global, agent-default, and matching-agent layers in order. The
  `startDaemon` default only auto-enables when no layer set it.
- `packages/memory-host-sdk/src/host/config-utils.ts` — `MemorySearchConfig.qmd`
  gains `mcporter?: MemoryQmdMcporterConfig`.
- `src/config/zod-schema.agent-runtime.ts` — strict schema accepts the block.
- `src/config/types.tools.ts` — matching TypeScript type.
- `src/config/schema.labels.ts`, `src/config/schema.help.ts` — labels + help
  text (required by `schema.help.quality.test.ts`).

Behaviour is unchanged when no agent sets an override: the merge loop applies
the global layer exactly as before.

### Usage

Give each agent its own keep-alive server, so each `qmd mcp` process runs with
that agent's XDG paths:

```json5
{
  memory: { qmd: { mcporter: { enabled: true, serverName: "qmd" } } },
  agents: {
    list: [
      { id: "main" },
      {
        id: "household",
        memorySearch: { qmd: { mcporter: { serverName: "qmd-household" } } },
      },
    ],
  },
}
```

…with a matching `~/.mcporter/mcporter.json` entry per server, each pinning
`XDG_CACHE_HOME` **and** `XDG_CONFIG_HOME` to that agent's
`~/.openclaw/agents/<id>/qmd/`. Collections live in
`<xdg-config>/qmd/index.yml`, so pinning only the cache is not enough.

Or opt a single agent out while others keep the daemon:

```json5
{ id: "wiki-maintainer", memorySearch: { qmd: { mcporter: { enabled: false } } } }
```

## Verification

- `pnpm tsgo:core` — clean.
- `backend-config.test.ts` — 30 passed, including a new
  `merges per-agent mcporter override over the global config` case asserting
  inheritance, partial override (serverName wins, `startDaemon` still
  inherits), and opt-out.
- `schema.help.quality.test.ts` (23), `config.schema-regressions.test.ts` (35)
  — pass; new keys carry labels and help.
- Isolation, checked at the mcporter layer before writing the patch: a
  household-pinned server returned household's `MEMORY.md` at 1.0 and **empty**
  for `Niseko Japan` / `Octavio Garfias`, while the main-pinned server returned
  main's files for those same queries. Unknown-collection requests return empty
  with no fallback to "all collections", so per-agent servers do not weaken the
  memory boundary between agents.

## Upstream

Worth reporting. Any one of these fixes it without local patching:

1. Merge `memory.qmd.mcporter` per-agent (what this patch does).
2. Have `qmd mcp` resolve collections from the caller's `index.yml`.
3. Return an error for unknown collections so the existing fallback can fire —
   the silent-empty behaviour is the root problem.
