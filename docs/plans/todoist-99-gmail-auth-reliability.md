# Fix recurring Gmail authentication failures

Status: Reviewing deployment lifecycle
Issue: https://github.com/coletaylor788/puddles/issues/99
Last updated: 2026-08-18

## Human section

### Design

Gmail kept failing because the running service still used an old package from the configured repository checkout. The code repair is merged, and Cole has asked to deploy it because Gmail is currently unavailable.

The deployment path builds a separate immutable Gmail runtime from the exact reviewed revision. Before changing production, it saves the complete gateway configuration with owner-only permissions. It then changes only the secure Gmail command and working directory, restarts the gateway, confirms gateway health, and makes one read-only Gmail profile request without printing account or mailbox content.

If installation, restart, health, or Gmail validation fails, the process restores the exact prior configuration, restarts the old gateway, and confirms gateway health before returning the original failure. The old Gmail runtime is broken, but it still protects the rest of the gateway from a worse deployment.

### Status

The deployment helper and shared regression pass focused checks and the complete managed test lifecycle. Production is still untouched.

Independent full-diff review is next. Nothing needs Cole's input.

## Agent section

### State

- Phase: Independent review
- Repository: `coletaylor788/puddles`
- Todoist task: `6hHwPPrxrg2FQP9V`
- Todoist label: `agent`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/99`
- Feature pull request: `https://github.com/coletaylor788/puddles/pull/100`
- Deployment source revision: pending final candidate and merge.
- Production state: unchanged.

### Scope and acceptance criteria

- Deploy the landed Gmail authentication repair from an exact reviewed `main` revision.
- Do not edit the configured repository's primary checkout.
- Preserve the complete current gateway configuration before replacement.
- Build a unique release outside the checkout and replace configuration atomically.
- Restore the prior configuration automatically if install, restart, health, or Gmail validation fails.
- Keep production validation read-only. Do not send mail, archive, label, download attachments, or mutate mailbox state.
- Verify the gateway remains healthy and a bounded Gmail profile request succeeds.
- Add a committed deployment regression to the shared integration pool.
- Complete validation, retained review, terminal review, remote checks, merge, promotion, and post-promotion verification.

### Architecture and decisions

- `scripts/mac-mini/deploy-gmail-mcp.py` verifies a full commit SHA, an exact clean source worktree, and the expected Gmail source directory.
- Candidate releases live under `~/.local/share/puddles/gmail-mcp/releases/<revision>`, not under the configured primary checkout.
- Candidate creation copies the Gmail server without caches or a prior virtual environment, creates a new virtual environment, installs runtime dependencies, checks the MCP tool surface, records the resolved package set, and atomically renames staging into the release directory.
- `~/.openclaw/openclaw.json` is loaded as a regular JSON file. The complete original bytes are stored with mode `0600` under `~/.openclaw-deploy-backups/gmail-mcp/`.
- Promotion atomically rewrites only `gmailMcpCommand`, `gmailMcpArgs`, and `gmailMcpCwd` for `secure-gmail`. Unrelated config and secrets are preserved.
- `openclaw gateway restart` and the payload-free gateway health command are reused from existing host recovery patterns.
- `gmail_mcp.scripts.production_smoke` constructs the service and reads only the authenticated Gmail profile. It emits only a boolean result.
- A deployment lock prevents concurrent promotion. Signals during candidate validation trigger rollback, while signals received during rollback are deferred until recovery reaches a safe state.
- Failed candidate releases and recovery snapshots remain for diagnosis.
- Re-running the exact active revision is idempotent and performs health plus read-only smoke without replacing config again.

### Implementation

- [x] Read current production configuration, service process, Gmail package path, and deployment docs.
- [x] Trace existing snapshot, atomic replacement, restart, health, and rollback patterns.
- [x] Define exact candidate, recovery state, production paths, and read-only smoke behavior.
- [x] Add `scripts/mac-mini/deploy-gmail-mcp.py`.
- [x] Add `gmail_mcp.scripts.production_smoke`.
- [x] Add focused smoke tests and shared promotion and rollback regression coverage.
- [x] Update secure Gmail deployment documentation and the shared-pool coverage list.

### Validation

- Passed: all `171` safe Gmail tests.
- Passed: `7` cumulative Gmail deployment tests covering success, smoke failure rollback, install failure, restart failure, malformed config, interruption, concurrent denial, recovery cleanup, and unrelated config preservation.
- Passed: `21` focused shared Gmail deployment, Keychain, and plan contract tests.
- Passed: Gmail and deploy-helper Ruff checks, Python compilation, E2E TypeScript lint, and diff check.
- Passed: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `318` workspace tests, `171` safe Gmail tests, `471` mapped OpenClaw tests, and `1` candidate test. Build, lint, compilation, patch application, prompt snapshots, and cleanup also passed.
- Pending: retained full-diff review and terminal exact-commit review.
- Pending: exact-candidate production promotion and read-only validation.
- Safety constraint: automated and production validation must not mutate Gmail or expose credential values.

### Rollout and rollback

- No production mutation occurs until the helper is merged, its exact revision is remotely approved, and recovery state can be created.
- Promotion builds the release before config mutation, checks the current gateway, snapshots config, switches the Gmail runtime, restarts, and runs gateway plus Gmail read-only health.
- Any failure after config mutation restores the byte-for-byte config snapshot, restarts the prior gateway, and verifies gateway health.
- Rollback failures are reported in addition to the original deployment failure.
- The prior runtime, failed candidate, and recovery snapshot remain after deployment.

### Review log

- The code repair received retained and terminal review before merging.
- The prior closeout correctly reported that no safe Gmail deployment path existed.
- Cole reopened the task and authorized deployment, but did not waive recovery or production-validation requirements.
- The new deployment helper reuses established gateway restart, health, durable recovery, and atomic replacement patterns without deploying the whole OpenClaw package.
- Independent review of the complete deployment change is starting.

### Checklist

- [x] Tracking comment still points to issue 99.
- [x] Issue 99 follows the required plan link, Summary, and Status contract.
- [x] Plan was reopened before deployment research or production mutation.
- [x] Production topology and rollback helpers are understood.
- [x] Deployment tooling and cumulative regression are implemented.
- [x] Focused and full managed validation pass.
- [ ] Retained and terminal reviews are clean.
- [ ] Deployment pull request is green and merged.
- [ ] Exact landed candidate is promoted.
- [ ] Read-only production validation passes.
- [ ] Final plan, issue, and Todoist handoff are current.
