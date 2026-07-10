
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

---

## 2026-07 — Why memory "felt off", and the fixes

**Status:** In progress (2026-07-04). **Trigger:** Cole noticed the console's
**memory-palace** and **imported-insights** tabs were empty, dreaming "didn't
feel complete," and Puddles wasn't recalling cross-session topics — a week of
brisket talk never resurfaced, each day being a new session.

### The three layers (this is the key clarification)

The memory stack is really *three distinct layers*, and each had its own,
separate problem. Conflating them is what made this confusing:

1. **Memory** — `MEMORY.md` + `memory/YYYY-MM-DD.md` daily notes. The
   substance/evidence the agent writes and recalls from.
2. **Dreaming promotion** — nightly 03:00 cron. Ranks short-term recall signals
   and promotes durable facts into `MEMORY.md`.
3. **memory-wiki** (`~/.openclaw/wiki/main`) — a *synthesis* layer
   (entities / concepts / source-backed **claims**) that backs the **console's**
   memory-palace + imported-insights tabs. Built by a **separate maintainer
   agent**, not the main agent.

Correct mental model (confirmed from OpenClaw's vault docs + the bundled
`wiki-maintainer` skill): **the main agent tends memory (one concept); a
background maintainer synthesizes memory → wiki; the human reads the wiki in the
console.** The wiki is *not* a second store the agent chooses between — memory is
the evidence layer, the wiki is a compiled synthesis of it.

### Root causes

**A. Promotion was a knife-edge score miss (not a broken pipeline).**
Read from the `short-term-promotion` ranking, the deep-phase gate is:
`signalCount ≥ minRecallCount(3)` **and** `contextDiversity ≥ minUniqueQueries(3)`
**and** `score ≥ minScore(0.8)`, within `maxAgeDays(30)`, where
`signalCount = recallCount + dailyCount + groundedCount`.
- Recall is **not** the only signal — the nightly dreaming credits `daily`
  signals itself, so promotion does not require 3 live conversational recalls.
  (`grounded` signals only come from `wiki rem-backfill --stage-short-term`,
  which never ran → `groundedCount` was always 0 — a latent, unused path, not a
  regression.)
- Qualifying memories were scoring **~0.765 vs the 0.8 cutoff** — a knife-edge
  miss. `frequency = log1p(signalCount)/log1p(10)`: at signalCount 3 → 0.58; in
  the busy May/early-June setup phase memories reached signalCount ~10 →
  frequency 1.0 → cleared 0.8 (up to 10 promotions/night). As signal volume
  dropped, everything sat just under the line.
- The nightly promotion **step is healthy** — validated from history
  (`applied>0` right through Jul 3). It was purely the threshold + signal volume.

**B. The daily-note feedstock dried up.** `memory/YYYY-MM-DD.md` daily notes are
*the* promotion feedstock — 100% of recall-store entries are daily-note chunks;
dream diaries and topic notes never accumulate promotion signals. But the notes
were written *ad-hoc* (Puddles journaling project/setup work) plus the
email-triage cron section — there was never a dedicated consolidation job. As the
setup phase ended and traffic shifted to crons/tests/maintenance, the notes
thinned (last substantive one Jun 30), so new conversation topics never became
durable, recallable, promotable chunks.
- **Brisket proof:** 100+ conversation mentions across the week, present in
  memory only as *poetic dream-diary lines* (`memory/dreaming/light/*`), with
  **0 durable notes, 0 recall-store entries, never recalled.** Contrast
  volleyball: it has a durable `memory/2026-05-17.md` note → recalled 4× → nearly
  promoted. Things that get a durable note get recalled; things that only live in
  conversation/dreams do not.

**C. memory-wiki was never populated.** Enabled 2026-06-05 but
`0 sources / 0 entities / 0 concepts / 0 syntheses / 0 claims`, **0 compile-runs
ever**. `wiki compile` only refreshes generated indexes; it does **not**
auto-derive entities/concepts from sources (verified: ingest `MEMORY.md` + compile
→ still 0 entities). The wiki is curated by an agent running the bundled
**`wiki-maintainer` skill** (`extensions/memory-wiki/skills/wiki-maintainer/`):
ingest memory/daily-notes as evidence → synthesize source-backed claims via
`wiki_apply` → `wiki compile` → `wiki lint`. That maintainer was never wired to
run, and the main agent has no wiki tools (`allow_wiki: []`). So the console tabs
stayed empty **independent of** the promotion pipeline.

