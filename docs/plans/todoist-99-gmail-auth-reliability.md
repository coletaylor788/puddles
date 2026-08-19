# Fix recurring Gmail authentication failures

Status: Landing candidate
Issue: https://github.com/coletaylor788/puddles/issues/99
Last updated: 2026-08-18

## Human section

### Design

Gmail keeps failing because the earlier repair never reached the default branch or the running service. Production still asks a Homebrew Python process to read the OAuth credential through macOS Keychain. An interpreter upgrade can remove that process from the saved access list, which leaves a background tool waiting on an approval prompt nobody can see. A past manual recovery path also truncated the OAuth record, so repeating that recovery is unsafe.

The repair uses a stable operating-system process to read and update one exact Keychain item. Each operation has a short deadline and returns a clear error instead of hanging. Long OAuth records are preserved, refresh writes keep the existing access rules, concurrent refreshes cannot replace newer credentials, and invalid or scope-reduced records are rejected. A missing item means the account is signed out. A present but unreadable or malformed item returns a specific recovery error instead of looking missing. Blocking authentication work stays outside the shared request loop.

The earlier candidate already implemented and reviewed most of this design, but its pull request became stale and conflicted before merge. The focused repair is now ported onto current code without its stale tracker. Automated coverage uses temporary Keychain items and read-only boundaries. It never changes a live mailbox.

### Status

Implementation, focused checks, the complete managed test lifecycle, and independent review are green. No actionable review finding remains.

The exact landing candidate is being sealed for terminal review and remote integration. Production rollout remains unavailable because the repository has no safe Gmail promotion and rollback path. Nothing needs Cole's input.

## Agent section

### State

