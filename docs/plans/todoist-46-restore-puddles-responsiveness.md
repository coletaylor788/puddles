# Restore Puddles responsiveness

**Status:** Replacement landing candidate
**Issue:** https://github.com/coletaylor788/puddles/issues/46
**Last updated:** 2026-07-28

## Human design

### Problem

An in-place OpenClaw update installed version 2026.7.1-2 and regenerated the
gateway LaunchAgent. Startup then found stale update-check JSON that conflicted
with newer shared SQLite state, refused readiness, and entered a launchd restart
loop. The loopback gateway stayed closed, so the native iMessage channel could
not receive owner requests. The deployment script masked migration failure and
could report success without a healthy gateway.

### Outcome

The stale source is archived behind a recovery snapshot, the gateway and native
iMessage channel are healthy, and future patched deployments are serialized,
failure-atomic, and locally health-checked. Migration, browser refresh, restart,
readiness, interruption, or rollback failure cannot be reported as success.

### Approach

Preserve the newer shared state and archive only the conflicting legacy source.
For deployments, serialize each source build and target mutation; quiesce the
gateway; preserve the installed package and service definition; snapshot the
complete runtime with no-fallback `clonefile(2)`; migrate; build and promote the
browser image transactionally; then start and probe the configured local port.
Rollback stages a complete reverse clone and atomically swaps it into place.

### Safety and rollout

Production validation is payload-free and sends no message. External writes in
tests use existing recording mocks. Recovery fails closed when source cloning,
shutdown confirmation, reverse cloning, or atomic swap is unavailable. A target
lock covers package, state, browser image, and restart work; a source lock covers
patch, build, and pack. Promotion uses the documented local lifecycle and its
recorded rollback artifacts.

## Agent details

### State

The live gateway LaunchAgent is stable, its loopback health endpoint reports
live, configuration validates, and the native iMessage monitor/private API probe
is ready. No test message was sent. Sixteen review findings have been accepted
and remediated. Twenty focused deployment tests and the atomic-restore full
managed lifecycle pass. Atomic-restore review found one accepted gap: failed
previous-package reinstall still allowed restart. Package, runtime, and plist
restoration failures are now restart-blocking; 21 focused tests and the full
managed lifecycle pass. Restart-blocking review found that doctor can bootstrap
the intentionally stopped service; remediation is in progress to externalize
service repair and preserve quiescence. Doctor now runs under external service
ownership, the gateway is verified unloaded afterward, and 21 focused tests
and the full managed lifecycle pass. Clean full-diff review found no actionable
issues; the replacement landing candidate is being committed for terminal
exact-commit review.

### Scope and acceptance criteria

- Restore owner-request ingress without delivering an automated test message.
- Fail nonzero on migration, package, browser, restart, readiness, interruption,
  or rollback errors.
- Serialize shared source builds and all target-host deployment mutations.
- Confirm gateway shutdown before snapshot or restore and probe only the local
  configured gateway port after restart.
- Snapshot the full runtime with no physical-copy fallback.
- Restore by complete reverse clone and atomic swap; never restart after restore
  failure or mutate rollback state after shutdown timeout.
- Treat previous-package, runtime, and plist restoration failures as
  restart-blocking so uncertain code/config combinations never launch.
- Run doctor with gateway service repair externally managed and fail if the
  service becomes loaded before the explicit transaction commit.
- Preserve the prior package, plist, browser entrypoint, browser image identity,
  and runtime state.
