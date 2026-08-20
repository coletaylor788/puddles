# Diagnose Node permission prompts

Status: Ready for Cole review
Issue: https://github.com/coletaylor788/puddles/issues/91
Last updated: 2026-08-19

## Human section

### Design

The long-running Node gateway receives messages, runs the main agent loop, loads tool plugins, and starts native helper processes. It should coordinate access, but it should not be the identity that macOS trusts. Routine Homebrew updates replace Node, so Keychain and private-data grants attached to that binary eventually stop matching. Todoist already uses a stable signed helper, and the main Contacts, Reminders, and Calendar tools already use native wrappers that own their privacy grants.

The system has changed since the August design. Gmail's durable code is merged, but the configured live checkout still runs the older Python Keychain path. A separate Gmail reliability task now owns its non-destructive migration and any Gmail approval. The model credential item now already trusts Apple's stable credential command, so the model adapters can stop using Node without a new prompt. The attendee safety check still cannot find the approved Contacts wrapper. Automatic updates still run without restarting the gateway. The unsupported classifier setting has stopped failing. The iMessage recovery work fixed reply delivery, but it did not fix the original context failure: every heartbeat still reuses one session carrying a one-million-token budget against a 128,000-token model window.

The refreshed plan moves the model readers to bounded exact-item calls through the already-approved system command, repairs the Contacts wrapper path, and adds one per-user runtime reconciler. The failing model gets its own 100,000-token cap, while larger-window models keep their current budgets. A provider-neutral cache correction replaces stale per-session values before precheck, and supported max-lines compaction repairs the current heartbeat transcript. Cole no longer needs to approve the model credential helper or take any Gmail action through this task. Cole is needed once to install the privileged update writer and later to remove old Node access after a clean soak. Gmail may ask separately through its own task if its active durability investigation proves that an approval is still needed.

### Status

The current repository, active gateway, Keychain metadata, TCC principals, update daemon, session store, recent tool runs, and related landed repairs have been rechecked. Independent review corrected a global context-cap mistake and an incomplete source-patch lifecycle. The final design uses a model-specific cap and includes named patch artifacts, pinned-revision application proof, cumulative test registration, managed deployment, installed validation, and rollback.

No live permissions, credentials, configuration, sessions, or services changed during this refresh. The refreshed design is ready for Cole to review before implementation.

## Agent section

### State

- Phase: Awaiting Cole design review
- Repository: `coletaylor788/puddles`
- Tracking issue: `#91`
- Todoist task: `6hCmp4C6fqx95423`
- Production mutation: Not performed
- Blockers: Implementation waits for Cole's refreshed design approval.

### Scope and acceptance criteria

