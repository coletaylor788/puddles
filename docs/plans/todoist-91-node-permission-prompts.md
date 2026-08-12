# Diagnose Node permission prompts

Status: Design ready for review
Issue: https://github.com/coletaylor788/puddles/issues/91
Last updated: 2026-08-12

## Human section

### Design

The long-running Node service receives messages, loads tools, and starts helper processes. It should coordinate access, but it should not be the identity that macOS trusts. Homebrew replaces Node during routine updates, so any Keychain or private-data grant attached to that binary eventually stops matching. There is not one new permission daemon to put everything behind. The design uses two narrow native boundaries: a signed helper for fixed read-only secrets, and native Personal Information Management tools for Contacts, Reminders, and Calendar. Gmail is the exception because its OAuth credential must be updated, so it uses Apple's stable system credential tool with bounded reads and writes.

Today, Todoist already reads its token through the signed helper. The main Calendar and Reminders paths already run through the native tools that own their macOS privacy grants. Three paths are still wrong. The model credential is read directly by Node. Gmail reads its OAuth token through a Homebrew Python process. The calendar attendee safety check asks for the Contacts tool by name, but the Node service cannot resolve that name, so the check fails closed before reaching the already-approved native Contacts path. The direct Node Contacts grant seen during the incident came from another, still-unidentified call and is not explained away by the broken attendee check.

The migration first lands the existing reviewed helper and Gmail work. The model credential reader then calls the signed helper instead of Keychain. Gmail switches to the stable Apple credential tool. The attendee check gets the exact native Contacts path. A post-update reconciler restarts the Node service after package changes and runs checks that cannot open approval dialogs. Only after a restart and soak pass does Cole remove the old Node and Python Keychain access and turn off Node's Contacts grant. Cole is needed for two one-time Keychain approvals and one cleanup session in macOS settings. Everything else, including code, tests, deployment, restart, health checks, context-overflow recovery, and classifier validation, is agent-owned.

### Status

The revised design now names what is stable, what still bypasses a stable boundary, what moves, and how each move is checked. No live permissions, credentials, configuration, or services changed during this design pass.

The plan is ready for Cole to review before implementation. Cole's expected participation is one logged-in desktop session to approve the model credential helper and Gmail credential tool, then a later cleanup session after the soak to remove old interpreter access and disable Node's Contacts permission.

## Agent section

### State

- Phase: Design checkpoint
- Repository: `coletaylor788/puddles`
- Tracking issue: `#91`
- Todoist task: `6hCmp4C6fqx95423`
- Production mutation: Not performed
- Blockers: Cole has not yet approved the revised migration design.

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
- Follow-on implementation must add committed regressions and pass `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Automated validation must not read secret values into logs, alter live TCC rows, mutate mail or PIM data, or deliver messages.

### Architecture and decisions

Current caller inventory:

| Caller | Current permission boundary | Current state | Destination |
| --- | --- | --- | --- |
| Todoist CLI | Signed `puddles-keychain-helper` injects `TODOIST_API_TOKEN` into only the Todoist child | Stable and working. It is the helper's only installed consumer. | No move. Merge pull request `#29` so the deployed helper and launcher are durable repository state. |
| Runtime model credential reader | Gateway Node process loads `keytar` and reads the model credential item directly | Unstable. The current Node hash is trusted, while older Node hashes are stale. | The credential reader invokes the installed helper by absolute path with a fixed provider-neutral alias. It captures the value in memory with a timeout and never puts it in gateway-wide environment variables or child process arguments. Adapter wiring stays in its owning configuration and is not published here. |
| Gmail MCP server | Homebrew Python uses `keyring` to read and update `gmail-mcp` / `token` | Unstable. The Keychain trusted application points at an old Python application. | Rebase and finish pull request `#31`. Gmail uses bounded `/usr/bin/security` reads and writes, a short in-memory cache, and refresh locking. Gmail does not use the read-only helper because OAuth refresh and reauthorization need writes. |
| `apple-pim-cli` Calendar, Contacts, and Reminders tools | Configured `binDir` points at `~/.local/bin`, whose links enter the disclaim wrappers and then the `.real` Swift tools | Stable for Node updates. The `.real` tools hold current TCC grants. | No move. Keep explicit `binDir` and verify all three authorizations after every relevant update. |
| Secure Calendar MCP bridge | The bundled server finds the wrapped Swift tools in the plugin release directory | Stable for Node updates. Post-update Calendar reads and writes succeeded. | No move. Add a read-only postflight that proves the resolved binary is a wrapper and the `.real` tool remains authorized. |
| Calendar attendee Contacts check | `ContactsTrustResolver` defaults to bare `contacts-cli`; the gateway `PATH` excludes `~/.local/bin` | Broken fail-closed path. It cannot reach Contacts and did not cause the Node Contacts prompt. | Set `contactsCliPath` to the absolute `~/.local/bin/contacts-cli` wrapper. Add register-time health checking and keep deny-by-default behavior. |
| Unidentified direct Contacts caller | Current Node `22.23.2` has an allowed AddressBook TCC row created during the incident | Unstable and broader than intended. The originating call is still unknown. | Add TCC principal auditing and call-path logging. After every known PIM path passes through wrappers, Cole disables Node's Contacts access. Any recurrence is treated as a failed migration and traced before proceeding. |
| Homebrew update daemon | Runs weekly as `cole`, updates packages, and exits without restarting or checking the `puddles` gateway | Updates are automatic but permission failures surface only on later use. | Write an atomic version-change marker. A new `puddles` LaunchAgent consumes the marker, restarts the gateway once, and runs noninteractive postflight checks. |
| Main conversation compaction | Safeguard compaction runs inside the gateway | It compacted three times, then repeated precheck overflow without recovery. | Set and verify a soft budget below the selected model's hard window. Rotate only after repeated precheck overflow when compaction cannot run, preserving the old session. |
| Tool classifier | Loads a configured model when a protected tool is first used | An unsupported model caused web search to deny requests. | Validate model support at gateway startup and expose a degraded health state before the first tool call. Keep fail-closed behavior. |

