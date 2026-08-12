# Diagnose Node permission prompts

Status: Design clarification in progress
Issue: https://github.com/coletaylor788/puddles/issues/91
Last updated: 2026-08-12

## Human section

### Design

This was not one failure. The main agent stopped handling one recurring conversation because that conversation had grown beyond the model's context limit. Each retry failed before the model or any tool ran. The macOS prompts were a separate result of an automatic Node update. The update changed Node's ad-hoc code signature, so privacy and keychain rules tied directly to the old binary no longer matched after the gateway restarted.

The earlier proposal correctly chose stable signed programs as the permission boundary, but it did not say which callers still bypass that boundary or how each one moves. This revision will name every direct keychain and private-data caller, the stable program it should call instead, the configuration and code changes needed, and the order of the migration. It will also separate work the agent can do unattended from the few macOS approvals that require Cole in the logged-in desktop session.

Automatic updates will stay enabled. The design will keep reversible migration and one-way permission cleanup as separate steps. Existing access remains available during a short soak where it is still valid. Only after the stable path passes end-to-end checks will old interpreter access be removed. If macOS requires a password or an Allow decision, the plan will say exactly when Cole is needed, what prompt to expect, and what the agent verifies afterward.

### Status

Cole reopened the design because the first version stayed too abstract. The incident diagnosis remains valid, but the proposed migration is being rewritten around a concrete inventory of callers, destinations, steps, and human approvals.

No live permissions, credentials, configuration, or services are changing during this design pass. The next step is to verify the current runtime and repository paths, then return a design that Cole can approve without having to infer what moves where.

## Agent section

### State

- Phase: Design clarification
- Repository: `coletaylor788/puddles`
- Tracking issue: `#91`
- Todoist task: `6hCmp4C6fqx95423`
- Production mutation: Not performed
- Blockers: None

### Scope and acceptance criteria

- Separate the agent nonresponse from the macOS permission prompts and tool-specific failures.
- Identify the Node update, restart, changed code identity, and affected access rules.
- Verify which privacy-backed tools continued working after the update and which new grants appeared.
- Explain why the existing stable keychain helper did not cover all keychain consumers.
- Name every permission-bearing caller that is not using a stable signed boundary today.
- State what each caller moves behind, how the call path changes, and how it is tested.
- State exactly where Cole must participate in an interactive macOS approval.
- Propose a provider-neutral design that keeps automatic software updates enabled.
- Include detection, migration, validation, rollout, and rollback guidance for each failure class.
- Keep this task at design scope. Do not change live grants, ACLs, credentials, configuration, services, or message delivery.
- Follow-on implementation must add committed regressions and pass the shared managed integration pool.

### Architecture and decisions

- Treat context management, TCC privacy grants, keychain ACLs, and classifier configuration as four separate failure domains.
- Keep weekly Homebrew updates. Do not pin Node or disable the update daemon.
- Make a stable signed native helper the only keychain principal. The helper keeps a fixed alias allowlist and returns values only to the requesting child process. Mutable interpreter binaries must not remain in keychain ACLs.
- Keep usable current interpreter trust during the migration and soak window. It expires at the next interpreter update, and one of the two observed services already has only stale direct trust. Complete migration and soak within one update window or schedule interactive reapproval. Removing trust is a separate hardening step after every consumer passes helper-backed health checks.
- Merge and use the existing helper work from pull request `#29` before adding consumers. The installed helper proved that interpreter upgrades can be independent of keychain approval, but the repository change is not on `main` yet.
- Route every PIM caller through one explicit stable native path. Prefer signed real CLIs or a small signed broker over relying only on private responsibility-disclaim SPI.
- Configure the Contacts trust resolver with an absolute wrapper or broker path. The live setting is unset, and the gateway's effective `PATH` cannot resolve `contacts-cli`, `reminder-cli`, or `calendar-cli`. This contradicts the setup guide's assumption that the egress guard resolves the shared wrapper.
- Add a post-update lifecycle that records version changes, restarts affected services once, and runs bounded read-only checks. Use non-prompting PIM authorization status APIs and stable-helper reads whose values are discarded. Report failures without opening prompts, changing ACLs, or editing TCC.
- Keep safeguard compaction as the first recovery layer. Set its effective soft budget safely below the selected model's hard context window, then detect repeated precheck overflow and rotate the affected conversation only when compaction can no longer run. Send an explicit recovery message instead of retrying forever.
- Validate classifier model support at startup and report a degraded tool before first use. Deny-by-default behavior remains correct.
- Keep credentials, personal content, account identifiers, and provider-specific details out of public artifacts.

