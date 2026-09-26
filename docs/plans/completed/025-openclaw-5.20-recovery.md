# Plan 025: Historical OpenClaw 5.20 recovery

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The recovery updated the browser container build inputs to the gateway’s expected contract and repaired cross-agent delegation. A specialized worker must receive its own configured tools when another agent launches it, while same-agent children retain inherited restrictions.

### Status

The delivered browser bootstrap and cross-agent delegation fixes are complete and maintained as source patches. The Mini now runs a later release with the persistent browser entrypoint present.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Rebuild browser sandbox inputs from a compatible source version rather than an obsolete copied Dockerfile.
- Preserve the persistent browser-profile override while updating the image contract.
- Keep the target agent’s tools for cross-agent native spawns and preserve same-agent inheritance.
- Document current maintained patch and release paths instead of old hashed-file edits.

### Architecture and decisions

- The old network-fetch/bootstrap and hashed-dist patcher workflow has been replaced by the maintained source patch and release workflow.
- `subagent-cross-agent-spawn-fix.patch` now covers native and ACP spawn behavior; ACP retains its separate requester command-capability boundary.
- `browser-userdata-dir-fix.patch` preserves the profile override and stale-lock cleanup in the current browser build inputs.
- The original proposed synthetic-scope-only announce fix was retracted and is not part of this completed recovery scope.
- Fresh delegation uses the target profile; historical ended session records do not require a bulk mutation.

### Implementation

- `docs/openclaw-setup/patches/subagent-cross-agent-spawn-fix.{md,patch}` replaces the retired `apply-subagent-cross-agent-spawn-fix.mjs`.
- `docs/openclaw-setup/patches/browser-userdata-dir-fix.{md,patch}` and the release workflow own browser image compatibility.
- `packages/e2e/openclaw-patch-suite.json` retains shared regression coverage for the maintained source patches.

### Validation

- Mini installed package reports 2026.7.1; browser entrypoint contains profile override and singleton cleanup.
- Maintained cross-agent patch documentation records live verification on 2026.6.11 and 2026.7.1 and both backend sites.
- Mini has separate main/reader/browser tool allowlists consistent with the specialized-worker design.

No fresh cross-agent run or container rebuild was performed. The scope is the delivered browser and delegation recovery. Announce queue redesign remains a separate plan; old optional upstream work and runtime follow-ups have been removed here.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
