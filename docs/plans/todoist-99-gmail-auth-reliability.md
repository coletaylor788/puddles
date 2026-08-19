# Fix recurring Gmail authentication failures

Status: Rechecking remediated deployment
Issue: https://github.com/coletaylor788/puddles/issues/99
Last updated: 2026-08-18

## Human section

### Design

Gmail kept failing because the running service still used an old package from the configured repository checkout. The code repair is merged, and Cole has asked to deploy it because Gmail is currently unavailable.

The deployment path builds a separate Gmail runtime from tracked source in the exact reviewed revision. A cryptographic manifest proves that a prepared release has not changed before reuse. Immediately before promotion, the helper joins the gateway's configuration lock, saves the complete current config with owner-only permissions, and changes only the secure Gmail runtime fields.

The helper restarts the gateway, confirms health, and makes one read-only Gmail profile request without printing account or mailbox content. A failed deployment restores the prior Gmail fields while preserving unrelated config changes. It refuses to overwrite a concurrent Gmail edit. The old Gmail runtime is broken, but it still protects the rest of the gateway from a worse deployment.

### Status

Both independent-review findings are fixed. Focused checks and the complete managed test lifecycle pass again, and production remains untouched.

The retained reviewer is rechecking the complete remediated diff. Nothing needs Cole's input.

## Agent section

### State

- Phase: Retained reviewer recheck
- Repository: `coletaylor788/puddles`
- Todoist task: `6hHwPPrxrg2FQP9V`
- Todoist label: `agent`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/99`
- Initial implementation commit: `849a2d6a52e8cec176a10547514e14ae5cdca7cb`
- Production state: unchanged.

### Scope and acceptance criteria

- Deploy the landed Gmail authentication repair from an exact reviewed `main` revision.
- Do not edit the configured repository's primary checkout.
- Build only tracked Gmail source from the exact revision.
- Verify prepared runtime content before reuse.
- Join OpenClaw's config lock at the promotion boundary.
- Abort promotion rather than overwrite a concurrent config change.
- Restore prior Gmail fields while preserving unrelated changes after a failed deployment.
- Refuse rollback overwrite when Gmail fields changed concurrently.
- Keep production validation read-only and bounded.
- Add committed release-identity and config-concurrency regressions to the shared integration pool.
- Complete review, remote checks, merge, promotion, and post-promotion verification.

### Architecture and decisions

- Source extraction uses `git archive <revision> -- servers/gmail-mcp`. Ignored credentials, tokens, caches, and untracked worktree files cannot enter a release.
- Each release records a SHA-256 manifest of regular files and symlink targets. Reuse recomputes and compares the complete runtime manifest.
- Releases remain under `~/.local/share/puddles/gmail-mcp/releases/<revision>`.
- Candidate preparation installs runtime dependencies, checks the MCP tool surface, records resolved packages, writes the content manifest, and atomically renames staging into place.
- The helper uses the same `<openclaw.json>.lock` sidecar protocol as OpenClaw config mutations during the final read, snapshot, and conditional write.
- Promotion compares live bytes immediately before atomic replacement.
- Recovery stores original bytes, prior Gmail field presence and values, and the exact promoted bytes.
- Rollback restores byte-for-byte config when nothing changed. If unrelated config changed, it restores only the Gmail runtime fields. A concurrent Gmail edit blocks rollback overwrite.
- Gateway restart, health, read-only profile smoke, deployment locking, signal deferral, and retained recovery state remain unchanged.

### Implementation

- [x] Implement the initial rollback-capable deployment helper, smoke check, tests, and docs.
- [x] Replace working-tree copying with tracked-object extraction.
- [x] Add and verify a cryptographic release manifest.
- [x] Move config loading and snapshotting to the promotion boundary.
- [x] Join OpenClaw's config lock and add conditional promotion replacement.
- [x] Preserve unrelated concurrent config changes during rollback.
- [x] Refuse rollback when Gmail runtime fields changed concurrently.
- [x] Add ignored-file, release tampering, config lock, conditional write, unrelated change, and Gmail conflict regressions.
- [x] Update documentation for release identity and config concurrency guarantees.

### Validation

- Passed after remediation: all `171` safe Gmail tests.
- Passed after remediation: `12` deployment tests covering success, ignored files, manifest tampering, install failure, restart failure, smoke failure, malformed config, interruption, deployment lock, config lock, conditional write conflict, unrelated config preservation, and Gmail rollback conflict.
- Passed after remediation: `26` focused shared deployment, Keychain, and plan contract tests.
- Passed after remediation: Ruff, Python compilation, E2E TypeScript lint, and diff check.
- Passed after remediation: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `323` workspace tests, `171` safe Gmail tests, `471` mapped OpenClaw tests, and `1` candidate test. Build, lint, compilation, patch application, prompt snapshots, and cleanup also passed.
- Pending: retained reviewer recheck and terminal exact-commit review.
- Pending: exact-candidate production promotion and read-only validation.

### Rollout and rollback

- Production remains unchanged until remediation is reviewed, merged, and remotely green.
- Release preparation occurs before config mutation and only consumes tracked source.
- Promotion holds the shared config lock and uses conditional atomic replacement.
- Rollback preserves unrelated concurrent config changes and refuses concurrent Gmail edits.
- Gateway and Gmail validation requirements remain the same.
- Failed candidate releases and recovery snapshots remain for diagnosis.

### Review log

- The code repair received retained and terminal review before merging.
- Cole reopened the task and authorized deployment without waiving recovery requirements.
- Retained deployment review found a high-severity stale-config race because config was read before environment preparation.
- Retained deployment review found a high-severity release-identity gap because ignored files could be copied and retained releases lacked content verification.
- Both findings were accepted and fixed. Expanded regressions and the complete managed lifecycle are green.
- The same retained reviewer is rechecking the complete current diff.

### Checklist

- [x] Tracking comment, issue, and reopened plan follow the required contract.
- [x] Deployment tooling and cumulative regression are implemented.
- [x] Both retained-review findings are fixed with regression coverage.
- [x] Focused and full managed validation pass after remediation.
- [ ] Retained and terminal reviews are clean.
- [ ] Deployment pull request is green and merged.
- [ ] Exact landed candidate is promoted.
- [ ] Read-only production validation passes.
- [ ] Final plan, issue, and Todoist handoff are current.
