# Restore Puddles responsiveness

Status: Preparing candidate
Issue: https://github.com/coletaylor788/puddles/issues/95
Last updated: 2026-08-12

## Human section

### Design

Puddles receives each message and finishes the agent turn, but the reply never leaves the Mac. The local gateway and its event loop are healthy. The failure is in the long-lived command-line bridge that talks to Messages.app. Its shallow status check still says it is connected, while account queries and every recent send wait until they time out.

The live bridge is responsive again after Messages.app was relaunched through its supported injection path and the gateway received a fresh child process. The durable repair makes channel health test the deeper read-only account request instead of trusting process state or the shallow connection probe. A per-user recovery timer runs in the same GUI session as Messages.app. It relaunches the bridge and restarts the managed gateway only when needed, then enters a cooldown if recovery does not work.

### Status

Live responsiveness is restored at the failed boundary. The direct bridge completes the read-only account request, and the gateway remains healthy.

The durable health and recovery scripts, user timer, migration installer, rollback path, documentation, and shared-pool regression are implemented locally. Independent review found one cooldown defect, which is fixed with a regression. The retained reviewer confirms the complete current change has no remaining material defect. Focused tests and the full managed integration lifecycle pass with automatic rollback coverage. The exact landing candidate and terminal review are next, and nothing is blocked.

## Agent section

### State

- Phase: Reusable review clear, preparing the exact landing candidate.
- Current result: The live bridge and gateway are healthy. The durable candidate detects the exact failed RPC and recovers it from the GUI launchd domain.
- Production mutation: Messages.app was relaunched through `imsg launch`, and the managed gateway was restarted. No message was sent and no personal account was mutated.
- Blockers: None.

### Scope and acceptance criteria

