# Restore Puddles responsiveness

**Status:** Landing candidate
**Issue:** https://github.com/coletaylor788/puddles/issues/46
**Last updated:** 2026-07-28

## Human design

### Problem

An in-place OpenClaw update installed version 2026.7.1-2 and regenerated the
gateway LaunchAgent, after which every gateway start refused readiness. The
startup migration found legacy update-check JSON that conflicted with the new
shared SQLite state, exited with code 1, and launchd repeatedly restarted it.
The gateway port therefore stayed closed and the native iMessage channel could
not receive owner requests.

### Outcome

The stale legacy state is archived behind a recoverable snapshot, the gateway
and native iMessage channel are healthy again, and deployment refuses to report
success if required state migration or gateway startup fails. Deployment now
restores the previous package and runtime snapshot on failure. The regression
is part of the shared cumulative integration pool.

### Approach

Snapshot the affected runtime state, preserve the newer shared SQLite state,
archive the stale legacy update-check file, restart the managed service, and
verify the gateway and channel through read-only health probes. Harden the
existing patch deployment script so it serializes deployments, quiesces the
gateway before taking a complete copy-on-write runtime snapshot, treats
migration failure as fatal, verifies the restarted local port with a bounded
payload-free probe, and rolls back package, runtime, and service state
automatically. Cover local and explicit remote paths in the deployment
integration tests.

### Safety and rollout

Keep production validation payload-free and do not send a test message.
Use a target-host lock and stop the gateway before the snapshot or migration.
Snapshot the complete runtime directory with an APFS copy-on-write clone plus
the service definition; restore it exactly and restart if repair worsens health.
Exercise migration mutation, delayed readiness, false remote health, concurrent
deployment, and successful restart only in isolated fixtures. Promote only the
independently reviewed, remotely green hardening change through the documented
deployment lifecycle.

## Agent details

### State

Live service is restored. Independent review found four lifecycle defects in
the first candidate; all are now remediated and focused tests are green.
Deployment now locks the target, quiesces the gateway, clones the complete
runtime tree, forces local-port health, uses unique remote staging, and restores
exact runtime/package/service state on failure or interruption. Replacement
review found two remaining concurrency defects: local package packing still
used a shared source artifact, and the target lock ended before sandbox refresh.
Both are remediated: candidates use per-invocation staging and the locked target
transaction now includes browser entrypoint installation, image build, and
sandbox recreation. A final complete-diff review then found three additional
accepted defects: the local tarball path was incorrectly re-prefixed, the
gateway restarted before rollback-capable browser work finished, and rollback
ownership flags were set after destructive commands. All three are remediated:
the absolute staged path is passed directly, the gateway stays stopped until a
candidate browser image is promoted/recreated transactionally, and rollback
ownership precedes destructive operations. Fourteen focused tests are green;
the ultimate full managed suite is green. Final review then found two accepted
race conditions: gateway shutdown was not awaited before snapshot/restore, and
the shared source checkout could still build concurrently. Both are being
remediated: shutdown is boundedly confirmed before state operations, and a
Git-admin source lock spans patch/build/pack/deploy. Sixteen focused tests are
green, and the race-hardened full managed lifecycle is green. Clean-gate review
found two accepted production-path blockers: packing the installed package ran
an unavailable `prepack` toolchain, and rollback mutated state even when bounded
shutdown confirmation failed. Both are remediated: installed-package backup
uses `--ignore-scripts`, and rollback aborts before mutation when shutdown is
unconfirmed. Seventeen focused tests and the production-shaped full managed
lifecycle are green. Final pre-commit complete-diff review is clean with no
actionable findings; the landing candidate is being created for terminal exact-
commit review. The
gateway LaunchAgent is running with one clean start, the loopback health
endpoint reports live, configuration validates, and the native iMessage probe
reports its monitor and private API ready. No message was sent.

### Scope and acceptance criteria

- Repair the conflicting legacy update-check migration from a recoverable
  snapshot and restore gateway readiness without delivering a message.
- Make deployment fail nonzero when `openclaw doctor --fix --yes` fails instead
  of continuing to restart and report success.
- Make deployment wait for a payload-free gateway health probe after restart
  on the configured local port and fail if readiness is not reached.
- Prevent concurrent deployments from overlapping on one target host and use a
  unique local and remote staging path.
- Stop the gateway before snapshot and migration, then capture the complete
  runtime mutation domain with copy-on-write storage.
- Restore runtime content exactly, including removing paths created by a failed
  migration, and verify rollback health on the same local port.
- Hold the same target-host lock through browser entrypoint installation, image
  rebuild, and sandbox recreation so package and sandbox artifacts cannot
  interleave across deployments.
- Keep the gateway stopped through every rollback-capable browser operation so
  no live writes can occur against a snapshot that may still be restored.
- Build the browser image under a unique candidate tag, preserve the previous
  production image identity, and restore that identity if promotion or later
  readiness fails.
- Set rollback ownership before every potentially destructive operation so a
  pending signal cannot observe stale ownership state.
