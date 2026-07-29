# Restore Puddles responsiveness

**Status:** Final landing candidate
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
iMessage channel are healthy, and future patched deployments are serialized,
failure-atomic, and locally health-checked. Migration, browser refresh, restart,
readiness, interruption, discovery, or rollback failure cannot be reported as
success or restart uncertain code/state.

### Approach

Preserve newer shared state and archive only the conflicting legacy source.
Serialize source build and target mutation; quiesce the externally managed
gateway; preflight recovery paths; preserve package and service state; clone
regular runtime files individually with no fallback while recreating links and
native metadata; run migrations; promote the browser image transactionally;
then explicitly start and probe the local port. Rollback stages an atomic
runtime swap and uses the patched candidate CLI for sandbox recreation before
restoring the previous package.

### Safety and rollout

Production validation is payload-free and sends no message. Tests keep external
writes behind recording mocks. Recovery fails closed on invalid topology,
unsupported cloning, shutdown timeout, critical restore failure, discovery
failure, or atomic-swap failure. Signals defer until rollback reaches a safe
terminal state. Source and target locks span their full transactions. Promotion
uses the documented local lifecycle and recorded rollback artifacts.

## Agent details

### State

The live gateway LaunchAgent is stable, loopback health reports live,
configuration validates, and the native iMessage monitor/private API probe is
ready. No test message was sent. Thirty review findings are remediated. Focused
validation and the full managed lifecycle pass, and the final complete-diff
review found no actionable issues. The replacement candidate is ready to commit
and terminal-review. Terminal review found OpenSSH argument serialization loses
quoting for remote paths containing spaces. Explicit shell escaping is in place,
29 focused tests pass, and final full-diff review found no actionable issues.

### Scope and acceptance criteria

- Restore owner-request ingress without automated message delivery.
- Fail nonzero on package, migration, browser, discovery, restart, readiness,
  interruption, or rollback errors.
- Serialize shared source builds and all target-host deployment mutations.
- Shell-escape every remote command argument before OpenSSH serialization.
- Confirm gateway shutdown before snapshot/restore and keep it stopped through
  migration and browser work.
- Probe only the configured local gateway port after explicit restart.
- Clone regular files without physical-copy fallback or recursive kernel tree
  locking; preserve topology, links, POSIX modes, flags, ACLs, and xattrs.
- Reject symlinked runtime roots and recovery destinations inside runtime state,
  including case-insensitive APFS aliases.