- Preserve the original split between macOS permission failures, heartbeat context overflow, and tool-classifier configuration.
- Keep automatic Homebrew updates enabled.
- Remove migration steps that already landed or moved to another owning task.
- Name every current credential or PIM caller and its live permission boundary.
- State the exact destination, code or configuration change, validation, rollback, and owner for every remaining unstable path.
- Keep the Node gateway as the orchestrator, not the Keychain or TCC principal.
- Use the current stable system credential command where the exact item already trusts it.
- Route all Contacts, Reminders, and Calendar access through explicit native wrapper paths.
- Repair the currently failing heartbeat session with supported session tooling and a budget below the selected model's hard limit.
- Reuse the landed per-user recovery patterns for locks, cooldown, managed gateway restart, installation, and rollback.
- State every interactive action Cole must take and avoid asking for routine agent-owned work.
- Keep this task at design scope until Cole reviews the refreshed proposal.
- Changes in this repository must add committed regressions and pass `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Model-adapter changes and focused regressions land and pass in their separate owning workstream.
- Automated validation must not print secret values, alter live TCC rows, mutate mail or PIM data, or deliver messages.

### Architecture and decisions

Current caller inventory:

| Caller | Current permission boundary | Current state | Updated destination |
| --- | --- | --- | --- |
| Todoist CLI | Installed signed helper injects its token into only the Todoist child | Stable and working. The helper is deployed, but pull request `#29` remains open and its source is absent from `main`. | Refresh and merge `#29` without replacing the approved helper binary. No live migration or new prompt is needed. |
| Gateway-side model adapters | One or more adapters load `keytar` directly in Node when active | Unstable. The credential item trusts current Node, stale prior Node hashes, and `/usr/bin/security`. | In the separate owning workstream, replace direct `keytar` reads with a bounded, no-shell `/usr/bin/security` exact-item read. The item already trusts that command, so no new approval is expected. Keep the value in memory only and never pass it through argv or gateway-wide environment variables. |
| Gmail MCP server | The configured primary checkout still uses Homebrew Python `keyring` | Live Gmail currently works through a legacy item trusted by current Python. Stable `/usr/bin/security` code is merged into `main` but is not the active checkout. | Issue `#99` exclusively owns the separate-item migration, production promotion, rollback, and any Gmail approval. This plan records the dependency but does not duplicate or sequence Gmail changes. |
| `apple-pim-cli` Calendar, Contacts, and Reminders tools | Explicit installed wrapper directory leads to disclaim launchers and then `.real` Swift tools | Stable for Node updates. The native tools remain authorized and recent Calendar, Reminders, and Calendar-write calls succeed. | No move. Preserve explicit wrapper resolution and verify authorization after relevant updates. |
| Secure Calendar MCP bridge | The bundled server resolves the installed Swift wrappers through its configured release path | Stable for Node updates. | No move. Add read-only postflight proof of wrapper identity and native authorization. |
| Calendar attendee Contacts check | `ContactsTrustResolver` defaults to bare `contacts-cli`; gateway PATH omits the wrapper directory | Broken fail-closed path. No post-August attendee egress call or degradation warning was observed. | Set `contactsCliPath` to the fully expanded installed wrapper path. Add register-time `auth-status` checking and a regression that does not rely on PATH. |
| Unidentified direct Contacts caller | Current Node retains an allowed AddressBook TCC row created during the incident | Unstable and broader than intended. No later TCC change identifies the caller. | Record TCC principals plus content-free PIM call-path metadata during the soak. Remove Node's grant only when no unattributed Node access occurs, or the caller is identified and moved through a native wrapper. |
| Homebrew update daemon | Weekly system LaunchDaemon updates packages and exits | Active. Launchd reports successful runs, but the script does not restart or postflight the gateway, and no shared reconcile channel exists. | Publish a package-identity generation to a package-manager-owned readable directory. A per-user reconciler polls the generation, uses the managed gateway restart, and runs noninteractive postflight. |
| Main heartbeat session | Every 30-minute heartbeat reuses `agent:main:main` | Actively broken. The session caches a 1,000,000-token budget while its selected model catalog is 128,000. Every current heartbeat fails precheck with zero compactions. | Set `contextTokens: 100000` only on the selected model entry, not on `agents.defaults`. Add a provider-neutral OpenClaw patch that refreshes a cached session budget when it exceeds the currently resolved model cap before precheck. Preserve the transcript and index, compact the current session through `openclaw sessions compact agent:main:main --max-lines 200`, restart, and verify the cached budget and next heartbeat. The reconciler repairs one future precheck overflow and enters cooldown on failure. |
| Tool classifiers | Protected tools call a configured classifier model | Healthy since August 12. Recent Calendar and Gmail audits complete without the unsupported-model error. | Remove the separate classifier implementation item. Keep a bounded synthetic readiness check after restart and remain fail closed. |
| Direct iMessage bridge | Per-user recovery timer probes a deep read-only account RPC and can restart the managed gateway | Repaired and production-validated in issue `#95`. | No move. Reuse its lock, cooldown, installer, rollback, and managed-restart patterns for the new runtime reconciler. Do not merge the responsibilities into the iMessage script. |

Permission and ownership decisions:

