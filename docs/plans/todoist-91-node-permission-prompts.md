# Diagnose Node permission prompts

Status: Design review recheck
Issue: https://github.com/coletaylor788/puddles/issues/91
Last updated: 2026-08-12

## Human section

### Design

The long-running Node service receives messages, loads tools, and starts helper processes. It should coordinate access, but it should not be the identity that macOS trusts. Homebrew replaces Node during routine updates, so any Keychain or private-data grant attached to that binary eventually stops matching. There is not one new permission daemon to put everything behind. The design uses two narrow native boundaries: a signed helper for fixed read-only secrets, and native Personal Information Management tools for Contacts, Reminders, and Calendar. Gmail is the exception because its OAuth credential must be updated, so it uses Apple's stable system credential tool with bounded reads and writes.

Today, Todoist already reads its token through the signed helper. The main Calendar and Reminders paths already run through the native tools that own their macOS privacy grants. Three paths are still wrong. The model credential is read directly by Node. Gmail reads its OAuth token through a Homebrew Python process. The calendar attendee safety check asks for the Contacts tool by name, but the Node service cannot resolve that name, so the check fails closed before reaching the already-approved native Contacts path. The direct Node Contacts grant seen during the incident came from another, still-unidentified call and is not explained away by the broken attendee check.

The migration first lands the existing reviewed helper and Gmail work. The model credential reader then calls the signed helper instead of Keychain. That reader is owned and tested in its separate private workstream, while this repository owns the reusable helper and the provider-neutral operating contract. Gmail switches to the stable Apple credential tool. The attendee check gets the fully expanded native Contacts path. A post-update reconciler restarts the Node service after package changes and runs checks that cannot open approval dialogs. During the soak, attribution records must show that Contacts access comes only from the native tools. Only then does Cole remove old Node and Python Keychain access and turn off Node's Contacts grant. Cole is needed for two one-time Keychain approvals, one administrator session to install the system-side update handoff, and one later cleanup session in macOS settings. Everything else, including code, tests, user-side deployment, restart, health checks, context-overflow recovery, and classifier validation, is agent-owned.

### Status

The revised design now names what is stable, what still bypasses a stable boundary, what moves, how each move is checked, and which workstream owns each regression. The Contacts cleanup is gated on observed attribution during the soak rather than assumptions about known paths. Independent review also exposed the privileged update installation and a session-group flaw in its first marker design. The installation is explicit, the marker is owner-writable but readable without new group membership, and the real user-side reconciler must already be staged before the administrator session. No live permissions, credentials, configuration, or services changed during this design pass.

The retained review is clean. One final recheck covers the explicit marker creation modes and installation order before the design returns to Cole. Cole's expected participation is one logged-in desktop session for the two credential approvals, one administrator session for the update writer and package-manager-owned marker channel, and a later cleanup session only after the attribution soak is clean.

## Agent section

### State

- Phase: Retained design review recheck
- Repository: `coletaylor788/puddles`
- Tracking issue: `#91`
- Todoist task: `6hCmp4C6fqx95423`
- Production mutation: Not performed
- Blockers: Revised review must clear before Cole's design checkpoint.

### Scope and acceptance criteria

- Preserve the original root-cause split between context overflow, macOS permissions, and classifier configuration.
- Keep automatic Homebrew updates enabled.
- Name every current credential or PIM caller and whether it already uses a stable native boundary.
- State the exact destination, code or configuration change, validation, rollback, and owner for every unstable path.
- Keep the Node gateway as the orchestrator, not the Keychain or TCC principal.
- Use the signed allowlisted helper for fixed read-only secrets.
- Use a bounded stable read/write boundary for the Gmail OAuth credential.
- Route all Contacts, Reminders, and Calendar access through explicit native wrapper paths.
- State every interactive action Cole must take and avoid asking for routine agent-owned work.
- Keep this task at design scope until Cole reviews the revised proposal.
- Changes in this repository must add committed regressions and pass `node packages/e2e/bin/openclaw-test-env.mjs ci`. The model credential reader change and focused regressions land and pass in its separate owning workstream.
- Automated validation must not read secret values into logs, alter live TCC rows, mutate mail or PIM data, or deliver messages.