- Restore through a staged reverse clone and atomic swap.
- Recreate sandboxes with the patched candidate CLI before package rollback.
- Never restart after critical package, plist, runtime, browser, or swap failure.
- Pass focused tests and `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Complete terminal review, remote checks, configured promotion, production
  validation, and landing.

### Architecture and decisions

- The request path is native iMessage to the loopback gateway; model, sandbox,
  disk, and memory resources were healthy.
- The live repair preserves the newer SQLite update-check row and archives stale
  JSON with OpenClaw's `.migrated` convention.
- Doctor runs with `OPENCLAW_SERVICE_REPAIR_POLICY=external`; deployment alone
  owns service activation.
- Local readiness uses `openclaw gateway health --port <port>`.
- `clone-runtime-tree.py` walks without following symlinks. Regular files use
  no-fallback `copyfile(3)` cloning; directories and symlinks use no-follow
  native metadata copying; hard links use inode identity.
- Native copy state preserves setuid/setgid, with explicit mode reapplication.
- Lexical and filesystem-identity containment checks run before recovery
  artifacts or gateway shutdown.
- Reverse restore clones into staging and uses
  `renamex_np(RENAME_SWAP)`.
- Installed package backup uses `npm pack --ignore-scripts`.
- Browser images use unique candidate tags and preserve prior image identity.
- The maintained sandbox discovery patch propagates recreate discovery errors;
  diagnostic list behavior remains best-effort.
- Rollback restores runtime/browser state and recreates sandboxes with the
  patched candidate CLI before reinstalling the previous package.
- Remote deployment constructs one explicitly escaped command string rather than
  relying on OpenSSH to preserve local argv boundaries.

### Implementation

1. Captured live recovery artifacts, archived stale update-check JSON, waited out
   the migration lease, and restored gateway/channel health.
2. Unified local and explicit-remote deployment through source and target locks
   with unique staging.
3. Added package/plist/runtime/browser recovery, signal deferral, bounded
   shutdown/readiness, local-only health, and restart-blocking restoration.
4. Added per-file no-fallback cloning, native metadata/special-mode
   preservation, topology/containment validation, and staged atomic restore.
5. Added and registered an OpenClaw patch that propagates sandbox recreate
   discovery failures with upstream-style tests.
6. Added isolated local/remote regressions for success, migration mutation,
   delayed readiness/shutdown, exact restore, interruption, false remote health,
   locks, staging, browser rollback, package failures, clone failures/topology,
   doctor quiescence, APFS metadata, discovery errors, candidate-CLI rollback,
   signal deferral, and preflight ordering.
7. Completed: shell-escaped remote target arguments and added path-with-spaces
   coverage.

### Validation

- Live failure reproduced as connection refusal, repeated launchd exit 1, and
  structured migration-conflict errors.
- Live recovery passed endpoint/CLI health, stability, config validation, and
  native iMessage probe without delivery.
- Shell syntax, Python compile, and e2e type checking pass.
- Twenty-eight focused deployment tests and patch-manifest tests pass.
- `node packages/e2e/bin/openclaw-test-env.mjs ci` passes with workspace
  build/lint, 265 workspace tests, 319 cumulative patch tests, and candidate
  browser-entrypoint coverage.
- Remote-argument remediation invalidates these results; all gates must rerun.
- Twenty-nine focused deployment tests and patch-manifest tests pass after
  remote-argument remediation; the full lifecycle must rerun.
- The first full rerun passed deployment coverage but one unrelated parser
  performance assertion measured 103.6 ms against a 100 ms threshold. The exact
  retry was fully green.
- `node packages/e2e/bin/openclaw-test-env.mjs ci` passes with workspace
  build/lint, 266 workspace tests, 319 cumulative patch tests, and candidate
  browser-entrypoint coverage.
- A previous run had one unrelated 14,999/15,000 ms timing miss; the exact
  subsequent runs were green.
- Post-promotion payload-free production checks are pending.

### Rollout and rollback

The incident snapshot remains under `~/.openclaw/recovery/`. Each deployment
records package, plist, runtime clone, and browser metadata outside runtime
state. Rollback confirms shutdown; restores runtime, plist, entrypoint, and
image; recreates sandboxes with the patched candidate CLI; then restores the
previous package, restarts, and probes locally. Signals defer through the safe
terminal state. Shutdown or critical restore failure retains diagnostics and
suppresses restart.

### Review log

- Thirty reusable-review findings covering migration propagation, quiescence,
  concurrency, exact rollback, health targeting, browser transactionality,
  signal safety, package backup, clone safety/topology/metadata, doctor
  activation, sandbox discovery, preflight ordering, and runbook accuracy were
  remediated.
- The first two terminal candidates found clone fallback and recursive clone
  host risk; both were remediated and the lifecycle restarted.
- Terminal review of `bea3d35` found remote argv quoting loss; remediation is
  complete.
- Final replacement full-diff review found no actionable issues. Residual gaps
  are real remote-host deployment, production promotion/read-only validation,
  and SIGKILL/power-loss recovery.
- Pending: terminal exact-commit review of the replacement candidate.

### Checklist

- [x] Verify Todoist linkage and issue ledger shape.
- [x] Repair the live response failure.
- [x] Implement deployment hardening, source patch, and regressions.
- [x] Pass focused and full managed validation.
- [x] Complete clean full-diff review.
- [ ] Complete terminal exact-commit review.
- [ ] Push, open a non-draft pull request, and pass remote checks.
- [ ] Promote, validate production, merge, and verify the landed result.
- [ ] Update issue and Todoist for final review.