- The signed helper remains Todoist's narrow read-only boundary. Merging its source must not replace the approved installed binary.
- Model adapters use `/usr/bin/security` because a read-only ACL dump shows the exact item already trusts it. The provenance of that grant is unknown, so rollout rechecks it and stops without prompting if it changed. When present, the migration removes interpreter-version coupling without widening the current same-user boundary.
- Gmail is not a prerequisite owned here. Issue `#99` determines its active durable path and asks Cole separately only if needed.
- PIM privacy remains attached to the `.real` native tools. The gateway receives no blanket Contacts, Reminders, or Calendar grant.
- The public repository owns the helper contract, Contacts path, runtime reconciler, heartbeat repair, update automation, and shared integration coverage.
- The separate model-adapter workstream owns direct credential-reader replacement and its focused test pool.
- The runtime reconciler polls every five minutes. Polling avoids unreliable filesystem watches before the shared marker directory exists.
- The 100,000-token cap belongs only to the currently selected 128,000-token model entry. It must not change the resolved window for any other configured model or agent.
- Stale session cache repair is provider-neutral OpenClaw behavior. It ships as `docs/openclaw-setup/patches/heartbeat-session-context-refresh.patch` plus `heartbeat-session-context-refresh.md`, appears in the patch README table and `apply-and-deploy.sh` `PATCHES=()` list, and registers its upstream-style test targets in the cumulative `packages/e2e/openclaw-patch-suite.json`.

Implementation sequence:

1. **Repair the active heartbeat loop.** Preserve `sessions.json`, the current transcript, model configuration, installed package, and patch manifest state. Record the resolved effective window for every configured model. Set `contextTokens: 100000` only on the affected selected-model entry. Add `heartbeat-session-context-refresh.patch` with an upstream-style regression and companion guide, register both in the patch README, register the patch in `apply-and-deploy.sh`, and add its test targets to the cumulative patch-suite manifest without replacing existing entries. The patch replaces a cached session value only when it exceeds the freshly resolved cap for that same model, before precheck runs. Deploy it only through `docs/openclaw-setup/patches/apply-and-deploy.sh`. Use supported max-lines compaction on `agent:main:main`, restart through the managed gateway command, and verify the installed guard is present, the session stores `100000` after the first run, the next heartbeat succeeds, and every other configured model resolves to its original window. Roll back the package, patch manifest state, model entry, and session state if any check fails.
2. **Land the helper source.** Refresh pull request `#29` against current `main`, rerun its focused and managed tests, and merge it. Do not deploy or replace the already-approved helper.
3. **Move the model readers.** In the separate owning workstream, replace all direct Node `keytar` reads of the model credential with bounded exact `/usr/bin/security` reads. Cover success, missing item, denial, timeout, malformed output, cancellation, caching, and multiple adapters. This repository verifies only the provider-neutral stable-reader contract.
4. **Repair the attendee Contacts path.** Set `contactsCliPath` to the fully expanded installed wrapper. Add register-time authorization validation and a focused regression proving the gateway environment does not need PATH lookup.
5. **Add one runtime reconciler.** Create a five-minute per-user LaunchAgent using the issue `#95` recovery patterns. It independently handles update generations and heartbeat overflow with separate locks and cooldown state. It validates ownership before reading a marker, never reads secret values, never sends a message, and uses the managed gateway restart.
6. **Add the update writer.** Extend `scripts/mac-mini/brew-autoupdate.sh` to publish before and after package identities only when a relevant executable changes. Extend its installer to preserve the old writer, create `/Users/Shared/openclaw-update-reconcile/` with package-manager ownership, mode `0755`, marker mode `0644`, and umask `022`, reload the system service, validate a real reconciler handoff, and expose privileged rollback.
7. **Run pre-cleanup validation and attribution soak.** Prove Todoist and model reads without prompts, current Gmail read-only health through issue `#99`'s selected path, Contacts resolver health, PIM reads, gateway and iMessage health, heartbeat recovery, classifier readiness, update handoff, interruption recovery, and rollback fixtures. Keep old Node access during a 24-hour soak. Record TCC principal changes and content-free call-path metadata.
8. **Gate cleanup on evidence.** Continue only if the model adapters no longer load direct `keytar`, the heartbeat remains healthy, and no Node Contacts access remains unattributed. Otherwise keep the grants and investigate.
9. **Remove old Node grants.** In one logged-in desktop session, remove Node entries from the model and Todoist Keychain items and disable Node under Contacts privacy. Do not touch Gmail's item or native PIM grants from this task. Restart and repeat all read-only checks.
10. **Exercise the real update boundary.** Use isolated fixtures for generation, duplicate polling, restart, interruption, insecure-marker rejection, and rollback. After merge, the next normal Homebrew update is the production proof. Postflight verifies the installed heartbeat guard and behavior as well as gateway health. A missing patch, stale session cap, or failed postflight marks health failed and preserves evidence; it never downgrades Homebrew automatically.
11. **Update documentation.** Replace the obsolete path-based Node ACL advice, add the heartbeat patch companion guide and patch-table row, and document the stable reader, native PIM, heartbeat, update, recovery, and Cole checkpoint model.

