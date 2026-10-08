# Plan 021: Per-agent calendar bridge configuration

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

Each agent selects a calendar process configured for that agent’s workspace. Agents that resolve to the same configuration can share a process, while different configurations get separate processes. Security checks and the calendar read/write tool names stay the same.

### Status

The per-agent factory and bridge cache are implemented and installed. The Mini has workspace PIM configuration and the calendar bundle contains the configuration handoff.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Resolve workspace configuration before plugin default, environment fallback, and upstream default.
- Cache one pending bridge promise per resolved configuration directory, including a default key.
- Merge plugin environment and pass the resolved configuration directory to the subprocess.
- Evict failed/closed bridge entries and clean up on shutdown.
- Preserve tool names, action gates, hooks, and backward compatibility for agents without workspace configuration.

### Architecture and decisions

- `api.registerTool(factory)` receives `ctx.workspaceDir`; a static tool cannot infer agent identity from its execute arguments.
- The cache is keyed by resolved configuration directory, not agent ID. Concurrent callers share the promise.
- The plugin resolves configuration when the factory is called, and a returned tool retains that bridge specification. Changing which directory exists therefore requires factory re-resolution; do not assume edits are watched live.
- Configuration content reload depends on the underlying process. Restarting/recreating affected bridges is the conservative way to apply changes; the old contradictory blanket no-restart advice is removed.
- Apple-PIM configuration must include all required domain blocks. Invalid configuration may fall back upstream, so validate the decoded scope before granting a tool.

### Implementation

- `openclaw-plugins/secure-apple-calendar/src/bridge-cache.ts` provides sharing, failure eviction, environment handoff, and shutdown.
- `src/plugin.ts` registers read/write factories; `src/mcp-bridge.ts` exposes transport close notification.
- Tests cover cache races, environment propagation, factory dispatch, and shutdown.

### Validation

- Inspected bridge-cache implementation, plugin factory, component README, and test inventory.
- Mini installed calendar bundle contains `APPLE_PIM_CONFIG_DIR`; selected main/reader workspace PIM config files exist.
- Original completion record reports 61 tests and a 2026-05-13 live per-agent allowlist smoke.

The audit verifies the installed mechanism and config presence without reading personal calendars. Historical live filtering checks are not rerun.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
