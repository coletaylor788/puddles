# Fix broken Gmail tools

- **Status:** Ready for review
- **Issue:** https://github.com/coletaylor788/puddles/issues/15
- **Last updated:** 2026-07-25
- **Owner:** Gmail repair worker

## Human design

### Problem

Gmail tools began timing out before reaching Gmail because macOS Keychain
trusted a Homebrew Python executable that an upgrade replaced. The background
server then waited on an invisible approval prompt. An early recovery attempt
also used Keychain's prompted password input for OAuth JSON and silently
truncated the credential to 128 bytes.

### Outcome

Gmail credential reads and refresh writes use a stable, bounded system command
instead of a versioned interpreter. Keychain failures return an actionable error
within five seconds rather than wedging tools. Complete OAuth credentials are
preserved, refresh races cannot overwrite newer or narrower credentials, tool
schemas remain compatible, and recovery is verified with read-only Gmail calls.

### Approach

Use exact-item `/usr/bin/security` operations against the canonical login
keychain, cache valid parsed credentials briefly, and keep blocking credential
work behind the existing worker boundary. Create new items with stable command
trust, update existing data without changing ACLs, and use hexadecimal input for
long JSON. Serialize OAuth replacement and refresh persistence across processes,
enforce shared deadlines and cancellation, and reject malformed or
scope-narrowed credentials. Keep this focused Gmail backend separate from other
credential helpers.

### Safety and rollout

Access stays local and exact-scoped to service `gmail-mcp` and account `token`.
Credential values remain in memory and are never logged or written to files;
automated tests use mocks or temporary items and never mutate a live mailbox.
The recovered credential is inspected only for length and shape, and live Gmail
checks are read-only. The repository has a managed candidate test lifecycle but
no snapshotting, rollback-capable Gmail production promotion lifecycle; its
documentation only describes manual installation from the primary checkout.
This handoff therefore stops at a reviewed pull request rather than inventing
production access or modifying that checkout. After merge, production rollout
requires a separately approved lifecycle. The recovered credential remains
valid independently of code rollout unless exposure is suspected.

## Agent details

### State

Candidate `c9dbabe365abdbe89d077a11326e60fc600db9c8` is pushed to draft
PR #31. It replaces Python `keyring` access and adds cumulative regression
coverage. Cole completed browser OAuth recovery; structural inspection
confirmed a complete 779-byte authorized-user object with required fields,
refresh token, and effective grants without exposing values. Candidate Gmail
profile and one-message list reads succeeded. Focused tests, the complete
managed lifecycle, remote CI, and adversarial review pass 18 are green. The
reserved plan migration is ready to commit, push, and receive terminal
exact-commit review. Production deployment is not run because the repository
has no safe configured Gmail promotion/rollback lifecycle.

### Scope and acceptance criteria

- Explain the runtime-upgrade trigger and remove executable-version-sensitive
  Keychain access.
- Bound each Keychain operation and all refresh/OAuth work beneath MCP worker
  deadlines; surface non-missing failures explicitly.
- Preserve complete authorized-user JSON and existing ACLs, handle create and
  replacement races, and reject malformed, invalid, or narrowed credentials.
- Keep successful MCP tool inputs and outputs backward compatible and keep
  blocking work off the shared event loop.
- Commit Gmail coverage to the cumulative integration pool without collecting
  live mailbox mutation tests.
- Accept after credential shape and required effective grants pass, candidate
  read-only Gmail access succeeds, focused and managed gates pass, an
  exact-commit independent review is clean, and either configured production
  promotion plus read-only validation succeeds or the absence of a safe
  configured promotion lifecycle is explicitly reported.

### Architecture and decisions

- `/usr/bin/security` is the single Gmail read/write backend because OAuth
  refresh must persist credentials.
- Every command targets the canonical OS-account login keychain and exact
  `gmail-mcp` / `token` selectors.
- Item-not-found is unauthenticated; permission, timeout, decoding, and command
  failures are explicit `KeychainAccessError` results.
- Create uses `-T /usr/bin/security`; updates use `-U` without `-T` so refreshes
  preserve ACLs. Arbitrary-length values use `-X`.
- Valid parsed Keychain credentials are cached for 60 seconds. Expired
  credentials enter one owner-only canonical cross-process transaction.
- Refresh and OAuth use cumulative deadlines, compare-before-write, cooperative
  cancellation, and bounded draining of active credential writes.
- Actual `granted_scopes`, when present, are authoritative. Invalid or narrowed
  refreshed credentials are not persisted or reported ready.
- Environment-token compatibility remains unchanged.
- Managed automation forces `CI=true` and excludes `tests/integration`
  explicitly; live validation uses read-only Gmail profile/list operations.

### Implementation

1. Replace Python `keyring` with bounded, byte-oriented exact-item Keychain
   helpers and structured errors.
2. Add long-value writes, ACL-preserving updates, duplicate-create recovery,
   canonical locking, compare-before-write, strict credential parsing, and
   short-lived caching.
3. Offload authentication and service construction, propagate operation
   deadlines and cancellation, bound OAuth browser/token exchange, and prevent
   late or stale persistence.
4. Validate required authorized-user fields, refresh tokens, and effective
   scopes before persistence or service construction.