### Architecture and decisions

Current caller inventory:

| Caller | Current permission boundary | Current state | Destination |
| --- | --- | --- | --- |
| Todoist CLI | Signed `puddles-keychain-helper` injects `TODOIST_API_TOKEN` into only the Todoist child | Stable and working. It is the helper's only installed consumer. | No move. Merge pull request `#29` so the deployed helper and launcher are durable repository state. |
| Runtime model credential reader | Gateway Node process loads `keytar` and reads the model credential item directly | Unstable. The current Node hash is trusted, while older Node hashes are stale. | The credential reader invokes the installed helper by absolute path with a fixed provider-neutral alias. It captures the value in memory with a timeout and never puts it in gateway-wide environment variables or child process arguments. The reader and its focused regressions are owned and validated in a separate private workstream. This repository owns the helper, setup contract, and cross-component integration boundary. |
| Gmail MCP server | Homebrew Python uses `keyring` to read and update `gmail-mcp` / `token` | Unstable. The Keychain trusted application points at an old Python application. | Rebase and finish pull request `#31`. Gmail uses bounded `/usr/bin/security` reads and writes, a short in-memory cache, and refresh locking. Gmail does not use the read-only helper because OAuth refresh and reauthorization need writes. |
| `apple-pim-cli` Calendar, Contacts, and Reminders tools | Configured `binDir` points at the installed wrapper directory, whose links enter the disclaim wrappers and then the `.real` Swift tools | Stable for Node updates. The explicit directory lets this plugin find the wrappers without using the gateway PATH. The `.real` tools hold current TCC grants. | No move. Keep explicit `binDir` and verify all three authorizations after every relevant update. |
| Secure Calendar MCP bridge | The bundled server finds the wrapped Swift tools in the plugin release directory | Stable for Node updates. Post-update Calendar reads and writes succeeded. | No move. Add a read-only postflight that proves the resolved binary is a wrapper and the `.real` tool remains authorized. |
| Calendar attendee Contacts check | `ContactsTrustResolver` defaults to bare `contacts-cli`; the gateway `PATH` excludes the installed wrapper directory | Broken fail-closed path. Unlike `apple-pim-cli`, this resolver has no explicit directory, so it cannot reach Contacts and did not cause the Node Contacts prompt. | Set `contactsCliPath` to the fully expanded absolute path of the installed `contacts-cli` wrapper. Add register-time health checking and keep deny-by-default behavior. |
| Unidentified direct Contacts caller | Current Node `22.23.2` has an allowed AddressBook TCC row created during the incident | Unstable and broader than intended. The originating call is still unknown. | Add TCC principal auditing and call-path logging before cleanup. Cole disables Node's Contacts access only if the soak records no unattributed Node Contacts access, or the caller is identified and moved through a native wrapper. Any recurrence stops cleanup and requires attribution first. |
| Homebrew update daemon | Runs weekly as the package-manager owner, updates packages, and exits without restarting or checking the agent gateway | Updates are automatic but permission failures surface only on later use. | Write an atomic version-change marker under `/Users/Shared/openclaw-update-reconcile/`, owned by the package-manager user, with directory mode `0755`, file mode `0644`, and umask `022`. Marker contents are non-secret package identities. Only the owner can publish or replace files, while the already-running gateway account can traverse and read without a new group or login session. A user LaunchAgent consumes marker generations read-only, restarts the gateway once, and runs noninteractive postflight checks. |
| Main conversation compaction | Safeguard compaction runs inside the gateway | It compacted three times, then repeated precheck overflow without recovery. | Set and verify a soft budget below the selected model's hard window. Rotate only after repeated precheck overflow when compaction cannot run, preserving the old session. |
| Tool classifier | Loads a configured model when a protected tool is first used | An unsupported model caused web search to deny requests. | Validate model support at gateway startup and expose a degraded health state before the first tool call. Keep fail-closed behavior. |