### Implementation

- [x] Verify the Todoist tracking comment and normalize issue `#91`.
- [x] Identify the incident window, Node update, gateway restart, and active process identities.
- [x] Inspect TCC grants, keychain ACL requirements, PIM wrapper state, update automation, and agent run outcomes.
- [x] Separate the context-overflow outage from the permission and classifier failures.
- [x] Write the root-cause finding and future design.
- [ ] Inventory every direct keychain and PIM permission path in the current runtime and repository.
- [ ] Rewrite the design with a caller-by-caller migration map and explicit Cole checkpoints.
- [ ] Follow-on: merge or supersede pull request `#29` so the stable keychain helper is durable in the repository.
- [ ] Follow-on: migrate every remaining direct keychain consumer to the stable helper, pass helper-backed health checks, and complete the soak inside one update window. Keep usable direct trust during this step.
- [ ] Follow-on hardening: after the soak passes, remove mutable interpreter ACL entries as a separate one-way step. Record that restoring direct access requires interactive GUI approval.
- [ ] Follow-on: replace or harden the PIM responsibility boundary, set absolute caller paths, repair the Contacts egress resolver, and add attribution checks.
- [ ] Follow-on: add restart and permission postflight checks to `scripts/mac-mini/brew-autoupdate.sh`.
- [ ] Follow-on: align the compaction budget with the real model window, then add overflow rotation and consecutive-failure health reporting as a backstop.
- [ ] Follow-on: add classifier startup validation and a clear degraded-tool health signal.
- [ ] Follow-on: update setup, recovery, and rollback documentation with the implemented behavior.

### Validation

- [x] Homebrew installed Node `22.23.2` at `2026-08-02 03:01` through the configured weekly update window.
- [x] Node is ad-hoc signed and its current designated requirement is a code hash. The prior keychain ACL entries contain stale code hashes even when they were added through stable symlink paths.
- [x] The gateway restarted into Node `22.23.2` at `2026-08-05 00:01` after a configuration change.
- [x] The keychain ACL dump shows the signed stable helper still trusted for its migrated client. It also shows direct Node trust on two services, with only one service updated for the current Node hash.
- [x] TCC recorded a new current-Node Contacts grant at `2026-08-05 08:05:47`.
- [x] Stable `.real` grants for Reminders, Contacts, and Calendar still match the installed binaries. Direct authorization probes report `authorized`.
- [x] Post-update `apple_pim_reminder`, `calendar_read`, and `calendar_write` runs completed successfully. No post-update PIM runtime error matched the documented denial or timeout signatures.
- [x] The gateway process loads two `keytar` native modules, confirming direct Node keychain access remains.
- [x] The affected main session is about 1.9 MB with 1,634 records. It repeatedly failed with `Context overflow: prompt too large for the model (precheck)` from `2026-08-04 11:35` local time through the incident, before any model or tool execution.
- [x] Safeguard compaction is enabled. The affected session compacted three times at about 114,000 to 119,000 tokens, most recently on `2026-08-02`, while the configured model catalog contains a 128,000-token window. Every recorded overflow retry reported zero compactions, so the guard could not recover after precheck rejection.
- [x] The main agent has no explicit `contextTokens` override. Follow-on work must verify the runtime-derived soft budget against the selected model's reported hard window before changing recovery behavior.
- [x] The Contacts trust resolver path is unset. The gateway's effective `PATH` does not include `~/.local/bin` and cannot resolve any of the three PIM CLI names.
- [x] No Contacts resolver degradation warning or post-update egress audit exists. The unresolved path is a latent fail-closed security-control degradation, not evidence for the Node-attributed Contacts prompt.
- [x] Web search denied requests at `2026-08-05 08:06` because its classifier model was unsupported. This fail-closed behavior was tool-specific.
- [x] Current gateway health endpoint is live and listening on loopback.
- [x] Independent adversarial review confirms the diagnosis and proposal.
- [ ] Follow-on implementation adds focused tests and runs `node packages/e2e/bin/openclaw-test-env.mjs ci`.