**D. Red herrings ruled out (documented so we don't re-chase them):**
- The deep-phase `provider rejected the request schema or tool payload` error —
  transient (0 in the last 3 days) and the candidate-truths are *algorithmic*,
  not LLM-generated, so it doesn't gate promotion.
- A "recall-quality regression" — the ~85% `no_relevant_memory` rate was
  dominated by heartbeat/cron/self-test turns; on real memory-relevant queries
  recall works (e.g. "volleyball windows next week" injected the exact
  court/TimeTree memory).
- A ledger reset — recall counts were near-zero all along in the retained window;
  nothing was wiped.

### Fixes

**Applied on the mini (2026-07-04):**
- Lowered `plugins.entries.memory-core.config.dreaming.phases.deep.minScore`
  **0.8 → 0.7** (backup `~/.openclaw/openclaw.json.bak-pre-minscore`; gateway
  restarted so the 03:00 cron uses it). Un-sticks the knife-edge.
- Promoted the backlog manually: `openclaw memory promote --min-score 0.75 --apply`
  then `--min-score 0.7 --apply` — insights landed in `MEMORY.md` (VW recall, PSE
  bill, ops notes); store now 8 promoted (was 5); `MEMORY.md` 90→97 lines
  (backup `MEMORY.md.bak-pre-promote`). After that, remaining store entries fail
  the *signal-count* gate (signalCount<3), not the score gate — i.e. they need
  more feedstock, which is fix #2.

**To build:**
- **Daily-consolidation cron + skill** — nightly ~02:00 (before the 03:00
  dreaming): read the day's real conversations (skip heartbeats/cron/tests), write
  a **factual** `memory/YYYY-MM-DD.md` (topics, decisions, preferences, open
  threads). This is the durable feedstock the recall→promotion pipeline consumes.
  Mirrors the working email-triage cron pattern; runs before dreaming so dreaming
  ingests it the same night.
- **wiki-maintainer cron** — a **separate sandboxed agent** holding the wiki tools
  (`wiki_apply`, `wiki_get`, `wiki_search`, `wiki_status`, `wiki_lint`), scheduled
  nightly *after* consolidation + dreaming, running the bundled `wiki-maintainer`
  skill: ingest memory/daily-notes → synthesize entities/concepts/claims →
  `wiki compile` → `wiki lint`. Keeps wiki tools **off the main agent**, so the
  main agent's one concept stays "memory." Populates the console.

### Corrected architecture

```
Main agent → tends MEMORY only (daily notes + MEMORY.md)
   │
   ├── daily-consolidation cron ~02:00  → writes factual memory/YYYY-MM-DD.md   [BUILD]
   │
   ├── dreaming cron 03:00              → promotes recall signals → MEMORY.md   [FIXED: minScore 0.7]
   │
   └── wiki-maintainer cron (separate sandboxed agent, own wiki tools)         [BUILD]
             → synthesizes memory → wiki (entities / concepts / claims)
                              │
                    Human reads the wiki in the console
```

Correction to the original 2026-05 model: the wiki is **not** maintained inline by
the main agent — it's a background maintainer pass, so the main agent only ever
thinks in memory. The nightly dreaming promotes into `MEMORY.md` (recall layer);
the wiki-maintainer synthesizes into the wiki (console layer); they are separate.

### As-built notes (2026-07-04)

- **minScore 0.7** and the manual backlog promotion are live (backups noted above).
- **daily-consolidation** — skill at `puddles-workspace/skills/daily-consolidation/`
  + cron `daily-consolidation` (`0 2 * * *`, agent `main`, best-effort delivery).
- **wiki-maintainer** — new sandboxed agent `wiki-maintainer` (own wiki + memory
  tools; wiki tools kept off `main`) + cron `wiki-maintainer-nightly`
  (`0 4 * * *`). **Gotcha:** a per-agent `workspace`/`workspaceAccess` override is
  **invalid config** and crash-loops the gateway (`agents.list.N: Invalid input`) —
  don't set it. Because a separate agent's per-agent QMD index can't see the main
  agent's root-workspace memory, the maintainer instead synthesizes from wiki
  **sources**: a `wiki-source-refresh` **command cron** (`50 3 * * *`) runs
  `openclaw wiki ingest MEMORY.md + memory/2026-*.md; openclaw wiki compile`, and
  the maintainer works via `wiki_search`/`wiki_get`/`wiki_apply` (not
  `memory_search`).
- **Cron PATH gotcha (fixed 2026-07-06):** the `wiki-source-refresh` command cron
  exited 127 — the gateway LaunchAgent PATH (which cron inherits) excludes
  `~/.npm-global/bin`, so bare `openclaw` isn't found (same class as the qmd PATH
  gotcha in memory). Fixed by moving the logic into
  `~/.openclaw/wiki-source-refresh.sh`, which `export`s
  `PATH=/opt/homebrew/opt/node@22/bin:~/.npm-global/bin:$PATH` before calling
  `openclaw`; the cron just runs `/bin/sh …/wiki-source-refresh.sh`. The
  wiki-maintainer *agent* cron was unaffected (gateway-routed tools, not shell CLI).
- **Verified:** the maintainer created source-backed synthesis pages
  (`cole`, `octavio-garfias`, `puddles`, `volleyball`) → the console
  **imported-insights** tab populates.
- **Known limit:** `wiki_apply` only creates **synthesis** pages (plus metadata),
  not `entity`/`concept` pages — so the **memory-palace** (entities/concepts) tab
  may stay empty; entities/concepts have no agent-facing creation path in this
  OpenClaw version. Open item if that tab specifically must fill.

### Nightly loop (as wired)

```
02:00  daily-consolidation  (main)            → factual memory/YYYY-MM-DD.md
03:00  dreaming             (managed)         → promote recall signals → MEMORY.md
03:50  wiki-source-refresh  (main, command)   → ingest memory → wiki sources + compile
04:00  wiki-maintainer      (wiki-maintainer) → synthesize sources → wiki syntheses
18:00  email triage         (main)            → (existing)
```