- Pass focused validation and
  `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Complete clean full-diff and terminal exact-commit review, remote checks,
  configured promotion, production validation, and landing.

### Architecture and decisions

- The request path is native iMessage to the loopback OpenClaw gateway; model,
  sandbox, disk, and memory resources were healthy.
- The live repair preserves the newer SQLite update-check row and archives the
  stale JSON using OpenClaw's `.migrated` convention.
- `openclaw doctor --fix --yes` is mandatory and its failure is propagated.
- Doctor runs with `OPENCLAW_SERVICE_REPAIR_POLICY=external`; the deployment,
  not doctor, exclusively owns gateway stop/start.
- `openclaw gateway health --port <port>` prevents an environment-selected
  remote gateway from satisfying readiness.
- `clonefile(2)` is called directly through the system C library; unlike
  `cp -cR`, it returns `ENOTSUP` or `EXDEV` instead of copying physically.
- Reverse restore clones into staging first, then uses
  `renamex_np(RENAME_SWAP)` so the current runtime is never removed before a
  complete replacement exists.
- The gateway plist and runtime directory are validated before shutdown and
  revalidated afterward.
- The installed rollback package uses `npm pack --ignore-scripts`; source-only
  prepack tooling is absent from production installs.
- The browser image builds under a unique tag and records the previous image ID
  before promotion; rollback restores and recreates the prior container.
- Locks live outside package/runtime contents: one in the source Git admin path
  and one in the target user's home.

### Implementation

1. Captured live config, service, legacy source, and consistent shared-state
   recovery artifacts.
2. Archived stale update-check JSON, waited out the interrupted migration lease,
   and restarted the gateway.
3. Unified local and explicit-remote deployment through one locked target
   transaction with unique candidate staging.
4. Added complete runtime clone, atomic restore, package/plist/browser rollback,
   signal handling, bounded shutdown/readiness, and local-only health checks.
5. Moved browser entrypoint/image/container refresh inside the stopped-gateway
   transaction and source patch/build/pack under a source-checkout lock.
6. Added isolated regressions for local/remote success, migration mutation,
   delayed readiness, timeout, exact restore, signal boundaries, false remote
   health, lock contention, valid staging, browser rollback, delayed shutdown,
   production package backup, unsupported cloning, reverse-clone failure, and
   missing plist preflight.
7. Completed: made package/plist/runtime restore failures restart-blocking
   and add a previous-package-install failure regression.
8. Completed: externalized doctor service repair, verified the service remains
   unloaded afterward, and test explicit-start ordering.

### Validation

- Live failure reproduced as connection refusal plus repeated launchd exit 1 and
  structured migration-conflict errors.
- Live recovery passed gateway endpoint/CLI health, stability, config validation,
  and native iMessage probe without delivery.
- `bash -n docs/openclaw-setup/patches/apply-and-deploy.sh` passes.
- `corepack pnpm --filter e2e lint` passes.
- Twenty-one focused deployment topology tests pass.
- `node packages/e2e/bin/openclaw-test-env.mjs ci` passes with workspace
  build/lint, 258 workspace tests, 298 cumulative patch regressions, and
  candidate browser-entrypoint coverage.
- Post-promotion payload-free production checks are pending.

### Rollout and rollback

The live incident snapshot remains under `~/.openclaw/recovery/`. Each deployment
creates a timestamped recovery directory outside runtime state containing the
installed package, plist, runtime clone, and browser entrypoint metadata. On
failure, the gateway is confirmed stopped, the prior package and browser image
are restored, a reverse runtime clone is atomically swapped into place, and the
prior gateway is restarted and probed locally. If shutdown, reverse clone, or
swap fails, rollback reports incomplete and does not restart against uncertain
state.

### Review log

- Thirteen reusable-review findings covering migration propagation, full-state
  rollback, quiescence, local health, source/target concurrency, unique staging,
  browser transactionality, signal ownership, production package backup, and
  shutdown gating were remediated.
- Terminal review of the first candidate found one additional clone fallback;
  direct `clonefile(2)` remediation is complete.
- Clone-remediation review found reverse-clone restart and post-stop plist
  preflight gaps; atomic restore and pre-stop validation are complete.
- Atomic-restore review found previous-package reinstall failure was not
  restart-blocking; remediation is complete.
- Restart-blocking review found doctor could activate the gateway
  mid-transaction; remediation is complete.
- Fresh replacement full-diff review found no actionable issues. Residual gaps
  are real APFS syscall exercise during promotion and post-promotion read-only
  production health checks.
- Pending: terminal fresh review of the replacement exact commit.

### Checklist

- [x] Verify Todoist tracking linkage and issue ledger shape.
- [x] Create and maintain the normalized repository plan.
- [x] Research and repair the live response failure.
- [x] Implement deployment hardening and committed regressions.
- [x] Rerun the full managed lifecycle after atomic-restore remediation.
- [x] Complete clean full-diff review.
- [ ] Complete terminal exact-commit review.
- [ ] Push, open a non-draft pull request, and pass remote checks.
- [ ] Promote, validate production, merge, and verify the landed result.
- [ ] Update the issue ledger and Todoist task for final review.
