# Fix recurring Gmail authentication failures

Status: Sealing the durable migration candidate
Issue: https://github.com/coletaylor788/puddles/issues/99
Last updated: 2026-08-20

## Human section

### Design

Gmail authentication failed repeatedly because its Keychain item trusted a Homebrew Python executable whose identity changes when Homebrew replaces it. Gmail works now because the current Python happens to be trusted by the old item. That survives a gateway restart, but it can fail again after the next Python update.

The durable path copies the authorized-user credential into a separate Keychain item that trusts the stable macOS security executable. The copy runs once through the currently trusted legacy Python, validates the credential before writing it, verifies the exact result through a fresh stable read, refuses to overwrite different data, never prints the token, and leaves the old item untouched for rollback. The Gmail runtime reads only the new item after promotion.

Promotion builds an immutable Gmail runtime from the exact reviewed revision. It proves the release contents before activation, updates only Gmail configuration while holding the gateway's shared lock, restarts the gateway, and makes a read-only profile request without printing account or mailbox content. Durable snapshots and phase records let normal failure or the next invocation restore the prior Gmail configuration. The shared OpenClaw lock has a kernel-backed stale-recovery guard so concurrent deployers cannot remove one another's live locks.

### Status

Patched OpenClaw is deployed and healthy. Gmail currently works before and after a gateway restart through the legacy item and the current Homebrew Python. Direct stable access to that old item still times out, so the current recovery is not durable.

The separate stable-item migration, runtime guidance, immutable deployment, rollback, and shared integration coverage are green. Retained review is clean. The exact migration candidate still needs terminal review, updated remote checks, production migration, immutable promotion, restart validation, merge, and post-merge verification.

## Agent section

### State

- Phase: Seal terminal-review candidate
- Repository: `coletaylor788/puddles`
- Branch: `coletaylor788-fix-gmail-authentication`
- Pull request: `https://github.com/coletaylor788/puddles/pull/102`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/99`
- Todoist task: `6hHwPPrxrg2FQP9V`
- Todoist label: `agent`
- Production OpenClaw: patched candidate deployed and healthy.
- Production Gmail: legacy configuration active and read-only profile checks pass.
- Durable Keychain item: not created.
- Immutable Gmail release: prepared predecessor rolled back; durable candidate not promoted.

### Scope and acceptance criteria

- Identify why Gmail works again without the requested interactive Keychain change.
- Remove dependence on a versioned Homebrew Python identity.
- Preserve the old credential and current configuration as rollback state.
- Refuse malformed source credentials and conflicting target credentials.
- Keep credential bytes out of output, logs, process environment, files, and repository artifacts.
- Build and activate the Gmail runtime from the exact reviewed revision.
- Serialize deployment and configuration writes with the gateway's shared lock.
- Recover normal failure, process death, damaged release state, and interrupted reconciliation.
- Prove gateway health and a fresh read-only Gmail profile before and after a gateway restart.
- Add focused tests and committed regressions to the cumulative integration pool.
- Complete clean retained and terminal reviews, remote checks, production validation, merge, and post-merge checks.

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

- [x] Landed the bounded Keychain backend, refresh isolation, malformed credential handling, and Python MCP SDK compatibility fix in PR 100.
- [x] Added immutable Gmail release preparation, manifest verification, atomic activation, durable phase state, rollback, crash recovery, and config conflict reconciliation.
- [x] Replaced custom config and deployment stale-lock handling with the patched shared OpenClaw lock.
- [x] Added the kernel stale-reclaim guard patch, deterministic contention regression, patch documentation, and materialized-code candidate check.
- [x] Added direct pnpm and Corepack package-manager resolution to OpenClaw deployment.
- [x] Diagnosed the current production success as renewed legacy Python trust.
- [x] Added the non-destructive migration from `gmail-mcp` to `gmail-mcp-stable`.
- [x] Updated runtime, documentation, tests, and recovery messages for the stable service.
- [ ] Seal and terminal-review the final candidate.
- [ ] Push the exact reviewed candidate and obtain green remote checks.
- [ ] Create and verify the real stable Keychain item.
- [ ] Promote the immutable Gmail runtime and prove restart durability.
- [ ] Merge PR 102 and verify the landed result.

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
- Production legacy profile passed in `172 ms`, then passed in `152 ms` after a gateway restart.
- A fresh `/usr/bin/security` read of legacy service `gmail-mcp` still timed out after five seconds.
- Pending: terminal review, updated PR checks, live stable-item verification, immutable promotion, post-restart profile smoke, and post-merge checks.

### Rollout and rollback

- Preserve the deployed patched OpenClaw package and its recovery snapshot at `~/.openclaw-deploy-backups/20260819T093708Z-33553`.
- Preserve the failed Gmail promotion recovery state at `~/.openclaw-deploy-backups/gmail-mcp/20260819T093911Z-36448`.
- Do not mutate production until terminal review and updated remote checks approve the exact candidate.
- Run `gmail_mcp.scripts.migrate_legacy_keychain` under the trusted legacy interpreter with the reviewed source on `PYTHONPATH`.
- Verify `gmail-mcp-stable` through a fresh `/usr/bin/security` read with output redirected away.
- Promote the same candidate with `scripts/mac-mini/deploy-gmail-mcp.py`.
- Require gateway health and the read-only profile smoke. Restart the gateway and repeat a fresh profile smoke.
- The old `gmail-mcp` item remains unchanged. Deployment snapshots preserve the old Gmail configuration. Failed promotion automatically restores or reconciles that configuration and requires gateway health.
- Recheck the PR head, base, and required checks before merge. Merge only the exact production-validated candidate, then verify `main` and post-merge checks.

### Review log

- Retained full-diff review resolved material findings in release identity, crash durability, directory sync, manifest integrity, config reconciliation, stale-lock takeover, patched dependency materialization, whole-deployment locking, and package-manager selection.
- Fresh terminal review found no actionable issue on deployment candidate `5d44fa46a5ae25e32014ae5fe900d211563bb69b`.
- Production promotion proved the OpenClaw deployment and Gmail rollback paths. It also exposed that the old Keychain item still blocks the stable reader.
- Durability follow-up added the separate stable item. Retained review found recovery guidance still named the rollback item.
- Recovery guidance now derives from `KEYCHAIN_SERVICE`; parser and tool-boundary regressions name `gmail-mcp-stable`.
- Retained review found no significant issue through remediation commit `2f5feacd670436da70add64a9ba11c65b1fceb42`.
- Pending: fresh terminal review of the exact final candidate.

### Checklist

- [x] Tracking comment, issue, and plan follow the required contract.
- [x] Current production success and remaining failure mode are explained.
- [x] Stable migration is non-destructive, collision-safe, and secret-safe.
- [x] Immutable promotion and automatic rollback are implemented.
- [x] Shared lock stale recovery is race-safe and covered by integration tests.
- [x] Focused and cumulative validation pass.
- [x] Retained full-diff review is clean after remediation.
- [ ] Fresh terminal review is clean on the exact candidate.
- [ ] The exact candidate is pushed and remote checks are green.
- [ ] `gmail-mcp-stable` is created and verified in production.
- [ ] Immutable Gmail promotion and post-restart profile smoke pass.
- [ ] PR 102 is merged and post-merge checks pass.
- [ ] Final plan, issue, and Todoist handoff are current.
