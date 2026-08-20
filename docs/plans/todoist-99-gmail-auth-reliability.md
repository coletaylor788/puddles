# Fix recurring Gmail authentication failures

Status: Done and ready for review
Issue: https://github.com/coletaylor788/puddles/issues/99
Last updated: 2026-08-20

## Human section

### Design

Gmail authentication failed repeatedly because its Keychain item trusted a Homebrew Python executable whose identity changes when Homebrew replaces it. Gmail later started working because the current Python happened to regain access to the old item. A gateway restart proved that state was usable, but a direct system read still failed, so another Python update could break it again.

The durable path keeps the old credential for rollback and copies it into a separate Keychain item that trusts the stable macOS security executable. The copy validates the credential before writing it, verifies the exact result through a fresh stable read, refuses to overwrite different data, and never prints the token. The promoted Gmail runtime reads only the new item.

Production now runs an immutable Gmail release built from the reviewed revision. Promotion updates only Gmail configuration while holding the gateway's shared lock, records durable rollback state, restarts the gateway, and makes a read-only profile request without printing account or mailbox content. The shared lock has kernel-backed stale recovery so concurrent deployers cannot remove one another's live locks.

### Status

The durable credential and immutable Gmail release are active. Fresh system access, gateway health, and the read-only Gmail profile pass before and after an independent gateway restart. The old credential and prior configuration remain available for rollback.

The change is merged. Pull request checks, post-merge security checks, and the full cumulative integration workflow are green. The work is done and ready for Cole to review.

## Agent section

### State

