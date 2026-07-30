# Restore Puddles responsiveness

**Status:** Landed
**Issue:** https://github.com/coletaylor788/puddles/issues/46
**Last updated:** 2026-07-29

## Human design

### Problem

An in-place OpenClaw update installed version 2026.7.1-2 and regenerated the
gateway LaunchAgent. Startup found stale update-check JSON conflicting with
newer shared SQLite state, refused readiness, and entered a launchd restart
loop. The loopback gateway stayed closed, so native iMessage requests never
reached Puddles. The deployment script masked migration failure and could report
success without a healthy gateway.

### Outcome

The stale source is archived behind recovery state, the gateway and native
iMessage channel are healthy, and patched deployments are serialized,
failure-atomic, and locally health-checked. Migration, browser refresh,
discovery, restart, readiness, interruption, or rollback failure cannot report
success or restart uncertain code/state.

### Approach

Preserve newer shared state and archive only the conflicting legacy source.
Serialize source build and target mutation; quiesce the externally managed
gateway; preflight recovery paths; preserve package and service state; clone
regular runtime files individually with no fallback while recreating links and
native metadata; run migrations; promote the browser image transactionally;
then explicitly start and probe the local port. Rollback atomically swaps staged
runtime state and uses the patched candidate CLI for sandbox recreation before
restoring the previous package.

### Safety and rollout

Production validation is payload-free and sends no message. Tests keep external
writes behind recording mocks. Recovery fails closed on invalid topology,
unsupported cloning, shutdown timeout, critical restore failure, discovery
failure, or atomic-swap failure. Signals defer until rollback reaches a safe
terminal state. Source and target locks span their full transactions. Production
uses the combined private lifecycle so both private overlays remain installed.

## Agent details

### State

Public commit `394d023` is merged in `main` at `0fc213c`. Combined private
integration commit `8903ef8` promoted that exact public head as deployment
`1fd9e336-9ba7-43a3-aee0-a792b5f42232`. Production runs OpenClaw 2026.7.1-2 at
`0790d9f` with six public patches, both private overlays, adaptive symbol count
2, and a healthy gateway/native iMessage channel. No test message was sent.

### Scope and acceptance criteria

- Restore owner-request ingress without automated message delivery.
- Fail nonzero on package, migration, browser, discovery, restart, readiness,
  interruption, or rollback errors.
- Serialize shared source builds and target-host deployment mutations.
- Confirm gateway shutdown before snapshot/restore and keep it stopped through
  migration and browser work.
- Probe only the configured local gateway after explicit restart.
- Preserve runtime topology, links, POSIX modes, flags, ACLs, and xattrs without
  physical-copy fallback or recursive kernel tree locking.
- Reject symlinked roots and in-tree recovery paths, including APFS aliases.
- Restore through staged reverse clone and atomic swap.
- Recreate sandboxes with the patched candidate CLI before package rollback.
- Never restart after critical package, plist, runtime, browser, or swap failure.
- Pass focused/full validation, terminal review, remote checks, combined
  promotion, production validation, merge, and post-merge checks.

### Architecture and decisions

- The request path is native iMessage to the loopback gateway; model, sandbox,
  disk, and memory resources were healthy.
- The live repair preserves the newer SQLite row and archives stale JSON using
  OpenClaw's `.migrated` convention.
- Doctor uses `OPENCLAW_SERVICE_REPAIR_POLICY=external`; deployment alone owns
  service activation.
- Local readiness uses `openclaw gateway health --port <port>`.
- `clone-runtime-tree.py` performs no-fallback per-file cloning and native
  no-follow metadata copying, preserving hard links and special modes.
- Lexical and filesystem-identity containment checks precede artifacts/shutdown.
- Reverse restore stages a complete clone and uses
  `renamex_np(RENAME_SWAP)`.
- Installed package backup disables source-only lifecycle scripts.
- Browser image promotion and inspection are identity-aware and failure-atomic.
- The sandbox discovery patch propagates recreate discovery errors.
- Remote commands are explicitly shell-escaped before OpenSSH serialization.
- Rollback restores runtime/browser state with the patched candidate CLI before
  reinstalling the previous package.

### Implementation

1. Captured live recovery artifacts, archived stale update-check JSON, waited out
   the migration lease, and restored gateway/channel health.
2. Unified local/remote deployment through source and target locks with unique
   staging and safe remote argument serialization.
3. Added package/plist/runtime/browser recovery, signal deferral, bounded
   shutdown/readiness, local-only health, and restart-blocking restoration.
4. Added per-file cloning, native metadata preservation, topology validation,
   staged atomic restore, and Docker image identity handling.
5. Added and registered an OpenClaw patch that propagates sandbox recreate
   discovery failures.
6. Added comprehensive local/remote regressions across success, interruption,
   concurrency, migration, clone, browser, Docker, topology, rollback, and
   discovery boundaries.

### Validation

- Live recovery passed gateway health/stability, config validation, and native
  iMessage probe without delivery.
- Shell syntax, Python compile, and e2e type checking pass.
- Thirty-three focused deployment tests and patch-manifest tests pass.
- `node packages/e2e/bin/openclaw-test-env.mjs ci` passed with 270 workspace
  tests, 319 cumulative patch tests, and candidate browser coverage.
- Terminal exact-commit review was clean for `394d023`.
- Remote PR checks and post-merge Integration/CodeQL passed on `0fc213c`.
- Combined private gate passed 24 mapped OpenClaw files / 605 tests plus private,
  snapshot, browser, and offline graph suites.
- Production validator passed twice, including gateway, policy, installed guard,
  finite reader boundary, and wrapped fresh no-match Gmail read without content,
  delivery, mutation, or agent turn.
- Post-merge payload-free gateway, config, event-loop, and iMessage probes pass.

### Rollout and rollback

The production snapshot is
`~/.openclaw/deploy-snapshots/20260729T103923Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`;
package/config checksums pass. Each deployment records package, plist, runtime,
and browser recovery state. Rollback confirms shutdown; restores runtime,
plist, entrypoint, and image; recreates sandboxes with the patched candidate
CLI; then restores the previous package, restarts, and probes locally. Critical
restore failure retains diagnostics and suppresses restart.

### Review log

- Thirty-four reusable and terminal findings covering migration, quiescence,
  concurrency, exact rollback, health targeting, browser/Docker transactionality,
  signal safety, package backup, clone topology/metadata, sandbox discovery,
  preflight ordering, remote quoting, and runbook accuracy were remediated.
- Final public terminal review was clean for `394d023`.
- Two private exact-tree reviews were clean for `8903ef8`.
- Residual gaps: real remote-host deployment and SIGKILL/power-loss recovery.

### Checklist

- [x] Verify Todoist linkage and issue ledger shape.
- [x] Repair the live response failure.
- [x] Implement deployment hardening, source patch, and regressions.
- [x] Pass focused/full validation and exact-tree reviews.
- [x] Pass remote checks and combined promotion.
- [x] Merge and pass post-merge/production validation.
- [x] Update issue and Todoist for final review.
