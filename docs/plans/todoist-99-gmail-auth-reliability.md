# Fix recurring Gmail authentication failures

Status: Reviewing stable Keychain migration
Issue: https://github.com/coletaylor788/puddles/issues/99
Last updated: 2026-08-18

## Human section

### Design

Gmail kept failing because the running service still used an old package from the configured repository checkout. The code repair is merged, and Cole has asked to deploy it because Gmail is currently unavailable.

The deployment path builds a separate Gmail runtime from tracked source in the exact reviewed revision. A cryptographic manifest proves that a prepared release has not changed before reuse. Immediately before promotion, the helper joins the gateway's configuration lock, saves the current and candidate configs with owner-only permissions, and records a durable deployment phase before replacing anything.

The helper restarts the gateway, confirms health, and makes one read-only Gmail profile request without printing account or mailbox content. Normal failure restores the prior Gmail fields while preserving unrelated changes. Recovery files and every new parent directory entry are synced before replacement. After power loss or process death, the next invocation reclaims only dead-owner locks, recovers the incomplete promotion, restarts and checks the prior gateway, then starts a new deployment.

### Status

Patched OpenClaw is deployed and healthy. Gmail works because production rolled back to the legacy keyring backend, and the current Homebrew Python binary is trusted by the old Keychain item. Fresh legacy profile calls pass before and after a gateway restart. A fresh stable system-command read still times out.

This is not durable. Replacing or upgrading that Python binary can revoke access again. The implemented migration creates a separate stable Keychain item and leaves the old item untouched for rollback. Recovery messages now derive from the active stable service, and complete validation is green.

## Agent section

### State