The permission boundaries remain separate on purpose:

- `puddles-keychain-helper` is read-only, alias allowlisted, immutable after approval, and has no daemon or network surface.
- `/usr/bin/security` is the Gmail read/write boundary. It is stable across Homebrew upgrades but broadens access to same-user code, which is why it is limited to Gmail's write requirement.
- Apple PIM wrappers disclaim Node responsibility so the `.real` native tools own TCC. The wrapper and `.real` binaries remain separate from Keychain handling.
- The OpenClaw gateway never receives a blanket permission grant. It receives secret values in memory only from the narrow helper call that needs them and reaches PIM only through explicit wrapper paths.

Implementation sequence:

1. **Land prerequisites.** Refresh and merge pull request `#29`. Rebase pull request `#31` onto current `main`, rerun its focused and cumulative validation, and merge it.
2. **Add model credential helper support.** Add a provider-neutral helper alias to the owner-only local allowlist without replacing the approved helper binary. In the separate owning workstream, change the configured credential reader from direct `keytar` access to an absolute helper subprocess with a five-second timeout, no shell, no argv secret, no logging, and an in-memory cache. Land and pass isolated success, denial, timeout, malformed-output, and cancellation regressions in that workstream's own test pool. This repository's integration verifies the installed helper contract without importing adapter-specific code.
3. **Deploy Gmail's stable backend.** Deploy pull request `#31` through its recovery-capable lifecycle. Migrate the existing item so `/usr/bin/security` can read it without prompting. Keep OAuth writes bounded and serialized.
4. **Repair the attendee Contacts path.** Set `contactsCliPath` to the fully expanded installed wrapper path. Add startup `auth-status` validation and a focused regression proving the gateway environment does not need PATH lookup.
5. **Add update reconciliation.** First add and install the user LaunchAgent and reconciler script under the gateway account. They lock by marker generation, reject marker directories or files that are not owned by the package-manager account or are writable by group or others, restart the gateway once, and run checks for the helper aliases, Gmail credential access, PIM wrapper identity and authorization, gateway health, context settings, and classifier support. Extend `scripts/mac-mini/brew-autoupdate.sh` to record before and after package identities and atomically publish a marker only when a relevant executable changed. Extend `scripts/mac-mini/install-brew-autoupdate.sh` to preserve the prior system writer, install the new one, create the shared marker directory with the fixed owner, modes, and umask above, reload the system service, and expose rollback through the same privileged path. Only after the user-side consumer is installed and idle does Cole use one administrator session on the package-manager account to run that installer and validate the handoff. This privileged installation is one-time and does not recur on weekly updates.
6. **Run pre-cleanup validation and attribution soak.** Restart the gateway with the candidate. Prove Todoist and model credential reads without prompts, Gmail read-only API access, Contacts resolver health, Calendar and Reminders reads, current gateway health, compaction configuration, classifier readiness, interruption recovery, and rollback fixtures. Enable bounded unified-log TCC observation, before-and-after TCC principal snapshots, and gateway PIM call-path logging that records executable identity and operation class but no PIM content. If those sources cannot establish attribution at the required fidelity, the gate fails and Node's Contacts grant stays in place. Keep existing interpreter ACLs and Node's Contacts grant during a 24-hour soak that must finish before the next weekly update.
7. **Gate cleanup on attribution.** Review the soak evidence. Continue only if no Node Contacts access occurred, or every Node access is attributed to a caller that has now moved through a native wrapper. If access remains unattributed, stop cleanup, keep the grant, and investigate the caller.
8. **Remove old grants.** In one logged-in desktop session, remove Node and Python from the migrated Keychain items and disable Node under Contacts privacy. Do not reset the native `.real` PIM grants. Restart and repeat all read-only and attribution checks.
9. **Exercise the real update boundary.** Use an isolated fixture to prove marker ownership, duplicate generation, restart, interruption, and rollback behavior. After merge, the next normal Homebrew update is the production proof. The reconciler records success or marks the gateway unhealthy; it never rolls back Homebrew automatically.
10. **Fix the two non-permission failures.** Land context-budget and overflow recovery with a committed regression. Validate classifier availability at startup with a committed fail-closed regression.