- Wait boundedly until launchd confirms the gateway service has fully left its
  domain before snapshotting or replacing runtime state.
- Serialize patch application, build, and pack per source checkout in addition
  to serializing deployment per target host.
- Preserve the installed rollback package without running package lifecycle
  scripts that are absent from production installations.
- Abort rollback mutations when bounded shutdown cannot be confirmed; retain
  recovery artifacts and report rollback incomplete rather than replacing live
  state.
- Preserve provider-neutral public behavior and existing security boundaries.
- Add committed regressions for migration failure, successful migration, delayed
  readiness, readiness timeout, exact filesystem restoration, local-port
  targeting, and concurrent deployment denial.
- Pass focused package validation and
  `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Complete independent adversarial review, remote integration, configured
  promotion, production health validation, and landing unless a concrete
  lifecycle blocker is found.

### Architecture and decisions

- The request path is native iMessage to the loopback gateway. No configured
  model, sandbox, disk, or memory failure is involved because the gateway exits
  before binding its port.
- The supported repair is `openclaw doctor --fix --yes`; the failure message
  explicitly requires it. Recovery state will be copied before invoking it.
- `docs/openclaw-setup/patches/apply-and-deploy.sh` already invokes the repair
  but masks its exit status with `|| true`. That success-shaped fallback is the
  deployment defect to remove.
- Deployment readiness will use `openclaw gateway health --port <local-port>`
  with a bounded retry, not environment-selected remote routing, a live agent,
  or message delivery.
- Existing test-environment command recording will be extended rather than
  introducing a new deployment framework.
- The runtime's suggested `doctor --fix` command returned success but could not
  reconcile an older legacy update-check file with newer shared state. The live
  repair therefore preserved the newer database row and archived the stale
  source using the runtime's own `.migrated` convention.
- A selected-file archive is insufficient because doctor can mutate agent,
  session, queue, plugin, and archive-marker state. The target Macs use APFS, so
  the complete runtime directory will be cloned with `cp -cR` after quiescing
  the gateway; failure to make that clone aborts before package replacement.
- The deployment lock and recovery directory live outside the runtime directory
  so complete snapshots do not recurse and exact restoration can replace the
  whole runtime tree.
- Package packing uses a per-invocation temporary directory; no deployment
  deletes or consumes another invocation's tarball.
- Sandbox refresh is part of the locked target transaction rather than an
  unlocked outer-script phase.
- The local target receives the already-absolute staged tarball path unchanged;
  tests reject install paths that do not exist.
- The browser image uses a candidate tag until build success; promotion records
  and can restore the previous production image tag.
- A source-checkout lock under its Git administrative directory covers apply,
  build, pack, target deployment, and cleanup without entering package contents.
- Installed-package backup uses `npm pack --ignore-scripts`; candidate source
  packing still runs the normal build-controlled package flow.

### Implementation

1. Completed: copied the live shared database, legacy sources, config, and
   service files to a timestamped recovery directory.
2. Completed: archived the stale update-check JSON, waited out the interrupted
   migration lease, and restarted the LaunchAgent.
3. Completed: verified gateway health, stability, configuration validity, and
   native iMessage monitor/private-API readiness without sending a message.
4. Completed: revised the unified target routine to acquire an atomic host
   lock, stop the gateway, clone the complete runtime state, use a unique remote
   candidate path, force local-port health, and exactly restore failed state.
5. Completed: extended local and remote tests to mutate filesystem state
   during a failed repair, prove exact restoration, reject a held deployment
   lock without deleting it, distinguish local readiness from an unrelated
   remote gateway, and exercise interruption recovery.
6. Completed: moved package packing to unique local staging and moved the
   browser entrypoint/image refresh into the locked target routine, with a
   regression proving the lock remains held through Docker mutation and that
   unrelated source tarballs are untouched.
7. Completed: passed the absolute local tarball path, kept the gateway
   stopped until browser refresh is complete, make browser image promotion
   rollback-aware, and move ownership flags before stop/entrypoint/image
   mutations.
8. Completed: added bounded shutdown confirmation and a source-checkout lock,
   plus delayed-shutdown and concurrent-build regressions.
9. Completed: disabled lifecycle scripts only for installed-package backup
   and gate every rollback mutation on confirmed shutdown, with production-
   shaped pack and rollback-timeout regressions.

### Validation

- Observed: gateway health returned connection refused while launchd recorded
  repeated exit code 1.
- Observed: structured startup logs reported conflicting legacy update-check
  and shared SQLite state and refused readiness until `doctor --fix`.
- Observed: config validation passed; disk and memory were healthy.
- Passed: `bash -n docs/openclaw-setup/patches/apply-and-deploy.sh`.
- Passed: eight focused deployment topology tests covering local and remote
  success, migration failure, delayed readiness, timeout, snapshot, and
  rollback.
- Passed: `corepack pnpm --filter e2e lint`.
- Passed after remediation: 11 focused deployment topology tests covering local
  and remote success, migration mutation/failure, delayed readiness, local
  readiness timeout, unrelated healthy remote routing, exact rollback,
  interruption recovery, unique staging, and lock contention.
- Passed after replacement-review remediation: the same 11 tests now also
  execute browser refresh in local and remote modes, assert the deployment lock
  is held during Docker mutation, and preserve unrelated source tarballs.
- Passed after final-review remediation: 14 focused deployment tests, including
  nonexistent candidate rejection, interruption during gateway stop and browser
  build, and browser entrypoint/image/container rollback after recreation
  failure.
- Passed after ultimate-review remediation: 16 focused deployment tests,
  including delayed launchd shutdown confirmation and concurrent source-build
  denial without removing the other invocation's lock.
- Passed after clean-gate remediation: 17 focused deployment tests, including a
  production-shaped installed package that requires `--ignore-scripts` and a
  rollback shutdown timeout that proves package/runtime state remains
  untouched.
- Passed after remediation:
  `node packages/e2e/bin/openclaw-test-env.mjs ci`, including workspace
  build/lint, 248 workspace tests, 298 cumulative OpenClaw patch regressions,
  and the candidate browser-entrypoint test.
- Passed after replacement-review remediation: the same full managed command
  with 248 workspace tests, 298 cumulative patch regressions, and candidate
  coverage.
- Passed after final-review remediation:
  `node packages/e2e/bin/openclaw-test-env.mjs ci`, including workspace
  build/lint, 251 workspace tests, 298 cumulative OpenClaw patch regressions,
  and candidate browser-entrypoint coverage.
- Passed after ultimate-review remediation:
  `node packages/e2e/bin/openclaw-test-env.mjs ci`, including workspace
  build/lint, 253 workspace tests, 298 cumulative OpenClaw patch regressions,
  and candidate browser-entrypoint coverage.
- Passed after clean-gate remediation:
  `node packages/e2e/bin/openclaw-test-env.mjs ci`, including workspace
  build/lint, 254 workspace tests, 298 cumulative OpenClaw patch regressions,
  and candidate browser-entrypoint coverage.
- Passed after live repair: payload-free gateway endpoint, CLI gateway health
  and stability, config validation, and native iMessage probe.
- Pending: post-promotion repetition of payload-free production checks.
- The final full managed result is current and green.
- The ultimate full managed result is current and green.
- The race-hardened full managed result is current and green.
- The production-hardened full managed result is current and green.

### Rollout and rollback

The live incident snapshot is stored under `~/.openclaw/recovery/` and remains
available for manual restoration. The remediated deployment creates a
timestamped recovery directory outside `~/.openclaw`, preserve the installed
package and service definition, stop the gateway, and copy-on-write clone the
complete runtime tree. Package, migration, restart, or readiness failure will
move the failed tree aside, restore the exact clone, restore the prior package
and service definition, restart the prior gateway, probe its local port,
preserve the original nonzero result, and report rollback failure separately.

### Review log

- Reusable-worker review found four accepted findings: incomplete state
  restoration, snapshot/migration concurrency with the running gateway,
  ambiguous remote-capable health targeting, and missing deployment
  serialization/unique staging.
- All four findings are remediated and the full pool rerun is green.
- The original code-review worker is one-shot and cannot be resumed. Per the
  workflow, a fresh independent replacement reviewed the complete current diff
  with the prior findings and remediation summary.
- Replacement review confirmed the first four fixes and found two additional
  medium-severity concurrency defects: shared local pack artifacts and lock
  release before sandbox refresh. Both are remediated; pending final validation
  and complete-current-diff replacement review.
- Final complete-diff review found three accepted defects: nonexistent local
  install path, browser work after gateway restart without Docker rollback, and
  post-mutation signal ownership flags. All three are remediated; pending final
  full validation and review.
- Ultimate review found two accepted races: unawaited gateway shutdown and
  concurrent mutation of one source checkout. Both are remediated; pending
  final full validation and clean review.
- Clean-gate review found two accepted production blockers: installed-package
  `prepack` failure and rollback mutation after shutdown timeout. Both are
  remediated.
- Final pre-commit complete-current-diff review found no actionable issues.
  Residual gap: configured promotion and post-promotion read-only production
  health checks remain pending.
- Pending: terminal fresh review of the exact landing candidate.
- Pending: terminal fresh review of the exact landing candidate.

### Checklist

- [x] Verify the first Copilot-authored Todoist comment links issue 46.
- [x] Verify issue 46 has the required concise ledger shape.
- [x] Create and normalize the repository plan.
- [x] Complete runtime and root-cause research.
- [x] Snapshot and repair live migration state.
- [x] Verify payload-free live gateway and channel health.
- [x] Implement the fix and committed regressions.
- [x] Rerun focused and full managed validation after review remediation.
- [x] Complete reusable-worker adversarial review and remediation.
- [ ] Complete terminal exact-commit adversarial review.
- [ ] Push, open a non-draft pull request, and pass remote checks.
- [ ] Promote, validate production, merge, and verify the landed result.
- [ ] Update the issue ledger and Todoist task for final review.