- Phase: Retained reviewer recheck
- Repository: `coletaylor788/puddles`
- Todoist task: `6hHwPPrxrg2FQP9V`
- Todoist label: `agent`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/99`
- Pre-crash-recovery commit: `0c6b57faebdaaae72ce1e99e827862b0d6dbcf6a`
- Production state: unchanged.

### Scope and acceptance criteria

- Build only tracked Gmail source from the exact reviewed revision.
- Verify prepared release content before reuse.
- Join OpenClaw's config lock at the promotion and rollback boundaries.
- Persist current and promoted config before replacement.
- Record durable deployment phases around promotion and validation.
- Recover incomplete promotion on the next invocation.
- Reclaim locks only when their recorded owner process is dead.
- Preserve unrelated config changes and refuse conflicting Gmail edits.
- Keep production validation read-only and bounded.
- Complete review, remote checks, merge, promotion, and post-promotion verification.

### Architecture and decisions

- Source extraction uses `git archive`; ignored and untracked files cannot enter releases.
- Published releases contain no Python bytecode. SHA-256 manifests cover every remaining regular file and symlink target, so later bytecode injection invalidates the release.
- Release manifests must also cover file and directory modes so executable and traversal permission damage triggers recovery.
- Metadata read, decode, and shape failures must all enter the same damaged-active-release recovery path.
- Every release regular file is fsynced, then every release directory is fsynced bottom-up before the manifest is published and the staging tree is renamed.
- Candidate releases remain under `~/.local/share/puddles/gmail-mcp/releases/<revision>`.
- OpenClaw's `<openclaw.json>.lock` sidecar protocol serializes config read, snapshot, and conditional write.
- Recovery stores `openclaw.json`, `promoted-openclaw.json`, `recovery.json`, and `deployment-state.json` with owner-only permissions.
- Every newly created recovery directory and ancestor is followed by an fsync of its parent directory.
- Durable states cover snapshot, prepared, promoted, complete, aborted, restoring, rolled-back, and recovered outcomes.
- Original and promoted snapshots are fsynced before live replacement.
- The deployment lock is a fully written temporary file atomically hard-linked into place. A dead owner can be reclaimed after PID and file-identity checks; a live or malformed owner blocks.
- Startup recovers exactly one incomplete deployment before source validation or candidate preparation.
- Startup also restores the prior runtime when a completed active release fails manifest verification.
- Crash recovery restores exact bytes when possible, otherwise restores only Gmail fields while preserving unrelated changes. Conflicting Gmail edits block overwrite.
- Any crash recovery conservatively restarts and health-checks the prior gateway.
- Normal rollback, signal deferral, gateway health, read-only profile smoke, and retained diagnosis state remain required.
- Completion must reacquire the config lock, verify Gmail still points at the candidate, and record completion under that lock.
- A concurrent Gmail edit during smoke must be preserved, loaded through a gateway restart, and reported as deployment failure.
- Reconciliation must remain nonterminal until the gateway restart and health check succeed.
- A later invocation must finish an interrupted reconciliation before considering another deployment.
- Normal rollback and crash recovery must also reconcile the gateway when a concurrent Gmail edit prevents config restoration.
- Missing secure Gmail entries and non-object Gmail config values are concurrent Gmail edits, not parser failures, after promotion.
- The shared config lock owner record must be fully written and fsynced before atomic publication.
- Config lock acquisition and stale-owner recovery must come from OpenClaw's own exported file-lock implementation rather than custom pathname reclamation.
- Whole-deployment serialization must use the same patched shared lock implementation.
- On macOS, stale sidecar removal must hold a kernel `O_EXLOCK` guard so only one reclaimer can inspect and remove a lock at a time.
- Production must deploy the patched OpenClaw package through its rollback-capable lifecycle before deploying the Gmail runtime that relies on the exported lock.
- OpenClaw dependencies must be installed with the frozen lockfile after the source patch stack changes dependency patches and lock hashes.
- Production package-manager invocation must work with either a direct pnpm binary or Corepack-provided pnpm.
- A successful production smoke requires the existing `gmail-mcp` Keychain item to trust `/usr/bin/security`; changing that ACL requires Cole's login-keychain password and interactive approval.
- A working Gmail tool is not durable evidence until the active bridge identity, credential backend, restart behavior, and fresh read-only request are confirmed.
- The durable migration must never print or write token data outside Keychain, must not overwrite an existing stable item, and must verify an exact in-memory round trip.
- Runtime credential errors must name `gmail-mcp-stable` and must not direct users to delete legacy rollback service `gmail-mcp`.
- Published releases must contain no bytecode and must run with bytecode writes disabled so all executable Python content remains inside the manifest.

### Implementation

- [x] Build from tracked Git objects and verify release manifests.
- [x] Join the shared config lock and handle concurrent config changes safely.
- [x] Persist promoted bytes before replacement.
- [x] Add durable deployment phase transitions.
- [x] Recover incomplete promotion before normal deployment.
- [x] Replace the deployment lock with an atomically published owner record.
- [x] Reclaim only dead deployment and config-lock owners.
- [x] Add SIGKILL recovery, durable state, dead-lock, tampering, ignored-file, and config conflict regressions.
- [x] Durably create and fsync recovery directory entries.
- [x] Add focused parent-directory fsync regression.
- [x] Update deployment documentation for directory durability.
- [x] Fsync every prepared release file and directory before publication.
- [x] Recover a damaged active completed release before refusing reuse.
- [x] Add release-tree fsync and damaged-active-release regressions.
- [x] Verify candidate Gmail config under lock after smoke before success.
- [x] Reconcile and fail when Gmail config changes during smoke.
- [x] Atomically publish the shared config lock owner record.
- [x] Remove bytecode before publication and disable runtime bytecode writes.
- [x] Add successful-smoke config conflict, lock publication, and bytecode injection regressions.
- [x] Add durable reconciling and superseded phase ordering.
- [x] Recover interrupted reconciliation on the next invocation.
- [x] Add SIGKILL reconciliation recovery regression.
- [x] Include file and directory modes in release manifests.
- [x] Treat unreadable release verification as corruption.
- [x] Add active executable-permission damage recovery regression.
- [x] Normalize metadata read, decode, and type failures as release corruption.
- [x] Add unreadable and non-object metadata recovery regressions.
- [x] Reconcile normal rollback conflicts before reporting failure.
- [x] Reconcile process-death recovery conflicts before reporting failure.
- [x] Add runtime reconciliation regressions for both conflict paths.
- [x] Classify structural Gmail changes as conflicts during completion.
- [x] Classify structural Gmail changes as conflicts during rollback and process-death recovery.
- [x] Add missing-entry and non-object reconciliation regressions.
- [x] Replace custom config-lock publication and reclamation with OpenClaw's lock API.
- [x] Add a two-process shared-lock contention regression.
- [x] Remove custom config-lock stale takeover code.
- [x] Patch OpenClaw's shared sidecar lock with a macOS kernel reclaim guard.
- [x] Add a multi-process stale-reclaimer contention regression.
- [x] Register the patch and test in the cumulative OpenClaw patch suite.
- [x] Document the shared lock patch and deployment order.
- [x] Move managed OpenClaw dependency install after patch application.
- [x] Materialize patched dependencies before production OpenClaw build.
- [x] Add candidate verification of installed fs-safe guard code.
- [x] Replace custom Gmail deployment lock with the shared lock holder.
- [x] Remove custom deployment stale-lock reclamation code.
- [x] Add two-process deployment-lock serialization regression.
- [x] Add one package-manager resolver used by install, build, and pack.
- [x] Cover both direct pnpm and Corepack fallback in deployment fixtures.
- [x] Promote patched OpenClaw through snapshot, migration, browser refresh, restart, and health.
- [x] Attempt Gmail promotion through release build, config snapshot, restart, read-only smoke, and automatic rollback.
- [x] Identify the active Gmail command, cwd, process start time, and source release.
- [x] Identify credential backend selection from environment names without reading values.
- [x] Test a bounded fresh legacy profile before and after gateway restart.
- [x] Confirm the exact stable system-command read still times out.
- [x] Determine the current path is legacy interpreter trust, not durable promotion.
- [x] Add a non-destructive legacy-to-stable Keychain migration tool.
- [x] Move the reviewed Gmail runtime to a new stable Keychain service.
- [x] Add migration, collision, secret-redaction, and rollback regression coverage.
- [x] Update setup and authentication documentation.
- [x] Derive malformed-credential guidance from the active service constant.
- [x] Add parser and tool-boundary regressions naming `gmail-mcp-stable`.
- [ ] Run migration under the currently trusted legacy interpreter.
- [ ] Promote the reviewed release and prove read-only access across restart.

### Validation

- Passed after final terminal remediation: all `171` safe Gmail tests.
- Passed after final terminal remediation: `19` deployment lifecycle tests and `33` focused deployment, Keychain, and plan contract tests.
- Passed after final terminal remediation: Ruff, Python compilation, TypeScript lint, and diff check.
- Passed after final terminal remediation: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `330` workspace tests, `171` safe Gmail tests, `471` mapped OpenClaw tests, and `1` candidate test.
- Passed after reconciliation remediation: all `171` safe Gmail tests.
- Passed after reconciliation remediation: `20` deployment lifecycle tests and `34` focused deployment, Keychain, and plan contract tests.
- Passed after reconciliation remediation: Ruff, Python compilation, TypeScript lint, and diff check.
- Passed after reconciliation remediation: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `331` workspace tests, `171` safe Gmail tests, `471` mapped OpenClaw tests, and `1` candidate test.
- Passed after permission remediation: all `171` safe Gmail tests.
- Passed after permission remediation: `21` deployment lifecycle tests and `35` focused deployment, Keychain, and plan contract tests.
- Passed after permission remediation: Ruff, Python compilation, TypeScript lint, and diff check.
- Passed after permission remediation: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `332` workspace tests, `171` safe Gmail tests, `471` mapped OpenClaw tests, and `1` candidate test.
- Passed after metadata remediation: all `171` safe Gmail tests.
- Passed after metadata remediation: `23` deployment lifecycle tests and `37` focused deployment, Keychain, and plan contract tests.
- Passed after metadata remediation: Ruff, Python compilation, TypeScript lint, and diff check.
- Passed after metadata remediation: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `334` workspace tests, `171` safe Gmail tests, `471` mapped OpenClaw tests, and `1` candidate test.
- Passed after rollback reconciliation remediation: all `171` safe Gmail tests.
- Passed after rollback reconciliation remediation: `24` deployment lifecycle tests and `38` focused deployment, Keychain, and plan contract tests.
- Passed after rollback reconciliation remediation: Ruff, Python compilation, TypeScript lint, and diff check.
- Passed after rollback reconciliation remediation: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `335` workspace tests, `171` safe Gmail tests, `471` mapped OpenClaw tests, and `1` candidate test.
- Passed after structural remediation: all `171` safe Gmail tests.
- Passed after structural remediation: `27` deployment lifecycle tests and `41` focused deployment, Keychain, and plan contract tests.
- Passed after structural remediation: Ruff, Python compilation, TypeScript lint, and diff check.
- Passed after structural remediation: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `338` workspace tests, `171` safe Gmail tests, `471` mapped OpenClaw tests, and `1` candidate test.
- Passed after lock API remediation: all `171` safe Gmail tests.
- Passed after lock API remediation: `28` deployment lifecycle tests and `42` focused deployment, Keychain, and plan contract tests.
- Passed after lock API remediation: Ruff, Python compilation, Node syntax, TypeScript lint, and diff check.
- Passed after lock API remediation: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `339` workspace tests, `171` safe Gmail tests, `471` mapped OpenClaw tests, and `1` candidate test.
- Passed: all `171` safe Gmail tests.
- Passed: `28` Gmail deployment tests and `49` focused deployment, Keychain, patch manifest, and plan contract tests.
- Passed: Ruff, Python compilation, Node syntax, TypeScript lint, and diff check.
- Passed: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `339` workspace tests, `171` safe Gmail tests, `472` mapped OpenClaw tests, and `1` candidate test.
- The deterministic multi-process stale-reclaimer regression passes on macOS.
- Passed after materialization remediation: all `171` safe Gmail tests.
- Passed after materialization remediation: `28` deployment tests and the patch manifest and deployment topology suites.
- Passed after materialization remediation: shell and Node syntax, TypeScript lint, and diff check.
- Passed after materialization remediation: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `339` workspace tests, `171` safe Gmail tests, `472` mapped OpenClaw tests, and `2` candidate tests.
- The installed-code candidate test confirms materialized fs-safe contains the Darwin reclaim guard.
- Passed after deployment-lock remediation: all `171` safe Gmail tests.
- Passed after deployment-lock remediation: `29` deployment lifecycle tests and `50` focused deployment, Keychain, patch manifest, and plan contract tests.
- Passed after deployment-lock remediation: Ruff, Python compilation, Node and shell syntax, TypeScript lint, and diff check.
- Passed after deployment-lock remediation: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `340` workspace tests, `171` safe Gmail tests, `472` mapped OpenClaw tests, and `2` candidate tests.
- Remote PR 102 was green on `21f7cd6887a5808dfad3b76080a4de3ba86e720e`.
- The promotion attempt applied patches in an isolated source worktree, then stopped at dependency materialization because `pnpm` was not in PATH.
- No gateway, package, runtime state, service config, browser image, or Gmail config mutation occurred.
- Passed after remediation: `36` deployment-topology tests cover direct pnpm and Corepack fallback.
- Passed after remediation: shell syntax, TypeScript lint, patch manifest checks, and diff check.
- Passed after remediation: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `341` workspace tests, `171` safe Gmail tests, `472` mapped OpenClaw tests, and `2` candidate tests.
- Retained review, terminal review, and updated PR 102 checks are green on `5d44fa46a5ae25e32014ae5fe900d211563bb69b`.
- Patched OpenClaw production deployment succeeded with recovery snapshot `~/.openclaw-deploy-backups/20260819T093708Z-33553`; installed guard, package migration, browser refresh, restart, and gateway health passed.
- Gmail release `5d44fa46a5ae25e32014ae5fe900d211563bb69b` was prepared and promoted, then the profile smoke failed because `/usr/bin/security` timed out reading the token after five seconds.
- Gmail automatic rollback restored the prior config, restarted the gateway, passed gateway health, and recorded recovery phase `rolled-back` under `~/.openclaw-deploy-backups/gmail-mcp/20260819T093911Z-36448`.
- The login keychain was unlocked at the time of failure.
- Cole now reports Gmail works without running the requested partition-list commands. The cause and restart durability are unverified.
- Three Gmail bridge processes use the primary-checkout cwd and Homebrew Python 3.11.16. Their environment has `HOME` and `PATH`, but no `GOOGLE_MCP_TOKEN` or `GMAIL_MCP_CONFIG_DIR`.
- The configured runtime is legacy code with no new Keychain module or parsed-credential cache.
- Fresh legacy profile checks passed in `172 ms` and, after gateway restart, `152 ms`.
- Fresh `/usr/bin/security` access to service `gmail-mcp`, account `token`, still timed out after five seconds.
- The current path survives a gateway restart but remains coupled to the current Homebrew Python identity.
- Passed: all `175` safe Gmail tests.
- Passed: `2` shared stable-migration tests covering secret-free output, exact copy, idempotency, and collision refusal.
- Passed: Ruff, Python compilation, TypeScript lint, syntax, and diff checks.
- Passed: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Managed lifecycle result: `343` workspace tests, `175` safe Gmail tests, `472` mapped OpenClaw tests, and `2` candidate tests.
- An isolated temporary macOS Keychain round trip proved a new item trusted for `/usr/bin/security` can be created and read by a fresh process without exposing its value.
- Guidance remediation is included in the `175` safe Gmail tests and complete managed lifecycle above.
- Pending: retained reviewer recheck and terminal exact-commit review.
- Pending: exact-candidate production promotion and read-only validation.

### Rollout and rollback

- Production remains unchanged until the final diff is reviewed, merged, and remotely green.
- Promotion first runs `docs/openclaw-setup/patches/apply-and-deploy.sh` on the exact landed source. That lifecycle snapshots OpenClaw package, runtime state, service config, and browser state, then rolls back on failure.
- Only after patched OpenClaw health passes does `scripts/mac-mini/deploy-gmail-mcp.py` promote the Gmail runtime.
- Patched OpenClaw promotion succeeded and its recovery snapshot remains.
- Gmail promotion failed safely and rolled back. The prepared immutable release and recovery state remain for retry and diagnosis.
- No further production mutation occurs until the working path is identified. Any durability check remains read-only.
- The stable migration creates a separate item and preserves the old item, so rollback never depends on deleting or rewriting the only usable credential.
- After merge and remote approval, run `gmail_mcp.scripts.migrate_legacy_keychain` through the trusted legacy interpreter with this release on `PYTHONPATH`.
- Verify `gmail-mcp-stable` through a fresh `/usr/bin/security` read, then rerun immutable Gmail promotion and read-only profile smoke.
- Every replacement must have durable original and promoted snapshots, a phase marker, and durable recovery directory entries.
- Normal rollback and next-run crash recovery preserve unrelated changes and refuse Gmail conflicts.
- Gateway health is required after rollback or crash recovery.
- Failed candidate releases and recovery snapshots remain for diagnosis.

### Review log

- Initial retained review found high-severity stale-config and release-identity gaps. Both were fixed and validated.
- Retained recheck found a medium-severity process-death gap because promoted bytes existed only in memory.
- Process-death remediation persists promoted bytes and phases, publishes a recoverable lock atomically, and restores incomplete promotion on the next run.
- Retained recheck found a medium-severity gap because new recovery directory entries were not followed by parent-directory fsync.
- The accepted fix durably creates every missing ancestor and fsyncs each new directory plus its parent. Focused and managed regressions pass.
- The retained reviewer rechecked the complete final diff at `44a61508f5f3139717eaed5ea84ef90ffc203c7f` and found no significant issue.
- Terminal review found a medium-severity gap because release contents were not recursively fsynced and a damaged active complete release did not trigger rollback.
- The accepted fix fsyncs the full release tree before publication and restores, quarantines, and rebuilds a damaged active completed release.
- Expanded focused and managed validation pass.
- The retained reviewer rechecked the complete final diff at `1e10012bdab12261bfeb93f815cba6b43e4905d2` and found no significant issue.
- The latest terminal review found medium-severity gaps: successful smoke did not recheck Gmail config, config lock publication could leave a partial lock, and executable bytecode was excluded from integrity checks.
- The accepted fixes verify Gmail under lock after smoke, reconcile and fail on conflicts, publish config lock records atomically, remove bytecode, disable bytecode writes, and treat later bytecode as release corruption.
- Retained recheck found a medium-severity crash window because `superseded` was written before gateway reconciliation completed.
- The accepted fix records `reconciling` before restart, writes `superseded` only after restart and health, and finishes interrupted reconciliation on the next invocation before stopping.
- Expanded focused and managed validation pass.
- The retained reviewer rechecked the complete final diff at `cb8eb887663973e63c65c10542dae5f28a10fe76` and found no significant issue.
- The latest terminal review found a medium-severity gap because manifest verification omitted executable file modes.
- The accepted fix records root, directory, regular-file, and symlink modes, treats unreadable trees as corruption, and proves active execute-bit damage triggers restore, quarantine, rebuild, and healthy reactivation.
- Expanded focused and managed validation pass. The retained reviewer is rechecking the complete final diff.
- Retained recheck found a medium-severity gap because unreadable or non-object release metadata could escape the damaged-release recovery path.
- The accepted fix normalizes read, decode, and object-shape failures as `DeploymentError` and proves non-object metadata and unreadable manifests trigger restore, quarantine, rebuild, and healthy activation.
- Expanded focused and managed validation pass.
- The retained reviewer rechecked the complete final diff at `2f1c0611768b60dcd8c2cd1f66065a8698753755` and found no significant issue.
- The latest terminal review found a medium-severity gap because rollback conflicts preserved disk config but could leave the failed candidate running in the gateway.
- The accepted fix routes both normal and process-death rollback conflicts through durable reconciliation, restarts and health-checks the operator config, marks superseded, and reports failure without retrying promotion.
- Expanded focused and managed validation pass. The retained reviewer is rechecking the complete final diff.
- Retained recheck found a medium-severity gap because missing or non-object Gmail config raised before reconciliation.
- The accepted fix treats missing and non-object Gmail config as concurrent conflict during completion, normal rollback, and process-death recovery, with durable reconciliation and gateway health.
- Expanded focused and managed validation pass.
- The retained reviewer rechecked the complete final diff at `18b0a28ca51fbb3e0185a3e1d9e151a05a121a3e` and found no significant issue.
- The latest terminal review found a medium-severity TOCTOU race because custom stale-lock identity checks and pathname deletion were separate operations.
- The accepted fix uses `openclaw/plugin-sdk/file-lock` through a holder process, removes custom config-lock reclamation, and proves two processes serialize through the shared lock.
- Expanded focused and managed validation pass. The retained reviewer is rechecking the complete final diff.
- Retained recheck found a medium-severity race inside the installed shared lock manager because stale identity checks and pathname removal are separate operations.
- The accepted source patch holds a kernel-exclusive reclaim guard around stale inspection and removal on macOS. A deterministic two-process test and the complete managed lifecycle pass.
- The retained reviewer is rechecking the complete final diff.
- Retained recheck found a high-severity deployment gap because dependency installation ran before the patch changed pnpm patch content and lock hashes.
- The accepted fix applies the full patch stack before frozen dependency installation in both managed tests and production deployment. The candidate test verifies installed code.
- Expanded focused and managed validation pass.
- The retained reviewer rechecked the complete final diff at `b58ac72a915b7cd4874409ed98cc5b35c0890ad2` and found no significant issue.
- The latest terminal review found a medium-severity TOCTOU race in the remaining custom deployment-lock stale reclaimer.
- The accepted fix uses the patched shared holder for the entire deployment, removes custom deployment stale takeover, and proves two deployment processes serialize.
- Expanded focused and managed validation pass.
- The retained reviewer rechecked the complete final diff at `0c8879c36ea1226a41aefd305c1a17932d93c9a5` and found no significant issue.
- Production preflight then found direct `pnpm` unavailable even though `corepack pnpm` is available. The package-manager resolver fix invalidates the prior terminal candidate.
- The accepted fix selects direct pnpm when present and otherwise uses Corepack for install, build, and pack. Both fixture paths and the complete managed lifecycle pass.
- The retained reviewer rechecked the complete diff at `62b04375a427a5da3c6ffc7651d0277ca4f1ce23` and found no significant issue.
- Fresh terminal review found no actionable issue on exact candidate `5d44fa46a5ae25e32014ae5fe900d211563bb69b`; updated remote checks passed.
- Production OpenClaw promotion passed. Gmail promotion exercised and passed automatic rollback after the Keychain ACL blocked read-only validation.
- Cole later observed working Gmail without performing the requested ACL commands. This follow-up reopens production diagnosis rather than assuming the blocker disappeared durably.
- Production evidence proves the observation comes from renewed legacy interpreter trust. A stable-item migration is required for upgrade durability.
- The migration implementation uses service `gmail-mcp` only as source and service `gmail-mcp-stable` as target. It validates authorized-user JSON, refuses a different existing target, and never prints token data.
- Retained review found a medium-severity guidance gap because malformed-credential errors told users to delete legacy service `gmail-mcp`.
- The accepted fix derives messages from `KEYCHAIN_SERVICE` and verifies parser and tool results name `gmail-mcp-stable`. Full validation passes.

### Checklist

- [x] Tracking comment, issue, and reopened plan follow the required contract.
- [x] Release identity and config concurrency findings are fixed.
- [x] Process-death recovery finding is fixed with regression coverage.
- [x] Recovery directory entries are durable across power loss.
- [x] Focused and full managed validation pass after final remediation.
- [x] Retained review is clean after all remediation.
- [x] Release-tree durability and active-release recovery are fixed.
- [x] Retained recheck is clean.
- [x] Final config, lock, and bytecode findings are fixed.
- [x] Reconciliation crash recovery is fixed.
- [x] Retained recheck is clean.
- [x] Release permission integrity is fixed.
- [x] Release metadata failures consistently trigger recovery.
- [x] Retained recheck is clean.
- [x] Rollback conflict runtime reconciliation is fixed.
- [x] Structural Gmail conflicts use the same reconciliation path.
- [x] Retained recheck is clean.
- [x] Shared config locking uses a patched race-safe OpenClaw implementation.
- [x] Patched dependency is materialized before tests and production build.
- [x] Retained recheck is clean.
- [x] Whole-deployment locking uses the patched shared implementation.
- [x] Production package-manager resolution is fixed.
- [x] Retained and terminal reviews are clean.
- [x] Updated deployment PR checks are green.
- [x] Patched OpenClaw is promoted and healthy.
- [x] Failed Gmail smoke rolled back and gateway health is restored.
- [x] The currently working Gmail path is identified.
- [x] Fresh-process and gateway-restart behavior are proven read-only.
- [x] Stable Keychain migration is implemented and validated in tests.
- [x] Stable-item guidance remediation passes full validation.
- [ ] Retained and terminal reviews are clean for the migration change.
- [ ] Stable production item is created and verified.
- [ ] Required durable fix or promotion is completed.
- [ ] Final plan, issue, and Todoist handoff are current.
- [ ] Deployment pull request is green and merged.
- [ ] Exact landed candidate is promoted.
- [ ] Read-only production validation passes.
- [ ] Final plan, issue, and Todoist handoff are current.