5. Update Gmail documentation and add focused Python plus cumulative E2E
   regressions.
6. Validate the recovered credential without values, run candidate read-only
   Gmail access, rerun all applicable gates, finalize plan bookkeeping, and
   obtain a clean terminal review of the exact handoff commit.
7. Inspect the repository for a configured Gmail promotion/rollback lifecycle.
   Do not deploy when only manual primary-checkout instructions exist; report
   the limitation in the review handoff.

### Validation

Completed for pushed candidate `c9dbabe`:

- `CI=false .venv/bin/python -m pytest tests/ --ignore=tests/integration -q`:
  166 passed; live mailbox tests were not collected.
- `.venv/bin/ruff check src/ tests/` and
  `.venv/bin/python -m compileall -q src tests`: passed.
- Focused cumulative Gmail E2E: 4 passed; E2E TypeScript lint passed.
- `CI=false HOME=/tmp/noncanonical-home OPENCLAW_SRC=/Users/puddles/git/openclaw node packages/e2e/bin/openclaw-test-env.mjs ci`:
  241 workspace tests, 166 safe Gmail tests, 289 mapped OpenClaw tests, and one
  candidate browser test passed; temporary worktree cleanup passed. The same
  complete lifecycle passed again after OAuth validation and plan migration.
- PR #31 remote CodeQL checks for actions, JavaScript/TypeScript, and Python plus
  the remote cumulative integration job passed on `c9dbabe`.
- Exact stable item read completed without a prompt. Temporary `security -X`
  fixtures round-tripped 312-byte create and 362-byte update values.
- Before browser recovery, shape inspection reported a present 128-byte value
  that was not a JSON object and had no usable required fields or scopes.
- After browser recovery, shape inspection reported a 779-byte JSON object with
  all required nonblank fields, refresh token, and required effective grants;
  no values were printed.
- Candidate read-only Gmail smoke successfully constructed the service, read
  profile metadata, and listed at most one message without printing mailbox
  content.
- Adversarial review pass 18 found no actionable issue after both refresh
  entrypoints adopted the same validity and effective-grant invariant.

Still required outside this final diff:

- Commit and push the reserved plan migration.
- Obtain a terminal fresh review against that exact committed handoff diff and
  record the result only in issue #15.

### Rollout and rollback

Current handoff:

1. Commit and push the reserved plan migration and update draft PR #31.
2. Obtain a clean terminal review of that exact commit without changing the
   diff afterward.
3. Hand off the reviewed PR with the explicit production lifecycle limitation.

Future rollout requires an approved mechanism that snapshots the currently
deployed Gmail server revision, atomically installs the reviewed revision
without editing the configured primary checkout, restarts the user LaunchAgent,
and runs explicit read-only Gmail health/profile/list checks.

Future rollback must preserve the first production failure, restore the recorded
server revision through that same mechanism, reload, revalidate health and
read-only Gmail access, and surface rollback failures separately. The recovered
OAuth credential should remain because it replaces corrupt data and is
independent of code, unless exposure is suspected.

### Review log

- Early reviews corrected cache invalidation, MCP error translation, repeated
  ACL mutation, duplicate-create races, prompted-write truncation, and stale
  documentation.
- Repository adversarial reviews 1-9 corrected event-loop blocking,
  refresh/OAuth serialization and deadlines, cross-process locking, malformed
  JSON handling, managed-test isolation, environment compatibility, binary
  corruption handling, browser-controller compatibility, lazy home resolution,
  and cache bypass.
- Reviews 10-15 corrected missing recovery refresh tokens, late persistence,
  concurrent replacement readiness, queue-time side effects, fabricated or
  malformed scopes, caller cancellation, Keychain-domain ambiguity, and
  cancellation during active writes.
- Reviews 16-17 corrected post-refresh validity and effective-grant checks in
  both OAuth recovery and normal service construction.
- Review 18 found no actionable issue on candidate `c9dbabe`.
- The terminal exact-commit review is the final issue-ledger gate after this
  plan migration is committed; its result will not alter the reviewed diff.

### Checklist

- [x] Diagnose and document the runtime-upgrade Keychain timeout.
- [x] Implement bounded exact-item Keychain reads and writes.
- [x] Preserve long OAuth JSON and ACLs; handle concurrent creation.
- [x] Add caching, canonical serialization, deadlines, and cancellation.
- [x] Keep blocking authentication work off the MCP event loop.
- [x] Reject malformed, invalid, stale, or narrowed credentials.
- [x] Remove the Python `keyring` dependency and update documentation.
- [x] Add focused and cumulative regression coverage.
- [x] Rebase current `main`, push candidate `c9dbabe`, and open draft PR #31.
- [x] Pass focused gates and the complete managed test lifecycle.
- [x] Obtain a clean pre-recovery adversarial review.
- [x] Receive confirmation that browser OAuth recovery was completed.
- [x] Validate recovered credential shape and required effective grants.
- [x] Pass candidate read-only Gmail smoke.
- [x] Rerun focused and complete managed gates after final plan migration.
- [x] Confirm remote cumulative and CodeQL checks pass.
- [x] Confirm no safe configured Gmail production promotion lifecycle exists.
- [x] Finalize in-diff plan and checklist for terminal exact-commit review.
