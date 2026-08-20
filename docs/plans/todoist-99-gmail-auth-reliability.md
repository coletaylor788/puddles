# Fix recurring Gmail authentication failures

Status: Complete, ready for review
Issue: https://github.com/coletaylor788/puddles/issues/99
Last updated: 2026-08-18

## Human section

### Design

Gmail kept failing because an earlier repair never reached the default branch or the running service. Production still asked a Homebrew Python process to read the OAuth credential through macOS Keychain. An interpreter upgrade could remove that process from the saved access list, leaving a background tool waiting on an approval prompt nobody could see. A past manual recovery path also truncated the OAuth record, so repeating that recovery was unsafe.

The landed repair uses a stable operating-system process to read and update one exact Keychain item. Each operation has a short deadline and returns a clear error instead of hanging. Long OAuth records are preserved, refresh writes keep the existing access rules, concurrent refreshes cannot replace newer credentials, and invalid or scope-reduced records are rejected. A missing item means the account is signed out. A present but unreadable or malformed item returns a specific recovery error instead of looking missing. Blocking authentication work stays outside the shared request loop.

A clean remote install also exposed an SDK compatibility boundary. The server uses the stable first-generation Python SDK API, so the package now stays on that supported major line until a separate migration changes the server and protocol together. The shared test pool enforces the boundary.

### Status

The repair is merged into the default branch. Pull request checks and post-merge integration and security runs are green. The stale repair pull request and issue are closed.

The repository work is done and ready for Cole to review. Todoist has the result and is labeled for review. Production deployment was not run because the repository has no safe Gmail promotion and rollback path.

## Agent section

### State

- Phase: Complete
- Repository: `coletaylor788/puddles`
- Todoist task: `6hHwPPrxrg2FQP9V`
- Todoist label: `ready_for_review`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/99`
- Pull request: `https://github.com/coletaylor788/puddles/pull/100`
- Landed merge: `7bcfab89225a5291d2f405af530ce0015d2e5a90`
- Superseded issue 15 and PR 31: closed.

### Scope and acceptance criteria

- Explain why the earlier reliability work did not prevent the current failure.
- Replace executable-version-sensitive Keychain access with bounded exact-item operations.
- Preserve complete OAuth JSON, refresh credentials, access rules, and required effective scopes.
- Keep blocking authentication and credential work off the shared request loop.
- Surface missing, denied, malformed, timed-out, invalid, and narrowed credential states explicitly.
- Keep fresh installs on an MCP SDK major version compatible with the server API.
- Add focused tests and committed regressions to the shared integration pool.
- Pass focused, managed, remote, and post-merge validation.
- Land the reviewed candidate and verify the default branch contains it.
- Do not expose credentials, mutate a live mailbox in automation, or edit the configured primary checkout.

### Architecture and decisions

- Root cause: PR 31 held the earlier Keychain repair but never merged, so production retained Python `keyring`.
- Runtime evidence: an exact `/usr/bin/security` lookup completed in about 11 ms. The configured Gmail process used the primary checkout under Homebrew Python 3.11.16.
- `/usr/bin/security` now targets the canonical login Keychain and exact `gmail-mcp` / `token` selectors.
- Item-not-found is unauthenticated. Empty, non-UTF-8, invalid JSON, invalid schema, and invalid scopes raise a sanitized `CredentialFormatError`.
- Permission, timeout, and command failures raise explicit `KeychainAccessError` results.
- New items trust the stable system command. Updates preserve existing access rules. Hexadecimal input prevents long JSON truncation.
- Valid credentials are cached briefly. Replacement and refresh persistence are serialized across processes.
- OAuth and refresh work use cumulative deadlines, compare-before-write, cancellation, and bounded draining.
- Actual granted scopes are authoritative. Invalid or narrowed refreshed credentials are rejected.
- The environment-token backend remains compatible.
- `mcp` is constrained to `>=1.0.0,<2.0.0`; a clean install resolves `1.29.0`.
- The shared integration pool covers Keychain behavior, malformed credentials, and the SDK upper bound.
- Production rollout is unavailable because no snapshotting, atomic, rollback-capable Gmail deployment path exists.

### Implementation

- [x] Trace the prior repair, token path, runtime wiring, and current failure.
- [x] Port the focused Keychain repair onto current `main`.
- [x] Preserve long credentials and access rules.
- [x] Serialize refresh and replacement writes across processes.
- [x] Bound Keychain, refresh, OAuth, and request-loop work.
- [x] Distinguish malformed credentials from a missing item.
- [x] Constrain fresh installs to the supported SDK major line.
- [x] Add focused and cumulative regression coverage.
- [x] Update Gmail and integration documentation.
- [x] Close stale issue 15 and PR 31 as superseded.

### Validation

- Fresh isolated install selected `mcp 1.29.0`.
- `169` safe Gmail tests passed with live integration tests excluded.
- Gmail Ruff and Python compilation passed.
- `5` focused shared Gmail tests and E2E TypeScript lint passed.
- `9` plan and issue writing contract tests passed.
- The local managed lifecycle passed `311` workspace tests, `169` safe Gmail tests, `471` mapped OpenClaw tests, and `1` candidate test.
- Retained full-diff review and terminal exact-commit review found no actionable issue on the landed candidate.
- PR 100 cumulative integration and all CodeQL checks passed.
- Post-merge Integration run `32208780771` and CodeQL run `32208780421` passed on `7bcfab8`.
- `origin/main` contains exact candidate `b691f4de39eb073b2bfd9c61e62814d06fdda101`.

### Rollout and rollback

- Repository code and tests are landed.
- Production deployment was not run. The configured service loads from the primary checkout, and this worker did not edit it.
- The repository has no safe Gmail promotion and rollback lifecycle. Manual copying or primary-checkout edits are not acceptable substitutes.
- The existing recovered OAuth credential remains independent of code rollout and was not replaced.
- A future production rollout needs recorded recovery state, atomic installation, service restart, read-only Gmail health checks, and automatic rollback on failure.

### Review log

- The first current-branch reviewer found one medium issue: malformed Keychain data looked the same as a missing item.
- The accepted fix added an explicit format error with unit, tool-boundary, shared-pool, and documentation coverage.
- The retained reviewer found no significant issue after remediation.
- The first terminal candidate was clean, but remote CI exposed an incompatible open-ended SDK range.
- The supported SDK upper bound and cumulative regression passed in a fresh environment.
- The retained reviewer and a fresh terminal reviewer found no actionable issue on the corrected candidate.
- Remote and post-merge checks are green.

### Checklist

- [x] Tracking comment, issue, and plan follow the required contract.
- [x] Root cause and runtime boundary are documented.
- [x] Keychain repair and regressions are landed.
- [x] Malformed and missing credentials are distinct.
- [x] Fresh installs stay on the compatible SDK major line.
- [x] Focused, managed, remote, and post-merge checks pass.
- [x] Retained and terminal reviews are clean.
- [x] Pull request 100 is merged and the default branch is verified.
- [x] Missing safe production rollout lifecycle is recorded.
- [x] Superseded Gmail trackers are closed.
- [x] Final plan and issue say the work is ready for Cole to review.
- [x] Todoist result is posted and `agent` is replaced with `ready_for_review`.
