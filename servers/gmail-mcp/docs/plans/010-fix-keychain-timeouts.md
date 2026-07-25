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

The backend, focused tests, cumulative regression, documentation, and initial
independent reviews are implemented locally. The branch is rebased onto current
`main`, and the complete managed lifecycle passes. Stable access to the exact
Keychain item completes without interaction, but its current 128-byte value is
invalid JSON. Cole must complete one browser OAuth flow through the candidate
before read-only candidate validation.

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
- Offload authentication and service construction to the existing worker-thread
  boundary so a bounded slow Keychain call cannot freeze concurrent MCP I/O.
- Serialize credential refresh-and-persist with OAuth replacement so stale
  refreshes cannot overwrite newly authorized credentials, including across
  concurrent Gmail MCP processes.
- Bound OAuth browser waiting and refresh HTTP below their worker deadlines, and
  translate service-construction timeouts into structured tool errors.
- Treat valid non-object JSON as malformed credentials rather than allowing an
  SDK `AttributeError` to escape.
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
6. Offload synchronous authentication checks and service construction from the
   shared MCP event loop.
7. Add focused unit coverage and a committed cumulative `packages/e2e`
   regression that executes the stdlib-only Keychain module against a
   deny-by-default fake command.
8. Reauthenticate, validate credential shape without values, and run candidate
   and production read-only Gmail smoke tests.

### Validation

Completed locally:

- `CI=true .venv/bin/python -m pytest tests/ --ignore=tests/integration -q` -
  133 safe tests passed; live mailbox tests were not collected.
- `.venv/bin/ruff check src/ tests/` - passed.
- `.venv/bin/python -m compileall -q src tests` - passed.
- `git diff --check` - passed.
- Exact existing-item read - exit 0 in about 20 ms without a prompt.
- Temporary `security -X` fixture - exact 312-byte create and 362-byte
  content-only update round trips passed.
- Multiple independent reviews found recurring ACL updates, create races,
  long-value truncation, and stale security documentation; all were corrected.
- An adversarial review found bounded Keychain calls still blocked the shared
  event loop; authentication now uses the existing worker-thread bridge, with a
  focused concurrency regression.
- A fresh review found interactive OAuth blocking, stale-refresh overwrite, and
  mismatched refresh/worker timeout boundaries; deterministic regressions cover
  each corrected failure path.
- The next review found retry-aware and cross-process variants of those races,
  malformed JSON shapes, and missing cumulative coverage. Shared refresh
  deadlines, bounded background browser launch and token exchange, a
  cross-process lock plus compare-before-write, shape validation, and managed
  Python gates correct them.
- A third review found inherited CI values could enable live mailbox tests,
  same-process lock wait was outside its deadline, configurable lock roots could
  split serialization, late refresh responses could still persist, malformed
  object fields could escape, and OAuth timeout translation was incomplete.
  The managed gate now forces `CI=true` and excludes `tests/integration`
  explicitly; one absolute lock deadline and canonical path cover all waiters;
  late responses and malformed fields fail closed; and OAuth timeouts are
  structured failures.
- A fourth review found environment-controlled home paths could split the lock,
  environment credentials refreshed twice, library OAuth timeouts were not
  translated, multi-command Keychain writes reset their budget, and SDK-accepted
  malformed required fields looked authenticated. The lock now derives from
  the OS account home, refresh has one owner, browser/token timeouts are
  normalized, each Keychain write shares one deadline, and required authorized
  user fields must be non-empty strings.
- A fifth review found the declared OAuth dependency range did not always export
  its timeout type and binary Keychain corruption could fail during implicit
  subprocess decoding. Timeout normalization now uses the compatible base
  exception across the declared range, and Keychain output is captured as bytes
  and decoded explicitly so invalid UTF-8 is unauthenticated.
- `packages/e2e/tests/gmail-keychain.test.ts` - two isolated regressions passed,
  covering long create/update values, content-only refresh ACL behavior, bounded
  timeouts, and sensitive traceback sanitization.
- `node packages/e2e/bin/openclaw-test-env.mjs ci` - passed repository build and
  lint, 241 workspace tests (112 hooks, 25 cumulative E2E, 61 calendar, 43
  secure Gmail), the 133-test safe Gmail Python suite plus Ruff and compilation,
  289 mapped OpenClaw tests, and one candidate browser test; temporary worktree
  cleanup completed.

Still required:

- Complete interactive OAuth and validate only JSON shape and required fields.
- Run a candidate read-only Gmail API call.
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
- The first repository adversarial review found synchronous Keychain calls
  could freeze concurrent MCP I/O for five seconds; the calls are now offloaded
  and the focused and complete managed lifecycles pass.
- A fresh repository adversarial review found three additional concurrency
  boundaries: interactive OAuth blocking, stale refresh persistence, and an
  outer timeout shorter than refresh I/O. OAuth is now offloaded and
  inner-bounded, while credential refresh-and-store is serialized with OAuth
  replacement.
- The second fresh review found six retry, browser, cross-process, error-shape,
  and cumulative-gate gaps. The managed lifecycle now includes the complete safe
  Gmail Python suite, and the runtime uses inner operation deadlines,
  cross-process serialization, and compare-before-write persistence.
- The third fresh review found and corrected the final managed-test safety,
  absolute-deadline, canonical-lock, late-response, malformed-object, and OAuth
  timeout translation gaps.
- The fourth fresh review found and corrected canonical OS-account lock
  identity, duplicate environment refresh, concrete OAuth timeout classes,
  cumulative Keychain-write timing, and required-field validation.
- The fifth fresh review found and corrected declared-version OAuth timeout
  compatibility and binary Keychain corruption handling.
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
- [x] Keep slow Keychain access off the shared MCP event loop.
- [x] Prevent stale refreshes from overwriting OAuth replacement.
- [x] Bound OAuth and refresh work below their worker deadlines.
- [x] Serialize credential persistence across Gmail MCP processes.
- [x] Include Gmail Python tests and lint in the managed cumulative lifecycle.
- [x] Remove the Python `keyring` dependency.
- [x] Update user, architecture, migration, security, and rollback docs.
- [x] Add focused success, error, timeout, cache, write, and race tests.
- [x] Rebase current remote `main` and add cumulative E2E coverage.
- [x] Pass focused tests, lint, compilation, and diff checks after rebase.
- [ ] Complete browser OAuth reauthentication.
- [ ] Validate credential shape and candidate read-only Gmail access.
- [x] Pass the complete managed cumulative E2E lifecycle.
- [ ] Obtain clean adversarial reviews and exact-commit terminal review.
- [ ] Commit, push, and open the focused Gmail pull request.
- [ ] Promote through the configured lifecycle.
- [ ] Pass production read-only validation or roll back.
- [ ] Mark the plan and issue ready for review with final evidence.
