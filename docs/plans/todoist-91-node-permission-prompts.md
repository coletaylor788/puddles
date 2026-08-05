# Diagnose Node permission prompts

Status: Proposal under review
Issue: https://github.com/coletaylor788/puddles/issues/91
Last updated: 2026-08-05

## Human section

### Design

This was not one failure. The main agent stopped handling one recurring conversation because that conversation had grown beyond the model's context limit. Each retry failed before the model or any tool ran. The macOS prompts were a separate result of an automatic Node update. The update changed Node's ad-hoc code signature, so privacy and keychain rules tied directly to the old binary no longer matched after the gateway restarted.

The durable keychain helper worked for the one client already migrated to it, but other gateway code still read the keychain directly from Node. The existing path-based keychain setup was not durable because macOS saved Node's code hash, not just the stable package-manager path. The native privacy wrappers remained authorized and post-update Reminders and Calendar work completed, but macOS still recorded one new Contacts grant against Node. That leaves a residual path or responsibility handoff that the current design does not detect. A separate classifier configuration error also made web search fail closed, but it did not cause the agent-wide outage.

Automatic updates should stay enabled. Permission-bearing work should move behind stable signed native identities, and every caller should use one explicit path to those identities. The update job should restart affected services promptly, run bounded read-only permission checks, and report a clear unhealthy state without trying to grant access. Long-running conversations should recover from context overflow by rotating or compacting the session and telling the user. Tool classifiers should be checked at startup so a bad setting is visible before the first tool call.

### Status

The incident is diagnosed and the design proposal is ready for independent review. Automatic updates remain enabled. No privacy grants, keychain rules, credentials, runtime configuration, or production services were changed.

The next implementation should finish the stable-identity migrations, add update-aware health checks, and add explicit recovery for context overflow. The current agent is live, but the long-running conversation and the residual Contacts and direct keychain paths remain risks until that work lands.

## Agent section

### State

- Phase: Independent proposal review
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
- Propose a provider-neutral design that keeps automatic software updates enabled.
- Include detection, migration, validation, rollout, and rollback guidance for each failure class.
- Keep this task at design scope. Do not change live grants, ACLs, credentials, configuration, services, or message delivery.
- Follow-on implementation must add committed regressions and pass the shared managed integration pool.

### Architecture and decisions

- Treat context management, TCC privacy grants, keychain ACLs, and classifier configuration as four separate failure domains.
- Keep weekly Homebrew updates. Do not pin Node or disable the update daemon.
- Make a stable signed native helper the only keychain principal. The helper keeps a fixed alias allowlist and returns values only to the requesting child process. Mutable Node or Python binaries must not remain in keychain ACLs.
- Merge and use the existing helper work from pull request `#29` before adding consumers. The installed helper proved that interpreter upgrades can be independent of keychain approval, but the repository change is not on `main` yet.
- Route every PIM caller through one explicit stable native path. Prefer signed real CLIs or a small signed broker over relying only on private responsibility-disclaim SPI.
- Configure the Contacts trust resolver with an absolute wrapper or broker path. Its current unset path is not resolvable from the gateway's effective `PATH`.
- Add a post-update lifecycle that records version changes, restarts affected services once, and runs bounded read-only checks. It must report failures without opening prompts, changing ACLs, or editing TCC.
- Detect repeated context-overflow precheck failures. Rotate or compact the affected conversation and send an explicit recovery message instead of retrying forever.
- Validate classifier model support at startup and report a degraded tool before first use. Deny-by-default behavior remains correct.
- Keep credentials, personal content, account identifiers, and provider-specific details out of public artifacts.

### Implementation

- [x] Verify the Todoist tracking comment and normalize issue `#91`.
- [x] Identify the incident window, Node update, gateway restart, and active process identities.
- [x] Inspect TCC grants, keychain ACL requirements, PIM wrapper state, update automation, and agent run outcomes.
- [x] Separate the context-overflow outage from the permission and classifier failures.
- [x] Write the root-cause finding and future design.
- [ ] Follow-on: merge or supersede pull request `#29` so the stable keychain helper is durable in the repository.
- [ ] Follow-on: migrate every remaining direct keychain consumer to the stable helper and remove mutable interpreter ACL entries.
- [ ] Follow-on: replace or harden the PIM responsibility boundary, set absolute caller paths, and add attribution checks.
- [ ] Follow-on: add restart and permission postflight checks to `scripts/mac-mini/brew-autoupdate.sh`.
- [ ] Follow-on: add context-overflow recovery and consecutive-failure health reporting.
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
- [x] Web search denied requests at `2026-08-05 08:06` because its classifier model was unsupported. This fail-closed behavior was tool-specific.
- [x] Current gateway health endpoint is live and listening on loopback.
- [ ] Independent adversarial review confirms the diagnosis and proposal.
- [ ] Follow-on implementation adds focused tests and runs `node packages/e2e/bin/openclaw-test-env.mjs ci`.

### Rollout and rollback

- This diagnosis is read-only. No rollout occurs in this task.
- Keychain migration must snapshot each item's metadata and ACL before removing direct interpreter trust. Rollback restores the snapshot and previous launcher, then verifies a read without exposing the value.
- PIM migration must preserve current wrapper binaries and TCC rows until the signed replacement passes no-prompt authorization and read-only tool checks. Rollback restores the wrappers and configured paths.
- Update postflight must never roll back package updates automatically. If a service fails after an update, it records the old and new versions, reports the failure, and uses the component's normal recovery path.
- Context recovery must preserve the prior conversation artifact before rotating the active session. Rollback reselects the prior session if the new session cannot accept a test message.
- Classifier validation changes only health and routing behavior. Rollback restores the prior validated model setting, not fail-open behavior.
- Production checks remain read-only. Any write or delivery test uses deny-by-default recording fixtures.

### Review log

- 2026-08-05: Tracking comment and issue body verified. Initial plan created before incident research.
- 2026-08-05: Read-only incident correlation completed. Diagnosis separates context overflow, mutable Node identity, residual Contacts attribution, and classifier configuration.
- Independent adversarial review: In progress.
- Terminal review: Pending.

### Checklist

- [x] Todoist tracking comment points to issue `#91`.
- [x] Issue body contains the plan link, `Summary`, and `Status` only.
- [x] Initial two-section plan created.
- [x] Research evidence recorded without secrets or personal content.
- [x] Root cause and affected operations documented.
- [x] Design and acceptance criteria synchronized.
- [x] Automatic updates remain enabled.
- [x] No production mutation performed.
- [ ] Independent proposal review is clear.
- [ ] Plan-only commit is published and landed.
- [ ] Follow-on implementation is approved or split into owned work.
- [ ] Relevant implementation and regressions are committed.
- [ ] Managed integration pool passes for follow-on behavior changes.
- [ ] Pull request is remotely green and merged.
- [ ] Default branch and applicable production state are verified.
- [ ] Issue and Todoist task are ready for Cole to review.
