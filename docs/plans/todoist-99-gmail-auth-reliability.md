# Fix recurring Gmail authentication failures

Status: Reviewing final correction
Issue: https://github.com/coletaylor788/puddles/issues/99
Last updated: 2026-08-18

## Human section

### Design

Gmail keeps failing because the earlier repair never reached the default branch or the running service. Production still asks a Homebrew Python process to read the OAuth credential through macOS Keychain. An interpreter upgrade can remove that process from the saved access list, which leaves a background tool waiting on an approval prompt nobody can see. A past manual recovery path also truncated the OAuth record, so repeating that recovery is unsafe.

The repair uses a stable operating-system process to read and update one exact Keychain item. Each operation has a short deadline and returns a clear error instead of hanging. Long OAuth records are preserved, refresh writes keep the existing access rules, concurrent refreshes cannot replace newer credentials, and invalid or scope-reduced records are rejected. A missing item means the account is signed out. A present but unreadable or malformed item returns a specific recovery error instead of looking missing. Blocking authentication work stays outside the shared request loop.

Fresh remote installation exposed a separate compatibility boundary. The server still uses the stable first-generation Python SDK API, but its dependency range admitted the new second-generation SDK, which removed that API. The package now stays on the supported major line until a separate migration changes the server and protocol together. The shared test pool enforces that boundary so clean environments cannot silently select an incompatible SDK.

### Status

The dependency correction is complete. A fresh environment selects the supported SDK line, and focused checks plus the complete managed test lifecycle pass without source overrides.

The retained reviewer is rechecking the complete updated diff. A new exact candidate and terminal review follow. Nothing needs Cole's input.

## Agent section

### State

- Phase: Retained full-diff review
- Repository: `coletaylor788/puddles`
- Todoist task: `6hHwPPrxrg2FQP9V`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/99`
- Pull request: `https://github.com/coletaylor788/puddles/pull/100`
- Current branch: `coletaylor788-fix-gmail-authentication`
- Superseded tracker: issue 15 and PR 31 remain open, stale, and conflicting.

### Scope and acceptance criteria

- Explain why the earlier reliability work did not prevent the current failure.
- Replace executable-version-sensitive Keychain access with bounded exact-item operations.
- Preserve complete OAuth JSON, refresh credentials, access rules, and required effective scopes.
- Keep blocking authentication and credential work off the shared request loop.
- Surface missing, denied, malformed, timed-out, invalid, and narrowed credential states explicitly.
- Keep fresh installs on an MCP SDK major version compatible with the server API.
- Add focused tests and committed regressions to the shared integration pool.
- Pass focused component checks and the complete managed integration lifecycle.
- Complete independent adversarial review, remote checks, landing, and default-branch verification.
- Do not expose credentials, mutate a live mailbox in automation, or edit the configured primary checkout.

### Architecture and decisions

- Root cause: PR 31 contains the earlier Keychain repair but was never merged. Current `origin/main` and production still use Python `keyring`.
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
- Constrain `mcp` to `>=1.0.0,<2.0.0`. A clean installation now resolves `1.29.0`; remote CI selected incompatible `2.0.0` from the prior open-ended range.
- Keep a cumulative manifest regression that asserts the supported upper bound remains present.
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
- [x] Constrain the Python MCP SDK to the compatible major line and document the boundary.
- [x] Add a cumulative regression for fresh-install compatibility.
- [ ] Close stale issue 15 and PR 31 as superseded after the replacement lands.

### Validation

- Fresh isolated install: `mcp 1.29.0` selected from `>=1.0.0,<2.0.0`.
- Passed with the fresh environment: `169` safe Gmail tests, Gmail Ruff, and Python compilation.
- Passed: `5` focused tests in `packages/e2e/tests/gmail-keychain.test.ts` and E2E TypeScript lint.
- Passed: `node packages/e2e/bin/openclaw-test-env.mjs ci` using the fresh environment without a source-path override.
- Managed lifecycle result: `311` workspace tests, `169` safe Gmail tests, `471` mapped OpenClaw tests, and `1` candidate test passed. Build, lint, compilation, patch application, prompt snapshot checks, and cleanup also passed.
- Remote PR 100 on superseded commit `043dc6a`: all CodeQL checks passed; cumulative failed because the former range selected `mcp 2.0.0`.
- Pending: retained-reviewer recheck and a new terminal exact-commit review.
- Safety constraint: tests must not send mail, change mailbox state, print credential values, or edit the configured primary checkout.

### Rollout and rollback

- The corrected candidate passes fresh-install and complete managed validation.
- Repository research found no snapshotting, atomic, rollback-capable Gmail production promotion path. The running service loads the package from the configured primary checkout, which this worker must not edit.
- Production deployment is not run. Do not replace the missing lifecycle with a manual copy or primary-checkout edit.
- Land the repository fix after new review and remote gates, then report the production rollout limitation.
- The existing recovered OAuth credential remains independent of code rollout and must not be replaced unless validation proves it unusable.

### Review log

- The prior candidate received an extended retained-review loop and a clean terminal review at `264cf75`, but later base changes made PR 31 conflicting.
- The first current-branch reviewer found one medium-severity issue: malformed Keychain data was collapsed into the same `None` result as a missing item.
- The accepted format-error fix has focused, server-boundary, shared-pool, and documentation coverage.
- The replacement retained reviewer found no significant issue after that fix.
- Fresh terminal review found no actionable issue on `043dc6a2fd39106cc1135418785f836cfb676c14`.
- Remote fresh-install CI then exposed the incompatible open-ended SDK range. The upper bound and cumulative regression now pass locally in a clean environment.
- The retained reviewer is rechecking the complete updated diff. The terminal exact-commit review must repeat afterward.

### Checklist

- [x] Todoist tracking comment points to issue 99.
- [x] Issue 99 uses the required plan link, Summary, and Status format.
- [x] Research identifies the root cause and current runtime boundary.
- [x] Human and Agent sections describe the same current design.
- [x] Focused Keychain repair is ported without stale tracker artifacts.
- [x] Committed regression covers the recurring Keychain failure.
- [x] Malformed credentials are distinct from missing credentials.
- [x] Fresh installs stay on the compatible MCP SDK major line.
- [x] Focused and complete managed validation pass after remote remediation.
- [ ] Replacement retained-worker review is clean on the new candidate.
- [ ] Exact candidate receives a new clean terminal review.
- [ ] Pull request is remotely green, mergeable, and merged.
- [ ] Default branch contains the repair.
- [x] Missing safe production rollout lifecycle is recorded.
- [ ] Issue and Todoist task are ready for Cole's review.
