# Plan 024: Memory recall and nightly consolidation

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The assistant keeps durable notes as its evidence store and indexes them for recall. A nightly sequence turns conversations into factual notes, promotes useful memories, refreshes wiki sources, and lets a separate maintainer produce source-backed summaries for human browsing.

### Status

The memory stack and nightly jobs are implemented and configured. All four relevant scheduled jobs report their latest run as successful. The current promotion threshold and main-agent read access differ from the July notes.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Markdown notes remain the durable evidence store with per-agent indexed recall.
- Enable active recall, nightly dreaming promotion, and commitment extraction.
- Consolidate daily conversations before promotion; refresh wiki sources before the maintainer synthesizes them.
- Keep write-capable wiki maintenance on its own agent.
- Record observed configuration separately from historical content-quality claims.

### Architecture and decisions

- Mini uses `memory.backend=qmd`, with memory-core, active-memory, and memory-wiki enabled.
- Scheduled order is daily consolidation at 02:00, dreaming promotion at 03:00, wiki source refresh at 03:50, and wiki maintainer at 04:00.
- Current deep-promotion `minScore` is 0.8, not the July temporary 0.7 setting. This audit records the configured value without changing it.
- Main now has `wiki_get/wiki_search`; the maintainer additionally has `wiki_apply/wiki_status/wiki_lint`. The old claim of no wiki tools on main is stale.
- The original local embedding and content-backfill numbers are historical setup evidence, not current model or recall-quality guarantees.
- Wiki synthesis output is separate from entity/concept creation. This archive does not promise every console tab is populated.

### Implementation

- Memory features are configured in the gateway and use per-agent state.
- Four jobs are stored in the current SQLite cron store, not the migrated legacy JSON files.
- The source-refresh job bridges the note evidence layer into the maintainer’s wiki sources.

### Validation

- Selected SQLite `cron_jobs` fields show all four named jobs enabled, latest `last_run_status=ok`, and `consecutive_errors=0`.
- Selected Mini config confirms QMD, active-memory, dreaming, commitments, current deep threshold, and wiki tool scopes.
- No note, conversation, wiki page, or commitment content was read.

Successful scheduling is not a fresh recall-quality or console-appearance test. Later console entity/concept work, retention, additional ingestion, and tuning have been removed from this completed implementation record.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
