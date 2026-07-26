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
credential helpers. Integrate current `main` without weakening either branch's
cumulative test documentation or coverage.

### Safety and rollout

Access stays local and exact-scoped to service `gmail-mcp` and account `token`.
Credential values remain in memory and are never logged or written to files;
automated tests use mocks or temporary items and never mutate a live mailbox.
The recovered credential is inspected only for length and shape, and live Gmail
checks are read-only. The repository has a managed candidate test lifecycle but
no snapshotting, rollback-capable Gmail production promotion lifecycle; its
documentation only describes manual installation from the primary checkout.
This handoff therefore stops at a reviewed, conflict-free pull request rather
than inventing production access or modifying that checkout. Mainline merges are
resolved in the isolated branch and must preserve the complete cumulative test
pool. After merge, production rollout requires a separately approved lifecycle.
The recovered credential remains valid independently of code rollout unless
exposure is suspected.

## Agent details

### State

PR #31 contains the completed Gmail repair and recovered credential evidence.
Current `main` at `04b05a1de49662b7cb6787f544fdfd67c08ca138` is merged
locally. The sole `packages/e2e/README.md` conflict was additive: the Gmail
branch documented safe Python gates and Gmail regression coverage, while `main`
documented reusable-reviewer workflow coverage. The resolution preserves both.
Focused Gmail and full managed gates pass on merge commit `fbbe69f`. One retained
replacement reviewer found no actionable issue in the complete merged diff. The
previous exact-commit review of `7a23b26` is superseded by this merge; the final
commit will receive the required terminal fresh review and remote checks without
further in-diff bookkeeping. Production deployment remains unrun because the
repository has no safe configured Gmail promotion/rollback lifecycle.

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
8. Merge current `main`, resolve the cumulative E2E README conflict by preserving
   both branches' managed-lifecycle documentation, rerun all required gates, and
   review the complete merged diff before restoring review readiness.

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
- After merging current `main`, focused Gmail validation passed 166 safe tests,
  Ruff, compilation, and diff checks.
- The post-merge complete managed lifecycle passed 242 workspace tests (112
  hooks, 26 cumulative E2E, 61 calendar, 43 secure Gmail), 166 safe Gmail tests,
  292 mapped OpenClaw tests, and one candidate browser test; cleanup passed.

Required for the current mainline refresh:

- Commit and push this final bookkeeping, run the required terminal fresh review
  on the exact commit, confirm PR #31 is mergeable, and wait for remote checks.
  Record those post-commit results only in issue #15.

### Rollout and rollback

Current handoff:

1. Commit and push this final in-diff bookkeeping.
2. Obtain a clean terminal review of the exact commit without changing the diff,
   and confirm PR #31 is mergeable with green checks.
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
- Terminal review found no actionable issue on `7a23b26`; merging newer `main`
  invalidates that exact-commit result.
- The prior reviewer handle is unavailable. One independent replacement will be
  retained for the complete merged-diff remediation loop, followed by the
  required terminal fresh exact-commit review.
- Current-main conflict resolution is additive and preserves Gmail lifecycle
  coverage plus the reusable-reviewer workflow coverage added by `main`.
- Post-merge focused and managed validation is green.
- The retained replacement reviewer examined the complete current diff after the
  merge and found no actionable issue. Residual limitations are the documented
  absence of production deployment and intentional exclusion of live mutation
  tests.

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
- [x] Fetch current `main` and identify the sole README merge conflict.
- [x] Merge current `main` and preserve cumulative lifecycle documentation.
- [x] Rerun focused Gmail and complete managed validation.
- [x] Complete the retained replacement-reviewer loop.
- [x] Finalize in-diff bookkeeping for the conflict-free handoff commit.
