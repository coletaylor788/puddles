# Todoist CLI issue filing

**Status:** Ready for terminal review
**Issue:** [#40](https://github.com/coletaylor788/puddles/issues/40)
**Last updated:** 2026-07-30

## Human design

### Problem

The Todoist CLI capability is landed, but its credential setup incorrectly
treats `~/.openclaw/.env` as the canonical token source. Puddles already has a
shared mode-600 SecretRef store at `~/.openclaw/secrets.json`, established by
the Mac mini setup work, and repository guidance says long-lived credentials
belong there. The current command and documentation bypass that architecture.

### Outcome

One repository command runs Todoist OAuth login, captures the token without
printing it, atomically stores it at `providers.todoist.apiKey` in the shared
store, and maps the Todoist skill to a file SecretRef. The shared store is the
only operator-managed source of truth. Because OpenClaw's Docker env schema
accepts strings rather than SecretRefs, the installer creates and owns the
minimum marked `.env` runtime projection required by the sandbox and removes it
during rollback.

### Approach

Add a safe host-side login/store script, change the installer to require the
shared store and derive the sandbox projection, extend isolated tests for token
capture, atomic store updates, projection lifecycle, rollback, and denial
paths, and update the root architecture, cross-cutting secret architecture, and
Todoist setup guide. Run the full managed lifecycle and review loop, then land
and verify the change before performing credentialed live validation.

### Safety and rollout

The token never appears in command arguments, stdout, repository files, test
fixtures, recovery JSON, or logs. The login script captures `td auth token view`
into a local shell variable and sends it over stdin to an atomic mode-600 JSON
update. Tests use fake tokens and mock commands. The installer fails closed for
missing, malformed, insecure, or ambiguous shared-store configuration, marks
the derived `.env` projection, refuses to overwrite an unmanaged projection,
and removes only its own projection on rollback.

## Agent details

### State

The Todoist capability, safe-feature-development 1.6.0 help-request contract,
deterministic patch-test fix, and final landed-state plan are on `main` with
green post-merge checks. Research traced the prior shared-store work to Plan
016 and guide 03: provider `local`, JSON file
`~/.openclaw/secrets.json`, credentials under `providers.<service>`, atomic
mode-600 updates, file SecretRefs, and `openclaw secrets reload`. The current
Todoist `.env` source conflicts with that architecture; implementation of the
shared-store alignment is complete. Focused and full managed validation pass;
independent complete-diff review is clean. Its non-blocking legacy-upgrade
observation is addressed with an explicit, non-printing `.env` migration recipe;
final recheck identified a concrete dual-agent lifecycle edge. The global
projection must remain while any configured agent consumes it and be removed
only after the final consumer is rolled back. That correction and a mode-600
migration temp file are implemented. Focused and full managed validation pass;
final complete-diff review is clean. In-diff bookkeeping is final; the exact
landing candidate was terminal-reviewed and pushed, but the root README did not
yet expose the shared-secret rule. That documentation gap is being corrected;
the root guidance is implemented and 23 focused tests, E2E lint, and diff checks
pass. The changed candidate requires complete-diff re-review and a fresh terminal
review. Complete-diff re-review is clean. Terminal review identified one
rotation gap: updating the canonical shared token must refresh an already
managed sandbox projection. The store command now refreshes only an existing
marked projection, leaves pre-install `.env` untouched, and preserves unrelated
lines. Final review identified that persistent agent-scoped containers must be
recreated after projection refresh to consume the new token. That correction is
implemented for every configured Todoist env consumer. Focused and full managed
validation pass; final complete-diff re-review is clean. In-diff bookkeeping is
final.

### Scope and acceptance criteria

- Add a single command that:
  - runs `td auth login`;
  - captures the stored token without printing or placing it in argv;
  - atomically writes `providers.todoist.apiKey` to the configured shared JSON
    provider with mode 600;
  - maps `skills.entries.todoist-cli.apiKey` to
    `{source:"file",provider:"local",id:"/providers/todoist/apiKey"}`;
  - reloads/audits secrets without displaying credential values.
  - refreshes an existing marked sandbox projection after token rotation without
    creating an unmanaged projection.
  - recreates every configured agent consuming `TODOIST_API_TOKEN` after a
    projection refresh so persistent containers receive the rotated value.
- Make the installer use the configured `local` file provider and
  `/providers/todoist/apiKey` as its canonical credential input.
- Treat `.env` only as a marked, installer-owned compatibility projection for
  `sandbox.docker.env`; never instruct operators to edit it with a token.
- Preserve unrelated `.env` lines and shared-store keys.
- Fail closed rather than overwrite an unmanaged `TODOIST_API_TOKEN` line.
- Remove the marked projection during failed installation and explicit rollback
  only when no configured agent still references it, without deleting the
  canonical shared secret.
- Preserve all existing image, skill, config, recovery, and no-clobber behavior.
- Document the repository-wide rule that long-lived secrets use the shared
  store and any unavoidable runtime projection is derived, minimal, marked,
  lifecycle-owned, and never canonical.
- Surface that rule in the root `README.md` architecture so future components
  encounter it before choosing a credential design.
- Add focused and cumulative regressions; never authenticate or mutate live
  Todoist in automated tests.
- Land the exact reviewed candidate, verify `main` and post-merge checks, then
  provide the concise live command and validation steps.

### Architecture and decisions

- The established provider is `secrets.providers.local` with `source: "file"`,
  `mode: "json"`, and path `~/.openclaw/secrets.json`.
- Todoist uses JSON pointer `/providers/todoist/apiKey`, matching the existing
  `providers.<service>` convention.
- `skills.entries.todoist-cli.apiKey` is a supported SecretRef surface and
  records the canonical mapping for audit and host-side skill execution.
- `agents.list[].sandbox.docker.env` accepts only strings. It cannot directly
  hold a SecretRef, and skill `apiKey` injection does not apply inside Docker.
  Therefore the installer derives `TODOIST_API_TOKEN` into
  `~/.openclaw/.env` immediately before sandbox config/recreation.
- The derived projection is adjacent to a stable marker comment. An existing
  token without that marker is unmanaged and blocks installation. Recovery
  state never stores its value. Rollback refreshes the configured agent list
  after removing the selected agent's env reference; it removes the marked
  global projection only when no agent remains a consumer.
- The canonical shared secret is not removed by rollback or uninstall.
- A reusable repository command is preferable to a copy-pasted Python one-liner:
  it makes the safe operation reviewable, testable, and easy to repeat.
- The login/store command refreshes `.env` only when the installer marker is
  already present. First installation remains the installer's responsibility;
  rotation updates both canonical source and its existing derived runtime copy,
  then recreates each configured consumer sandbox.

### Implementation

1. Added `scripts/mac-mini/store-openclaw-todoist-token.sh` with OAuth login,
   atomic shared-store update, managed-projection refresh on rotation, SecretRef
   mapping, reload, consumer sandbox recreation, and redacted status.
2. Updated `install-openclaw-todoist-cli.sh` to resolve the local provider,
   validate the shared store, create/remove the marked `.env` projection, and
   preserve projection state through failure and rollback. Final remediation
   adds consumer-aware removal for explicit multi-agent installations.
3. Extended focused E2E fixtures for the store command and installer projection
   lifecycle, including provider, JSON, permission, unmanaged-state, reinstall,
   failure-cleanup, preservation, and rollback paths.
4. Updated guide 03's shared-secret architecture and guide 05's authentication,
   install, verification, and rollback instructions.
5. Added a migration recipe that first stores the canonical token, then removes
   only the prior unmanaged `.env` line without printing it. Its temporary file
   is created mode 600 before any unrelated `.env` content is written.
6. Add the shared-secret source-of-truth and projection rules to the root
   architecture documentation.
7. Document the host `td` prerequisite and rotation behavior.
8. Run focused tests and the complete managed lifecycle.
9. Complete retained/replacement full-diff review, terminal review, remote
   integration, merge, and post-merge verification.
10. Run the documented live login/store/install validation with Cole.

### Validation

Previously completed:

- landed Todoist implementation and safe-feature 1.6.0;
- 19 focused tests, TypeScript lint, locked image smoke, repeated full managed
  lifecycle, complete-diff review, terminal review, remote gates, merge, and
  post-merge checks;
- deterministic iMessage patch-test stabilization and landed-state plan
  follow-ups.

Required for this cycle:

- shell syntax, E2E TypeScript lint, and 24 focused login/store, installer, and
  write-sink tests;
- success, missing provider, missing secret, insecure permissions, malformed
  JSON, unmanaged projection, reinstall, install failure cleanup, and rollback;
- `node packages/e2e/bin/openclaw-test-env.mjs ci`: workspace build/lint, 112
  mcp-hooks tests, 81 e2e tests, 61 calendar tests, 43 Gmail tests, 470 mapped
  OpenClaw tests, one candidate test, and cleanup passed;
- complete-current-diff and exact-candidate terminal review;
- remote checks, merge, default-branch artifact verification, and post-merge
  checks;
- credentialed live login/store/install, read-only auth status, and one explicit
  low-risk routing check.

After adding the root README architecture, repeated 23 focused tests, E2E
TypeScript lint, and `git diff --check` successfully. The runtime diff is
unchanged from the full managed green candidate. Independent re-review verified
the README link, anchor, discoverability, provider-neutrality, and consistency
with guide 03, guide 05, and the implemented consumer-aware lifecycle.

### Rollout and rollback

After landing, run the repository login/store command, then the Todoist installer
dry-run and install commands. Verify the SecretRef shape without printing the
store, run read-only auth status, and file one explicit low-risk task. Installer
failure and rollback remove the marked `.env` projection and restore prior
OpenClaw config/sandbox state while retaining `providers.todoist.apiKey` as the
canonical credential. Remove that shared-store key only as a separate,
intentional credential-revocation action.

### Review log

Prior reviews found and remediated a shell-only token success-shaped failure,
the unclear requester-help contract, incomplete contract assertions, and a
clock-sensitive maintained patch test. All prior changes landed cleanly.
Current research confirms the shared store predates this feature and that
sandbox Docker env is outside OpenClaw's SecretRef credential surface. The
runtime projection is therefore explicit compatibility state, not a second
operator-managed secret source. Shared-store review returned clean. Its
non-blocking observation that older installs have an unmanaged `.env` line is
addressed by a safe migration recipe. Final recheck identified that per-agent
recovery cannot alone own one global projection; consumer-aware cleanup is
implemented and covered. The migration recipe now creates its temp file mode 600
before writing preserved `.env` content. Validation passes, and final
complete-current-diff review found no actionable defects. Terminal review
identified stale managed projection after token rotation as a concrete gap; it
is remediated with atomic refresh and an isolated regression. The host `td`
prerequisite and rotation behavior are documented. Final re-review identified
that persistent containers do not receive refreshed env until recreation;
consumer sandbox recreation is implemented and covered. Validation passes, and
final complete-current-diff review found no actionable defects.

### Checklist

- [x] Locate and verify the prior shared secret-store architecture.
- [x] Define the Todoist shared-store path and projection boundary.
- [x] Implement the login/store command.
- [x] Align installer projection and rollback behavior.
- [x] Update shared architecture and Todoist documentation.
- [x] Add focused and cumulative regressions.
- [x] Pass focused and full managed validation.
- [x] Complete initial independent review.
- [x] Add consumer-aware projection cleanup and regression.
- [x] Complete final focused and managed validation.
- [x] Complete final replacement review.
- [x] Add root README secret architecture guidance.
- [x] Revalidate the changed candidate.
- [x] Re-review the complete changed candidate.
- [x] Refresh an existing managed projection during token rotation.
- [x] Revalidate the updated candidate.
- [x] Recreate persistent consumer sandboxes after rotation.
- [x] Revalidate the final updated candidate.
- [x] Re-review the final updated candidate.
- [ ] Commit and terminal-review the exact candidate.
- [ ] Land and verify the exact candidate.
- [ ] Complete credentialed live validation.