Cole checkpoints:

| Checkpoint | What Cole does | Expected prompt or screen | Agent action before and after |
| --- | --- | --- | --- |
| Update writer installation | In an administrator session on the package-manager account, run the reviewed installer with `sudo`. Approve creation of the package-manager-owned shared marker directory, replacement of the system update script, and reload of the system service. | Terminal administrator password prompt. No Keychain or private-data approval is expected. | Before: install the user reconciler, stage rollback copies, and validate install and rollback fixtures. After: trigger the real reconciler under the gateway account, verify one restart and postflight, and restore the writer in the same session on failure. This is one-time, not weekly. |
| Old-grant cleanup after soak | In Keychain Access, remove Node from the model and Todoist trusted-application lists. In System Settings, turn off Node under Privacy & Security > Contacts. | Keychain Access trusted-app lists and Contacts privacy. No new Allow prompt is expected when attribution is clean. Restoring Node later requires another interactive approval. | Before: confirm the 24-hour soak, absence of direct readers, clean Contacts attribution, and recovery state. If any gate is dirty, do not ask Cole to remove access. After: restart, repeat read-only checks, and inspect metadata without reading values. |
| Unexpected native PIM prompt only | Approve the named `.real` Contacts, Reminders, or Calendar tool only after its identity is verified. Do not approve Node. | A macOS private-data prompt naming a native PIM tool. | Stop automation, verify binary identity, ask Cole to approve, and rerun only the affected check. Current evidence says this should not be needed. |
| Gmail only if issue #99 requests it | Follow the exact approval or OAuth recovery step from issue `#99`. | Defined by that task after its durability investigation. | This task does not duplicate the step or treat it as a prerequisite. |

Cole is no longer needed for a model credential approval. Cole is not needed to compact or rotate the heartbeat session, merge or rebase pull requests, change agent-owned configuration, install the user reconciler, run tests, restart the gateway, monitor the soak, resolve CI or review, merge implementation, or perform read-only postflight checks.

### Implementation

- [x] Verify the latest Todoist comment and reopen issue `#91`.
- [x] Merge current `main` into the isolated worktree.
- [x] Recheck current repository changes since the August design.
- [x] Recheck active gateway processes and loaded credential modules.
- [x] Recheck current Keychain trusted applications without reading values.
- [x] Recheck TCC principals and native PIM authorization.
- [x] Recheck helper installation, allowlist, and consumers.
- [x] Recheck Gmail repository, live checkout, process, audit, and issue `#99` ownership.
- [x] Recheck automatic-update execution and missing restart handoff.
- [x] Recheck current classifier audits.
- [x] Recheck heartbeat triggers, session metadata, compaction count, and model-window mismatch.
- [x] Recheck landed iMessage recovery for reusable lifecycle patterns.
- [x] Rewrite the design to remove obsolete work and currentize Cole's checkpoints.
- [ ] Complete refreshed retained and terminal design review.
- [ ] Return the landed refreshed design to Cole before implementation.

### Validation

Current design evidence on 2026-08-19:

- [x] The Todoist item still trusts the installed signed helper, whose allowlist contains only the Todoist alias. Pull request `#29` remains open and mergeable.
- [x] The model credential item trusts current Node, stale prior Node hashes, and `/usr/bin/security`. Direct Node `keytar` readers remain loaded when their adapters are active.
- [x] The trusted-application claim comes from `security dump-keychain -a` metadata; no credential value was read. The origin of the `/usr/bin/security` grant is unknown.
- [x] Model calls succeed after the current gateway restart.
- [x] Gmail stable code landed through pull request `#100`; pull request `#101` recorded the landed result, and stale pull request `#31` is closed.
- [x] The configured Gmail service still loads the dirty primary checkout, which is 273 commits behind and still uses Python `keyring`.
- [x] Gmail currently succeeds through a legacy item trusted by current Python. Issue `#99` owns the active durability investigation and non-destructive migration.
- [x] Native Contacts, Reminders, and Calendar tools remain authorized. Recent Calendar reads, Calendar writes, and Reminders calls succeed.
- [x] Secure Calendar still leaves `contactsCliPath` unset. Gateway PATH cannot resolve the PIM tools by name, and no post-August attendee egress audit was observed.
- [x] Node retains the incident AddressBook grant. No later TCC row identifies the caller.
- [x] The weekly update daemon is loaded, reports four successful runs, and still has no restart marker or postflight.
- [x] The runtime reconcile directory is absent.
- [x] The iMessage deep-health recovery timer is installed, has clean exits, and uses the managed gateway restart.
- [x] No unsupported-classifier error appears after August 12; recent protected Calendar and Gmail calls complete.
- [x] The active heartbeat session stores `contextTokens: 1000000`; the configured model catalog is `128000`; and the global context override is unset.
- [x] Other configured models retain larger native windows, so a global `agents.defaults.contextTokens` cap would create unrelated regressions.
- [x] Every current 30-minute heartbeat for that session fails precheck with zero compactions.
- [x] `openclaw sessions compact <key> --max-lines <count>` is a supported bounded recovery interface.
- [x] No live secret value, permission, configuration, session, process, or service was changed during this refresh.

Required implementation validation:

- [ ] Focused helper, Contacts resolver, runtime reconciler, heartbeat, update writer, and documentation tests pass in this repository.
- [ ] The OpenClaw patch proves an oversized cached session value is replaced by the freshly resolved cap before precheck and leaves equal or smaller cached values unchanged.
- [ ] `heartbeat-session-context-refresh.patch`, its companion guide, and the patch README row are committed and reviewed. `packages/e2e/tests/patch-suite.test.ts` checks the patch file, `PATCHES=()` order, manifest equality, and test registration.
- [ ] The patch's upstream-style test target runs through `packages/e2e/openclaw-patch-suite.json`; a test embedded only in the patch is not accepted.
- [ ] The complete patch stack applies cleanly to the manifest's pinned `openclawRef`, and the CI workflow uses the same ref. Any pin change reruns patch application and every registered target before promotion.
- [ ] Before-and-after validation records the resolved effective window for every configured model and proves only the targeted model is capped.
- [ ] Model-reader success, denial, timeout, malformed-output, cancellation, cache, and multiple-adapter regressions pass in its separate owning workstream.
- [ ] Denial, missing approval, repeated overflow, failed compaction, cooldown, concurrent run, duplicate marker, insecure marker, restart failure, interrupted install, rollback, and cleanup paths pass.
- [ ] Tests use synthetic Keychain, TCC, session, and update fixtures and deny-by-default write or delivery adapters.
- [ ] `node packages/e2e/bin/openclaw-test-env.mjs ci` passes with every regression for changes committed in this repository.
- [ ] Deployment uses `docs/openclaw-setup/patches/apply-and-deploy.sh`; the installed-runtime validator proves the heartbeat guard is present and the first real post-update check repeats that proof.
- [ ] Live postflight stays read-only and sends no message.
- [ ] Retained full-diff review and fresh terminal exact-commit review are clean.
- [ ] Remote checks pass on the exact candidate.