Cole checkpoints:

| Checkpoint | What Cole does | Expected prompt or screen | Agent action before and after |
| --- | --- | --- | --- |
| Model credential approval | In the logged-in desktop session, enter the login Keychain password and choose **Always Allow** for the installed signed helper reading the model credential item. | One Keychain prompt naming `puddles-keychain-helper` and the existing model credential item. | Before: snapshot item metadata and verify the exact helper identity and alias. After: run a UI-disabled helper read, restart the gateway, and prove model access. |
| Gmail credential approval | Enter the login Keychain password and choose **Always Allow** for `/usr/bin/security` reading `gmail-mcp`. Complete browser OAuth only if the existing credential fails read-only validation. | One Keychain prompt naming `/usr/bin/security`; optional browser consent if the credential is invalid or revoked. | Before: preserve the existing credential through the reviewed recovery path. After: run UI-disabled Keychain reads and a read-only Gmail API smoke. |
| Update writer installation | In an administrator session on the package-manager account, run the reviewed installer with `sudo`. Approve creation of the package-manager-owned shared marker directory, replacement of the system update script, and reload of the system service. | Terminal administrator password prompt. No Keychain or private-data approval is expected. | Before: stage rollback copies and validate install and rollback against fixtures. After: trigger the actual reconciler LaunchAgent under the already-running gateway account, then verify marker owner and modes, system service state, one gateway restart, and cleanup. If installation validation fails, use the same administrator session to restore the prior writer. This is a one-time install, not a weekly action. |
| Old-grant cleanup after soak | In Keychain Access, remove Node from the model item and Python from the Gmail item. In System Settings, turn off Node under Privacy & Security > Contacts. | Keychain Access trusted-app lists and the Contacts privacy list. No new Allow prompt is expected if attribution is clean. If an unattributed caller later needs Contacts, restoring Node access will require another logged-in interactive approval. | Before: confirm the 24-hour soak, clean attribution report, and rollback artifacts. If attribution is not clean, do not ask Cole to remove the grant. After: restart, repeat all read-only checks, and inspect TCC and ACL metadata without reading values. |
| Unexpected PIM prompt only | If a wrapper grant is missing, approve the named native `.real` Contacts, Reminders, or Calendar tool. Do not approve Node. | A macOS private-data prompt naming the native tool. | Stop automation, verify the binary identity, have Cole approve, then rerun the single affected check. Current evidence says this should not be needed. |

Cole is not needed to merge or rebase pull requests, edit allowlists, change agent-owned configuration, install the user LaunchAgent, run tests, restart the gateway, monitor the soak, resolve CI or review, merge implementation, or perform read-only postflight checks. Cole is needed only for the credential approvals, the one-time privileged system-writer installation, and the post-soak permission cleanup described above.

### Implementation