### Rollout and rollback

- This diagnosis is read-only. No rollout occurs in this task.
- Keychain migration must reuse pull request `#29` to snapshot and restore the helper binary and wrapper. That snapshot does not cover keychain ACLs. Keep usable current interpreter trust in place while every consumer migrates and completes a soak period, but treat it as valid only until the next interpreter update. One observed service is already stale and has no direct rollback. Finish migration and soak inside one update window or schedule interactive reapproval. Record each item's metadata and trusted applications before cleanup. Remove interpreter trust only as a separate one-way hardening step after the rollback window. Restoring it later requires interactive approval in the GUI.
- PIM migration must preserve current wrapper binaries and TCC rows until the signed replacement passes no-prompt authorization and read-only tool checks. Rollback restores the wrappers and configured paths.
- Update postflight must never roll back package updates automatically. If a service fails after an update, it records the old and new versions, reports the failure, and uses the component's normal recovery path.
- Context recovery first lowers or verifies the compaction budget against the selected model window. Any fallback rotation must preserve the prior conversation artifact. Rollback restores the prior budget and reselects the prior session if the replacement cannot accept a test message.
- Classifier validation changes only health and routing behavior. Rollback restores the prior validated model setting, not fail-open behavior.
- Production checks remain read-only. Any write or delivery test uses deny-by-default recording fixtures.

### Review log

- 2026-08-05: Tracking comment and issue body verified. Initial plan created before incident research.
- 2026-08-05: Read-only incident correlation completed. Diagnosis separates context overflow, mutable Node identity, residual Contacts attribution, and classifier configuration.
- 2026-08-05: Replacement adversarial review found two material evidence gaps. The plan now records why deployed compaction failed to recover and proves the Contacts resolver path is unavailable.
- 2026-08-05: Terminal review found that pull request `#29` cannot restore keychain ACLs. The rollout now keeps direct trust through the rollback window and treats its later removal as interactive, one-way hardening.
- 2026-08-05: Final review found that retained interpreter trust expires on update and is already stale for one service. The rollback window is now bounded by the next update or explicit interactive reapproval.
- 2026-08-05: Terminal recheck found that the implementation list still bundled migration and ACL cleanup. They are now separate gated work items.
- 2026-08-12: Cole reopened the design because it did not identify the exact callers, moves, or interactive approval points.
- Independent adversarial review: Prior proposal was clean. Revised design review is pending.
- Terminal review: Pending revised final candidate.

### Checklist

- [x] Todoist tracking comment points to issue `#91`.
- [x] Issue body contains the plan link, `Summary`, and `Status` only.
- [x] Initial two-section plan created.
- [x] Research evidence recorded without secrets or personal content.
- [x] Root cause and affected operations documented.
- [x] Design and acceptance criteria synchronized.
- [x] Automatic updates remain enabled.
- [x] No production mutation performed.
- [x] Independent proposal review is clear.
- [x] Final bookkeeping candidate prepared for terminal review.
- [x] Original plan-only commit was published and landed.
- [x] Follow-on implementation is split into gated work items.
- [ ] Concrete caller and destination inventory is complete.
- [ ] Cole's interactive approval steps are explicit.
- [ ] Revised design review is clear.
- [ ] Revised plan-only commit is published and landed.
- [ ] Relevant implementation and regressions are committed.
- [ ] Managed integration pool passes for follow-on behavior changes.
- [ ] Pull request is remotely green and merged.
- [ ] Default branch and applicable production state are verified.
- [ ] Issue and Todoist task closeout follows revised plan landing.