### Rollout and rollback

- This refresh is design-only. No live rollout occurs before Cole reviews it.
- Heartbeat repair preserves `sessions.json`, the current transcript, the selected-model entry, installed package, patch manifest, and prior patch stack before changing the cap or compacting. Failure uses the documented patch deployment rollback to restore the prior package and manifest, restores session and model state, and restarts the previous gateway state. The old transcript is never deleted.
- Model-specific cap rollout fails if any non-target model or agent resolves to a different effective window after the change.
- Pull request `#29` lands source only. Do not replace the approved helper binary or change its live allowlist during that step.
- Model-reader migration preserves the private adapter configuration and keeps Node trust through the soak. Rollback restores direct `keytar` reads while Node remains approved. After cleanup, restoring Node needs Cole.
- Model-reader rollout rechecks `/usr/bin/security` trusted-application metadata immediately before deployment. If the grant is absent or invalid, stop and return the design to Cole rather than triggering an unexpected prompt.
- Gmail state, code deployment, Keychain item, and rollback are owned only by issue `#99`.
- Contacts path rollback restores the prior unset configuration, which returns to fail-closed denial rather than a working attendee check.
- Node's Contacts grant stays during the attribution soak. Insufficient telemetry or unattributed access blocks cleanup.
- The update installer records the prior writer and system-service state. A failed live handoff is restored during the same administrator session. Runtime reconciler installation has its own user-level recovery state and rollback.
- Update reconciliation never downgrades Homebrew. It preserves before and after identities and marks health failed on an unsuccessful restart or postflight.
- Production writes and message delivery remain outside automated validation.

### Review log

- 2026-08-05: Original diagnosis separated context overflow, mutable interpreter permissions, residual Contacts attribution, and classifier configuration.
- 2026-08-12: Concrete caller, migration, and Cole-checkpoint design passed retained and terminal review and landed in pull request `#96`.
- 2026-08-19: Cole requested a refresh after changing the system.
- 2026-08-19: Gmail repository repair and iMessage recovery were confirmed landed. Gmail live durability remains separately owned by issue `#99`.
- 2026-08-19: The classifier failure is no longer observed and is reduced to postflight validation.
- 2026-08-19: Model credential stable-system trust is now present, eliminating the planned model approval.
- 2026-08-19: The heartbeat failure is now tied to a 1,000,000 versus 128,000 token-window mismatch on the active heartbeat session.
- 2026-08-19: Retained review found the proposed 100,000-token global cap would shrink every configured model. The cap is now model-specific, cache correction occurs before precheck, and validation covers all configured model windows.
- 2026-08-19: Retained recheck found the source patch was not attached to the mandatory patch artifacts, deployment list, or shared suite. The full patch lifecycle and installed guard checks are now explicit.
- 2026-08-19: Retained review cleared the patch lifecycle. Final wording now distinguishes automated patch-contract checks from prose review and makes pinned-revision application proof explicit.
- 2026-08-19: Retained final full-diff recheck reported no actionable findings.
- Independent adversarial review: Clean.
- Terminal review: Run against the final design-checkpoint candidate and record the result outside the candidate diff.

### Checklist

- [x] Todoist tracking comment points to issue `#91`.
- [x] Issue body contains the plan link, `Summary`, and `Status` only.
- [x] Original diagnosis is preserved.
- [x] Every prior design assumption is rechecked against current repository and live state.
- [x] Completed or separately owned migration work is removed.
- [x] Current caller and destination inventory is complete.
- [x] Heartbeat recovery uses a supported command and an explicit safe budget.
- [x] The heartbeat cap is model-specific and cannot clamp unrelated models.
- [x] Automatic updates remain enabled.
- [x] Cole's current participation is explicit and reduced.
- [x] No production mutation occurred during refresh.
- [x] Refreshed design adversarial review is clear.
- [x] Final refreshed design candidate prepared.
- [ ] Refreshed plan-only pull request is remotely green and merged.
- [ ] Issue and Todoist task return to `ready_for_review`.
