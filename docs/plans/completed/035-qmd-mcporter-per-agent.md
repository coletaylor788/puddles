# Per-agent QMD mcporter support

**Status:** Complete
**Issue:** [#108](https://github.com/coletaylor788/puddles/issues/108)
**Last updated:** 2026-09-26

## Human section

### Design

The memory search backend can keep a long-lived query process for faster searches. A shared process can point at the wrong agent index. Per-agent overrides let each agent select a different process or disable that transport and use direct searches.

Configuration merges the global values, agent defaults and matching agent entry field by field. A partial override must preserve settings inherited from defaults. This records the delivered external-memory implementation; the newer stable source migrates to builtin local search because upstream retired that backend.

### Status

The per-agent override implementation is deployed on the Mini and its gateway is running. The installed resolver merges all three layers, and two configured agents disable the shared transport. The earlier claim that the live gateway is offline is obsolete.

## Agent section

### State

Completed historical feature. Public merge `2d30e17` contains the corrected implementation. On 2026-09-26 the Mini runs OpenClaw `2026.7.1` with QMD enabled and per-agent disables for household and the wiki-maintainer. Current stable source replaces retired QMD transport with builtin-memory migration coverage.

### Scope and acceptance criteria

- Preserve global behavior when no agent override exists.
- Merge enabled, serverName and startDaemon across all three layers.
- Let an agent disable mcporter in favor of direct QMD searches.
- Retain configuration and isolation regression coverage.
- Restore and validate the deployed gateway through the managed lifecycle.

### Architecture and decisions

The installed backend calls `resolveMcporterConfig` with global QMD, agent defaults and the matching entry. This preserves partial overrides. `builtin-memory-migration.patch` in current stable source carries the later retirement and configuration migration; it is not an unimplemented part of this feature.

### Implementation

The original `qmd-mcporter-per-agent.patch` and its three-layer regression landed through #109. Stable source has removed the external backend and retains migration/source-isolation coverage in `docs/openclaw-setup/patches/builtin-memory-migration.patch`.

### Validation

The original corrected candidate passed 127 workspace tests, 502 mapped OpenClaw tests and two candidate tests. The audit inspected the installed resolver, safe configuration fields and loopback listener. It did not execute memory searches or print memory content.

### Rollout and rollback

This feature is deployed. Any restoration uses a coherent retained package and state through the managed rollback workflow. Stable builtin-memory migration is a separately delivered source change and does not require restoring the retired backend.

### Review log

Independent review caught the original defaults-loss bug and its correction added explicit three-layer composition. The hygiene audit confirms that composition in the installed bundle and removes the stale outage and deployment-pending claims.

### Checklist

- [x] Implement per-agent overrides and preserve defaults.
- [x] Register and pass focused and accumulated regressions.
- [x] Land the corrected public source.
- [x] Confirm deployed resolver, selected overrides and running gateway.
