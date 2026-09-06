# Hardened OpenClaw release pipeline

Status: In progress
Issue: https://github.com/coletaylor788/puddles/issues/110
Last updated: 2026-09-05

## Human section

### Design

OpenClaw releases currently apply patches, build a package, and deploy in one long operation. That makes an interruption hard to distinguish from a failed or completed stage. It also means production can receive a package that was rebuilt after validation instead of the exact package that passed the combined public and private checks.

This change makes the release a sequence of durable stages. The public repository creates an isolated candidate at one pinned OpenClaw revision, validates the public patch stack, and writes a receipt with the candidate digest. A separately supplied private tool may add its overlay and validate the combined tree through a narrow executable contract. The public runner then packages that exact tree once, records the package digest, deploys only that package, performs read-only production checks, and verifies that the pull request still points at the reviewed head and base before merge.

Each stage records its inputs, outputs, command, timing, and concise result outside the candidate tree. Resume re-hashes every declared input and output instead of trusting completion markers. Deployment keeps the existing recovery ownership for the installed package, runtime state, service definition, browser image, migration, and gateway restart. A failed or stale promotion restores the recorded production state before the workflow can continue.

### Status

The public orchestrator now validates one pinned source tree, calls the private overlay through its narrow command contract, packages the combined candidate once, and deploys only the recorded artifact digest. Each stage records inputs, outputs, commands, timing, and resume data outside the candidate. The existing deployment rollback owns production checks and the final pre-merge pull-request state check. Merge and landed verification use a separate durable stage after rollback ownership ends.

The full managed lifecycle passes on the supported Node runtime. The private side is reviewed at its pinned head and its receipt shape matches the public contract. The retained independent and cross-repository reviews found nine material issues across their passes. All are fixed, covered, and clean on recheck.

## Agent section

### State

- Phase: Pull request and remote checks.
- Public repository: `coletaylor788/puddles`.
- Private coordination: creator session `ef5fc892-f0fb-4ba0-b024-cf08ca61adb8`.
- Private implementation owner: session `66dd0a6d-f143-45c1-8011-15c95b616fb9`.
- Production topology: user LaunchAgent `gui/502/ai.openclaw.gateway`, plist `~/Library/LaunchAgents/ai.openclaw.gateway.plist`, local port `18789`.
- Private contract: Repository `coletaylor788/puddles-private`, executable `docs/openclaw-setup/patches/private-overlay.mjs`, head `7aa2b9327f3f4bcfc4807cedcbcf043e3247db40`.
- Blocker: The private executable's absolute path on the target Mac mini is needed only for promotion.

### Scope and acceptance criteria

- Add a simple resumable public release orchestrator with durable per-stage state.
- Pin the public patch stack, private overlay, and release manifest to one OpenClaw source revision.
- Bootstrap missing public workspace dependencies in fresh worktrees.
- Create a disposable Gmail development environment instead of relying on production Python tools.
- Canonicalize temporary paths so macOS `/tmp` and `/private/tmp` aliases do not invalidate checks.
- Bound Vitest execution so stalled workers fail clearly and select the intended project.
- Validate patch-manifest completeness before expensive dependency installation or OpenClaw tests.
- Emit progress and timings during long install, build, package, transfer, deploy, and validation stages.
- Invoke the private executable only through the locked `apply` and `validate` argument contract.
- Keep raw private receipts outside both the candidate and public run directory. Copy only sanitized opaque hashes plus repository and head identifiers into public run evidence.
- Produce the required public validation receipt with schema version 1.
- Use a canonical candidate digest that includes `git diff --binary HEAD` plus untracked paths and bytes.
- Package the exact combined candidate once, record its SHA-256, and reject any later artifact change.
- Deploy the immutable package without rebuilding and preserve existing rollback ownership.
- Make remote execution use an explicit non-interactive path, `IdentitiesOnly`, and SSH control connection defaults.
- Make target completion durable so a disconnected SSH client cannot make deployment status ambiguous.
- Record run id, hashes, timestamps, timings, exact argv, concise result, and resume metadata for every stage.
- Revalidate stage inputs and outputs on resume.
- Prove public-only validation, combined validation, immutable installation, interruption recovery, rollback, and stale-head handling in committed tests.
- Run `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Complete one independent adversarial review loop and reuse the same reviewer for remediation.
- Pass remote checks, promote only after both repositories are reviewed and green, validate production read-only, recheck exact pull-request state, merge, and verify the landed result.

### Architecture and decisions

- Add one Node entry point under `packages/e2e/bin/` for release orchestration and small reusable helpers under `packages/e2e/src/`.
- Keep run evidence under an explicit external run directory. Never place receipts in the candidate tree.
- Represent each stage with one JSON state file written atomically after outputs are hashed.
- Resume a passed stage only when its recorded argv, input hashes, and output hashes still match.
- Use SHA-256 over a length-delimited canonical stream containing the binary tracked diff and sorted untracked path and byte records.
- Have public validation prepare the detached candidate, apply the manifest stack, run the public gates, and write `public.json`.
- Call `$PUDDLES_PRIVATE_PIPELINE apply` and `validate` exactly as specified. Treat returned metadata as untrusted and verify its schema, pins, and digests.
- Build and pack once after combined validation. Pass the resulting tarball and expected digest into the deployment wrapper.
- Require combined validation to retain an external build-ready production stage with a complete `puddles-directory-v1` digest. Package that exact stage without another install or build, and verify its digest before and after packing.
- Extend `apply-and-deploy.sh` with an immutable-artifact mode while retaining its current compatibility path.
- Keep target-side recovery and rollback in the deployment wrapper. Add durable target evidence for pre-quiesce failures, rollback outcomes, successful completion, and disconnected-client reconciliation.
- Query GitHub immediately before promotion and again before merge. A changed head, base, check state, review state, or mergeability invalidates promotion.
- Revise the repository skills to use one retained independent reviewer loop. Remove the separate terminal fresh review requirement.

### Implementation

- [x] Add release manifest and receipt helpers.
- [x] Add resumable stage runner and public release entry point.
- [x] Bootstrap repository and Gmail development dependencies safely.
- [x] Harden OpenClaw patch execution and Vitest selection/timeouts.
- [x] Add immutable-artifact deployment mode and durable target evidence.
- [x] Add SSH defaults and disconnect-safe target execution.
- [x] Add public and private pull-request pin and merge recheck stages.
- [x] Revise release and integration documentation.
- [x] Revise safe feature and adversarial review wording for one review loop.
- [x] Add focused unit and integration regressions.

### Validation

- Focused package tests will cover canonical tree hashing, receipt validation, atomic state, resume invalidation, private command arguments, package digest checks, SSH options, target completion evidence, and stale pull-request state.
- Deployment fixture tests will cover immutable package consumption, no rebuild during promotion, interruption rollback, the real LaunchAgent topology, explicit path handling, and disconnected-client recovery.
- The cumulative managed command is `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Public validation must pass without the private overlay. Combined validation must pass after the private overlay and must prove interactions across both patch sets.
- Production validation is read-only and checks package version and digest evidence, LaunchAgent state, port 18789, and the payload-free gateway health probe.
- Focused result: `packages/e2e` type-check passes. Release state, release contract, process timeout, review workflow, immutable deployment, post-deploy rollback, and remote path regressions pass.
- Full managed result: Passed with Node 22.23.1. Puddles package suites passed 158 E2E tests, 112 MCP hook tests, 61 calendar tests, 43 Gmail plugin tests, and 175 Gmail Python tests. The patched OpenClaw project groups passed 319 tests across 12 files, and the candidate suite passed 2 tests.
- Failed iterations found two lifecycle defects that are now covered: broad Vitest selection loaded tests into the wrong projects, and this host's Node 24.2.0 did not satisfy the pinned OpenClaw engine. The runner now uses one declared project per mapped test. Validation used the same supported Node 22.23.1 configured in CI.

