# Fix macOS Keychain timeouts

- **Status:** In progress - blocked on interactive OAuth reauthentication
- **Issue:** https://github.com/coletaylor788/puddles/issues/15
- **Last updated:** 2026-07-25
- **Owner:** Gmail repair agent

## Human design

### Problem

Gmail tools began timing out before any Gmail API request because macOS
Keychain authorization trusted a Homebrew Python executable that an upgrade
replaced. Background access then waited on an invisible approval prompt. An
early migration also used the Keychain password prompt for OAuth JSON, which
silently truncated the stored credential to 128 bytes.

### Outcome

Gmail reads and refresh writes use a stable bounded Keychain command rather than
a versioned interpreter. Keychain failures return an actionable tool error
within five seconds instead of wedging the MCP request. Complete OAuth JSON is
preserved, normal tool schemas stay unchanged, and the repaired credential is
validated only with read-only Gmail operations.

### Approach

Replace Python `keyring` with exact-item `/usr/bin/security` calls. Cache parsed
credentials for 60 seconds, trust the stable command only when creating an
item, and update an existing item's data without modifying its ACL. Use the
hexadecimal data option for long OAuth JSON because prompted password input is
limited to 128 bytes. Retry a concurrent create as a content-only update.

Keep this focused Gmail change separate from the read-only per-user helper used
by other consumers. Reauthenticate once through the isolated candidate, add a
committed regression to the cumulative integration pool, and use only the
configured managed lifecycle for rollout.

### Safety and rollout

Keychain access remains local and exact-scoped to service `gmail-mcp` and
account `token`. Reads capture the value only in memory. Writes briefly expose
the hexadecimal value to same-user process inspection; this does not widen the
accepted same-user boundary because same-user code can already invoke the
trusted system command to read the item. Values are never logged or written to
files, and sensitive timeout errors suppress command arguments.

Automated tests use mocks or temporary Keychain items and never mutate Gmail.
Live Gmail checks are read-only. Rollout requires the cumulative managed E2E
lifecycle, reviewed commits, and the repository's configured promotion path.
On production failure, restore the preceding revision through the same
lifecycle and preserve the newly issued credential unless exposure is
suspected.

## Agent details

### State

The backend, focused tests, long-value regression, documentation, and initial
independent reviews are implemented locally. Stable access to the exact
Keychain item completes without interaction, but its current 128-byte value is
invalid JSON. Cole must complete one browser OAuth flow through the candidate
before read-only candidate validation. Current remote `main` now provides the
mandatory cumulative E2E lifecycle, which must be integrated after rebasing.

### Scope and acceptance criteria

- Diagnose the pre-API timeout and document why it appeared after a runtime
  upgrade.
- Remove the executable-version-sensitive `keyring` dependency.
- Bound every Keychain operation to five seconds.
- Treat a missing item as unauthenticated and all other Keychain failures as
  explicit errors.
- Cache valid Keychain credentials for 60 seconds and observe replacements
  after expiry.
- Preserve OAuth JSON values longer than 128 bytes.
- Never modify ACLs during token refresh writes.
- Handle concurrent item creation without discarding a completed OAuth flow.
- Keep successful MCP tool inputs and outputs backward compatible.
- Pass focused tests, lint, compilation, the cumulative managed E2E lifecycle,
  adversarial review, candidate read-only Gmail validation, and configured
  production read-only validation.

### Architecture and decisions

- Use `/usr/bin/security` as the single Gmail Keychain backend; do not add the
  read-only helper as a second backend because OAuth refresh requires writes.
- Select exactly `gmail-mcp` / `token`.
- Use exit status 44 only for item-not-found and status 45 only for the
  create-race retry.
- Cache only successfully parsed `Credentials`; invalid data remains
  unauthenticated.
- Create with `-T /usr/bin/security`; update with `-U` and no `-T`.
- Use `-X` for arbitrary-length data. The value is hex-encoded in argv under
  the documented same-user boundary.
- Suppress sensitive command arguments from timeout exception chaining.
- Translate `KeychainAccessError` only at the MCP tool boundary so failures are
  logged as failed calls and returned as structured errors.
- Leave the environment-variable backend unchanged.
- Skip live mailbox-mutation tests in automation; use isolated cumulative
  coverage plus explicit read-only Gmail smoke tests.

