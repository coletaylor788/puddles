# Stable per-user Keychain access

**Status:** In progress — reopened for Gmail completion
**Issue:** [#23](https://github.com/coletaylor788/puddles/issues/23)
**Last updated:** 2026-07-25
**Owner:** Implementation agent

## Human design

### Problem

Homebrew replaces Node and Python executables during upgrades. Their ad-hoc
signatures use build-specific code hashes, so macOS Keychain grants tied to
those executables stop matching and background tools wait on invisible approval
prompts.

Todoist is now routed through a small immutable native helper, but Gmail remains
broken. Its existing OAuth value was truncated to 128 bytes during an earlier
migration and is invalid JSON. Gmail also needs safe credential writes during
OAuth and token refresh, which the read-only helper intentionally does not
provide.

### Outcome

- Todoist continues to read its token through the approved immutable helper
  without depending on the current Homebrew Node binary.
- Gmail is reauthenticated once and uses the stable, bounded
  `/usr/bin/security` read/write backend implemented by issue #15, without
  depending on the current Homebrew Python binary.
- Neither path exposes a network listener, enumerates secrets, logs values, or
  broadens access beyond the approved same-user boundary.
- Both changes have committed regression coverage, clean independent review,
  production read-only validation, and proven rollback.

### Approach

Keep one coherent backend per consumer rather than forcing every secret through
one abstraction:

1. Preserve the exact Keychain-approved helper binary for Todoist. The helper
   maps one opaque alias from an owner-only allowlist to one exact
   generic-password item and injects it only into the Todoist child process.
2. Finish issue #15's Gmail repair. Its bounded `/usr/bin/security` backend
   supports complete OAuth JSON reads and writes, including refresh updates,
   and avoids interpreter-specific ACL trust.
3. Reauthenticate Gmail interactively from issue #15's isolated candidate,
   validate the stored JSON shape without printing values, run the candidate
   read-only Gmail smoke, and promote only through the repository's configured
   lifecycle.
4. Keep the helper and Gmail changes in their existing focused pull requests,
   with this plan and issue #23 tracking the combined user outcome.

### Safety and rollout

- Automated helper tests use a compile-time in-memory secret backend and cannot
  open Keychain or trigger authorization UI.
- Gmail OAuth is the only required interactive action. The browser flow writes
  the replacement credential through the reviewed long-value path; no command
  prints, copies, or persists the credential outside Keychain.
- Live Gmail validation is read-only. Tests that mutate a mailbox remain
  disabled outside explicit fixtures.
- The helper binary is immutable because macOS prompted after a rebuilt binary
  even when it satisfied the prior certificate-pinned designated requirement.
  Updating it requires deliberate reapproval.
- Roll back Todoist by restoring its package-generated launcher. Roll back
  Gmail by deploying the preceding server revision and restarting through the
  configured lifecycle. Credential rotation is required only if exposure is
  suspected, not for routine code rollback.

## Agent details

### State

- Helper implementation is committed and pushed in pull request #29.
- The signed immutable helper is installed locally.
- Todoist uses `TODOIST_API_TOKEN` injected by the helper; a live task read and
  launcher rollback/reinstall both passed.
- The local helper allowlist contains only the Todoist alias.
- Gmail configuration and credential were not changed by issue #23.
- Issue #15 owns the Gmail backend repair. Its implementation, focused tests,
  lint, long-value fixtures, ACL checks, and independent review are complete.
- Cole reports that the interactive OAuth reauthentication completed. The
  issue #15 candidate must now verify that the replacement is complete
  authorized-user JSON, then run its read-only Gmail smoke and remaining
  lifecycle gates.

### Scope and acceptance criteria

- [x] Add a native non-root per-user helper with no daemon or listener.
- [x] Accept only fixed allowlist aliases; reject arbitrary service/account
  selectors, listing, search, writes, malformed input, and insecure files.
- [x] Never log secret values or place them in command arguments.
- [x] Sign and install at a stable path with secure path, ACL, symlink,
  transaction, interruption, concurrency, and rollback handling.
- [x] Migrate Todoist and pass a live read through the injected environment.
- [x] Prove Todoist launcher rollback and reinstall.
- [ ] Restore a complete Gmail OAuth credential through the issue #15 candidate.
- [ ] Pass candidate read-only Gmail API smoke without interactive Keychain
  access or timeout.
- [ ] Commit and expose the Gmail regression in the shared cumulative test pool.
- [ ] Run the full configured `packages/e2e` managed lifecycle when present.
- [ ] Obtain clean terminal adversarial reviews for the exact helper and Gmail
  commits handed off.
- [ ] Promote Gmail through the configured lifecycle and pass read-only
  production validation, or record that no approved lifecycle exists.
- [ ] Keep issue #23's ledger and both Todoist tasks synchronized with final
  evidence and review actions.

### Architecture and decisions

- **Trust boundary:** Same-user processes may invoke configured aliases. This
  matches the approved local model but is broader than per-executable
  isolation.
- **Helper API:** `puddles-keychain-helper <alias>` writes only the selected
  secret bytes to stdout. It uses `SecItemCopyMatching` with
  `kSecMatchLimitOne`.
- **Allowlist:** Fixed path
  `~/.config/puddles-keychain-helper/allowlist.tsv`; regular non-symlink,
  current-user-owned, mode `0600` or stricter, and no extended ACL entries.
- **Child injection:** `puddles-with-keychain-secret ENV ALIAS -- COMMAND`
  accepts non-empty UTF-8 without NUL, exports it only to the child, and uses no
  `eval` or child shell.
- **Immutable identity:** Production install refuses to replace an approved
  helper. Node upgrades are independent; helper updates require reapproval.
- **Todoist launcher:** The repository launcher invokes the standard per-user
  Todoist entrypoint with `TODOIST_API_TOKEN`. A global Todoist package reinstall
  may overwrite it and require reinstallation.
- **Gmail backend:** Use issue #15's single `/usr/bin/security` read/write
  implementation. Do not add the read-only helper as a second Gmail backend;
  OAuth and refresh persistence require writes.
- **Gmail bounds:** Five-second subprocess timeout, 60-second in-memory
  credential cache, exact generic-password selector, sanitized errors, and
  content-only updates for existing items.
- **Long values:** Gmail writes use the reviewed hexadecimal input path because
  prompted password input truncated at 128 bytes. The argument is briefly
  visible to same-user process inspection, which does not widen the accepted
  same-user boundary.
- **Excluded secrets:** File-backed secret references, stable signed clients,
  and the administrator login password are not exposed through the helper.

### Implementation

1. **Tracker normalization**
   - Replace the superseded plan 032 path with this reserved Todoist plan.
   - Keep issue #23 limited to the plan link, `Status`, and `Done`.
2. **Helper and Todoist**
   - Keep pull request #29 focused on the helper, installer, wrappers,
     documentation, and regressions.
   - Preserve the deployed immutable helper and Todoist launcher.
3. **Gmail repair coordination**
   - Resume the existing issue #15 session and branch; do not duplicate its
     implementation in pull request #29.
   - Complete interactive OAuth in the issue #15 isolated worktree.
   - Validate complete credential shape and candidate read-only Gmail access.
4. **Shared integration pool**
   - Ensure both changes have committed regressions in the accumulated test
     surface.
   - Run `node packages/e2e/bin/openclaw-test-env.mjs ci` on each active branch
     where the runner exists, following `packages/e2e/README.md`.
5. **Audit and promotion**
   - Run fresh adversarial review after final bookkeeping on each exact commit.
   - Promote Gmail only through the configured lifecycle and run read-only
     production validation.
6. **Handoff**
   - Update this complete plan, then issue #23's concise ledger.
   - Link the focused pull requests and move both owning Todoist tasks to the
     appropriate review state without completing them.

### Validation

Completed for helper pull request #29:

- `bash -n` for helper, installer, rollback, setup, wrapper, Todoist launcher,
  and lifecycle scripts.
- Production Swift compile with warnings treated as errors.
- `tools/keychain-helper/tests/run.sh`.
- Workspace lint and build.
- 216 workspace unit tests: 112 shared hook tests, 61 calendar plugin tests,
  and 43 Gmail plugin tests.
- Prompt-proof lifecycle coverage for malformed and insecure allowlists,
  synthetic success/denial/interaction/error outcomes, concurrency, binary
  rejection, Node/Python child injection, Todoist launcher injection,
  promotion interruption, operation locking, transaction recovery, APFS path
  aliases, rollback, and snapshot handoff.
- Live Todoist `auth status` reported the environment backend and a live task
  read passed.
- Todoist launcher rollback restored the original symlink; reinstall and live
  read passed.
- Multiple independent reviews; final staged review was clean.

Completed on issue #15's candidate, pending reauthentication recheck:

- 106 safe tests passed; 19 live mailbox mutation tests skipped.
- Ruff and Python compilation passed.
- Stable exact-item read completed in about 20 ms without a prompt.
- Temporary Keychain fixtures round-tripped 312-byte creates and 362-byte
  content-only updates.
- ACL inspection confirmed `/usr/bin/security` trust and the `apple-tool`
  partition.
- Independent full-diff review was clean.

Still required:

- Confirm the reauthenticated Gmail value is complete authorized-user JSON
  without printing values.
- Run candidate read-only Gmail API smoke.
- Add/confirm cumulative `packages/e2e` regression registration and run the
  full managed `ci` lifecycle.
- Rerun applicable focused gates after any change.
- Run terminal fresh adversarial review against each exact handoff commit.
- Run configured production read-only health and Gmail smoke after promotion.

### Rollout and rollback

Todoist production state:

- Helper:
  `~/.local/libexec/puddles-keychain-helper/puddles-keychain-helper`
- Environment wrapper:
  `~/.local/bin/puddles-with-keychain-secret`
- Allowlist:
  `~/.config/puddles-keychain-helper/allowlist.tsv`
- Todoist launcher:
  `~/.npm-global/bin/td`
- Original launcher backup:
  `~/.npm-global/bin/td.pre-keychain-helper`

Todoist rollback:

```bash
rm -f ~/.npm-global/bin/td
mv ~/.npm-global/bin/td.pre-keychain-helper ~/.npm-global/bin/td
```

After restoring all consumers, the helper's recorded pre-install absent-state
snapshot can remove the helper and child wrapper. Remove Keychain trusted-app
entries and the signing identity only after no consumer depends on them.

Gmail rollout:

1. Run issue #15's candidate OAuth flow interactively.
2. Validate credential shape and candidate read-only Gmail access.
3. Run focused and shared managed test lifecycles.
4. Commit, push, and open/update the focused Gmail pull request.
5. Promote through the configured lifecycle.
6. Restart only the managed gateway/service through that lifecycle.
7. Run read-only production Gmail smoke and confirm no Keychain timeout or
   prompt.

Gmail rollback:

1. Preserve the original post-promotion failure.
2. Deploy the preceding server revision through the same lifecycle.
3. Restart and revalidate production health/read-only Gmail access.
4. Keep the newly reauthenticated credential unless exposure is suspected; it
   replaces an already-invalid value and is not a code rollback artifact.

### Review log

- Helper reviews found and fixed install path/ACL weaknesses, allowlist ACL
  handling, binary truncation, transaction atomicity, arbitrary prefixes,
  lock races, APFS aliases, stale handoffs, and failed-approval rollback.
- The rebuilt helper experimentally satisfied the previous designated
  requirement but still prompted. The design changed to immutable approved
  binary rather than claiming transparent helper upgrades.
- Gmail coordination confirmed that the existing credential is invalid and
  issue #15 is the sole owner of its recovery. The helper never wrote the Gmail
  item or changed Gmail configuration.
- Final helper staged review reported no significant issues before commit
  `bd41ab1d32ae67e21bbafc2d91003cca08068062`.
- Pending: terminal fresh adversarial review for the tracker-normalized helper
  commit and the final Gmail commit after OAuth validation and integration
  coverage.

### Checklist

#### Tracker and design

- [x] Invoke and follow safe feature development.
- [x] Keep the public design provider-neutral and secrets local.
- [x] Normalize issue #23 to the reserved plan-ledger contract.
- [x] Migrate plan 032 details into this synchronized two-part plan.
- [x] Reconcile the helper and issue #15 Gmail architectures.

#### Helper and Todoist

- [x] Implement, document, and test the immutable allowlisted helper.
- [x] Complete interactive Todoist approval.
- [x] Migrate Todoist and pass live read-only validation.
- [x] Prove Todoist and helper rollback paths.
- [x] Push helper pull request #29.

#### Gmail

- [x] Diagnose the invalid 128-byte credential and stable-backend requirement.
- [x] Implement and locally validate the issue #15 Gmail backend.
- [ ] Complete interactive OAuth reauthentication.
- [ ] Pass candidate read-only Gmail smoke.
- [ ] Commit, push, and open/update the Gmail pull request.
- [ ] Promote through the configured lifecycle.
- [ ] Pass production read-only Gmail validation.

#### Integration and review

- [ ] Confirm committed regressions in the shared cumulative integration pool.
- [ ] Run the full managed `packages/e2e` CI lifecycle.
- [ ] Resolve any failures and rerun all affected gates.
- [ ] Obtain clean terminal adversarial reviews for exact handoff commits.

#### Handoff

- [ ] Mark this plan complete with final commit, PR, deployment, validation, and
  rollback evidence.
- [ ] Set issue #23 ledger to Ready for review.
- [ ] Update both Todoist tasks with raw issue links and next review actions.