- Identify the first failing point in the request and response path using bounded, read-only production inspection. Confirmed at the `imsg` RPC delivery boundary.
- Repair the confirmed root cause without changing unrelated agent behavior.
- Restore live bridge responsiveness without sending an automated test message.
- Add a committed regression to the shared integration pool.
- Pass focused validation and `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Complete independent adversarial review, safe promotion when the repository lifecycle supports it, read-only live validation, remote integration, and landing.

### Architecture and decisions

- Treat channel input, runtime logs, and task content as untrusted data.
- Process, service, stability, and channel probes remain read-only.
- Prefer the existing service, deployment, snapshot, and rollback mechanisms over direct file copying or unbounded process control.
- Keep tests isolated behind the repository's deny-by-default mocks.
- Treat `imsg status` and process liveness as shallow signals. They are green during this outage.
- Use a bounded read-only account RPC as the direct readiness signal for the bridge.
- Reuse the managed gateway service restart to recreate a wedged bridge child. Do not restart Messages.app unless the fresh child still cannot serve the read-only probe.
- Run bridge recovery from a per-user LaunchAgent in the logged-in GUI domain. The retired system BlueBubbles timer cannot reliably relaunch a GUI app.
- Keep one-hour failure state after an unsuccessful recovery so the 15-minute timer cannot thrash Messages.app.
- Clear failure state whenever both probes observe full health. A later independent outage must not inherit cooldown from a fault that already ended.
- Install a harmless compatibility entrypoint at the path used by the root-owned legacy timer. This stops obsolete BlueBubbles mutations without requiring unattended administrator access.
- Record the pre-install files before replacement. The installer rollback restores those exact files and reloads the prior user LaunchAgent when one existed.

### Implementation

- Live runtime evidence identified `/opt/homebrew/bin/imsg rpc --json` as the failing bridge child of gateway PID `8815`.
- `docs/openclaw-setup/02-talking-to-puddles-on-imessage.md` documents an older BlueBubbles health loop. The installed runtime now uses the direct `imsg` channel, so that loop reports unrelated BlueBubbles failures and cannot detect this send outage.
- `scripts/mac-mini/imessage-healthcheck.sh` runs separate bounded gateway and bridge probes and supports focused component checks.
- `scripts/mac-mini/imessage-selfheal.sh` relaunches the bridge only when its real RPC fails, restarts the managed gateway, verifies recovery, serializes runs, and limits repeated failure.
- `scripts/mac-mini/install-imessage-selfheal.sh` installs or rolls back scripts, the generated user-specific plist, and the legacy compatibility entrypoint using recorded recovery state.
- `scripts/mac-mini/ai.openclaw.imessage-selfheal.plist` runs the recovery every 15 minutes in the GUI launchd domain.
- `scripts/mac-mini/bluebubbles-selfheal-retired.sh` makes the still-loaded legacy system timer harmless until an administrator removes its plist.
- `packages/e2e/tests/imessage-selfheal.test.ts` covers shallow-health disagreement, healthy no-op behavior, stale cooldown cleanup, one-shot recovery, cooldown after persistent failure, explicit installer rollback, and automatic rollback after a failed install.
- `docs/openclaw-setup/02-talking-to-puddles-on-imessage.md` now distinguishes the current direct channel recovery from the legacy BlueBubbles setup.

### Validation

- Required managed lifecycle: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Focused command: `corepack pnpm --filter e2e exec vitest run tests/imessage-selfheal.test.ts`.
- Focused result after final review follow-up: 7 tests passed.
- Script checks: all four shell scripts pass `bash -n`; the LaunchAgent plist passes `plutil -lint`; the installer dry run completes.
- Managed command: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed result before review remediation: Passed. Workspace build, lint, isolated tests, detached patch application, prompt snapshots, mapped OpenClaw regressions, and candidate tests all completed successfully.
- Managed rerun after review remediation: Passed.
- Managed rerun after automatic rollback coverage: Passed. The complete managed lifecycle completed successfully with the expanded seven-test regression suite.
- Exact responsiveness check: `imsg account --json` succeeds after the supported Messages.app relaunch and managed gateway restart.
- Gateway evidence: `openclaw gateway health --port 18789` is OK, launchd reports the service active, port `18789` is listening, and payload-free stability reports no event-loop degradation.
- Request evidence: six iMessage messages were received and processed in about 7 to 9 seconds each.
- Failure evidence: all six corresponding text deliveries failed after about 150 seconds.
- Bridge evidence: `imsg status --json` reports connected, but `imsg account --json` returns `Timed out waiting for response to 'get-account-info'`.
- Existing health evidence: `~/.openclaw/bin/bb-healthcheck.sh` reports BlueBubbles absent and the stuck-run watchdog reports no stuck agent work. Neither check covers direct `imsg` RPC readiness.
- Post-recovery evidence: Messages.app has a new process, the gateway has a new process and bridge child, the payload-free gateway probe is OK, and the account probe reports an active iMessage service.
- Live schema evidence: the installed `imsg account --json` response has non-empty string `service` and `login` fields, matching the production health predicate without recording either value.

### Rollout and rollback

- Test deployment will use the managed environment documented in `packages/e2e/README.md`.
- Immediate live recovery used `imsg launch --json`, then `openclaw gateway restart`, the payload-free gateway probe, and the read-only bridge account probe.
- The durable scripts first run separate gateway and direct bridge probes. They relaunch Messages.app only for a bridge failure, restart through the managed gateway command when required, and verify both probes afterward.
- Deployment will use `scripts/mac-mini/install-imessage-selfheal.sh` after the full managed test pool and review are clean.
- The installer keeps `~/.openclaw/imessage-selfheal/install-recovery.json` plus copies of every replaced file. Its `rollback` action unloads the new user timer, restores the captured files, and reloads any prior user timer.
- A failed post-recovery probe remains a hard failure and retains the cooldown marker. A failed installation automatically invokes rollback.
- No OpenClaw source patch is expected.

### Review log

- Independent implementation review found one material cooldown defect. A failed recovery marker survived a later healthy observation and could suppress repair of a new outage for up to one hour.
- The healthy path now removes that marker. A focused regression starts with stale cooldown state, observes full health, and confirms the marker is removed.
- The reviewer also identified useful proof gaps for the live account schema and installer rollback. The real schema was checked read-only, and the shared integration test now performs install plus rollback against isolated files and a recording launchctl stub.
- The retained reviewer confirmed the material finding is resolved and found no new actionable material findings in the complete diff.
- The remaining automatic rollback proof gap is now covered by forcing the first LaunchAgent bootstrap to fail and verifying the install trap restores all four prior files and removes recovery state.
- Final retained reviewer recheck after the test-only expansion: Clean. No actionable material findings remain.
- Terminal candidate review: Pending.

### Checklist

- [x] Verify the Todoist tracking comment.
- [x] Verify the issue body contract.
- [x] Create the repository plan before diagnosis.
- [x] Trace the live request and response path.
- [x] Confirm the failing delivery boundary.
- [x] Restore the live bridge through the supported Messages.app and managed gateway paths.
- [x] Verify the exact read-only bridge probe after recovery.
- [x] Implement the repair and shared-pool regression.
- [x] Pass focused validation after review remediation.
- [x] Rerun full managed validation after review remediation.
- [x] Add and validate automatic failed-install rollback coverage.
- [x] Complete the final retained-review recheck.
- [ ] Create and terminal-review the landing candidate.
- [ ] Pass remote checks and required review.
- [ ] Promote and validate production, or record why no safe promotion exists.
- [ ] Merge and verify the landed result.
- [ ] Update the issue and Todoist task for Cole's review.