The permission boundaries remain separate on purpose:

- `puddles-keychain-helper` is read-only, alias allowlisted, immutable after approval, and has no daemon or network surface.
- `/usr/bin/security` is the Gmail read/write boundary. It is stable across Homebrew upgrades but broadens access to same-user code, which is why it is limited to Gmail's write requirement.
- Apple PIM wrappers disclaim Node responsibility so the `.real` native tools own TCC. The wrapper and `.real` binaries remain separate from Keychain handling.
- The OpenClaw gateway never receives a blanket permission grant. It receives secret values in memory only from the narrow helper call that needs them and reaches PIM only through explicit wrapper paths.

Implementation sequence:

1. **Land prerequisites.** Refresh and merge pull request `#29`. Rebase pull request `#31` onto current `main`, rerun its focused and cumulative validation, and merge it.
2. **Add model credential helper support.** Add a provider-neutral helper alias to the owner-only local allowlist without replacing the approved helper binary. Change the configured credential reader from direct `keytar` access to an absolute helper subprocess with a five-second timeout, no shell, no argv secret, no logging, and an in-memory cache. Add isolated success, denial, timeout, malformed-output, and cancellation tests in the credential reader's owning workstream.
3. **Deploy Gmail's stable backend.** Deploy pull request `#31` through its recovery-capable lifecycle. Migrate the existing item so `/usr/bin/security` can read it without prompting. Keep OAuth writes bounded and serialized.
4. **Repair the attendee Contacts path.** Set `contactsCliPath` to the installed absolute wrapper. Add startup `auth-status` validation and a focused regression proving the gateway environment does not need PATH lookup.
5. **Add update reconciliation.** Extend `scripts/mac-mini/brew-autoupdate.sh` to record before and after package identities and atomically publish a marker only when a relevant executable changed. Add a user LaunchAgent and reconciler script that lock by marker generation, restart the gateway once, and run checks for the helper aliases, Gmail credential access, PIM wrapper identity and authorization, gateway health, context settings, and classifier support.
6. **Run pre-cleanup validation.** Restart the gateway with the candidate. Prove Todoist and model credential reads without prompts, Gmail read-only API access, Contacts resolver health, Calendar and Reminders reads, current gateway health, compaction configuration, classifier readiness, interruption recovery, and rollback fixtures. Keep existing interpreter ACLs during a 24-hour soak that must finish before the next weekly update.
7. **Remove old grants.** In one logged-in desktop session, remove Node and Python from the migrated Keychain items and disable Node under Contacts privacy. Do not reset the native `.real` PIM grants. Restart and repeat all read-only checks.
8. **Exercise the real update boundary.** Use an isolated fixture to prove marker, restart, interruption, and rollback behavior. After merge, the next normal Homebrew update is the production proof. The reconciler records success or marks the gateway unhealthy; it never rolls back Homebrew automatically.
9. **Fix the two non-permission failures.** Land context-budget and overflow recovery with a committed regression. Validate classifier availability at startup with a committed fail-closed regression.

Cole checkpoints:

| Checkpoint | What Cole does | Expected prompt or screen | Agent action before and after |
| --- | --- | --- | --- |
| Model credential approval | In the logged-in desktop session, enter the login Keychain password and choose **Always Allow** for the installed signed helper reading the model credential item. | One Keychain prompt naming `puddles-keychain-helper` and the existing model credential item. | Before: snapshot item metadata and verify the exact helper identity and alias. After: run a UI-disabled helper read, restart the gateway, and prove model access. |
| Gmail credential approval | Enter the login Keychain password and choose **Always Allow** for `/usr/bin/security` reading `gmail-mcp`. Complete browser OAuth only if the existing credential fails read-only validation. | One Keychain prompt naming `/usr/bin/security`; optional browser consent if the credential is invalid or revoked. | Before: preserve the existing credential through the reviewed recovery path. After: run UI-disabled Keychain reads and a read-only Gmail API smoke. |
| Old-grant cleanup after soak | In Keychain Access, remove Node from the model item and Python from the Gmail item. In System Settings, turn off Node under Privacy & Security > Contacts. | Keychain Access trusted-app lists and the Contacts privacy list. No new Allow prompt is expected. | Before: confirm the 24-hour soak and rollback artifacts. After: restart, repeat all read-only checks, and inspect TCC and ACL metadata without reading values. |
| Unexpected PIM prompt only | If a wrapper grant is missing, approve the named native `.real` Contacts, Reminders, or Calendar tool. Do not approve Node. | A macOS private-data prompt naming the native tool. | Stop automation, verify the binary identity, have Cole approve, then rerun the single affected check. Current evidence says this should not be needed. |

Cole is not needed to merge or rebase pull requests, edit allowlists, change configuration, install LaunchAgents, run tests, restart the gateway, monitor the soak, resolve CI or review, merge implementation, or perform read-only postflight checks.

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

- [ ] Focused helper, provider credential, Gmail, Contacts resolver, update reconciler, context, and classifier tests pass.
- [ ] Denial, missing approval, timeout, malformed output, cancellation, concurrent refresh, interrupted install, repeated marker, restart failure, rollback, and cleanup paths pass.
- [ ] Tests use synthetic Keychain and TCC fixtures and deny-by-default write or delivery adapters.
- [ ] `node packages/e2e/bin/openclaw-test-env.mjs ci` passes with all new regressions in the shared pool.
- [ ] Retained full-diff adversarial review and terminal exact-commit review are clean.
- [ ] Remote checks pass on the exact candidate.
- [ ] Production postflight remains read-only and no unexpected prompt appears.

### Rollout and rollback

- This revision is design-only. No live rollout occurs before Cole approves it.
- Preserve the installed helper binary. Adding aliases or setup scripts must not rebuild or replace it, because replacing it would require reapproval for every item.
- Before model migration, snapshot the provider configuration, local allowlist, credential item metadata, and trusted applications without reading the value. Roll back by restoring the configuration and allowlist while current Node trust remains usable. After Node trust is removed, rollback requires Cole to reapprove it interactively.
- Before Gmail migration, use pull request `#31`'s recovery artifact and preserve the existing Keychain item. Roll back code and configuration before removing Python trust. After Python trust is removed, rollback requires interactive reapproval.
- Before Contacts path migration, preserve the plugin configuration. Roll back by restoring the prior setting. Because the prior path fails closed, rollback restores denial, not working attendee trust.
- Keep Node's Contacts grant during the candidate restart and 24-hour soak. After Cole disables it, any new Node prompt or TCC row is a failed migration. Stop, capture attribution evidence, restore the permission only if service recovery requires it, and do not approve blindly.
- Update reconciliation never downgrades Homebrew. On failure it preserves the before and after identities, marks health failed, and leaves recovery to the component rollback.
- Context recovery preserves the old session before selecting a replacement. Classifier rollback restores the last supported model and remains fail closed.
- Production writes and message delivery stay out of automated validation.

### Review log

- 2026-08-05: Original diagnosis separated context overflow, mutable interpreter permissions, residual Contacts attribution, and classifier configuration.
- 2026-08-05: Original plan passed retained and terminal adversarial review and landed in pull request `#92`.
- 2026-08-12: Cole reopened the design because it did not identify exact callers, destinations, migration mechanics, or human checkpoints.
- 2026-08-12: Current runtime and pending implementation branches were inventoried without reading values or changing live state.
- Independent adversarial review: Pending revised design.
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
- [ ] Cole approves the revised design.
- [ ] Revised design adversarial review is clear.
- [ ] Revised plan-only pull request is remotely green and merged.
- [ ] Issue and Todoist task return to `ready_for_review`.