- Phase: Complete
- Repository: `coletaylor788/puddles`
- Pull request: `https://github.com/coletaylor788/puddles/pull/102`
- Merge commit: `7b4f3cee5a1b3b89c143bc6ede67c858eb1fa2a2`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/99`
- Todoist task: `6hHwPPrxrg2FQP9V`
- Todoist target label: `ready_for_review`
- Production OpenClaw: patched package deployed and healthy.
- Production Gmail: immutable release `8b135c0f5f98f468dc8c0b461864a608d6b9ad7b` active.
- Active credential service: `gmail-mcp-stable`.
- Rollback credential service: `gmail-mcp`, unchanged.

### Scope and acceptance criteria

- [x] Explain why Gmail worked again without the requested interactive Keychain change.
- [x] Remove dependence on a versioned Homebrew Python identity.
- [x] Preserve the old credential and prior configuration as rollback state.
- [x] Refuse malformed source credentials and conflicting target credentials.
- [x] Keep credential bytes out of output, logs, process environment, files, and repository artifacts.
- [x] Build and activate Gmail from the exact reviewed revision.
- [x] Serialize deployment and configuration writes with the gateway's shared lock.
- [x] Recover normal failure, process death, damaged release state, and interrupted reconciliation.
- [x] Prove gateway health and a fresh read-only Gmail profile before and after restart.
- [x] Add focused tests and committed regressions to the cumulative integration pool.
- [x] Complete clean retained and terminal reviews, remote checks, production validation, merge, and post-merge checks.

### Architecture and decisions

- `servers/gmail-mcp/src/gmail_mcp/config.py` keeps `gmail-mcp` as `LEGACY_KEYCHAIN_SERVICE` and selects `gmail-mcp-stable` as `KEYCHAIN_SERVICE`.
- `servers/gmail-mcp/src/gmail_mcp/scripts/migrate_legacy_keychain.py` reads the old item through the trusted interpreter, validates authorized-user JSON, checks for an existing target, writes the new item with `/usr/bin/security` trusted, and verifies exact read-back.
- Migration is non-destructive. An identical target is idempotent, a different target is an error, and the source remains available for rollback.
- `servers/gmail-mcp/src/gmail_mcp/keychain.py` uses bounded `/usr/bin/security` reads. `auth.py` and `keychain.py` derive recovery guidance from the active service name.
- `scripts/mac-mini/deploy-gmail-mcp.py` builds tracked source into an immutable release, records content and modes, syncs publication and recovery state, updates Gmail config under the shared lock, validates health, and restores or reconciles on failure.
- `scripts/mac-mini/openclaw-config-lock.mjs` exposes the gateway's shared file-lock implementation to the Python deployer.
- `docs/openclaw-setup/patches/file-lock-stale-reclaim-guard.patch` adds a Darwin kernel-exclusive guard around stale inspection and removal in the shared lock package.
- The OpenClaw deploy lifecycle applies all patches before frozen dependency materialization and accepts direct pnpm or Corepack.
- Production smoke calls only the Gmail profile operation and does not emit PII.

### Implementation

- [x] Landed bounded Keychain access, refresh isolation, malformed credential handling, and Python MCP SDK compatibility in PR 100.
- [x] Added immutable Gmail release preparation, manifest verification, atomic activation, durable phase state, rollback, crash recovery, and config conflict reconciliation.
- [x] Replaced custom config and deployment stale-lock handling with the patched shared OpenClaw lock.
- [x] Added the kernel stale-reclaim guard patch, deterministic contention regression, patch documentation, and materialized-code candidate check.
- [x] Added direct pnpm and Corepack package-manager resolution to OpenClaw deployment.
- [x] Diagnosed production recovery as renewed legacy Python trust.
- [x] Added and ran the non-destructive migration from `gmail-mcp` to `gmail-mcp-stable`.
- [x] Updated runtime, documentation, tests, and recovery messages for the stable service.
- [x] Promoted and restart-validated the exact reviewed immutable release.
- [x] Merged PR 102 and verified the landed result.

### Validation

- Safe Gmail suite: `175` passed.
- Stable migration unit coverage proves create and verify, idempotency, collision refusal, malformed source rejection, and secret-free output.
- Shared stable migration regressions: `2` passed.
- Focused migration, Keychain, deployment, patch, and plan tests: `52` passed.
- Ruff, Python compilation, shell and Node syntax, TypeScript lint, and diff checks passed.
- Managed lifecycle command: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `343` workspace tests, `175` Gmail tests, `472` mapped OpenClaw tests, and `2` candidate tests passed.
- The candidate checks prove the installed shared lock contains the kernel stale-reclaim guard.
- An isolated temporary macOS Keychain proved a fresh item trusted for `/usr/bin/security` can be created and read by a new process without exposing its value.
- Production diagnosis proved legacy profile access before and after restart while direct `/usr/bin/security` access to `gmail-mcp` timed out.
- Production migration created `gmail-mcp-stable`; a fresh system read passed and a repeat migration returned `already-present`.
- Promotion smoke passed credentials and profile checks.
- After an independent gateway restart, gateway health and a second fresh credentials and profile smoke passed.
- PR 102 CodeQL and cumulative checks passed on exact candidate `8b135c0f5f98f468dc8c0b461864a608d6b9ad7b`.
- `main` CodeQL run `32332993798` and cumulative integration run `32332994301` passed on merge commit `7b4f3cee5a1b3b89c143bc6ede67c858eb1fa2a2`.

### Rollout and rollback

- Patched OpenClaw remains healthy. Its recovery snapshot is `~/.openclaw-deploy-backups/20260819T093708Z-33553`.
- The earlier failed Gmail promotion remains recorded at `~/.openclaw-deploy-backups/gmail-mcp/20260819T093911Z-36448`.
- Successful durable promotion recovery state is `~/.openclaw-deploy-backups/gmail-mcp/20260820T044327Z-39006`.
- Active config points to immutable release `~/.local/share/puddles/gmail-mcp/releases/8b135c0f5f98f468dc8c0b461864a608d6b9ad7b`.
- The old `gmail-mcp` Keychain item remains unchanged.
- Rollback can restore the previous Gmail configuration and use the old credential through its trusted legacy interpreter.
- Failed or interrupted deployment restores or reconciles Gmail configuration and requires gateway health before returning.

### Review log

- Retained full-diff review resolved material findings in release identity, crash durability, directory sync, manifest integrity, config reconciliation, stale-lock takeover, patched dependency materialization, whole-deployment locking, and package-manager selection.
- Fresh terminal review found no actionable issue on deployment candidate `5d44fa46a5ae25e32014ae5fe900d211563bb69b`.
- Production promotion proved the OpenClaw deployment and Gmail rollback paths. It also exposed that the old Keychain item still blocked the stable reader.
- Durability follow-up added the separate stable item. Retained review found recovery guidance still named the rollback item.
- Recovery guidance now derives from `KEYCHAIN_SERVICE`; parser and tool-boundary regressions name `gmail-mcp-stable`.
- Retained review found no significant issue through remediation commit `2f5feacd670436da70add64a9ba11c65b1fceb42`.
- Fresh terminal review found no significant issue on exact final candidate `8b135c0f5f98f468dc8c0b461864a608d6b9ad7b`.

### Checklist

- [x] Tracking comment, issue, and plan follow the required contract.
- [x] Current production success and remaining failure mode are explained.
- [x] Stable migration is non-destructive, collision-safe, and secret-safe.
- [x] Immutable promotion and automatic rollback are implemented.
- [x] Shared lock stale recovery is race-safe and covered by integration tests.
- [x] Focused and cumulative validation pass.
- [x] Retained and terminal reviews are clean.
- [x] Exact candidate remote checks are green.
- [x] `gmail-mcp-stable` is created and verified in production.
- [x] Immutable Gmail promotion and post-restart profile smoke pass.
- [x] PR 102 is merged and post-merge checks pass.
- [x] Final plan, issue, and Todoist handoff are current.
