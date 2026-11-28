# Preserve CI failure evidence through cleanup

Status: In implementation
Issue: https://github.com/coletaylor788/puddles/issues/382
Last updated: 2026-11-27

## Human section

### Design

A deployment failure can be hidden when recovery or cleanup fails afterward. Keep the first failure in a bounded durable `primaryFailure` record before recovery proceeds. Keep the latest cleanup failure separately. The existing status, recovery, queue and notification behavior remain unchanged. Successful cleanup must not erase either diagnostic record.

### Status

**Approval:** Production approved. **Approval reference:** The requester authorized required CI fixes, review, push and delivery in the deterministic CI chat. This is a scoped repair of that process, with no application or OpenClaw changes. Installation waits for a closed transaction.

Implementation and regressions are prepared. Complete tool validation and retained independent review are in progress.

## Agent section

### State

- Isolated branch `codex/ci-cleanup-failure-20261127`, based on current main.
- Failure evidence stays in existing bounded local run records.

### Scope and acceptance criteria

- Preserve the first failure's phase, message, time and numeric exit code.
- Record cleanup failures separately across restarts; retain existing outcomes.
- Bound each added message to 20,000 characters.

### Architecture and decisions

- Reuse atomic run-state persistence; do not create unbounded service logs.
- Capture command failures before recovery can replace their context.
- Capture non-command failures before cleanup starts.

### Implementation

- `packages/release/src/ci-run.mjs` owns durable failure capture.
- `packages/release/tests/ci.test.mjs` covers DEV and PROD cleanup failures, repeated cleanup, final closure and cleanup-only failure.

### Validation

- Full release-package build and suite are running.
- No application build or deployment is part of this tooling validation.

### Rollout and rollback

- Install through the maintained tooling procedure between closed tickets.
- Preserve the previous version and configuration for rollback.
- Never rewrite an installed version or active run record to adopt these edits.

### Review log

- Retained independent review is clear. The controller-internal failure finding was fixed and rechecked.

### Checklist

- [x] Isolated implementation and focused regressions.
- [ ] Full release-tool suite.
- [x] Retained review.
- [ ] Land and install between tickets.