### Implementation

1. Add the bounded Keychain command wrapper, exact-item read/write helpers, and
   explicit `KeychainAccessError`.
2. Add short-lived credential caching and cache updates after successful OAuth
   persistence.
3. Create trusted items once, perform content-only refresh updates, and retry a
   duplicate create without touching ACLs.
4. Preserve long OAuth JSON through `security -X` and sanitize sensitive
   timeout failures.
5. Remove `keyring`, update MCP error translation, and document migration,
   security boundary, rollout, and rollback.
6. Add focused unit coverage and a committed cumulative `packages/e2e`
   regression after rebasing current `main`.
7. Reauthenticate, validate credential shape without values, and run candidate
   and production read-only Gmail smoke tests.

### Validation

Completed locally:

- `CI=true .venv/bin/python -m pytest tests/ -q` - 106 passed and 19 live
  mailbox tests skipped before the latest sanitization-only adjustment.
- `.venv/bin/ruff check src/ tests/` - passed.
- `.venv/bin/python -m compileall -q src tests` - passed.
- `git diff --check` - passed.
- Exact existing-item read - exit 0 in about 20 ms without a prompt.
- Temporary `security -X` fixture - exact 312-byte create and 362-byte
  content-only update round trips passed.
- Multiple independent reviews found recurring ACL updates, create races,
  long-value truncation, and stale security documentation; all were corrected.

Still required:

- Rerun focused gates after the latest sanitization change.
- Complete interactive OAuth and validate only JSON shape and required fields.
- Run a candidate read-only Gmail API call.
- Add the cumulative E2E regression and run
  `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Obtain clean adversarial reviews after final bookkeeping and against the
  exact handoff commit.
- Promote through the configured lifecycle and run read-only production
  validation with rollback on failure.

### Rollout and rollback

Rollout:

1. Complete OAuth in the isolated issue #15 candidate.
2. Confirm the Keychain value is complete authorized-user JSON without printing
   values.
3. Pass candidate read-only Gmail access, focused gates, cumulative E2E, and
   adversarial review.
4. Commit, push, and open the focused Gmail pull request.
5. Promote only through the configured repository lifecycle.
6. Restart only through that lifecycle and run a read-only production
   `list_emails` smoke.

Rollback:

1. Preserve the original production failure evidence.
2. Restore the preceding reviewed server revision through the same lifecycle.
3. Restart and revalidate production health and read-only Gmail access.
4. Keep the newly reauthenticated credential unless exposure is suspected; it
   replaces an already-invalid value and is not a code artifact.

### Review log

- Initial reviews found missing cache invalidation and incomplete MCP error
  translation; both were fixed.
- A later review proved that applying `-T` during every refresh can itself
  prompt; refresh writes now preserve the ACL.
- Follow-up reviews found and resolved a concurrent-create race, the broader
  same-user trust boundary, 128-byte prompted-write truncation, and
  contradictory documentation.
- The next review must invoke the repository adversarial-review workflow after
  cumulative E2E integration and OAuth validation.

### Checklist

- [x] Diagnose the runtime-upgrade Keychain timeout.
- [x] Implement bounded exact-item Keychain reads and writes.
- [x] Add credential caching and expiry behavior.
- [x] Preserve ACLs during refresh writes.
- [x] Handle concurrent creation safely.
- [x] Preserve long OAuth JSON values.
- [x] Translate Keychain failures at the MCP tool boundary.
- [x] Remove the Python `keyring` dependency.
- [x] Update user, architecture, migration, security, and rollback docs.
- [x] Add focused success, error, timeout, cache, write, and race tests.
- [ ] Rebase current remote `main` and add cumulative E2E coverage.
- [ ] Pass focused tests, lint, compilation, and diff checks after rebase.
- [ ] Complete browser OAuth reauthentication.
- [ ] Validate credential shape and candidate read-only Gmail access.
- [ ] Pass the complete managed cumulative E2E lifecycle.
- [ ] Obtain clean adversarial reviews and exact-commit terminal review.
- [ ] Commit, push, and open the focused Gmail pull request.
- [ ] Promote through the configured lifecycle.
- [ ] Pass production read-only validation or roll back.
- [ ] Mark the plan and issue ready for review with final evidence.