- Phase: Seal exact landing candidate
- Repository: `coletaylor788/puddles`
- Todoist task: `6hHwPPrxrg2FQP9V`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/99`
- Current branch: `coletaylor788-fix-gmail-authentication`
- Superseded tracker: issue 15 and PR 31 remain open, stale, and conflicting.

### Scope and acceptance criteria

- Explain why the earlier reliability work did not prevent the current failure.
- Replace executable-version-sensitive Keychain access with bounded exact-item operations.
- Preserve complete OAuth JSON, refresh credentials, access rules, and required effective scopes.
- Keep blocking authentication and credential work off the shared request loop.
- Surface missing, denied, malformed, timed-out, invalid, and narrowed credential states explicitly.
- Add focused tests and a committed regression to the shared integration pool.
- Pass focused component checks and the complete managed integration lifecycle.
- Complete independent adversarial review, remote checks, landing, and default-branch verification.
- Do not expose credentials, mutate a live mailbox in automation, or edit the configured primary checkout.

### Architecture and decisions

- Root cause: PR 31 contains the earlier repair but was never merged. Current `origin/main` and production still use Python `keyring`.
- Runtime evidence: an exact `/usr/bin/security` lookup succeeds in about 11 ms. The configured Gmail process runs from the primary checkout under Homebrew Python 3.11.16.
- Use `/usr/bin/security` against the canonical login Keychain and exact `gmail-mcp` / `token` selectors.
- Treat item-not-found as unauthenticated.
- Raise `CredentialFormatError` for empty, non-UTF-8, invalid JSON, invalid schema, and invalid scope records. It subclasses `KeychainAccessError` so the existing MCP boundary returns a sanitized authentication-unavailable result.
- Treat permission, timeout, and command failures as explicit `KeychainAccessError` results.
- Create items with stable command trust. Update data without replacing existing access rules. Use hexadecimal input so long JSON cannot be truncated.
- Cache valid parsed credentials briefly and serialize replacement and refresh persistence across processes.
- Use cumulative deadlines, compare-before-write, cancellation, and bounded drain behavior for OAuth and refresh work.
- Treat actual granted scopes as authoritative and reject invalid or narrowed refreshed credentials.
- Preserve the environment-token backend.
- Port commits `26557b0` through `c9dbabe` from `origin/pr-31` and resolve the current test-pool documentation additively.
- Keep issue 99 and this plan as the active source of truth. Remove the stale component plan carried by the old commit series.

### Implementation

- [x] Read Gmail server documentation, prior auth plans, issue 15, and PR 31.
- [x] Trace token persistence, refresh behavior, request-loop boundaries, runtime wiring, and the current Keychain access path.
- [x] Confirm the earlier repair is absent from `origin/main` and production.
- [x] Port the focused Gmail repair onto current `origin/main`.
- [x] Resolve the shared-pool documentation conflict while preserving current coverage.
- [x] Remove the duplicate stale component plan and keep issue 99 as the active tracker.
- [x] Preserve Gmail documentation, CI wiring, focused tests, and cumulative regression coverage from the reviewed repair.
- [x] Distinguish malformed credentials from a missing Keychain item at the parser and MCP tool boundary.
- [ ] Close stale issue 15 and PR 31 as superseded after the replacement lands.

### Validation

- Passed after review fix: `169` safe Gmail tests with live integration tests explicitly excluded.
- Passed after review fix: Gmail Ruff checks and Python compilation.
- Passed after review fix: `4` focused tests in `packages/e2e/tests/gmail-keychain.test.ts`.
- Passed after review fix: TypeScript lint for `packages/e2e`.
- Passed after review fix: `node packages/e2e/bin/openclaw-test-env.mjs ci` with `PYTHONPATH` fixed to this worktree's Gmail source.
- Managed lifecycle result after review fix: `310` workspace tests, `169` safe Gmail tests, `471` mapped OpenClaw tests, and `1` candidate test passed. Build, lint, compilation, patch application, prompt snapshot checks, and cleanup also passed.
- Pending: terminal exact-commit review and remote checks.
- Safety constraint: tests must not send mail, change mailbox state, print credential values, or edit the configured primary checkout.

### Rollout and rollback

- The landing candidate passes the complete managed test lifecycle.
- Repository research found no snapshotting, atomic, rollback-capable Gmail production promotion path. The running service loads the package from the configured primary checkout, which this worker must not edit.
- Production deployment is not run. Do not replace the missing lifecycle with a manual copy or primary-checkout edit.
- Land the repository fix after terminal review and remote gates, then report the production rollout limitation.
- The existing recovered OAuth credential remains independent of code rollout and must not be replaced unless validation proves it unusable.

### Review log

- The prior candidate received an extended retained-review loop and a clean terminal review at `264cf75`, but later base changes made PR 31 conflicting.
- The first current-branch reviewer found one medium-severity issue: malformed Keychain data was collapsed into the same `None` result as a missing item.
- Accepted fix: only status 44 returns no credential. Invalid encoding, empty content, invalid JSON, invalid required fields, and invalid scopes now raise a sanitized format error through the existing authentication-unavailable tool result.
- Unit, server-boundary, shared-pool, and documentation coverage assert the corrected distinction.
- Focused and complete managed validation pass after the fix.
- The replacement retained reviewer checked the complete remediated diff and found no significant issue. The only residual gap is live ACL migration, refresh, and production rollout, which remain outside automated credential and deployment safety boundaries.
- Terminal review of the exact landing candidate is pending.

### Checklist

- [x] Todoist tracking comment points to issue 99.
- [x] Issue 99 uses the required plan link, Summary, and Status format.
- [x] Research identifies the root cause and current runtime boundary.
- [x] Human and Agent sections describe the same current design.
- [x] Focused repair is ported without stale tracker artifacts.
- [x] Committed regression covers the recurring failure.
- [x] Initial focused and complete managed validation passed.
- [x] Accepted independent-review finding is fixed with regression coverage.
- [x] Complete managed lifecycle passes after review remediation.
- [x] Replacement retained-worker review is clean.
- [ ] Exact candidate receives a clean terminal review.
- [ ] Pull request is remotely green, mergeable, and merged.
- [ ] Default branch contains the repair.
- [x] Missing safe production rollout lifecycle is recorded.
- [ ] Issue and Todoist task are ready for Cole's review.
