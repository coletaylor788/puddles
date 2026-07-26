# Stable per-user Keychain access

**Status:** Ready for review — combined implementation validated
**Issue:** [#23](https://github.com/coletaylor788/puddles/issues/23)
**Last updated:** 2026-07-25
**Owner:** Implementation agent

## Human design

### Problem

Homebrew replaces Node and Python executables during upgrades. Their ad-hoc
signatures use build-specific code hashes, so macOS Keychain grants tied to
those executables stop matching and background tools wait on invisible approval
prompts.

Todoist needed a stable read-only path. Gmail additionally needed safe
credential writes during OAuth and token refresh. An earlier Gmail migration
had truncated its OAuth JSON to 128 bytes, so durable executable identity alone
could not restore the invalid credential.

### Outcome

- Todoist continues to read its token through the approved immutable helper
  without depending on the current Homebrew Node binary.
- Gmail has a restored complete OAuth credential and a validated stable,
  bounded `/usr/bin/security` read/write backend implemented by issue #15,
  without depending on the current Homebrew Python binary.
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
   validate the stored JSON shape without printing values, and run the
   candidate read-only Gmail smoke.
4. Keep the helper and Gmail changes in their existing focused pull requests,
   with this plan and issue #23 tracking the combined user outcome.

### Safety and rollout

- Automated helper tests use a compile-time in-memory secret backend and cannot
  open Keychain or trigger authorization UI.
- Gmail OAuth was the only required interactive action. The browser flow wrote
  the replacement credential through the reviewed long-value path; no command
  printed, copied, or persisted the credential outside Keychain.
- Live Gmail validation is read-only. Tests that mutate a mailbox remain
  disabled outside explicit fixtures.
- The helper binary is immutable because macOS prompted after a rebuilt binary
  even when it satisfied the prior certificate-pinned designated requirement.
  Updating it requires deliberate reapproval.
- The repository has no configured snapshotting, rollback-capable Gmail
  production promotion lifecycle. The candidate was not copied into the
  configured primary checkout and production was not restarted. This
  limitation is explicit in the focused Gmail plan and pull request.
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
- Issue #15 owns the Gmail backend repair. The replacement credential is a
  complete 779-byte authorized-user JSON object with required nonblank fields,
  refresh token, and effective grants; no values were printed.
- The issue #15 candidate constructed the Gmail service, read profile metadata,
  and listed at most one message without printing mailbox content.
- Focused, cumulative, full managed lifecycle, remote CI, and CodeQL gates are
  green for the Gmail candidate.
- Pull request #31 and issue #15 are ready for review at exact reviewed commit
  `7a23b266b683fbb74e651e46424f265250dbe1d3`.
- Gmail production deployment was not run because no approved snapshotting and
  rollback-capable promotion lifecycle exists.

### Scope and acceptance criteria

- [x] Add a native non-root per-user helper with no daemon or listener.
- [x] Accept only fixed allowlist aliases; reject arbitrary service/account
  selectors, listing, search, writes, malformed input, and insecure files.
- [x] Never log secret values or place them in command arguments.
- [x] Sign and install at a stable path with secure path, ACL, symlink,
  transaction, interruption, concurrency, and rollback handling.
- [x] Migrate Todoist and pass a live read through the injected environment.
- [x] Prove Todoist launcher rollback and reinstall.
- [x] Restore a complete Gmail OAuth credential through the issue #15 candidate.
- [x] Pass candidate read-only Gmail API smoke without interactive Keychain
  access or timeout.
- [x] Commit and expose the Gmail regression in the shared cumulative test pool.
- [x] Run the full configured `packages/e2e` managed lifecycle.
- [x] Obtain a clean terminal adversarial review for the exact Gmail commit.
- [x] Record that no approved Gmail production lifecycle exists; do not invent
  one or modify the configured primary checkout.
- [x] Prepare the final helper-plan commit for terminal adversarial review; its
  result will be recorded only in issue #23's ledger.
- [x] Prepare issue #23 and both Todoist task handoffs with final evidence and
  review actions.

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
   - Inspect the configured production lifecycle. If it lacks snapshot and
     rollback support, do not deploy and record the limitation.
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

Completed on issue #15's candidate:

- Post-OAuth shape check: present 779-byte JSON object, required authorized-user
  fields nonblank, refresh token present, and required effective grants
  present; no values printed.
- Candidate read-only smoke constructed the service, read profile metadata, and
  listed at most one message; no mailbox content printed.
- 166 safe Python tests passed with live integration tests excluded.
- Ruff and Python compilation passed.
- Stable exact-item read completed in about 20 ms without a prompt.
- Temporary Keychain fixtures round-tripped 312-byte creates and 362-byte
  content-only updates.
- ACL inspection confirmed `/usr/bin/security` trust and the `apple-tool`
  partition.
- Focused cumulative Gmail E2E passed 4/4 and TypeScript lint passed.
- Full managed lifecycle passed with 241 workspace tests, 166 Gmail tests, 289
  mapped OpenClaw tests, one candidate browser test, and clean cleanup.
- Remote cumulative CI and CodeQL passed.
- Exact terminal adversarial review found no actionable finding on commit
  `7a23b266b683fbb74e651e46424f265250dbe1d3`.

Out-of-diff handoff after this plan commit:

- Run terminal fresh adversarial review against the final helper-plan commit.
- Synchronize issue #23 and both Todoist tasks with the combined review handoff.

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

1. Interactive OAuth, credential validation, candidate read-only smoke,
   focused tests, managed CI, remote CI, CodeQL, commit, push, and focused pull
   request are complete.
2. Production deployment was not run. Repository inspection found only manual
   primary-checkout install/restart instructions, not an approved snapshotting
   and rollback-capable promotion lifecycle.
3. After review and merge, an authorized operator must use or establish an
   approved production lifecycle before deploying the Gmail code, then run the
   documented read-only production smoke.

Gmail rollback:

1. Production rollback was not exercised because production deployment was not
   run.
2. Any later authorized lifecycle must preserve the preceding server revision,
   restore it on post-promotion failure, restart, and revalidate read-only Gmail
   access.
3. Keep the newly reauthenticated credential unless exposure is suspected; it
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
- Gmail terminal adversarial review reported no actionable finding on exact
  commit `7a23b266b683fbb74e651e46424f265250dbe1d3`.
- Pending: terminal fresh adversarial review for the final tracker-normalized
  helper commit. Its result will be recorded only in issue #23's ledger so the
  reviewed diff remains unchanged.

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
- [x] Complete interactive OAuth reauthentication.
- [x] Pass candidate read-only Gmail smoke.
- [x] Commit, push, and open the Gmail pull request.
- [x] Inspect production lifecycle and record that safe promotion is
  unavailable.
- [x] Leave production unchanged rather than inventing an unsafe deployment.

#### Integration and review

- [x] Confirm committed regressions in the shared cumulative integration pool.
- [x] Run the full managed `packages/e2e` CI lifecycle.
- [x] Resolve failures and rerun all affected gates.
- [x] Obtain a clean terminal adversarial review for the exact Gmail commit.
- [x] Prepare the exact final helper-plan commit for terminal adversarial
  review; record the result only in issue #23.

#### Handoff

- [x] Mark this plan ready for review with final PR, validation, deployment
  limitation, and rollback evidence.
- [x] Prepare issue #23 to be set to Ready for review after terminal review.
- [x] Prepare both Todoist task review handoffs with raw issue links.