- [x] Verify Todoist's tracking comment and reopen issue `#91`.
- [x] Preserve the original incident evidence and root-cause split.
- [x] Inventory live Keychain trusted applications without reading values.
- [x] Inventory live TCC principals and native PIM authorization.
- [x] Inventory the gateway's loaded credential module, effective PATH, plugin paths, and update lifecycle.
- [x] Verify Todoist is the signed helper's only installed consumer.
- [x] Verify the model credential still loads through Node `keytar`.
- [x] Verify Gmail still uses Python `keyring` and its trusted Python application is stale.
- [x] Verify the main PIM routes already enter disclaim wrappers.
- [x] Verify the attendee Contacts resolver has no configured absolute path and cannot resolve by name.
- [x] Rewrite the design with exact callers, destinations, sequence, validation, rollback, and Cole checkpoints.
- [x] Scope the external model credential reader to its separate owning workstream and validation pool.
- [x] Add Contacts principal attribution as an explicit pre-cleanup gate.
- [x] Define the cross-user update marker path, ownership, modes, and validation.
- [x] Add the one-time privileged system-writer installation to Cole's checkpoints.
- [x] Make the marker channel readable without supplemental groups while preserving owner-only writes.
- [x] Pin marker creation to umask `022` and require the user-side consumer before the administrator session.
- [ ] Obtain Cole's approval of this revised design.
- [ ] Start implementation only after the design checkpoint is approved.

### Validation

Evidence retained from the original incident:

- [x] Homebrew installed Node `22.23.2` during the configured weekly update window.
- [x] Node is ad-hoc signed and its designated requirement is a code hash.
- [x] The gateway restarted into the new Node after a later configuration change.
- [x] TCC recorded a new current-Node Contacts grant during the incident.
- [x] The affected conversation repeatedly failed context-overflow precheck before model or tool execution.
- [x] Web search denied requests because its configured classifier model was unsupported.

Current design evidence on 2026-08-12:

- [x] The gateway runs Node `22.23.2` and loads one `keytar` module for the configured model credential reader.
- [x] The model credential Keychain item trusts current Node plus stale prior Node hashes.
- [x] The Todoist item trusts the signed helper; its old Node entry is stale.
- [x] The helper allowlist contains only `todoist-api-token`, and the Todoist launcher is its only consumer.
- [x] The Gmail item trusts a stale Homebrew Python application, while the configured Gmail server runs from its Python virtual environment.
- [x] Pull request `#29` is open, mergeable, and remotely green. Its installed helper design matches the live Todoist boundary.
- [x] Pull request `#31` is open and conflicting with current `main`; its last reviewed candidate was green and uses bounded `/usr/bin/security`.
- [x] `apple-pim-cli` has an absolute `binDir` to the installed wrapper directory.
- [x] Contacts, Reminders, and Calendar wrappers are installed and their `.real` tools report authorized.
- [x] The current Node binary retains a direct Contacts grant; current Node has no Reminders or Calendar grant.
- [x] Secure Calendar leaves `contactsCliPath` unset, and the gateway PATH cannot resolve any PIM CLI by name.
- [x] The weekly update daemon runs as `cole` and does not restart or postflight the gateway.
- [x] No live secret value, ACL, TCC row, configuration, process, or service was changed during this design research.

Required implementation validation:

- [ ] Focused helper, Gmail, Contacts resolver, update reconciler, context, and classifier tests pass in this repository.
- [ ] The model credential reader's success, denial, timeout, malformed-output, and cancellation regressions pass in its separate owning workstream.
- [ ] Denial, missing approval, timeout, malformed output, cancellation, concurrent refresh, interrupted install, repeated marker, restart failure, rollback, and cleanup paths pass.
- [ ] Tests use synthetic Keychain and TCC fixtures and deny-by-default write or delivery adapters.
- [ ] `node packages/e2e/bin/openclaw-test-env.mjs ci` passes with every regression for changes committed in this repository.
- [ ] The attribution fixture proves cleanup is blocked for unknown Node Contacts access and allowed only for no access or an identified migrated caller.
- [ ] Live attribution uses unified-log TCC observation, TCC principal snapshots, and gateway call-path records. If they cannot establish attribution, cleanup remains blocked.
- [ ] The update fixture proves package-manager ownership, owner-only writes, gateway-account readability without supplemental groups, generation locking, insecure-marker rejection, restart, interruption, and cleanup.
- [ ] The live synthetic handoff runs through the actual reconciler LaunchAgent under the gateway account, not through the administrator shell.
- [ ] Retained full-diff adversarial review and terminal exact-commit review are clean.
- [ ] Remote checks pass on the exact candidate.
- [ ] Production postflight remains read-only and no unexpected prompt appears.

