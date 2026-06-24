
**Status:** ✅ Implemented (2026-05-15)
**Author:** Cole + Puddles

## The problem

Puddles wrote facts in three places — `MEMORY.md`, daily journal, project notebooks — with no recall loop binding them. The agent re-narrated fence-project facts in the journal because it couldn't recall what it already wrote in `projects/`. The memory index was stale (3 files, nothing past 2026-04-23). Most of OpenClaw's memory stack was installed but disabled.

## What we want

```
       Cole opens in Obsidian (read + edit)
                    │
                    ▼
   ┌───────────────────────────────────────────────┐
   │ workspace/   (canonical vault — now iCloud)   │
   │   MEMORY.md       memory/*.md                 │
   │   DREAMS.md       memory/.dreams/             │
   │   memory/recipes/  memory/wine/  ...          │
   └────────────────────────┬──────────────────────┘
                            │ auto-index
                            ▼
              ┌──────────────────────────────┐
              │ memory-core / QMD backend    │
              │ ~/.openclaw/agents/          │
              │      <agentId>/qmd/          │
              │ BM25 + vector + LLM rerank   │
              └─────────────┬────────────────┘
                            │ queries before each reply
                            ▼
                  ┌──────────────────┐
                  │ active-memory    │
                  │ Haiku sub-agent  │
                  │ injects hidden   │
                  │ context block    │
                  └──────────────────┘

   dreaming (3am cron, Opus) reads workspace, writes back:
     Light → DREAMS.md   (stages candidates)
     REM   → DREAMS.md   (thematic patterns)
     Deep  → MEMORY.md   (only durable promotions)

   commitments extractor runs after every reply,
   stores follow-ups in ~/.openclaw/commitments/,
   delivered via heartbeat when due.
```

## What we did

- **OpenClaw upgraded** 2026.4.20 → 2026.5.12 on the mini. Required separately installing the now-extracted `@openclaw/bluebubbles`, `@openclaw/acpx`, `apple-pim-cli` plugins.
- **QMD backend** installed (`@tobilu/qmd@2.1.0`), `memory.backend: "qmd"`. On-device embedder `embeddinggemma-300M-Q8` (~333 MB). Per-agent isolation automatic at `~/.openclaw/agents/<id>/qmd/`.
- **Dreaming** enabled — nightly cron `0 3 * * *`, runs Light/REM/Deep phases. Inherits agent's primary model (Opus 4.7) for high-quality consolidation.
- **active-memory** enabled for `main` only, model `<your-provider>/claude-haiku-4-5` for sub-second latency on every reply.
- **Commitments** enabled (`commitments.enabled: true`, `maxPerDay: 3`). Extractor fires after every eligible reply; nothing promoted yet but extractor runs are recorded under `~/.openclaw/commitments/extractor-sessions/<agent>/`.
- **Workspace moved to iCloud** at `~/Library/Mobile Documents/com~apple~CloudDocs/puddles-workspace/`. All per-agent subdirs nested inside. Sandbox containers re-mount the new path; agents see `/workspace` inside their containers.
- **Migration** (Puddles-led, gated by Cole): `projects/` folded into `memory/<topic>/` (with binaries in `attachments/`), topical dirs (recipes, wine, things-to-do, shopping, mom-visit) moved under `memory/`. `wishlist/` correctly left at root (skill data, not memory).
- **`openclaw memory rem-backfill`** replayed 13 historical daily notes through REM reasoning. Cole reviewed each; 3 facts promoted into `MEMORY.md`, 10 dropped.

## Lessons learned

- **OpenClaw 2026.5+ requires plugins to declare `contracts.tools` in `openclaw.plugin.json`** for tools to be exposed to sandboxed agents. Without it, `plugins doctor` says "plugin must declare contracts.tools before registering" and tools register as "hook-only" — they work for the main agent (via the legacy compatibility path) but vanish from sandboxed agents' tool lists. Fix: add `"contracts": { "tools": ["..."] }` block to each plugin manifest.
- **QMD collections persist across OpenClaw config changes.** When `agents.defaults.workspace` changes, QMD's stored collection paths still point at the old workspace and the gateway restart doesn't re-register them. Manual reset: `qmd collection remove <name> --force` for each, then `openclaw memory index --force` to re-register.
- **Sandbox containers don't pick up workspace path changes on gateway restart.** Need explicit `openclaw sandbox recreate --all --force` (or `docker rm -f`) so the next agent activity creates fresh containers with the new mount.
- **Hot-reload-strip on config writes can silently drop unknown keys.** If a config key isn't in the *runtime* validator's schema (even if the descriptive schema in `openclaw config schema` accepts it), the gateway's reload pass will strip it back out on the next write. Fix is the actual cause — usually a version mismatch between the CLI's install and the gateway's install. Confirm both point at the same OpenClaw version before debugging deeper.
- **OpenClaw doesn't prune `DREAMS.md`** — Light/REM phases append within the managed block forever. No `maxAgeDays` or rollup for the diary. User-managed retention if you care.
- **Grounded backfill entries don't auto-promote** — `openclaw memory rem-backfill` writes structured candidates with `<!-- openclaw:dreaming:backfill-entry day=... -->` markers. They sit as review-only until Cole (or Puddles in a session) decides each. Normal nightly Deep dreaming WILL auto-promote going forward via the standard recall-frequency thresholds.

## Follow-ups after initial implementation

- **memory-wiki enabled** (2026-06-05) — reversed the original "out of scope"
  call. Reason: wanted the Obsidian-friendly compiled wiki render alongside
  the raw memory + Obsidian-on-workspace setup, rather than relying on
  Obsidian to navigate raw memory files alone. Enabled via
  `openclaw plugins enable memory-wiki` on the mini and gateway restarted.

## Out of scope
- **LanceDB / Honcho backends** — QMD covers local + reranking; Honcho is for cross-session/remote.
- **Routing memory through provider-hosted embeddings** — not an option on QMD (local-only); revisit only if EmbeddingGemma recall is weak.
- **URL ingest, multi-tenant memory split, migrating `~/Documents/llm-notes/openclaw-notes/`** — separate decisions.