### Rollout and rollback

- Push a non-draft pull request after local validation and retained review are clean.
- Record the exact pull-request head and base only after required remote checks and review are green.
- Run the public pipeline on the target Mac mini with local deployment topology and `MINI_HOST` unset.
- Supply `PUDDLES_PRIVATE_PIPELINE` and the reviewed 40-character private head from the coordinating session.
- Preserve public, private, combined-validation, package, deployment, production, and pull-request evidence in the external run directory.
- On package replacement, migration, browser image, runtime state, plist, restart, readiness, production validation, or stale pull-request failure, invoke the recorded rollback and verify restored gateway health.
- Resume only after all prior inputs and outputs revalidate.

### Review log

- Independent retained reviewer: `71118f9e-0458-486c-8308-b51e88663719`.
- First pass: Three High findings. Run-directory symlink escape, single-shot remote receipt retrieval, and acceptance of private pull requests with no remote checks.
- Second pass: The first three findings were resolved. Four material findings remained. Merge ambiguity could trigger rollback after merge, private receipts were not sanitized, pre-quiesce failures lacked receipts, and the orchestrator had only source-contract tests.
- Cross-repository pass: Combined validation produced build outputs that the public candidate digest did not cover, while public packaging rebuilt the tree. The private receipt now declares a retained production stage with a complete directory digest. Public verifies and packages that exact stage without rebuilding.
- Corrections: Canonical containment blocks symlink escapes while accepting canonical macOS temporary roots. Remote deployment is detached, boundedly polled, and reconciled by immutable artifact digest. Both pull requests require successful checks. Production validation and merge are separate durable stages. Public run evidence contains sanitized private metadata. Every target terminal path writes or coordinates a receipt. A mocked executable CLI regression covers composition, sanitization, stale heads, ambiguous merge reconciliation, completed-run resume, receipt-to-stage interruption recovery, and exact packaging of the retained combined-validation output without rebuilding.
- Recheck: Clean. No concrete material findings remain.

### Checklist

- [x] Read the current managed test and deployment lifecycle.
- [x] Identify public, private, production, and publication trust boundaries.
- [x] Record the agreed architecture and locked private executable contract.
- [x] Create and link the tracking issue.
- [x] Implement focused behavior and regression coverage.
- [x] Pass focused local validation.
- [x] Pass the full cumulative integration pool.
- [x] Complete the retained independent adversarial review loop.
- [ ] Push and open a non-draft pull request.
- [ ] Pass required remote checks and review.
- [ ] Confirm the private pipeline is reviewed and remotely green.
- [ ] Promote the exact immutable artifact.
- [ ] Pass read-only production validation.
- [ ] Recheck exact pull-request head, base, checks, review, and mergeability.
- [ ] Merge and verify the default branch.