### Rollout and rollback

- This revision is design-only. No live rollout occurs before Cole approves it.
- Preserve the installed helper binary. Adding aliases or setup scripts must not rebuild or replace it, because replacing it would require reapproval for every item.
- Before model migration, snapshot the provider configuration, local allowlist, credential item metadata, and trusted applications without reading the value. Roll back by restoring the configuration and allowlist while current Node trust remains usable. After Node trust is removed, rollback requires Cole to reapprove it interactively.
- Before Gmail migration, use pull request `#31`'s recovery artifact and preserve the existing Keychain item. Roll back code and configuration before removing Python trust. After Python trust is removed, rollback requires interactive reapproval.
- Before Contacts path migration, preserve the plugin configuration. Roll back by restoring the prior setting. Because the prior path fails closed, rollback restores denial, not working attendee trust.
- Keep Node's Contacts grant during the candidate restart and 24-hour attribution soak. Do not ask Cole to disable it while any Node Contacts access remains unattributed. After clean attribution and cleanup, any new Node prompt or TCC row is a failed migration. Stop, capture attribution evidence, restore the permission only if service recovery requires it, and tell Cole that restoration needs another interactive approval.
- Update reconciliation never downgrades Homebrew. On failure it preserves the before and after identities, marks health failed, and leaves recovery to the component rollback.
- Context recovery preserves the old session before selecting a replacement. Classifier rollback restores the last supported model and remains fail closed.
- Production writes and message delivery stay out of automated validation.

### Review log

- 2026-08-05: Original diagnosis separated context overflow, mutable interpreter permissions, residual Contacts attribution, and classifier configuration.
- 2026-08-05: Original plan passed retained and terminal adversarial review and landed in pull request `#92`.
- 2026-08-12: Cole reopened the design because it did not identify exact callers, destinations, migration mechanics, or human checkpoints.
- 2026-08-12: Current runtime and pending implementation branches were inventoried without reading values or changing live state.
- 2026-08-12: Retained review found ambiguous external credential-reader validation ownership and a missing Contacts attribution gate. Both are corrected, and the update marker contract was tightened.
- 2026-08-12: Retained recheck found the system-side update writer needed an unlisted administrator checkpoint. The checkpoint is explicit, one-time, and rollback-backed. Its first dedicated-group design was superseded by the readable owner-write-only channel below.
- 2026-08-12: Retained recheck found a newly created group would not apply to the existing user session. The marker is now owner-writable and non-secret/readable, and validation runs through the actual reconciler process.
- 2026-08-12: Retained review cleared the revised design and left two non-blocking wording gaps. Marker creation now pins umask `022`, and the user-side reconciler is installed before Cole begins the privileged handoff.
- Independent adversarial review: Final wording recheck in progress.
- Terminal review: Pending revised final candidate.

### Checklist

- [x] Todoist tracking comment points to issue `#91`.
- [x] Issue body contains the plan link, `Summary`, and `Status` only.
- [x] Original diagnosis is preserved.
- [x] Current caller and destination inventory is complete.
- [x] Stable and unstable paths are clearly separated.
- [x] Migration sequence is concrete.
- [x] Cole's interactive steps and expected prompts are explicit.
- [x] Automatic updates remain enabled.
- [x] No production mutation occurred during design.
- [x] External credential-reader ownership and validation are explicit without crossing publication boundaries.
- [x] Contacts cleanup is gated on attribution evidence.
- [ ] Cole approves the revised design.
- [ ] Revised design adversarial review is clear.
- [ ] Revised plan-only pull request is remotely green and merged.
- [ ] Issue and Todoist task return to `ready_for_review`.
