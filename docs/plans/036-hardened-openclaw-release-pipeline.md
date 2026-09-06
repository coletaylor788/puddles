# Hardened OpenClaw release pipeline

Status: In progress
Issue: https://github.com/coletaylor788/puddles/issues/110
Last updated: 2026-09-06

## Human section

### Design

OpenClaw releases currently apply patches, build a package, and deploy in one long operation. That makes an interruption hard to distinguish from a failed or completed stage. It also means production can receive a package that was rebuilt after validation instead of the exact package that passed the combined public and private checks.

This change makes the release a sequence of durable stages. The public repository creates an isolated candidate at one pinned OpenClaw revision, validates the public patch stack, and writes a receipt with the candidate digest. A separately supplied private tool may add its overlay and validate the combined tree through a narrow executable contract. That tool must come from a clean Git checkout at the reviewed private repository, head, and tree. The public runner then packages the exact retained validation tree once, records the package digest, deploys only that package, performs read-only production checks, and rechecks both pull requests before landing the private dependency and then the public change.

Each stage records its inputs, outputs, command, timing, and concise result outside the candidate tree. Resume re-hashes every declared input and output instead of trusting completion markers. Deployment keeps the existing recovery ownership for the installed package, runtime state, service definition, browser image, migration, gateway restart, production checks, and dependency-ordered landing. A failed or stale promotion restores the recorded production state before the workflow can continue. The target publishes terminal success only after rollback ownership is disabled.

Candidate changes and production release are owned by separate workers under a parent orchestrator. The implementation worker is the only worker that changes files or pins and owns the retained review. Once its exact candidate is reviewed and remotely green, it reports an immutable handoff to the parent and stops. That handoff keeps executable arguments separate from environment values so paths are never reparsed as shell text. The parent alone starts one sibling validation and deployment worker, which runs the scripted release without editing or reviewing. A failed release returns through the parent to the same implementation worker instead of being repaired inside the production-capable session.

### Status

The public orchestrator now validates one pinned source tree, binds private execution to the reviewed clean Git tree, packages the combined candidate once, and deploys only the recorded artifact digest. Each stage records inputs, outputs, commands, timing, and resume data outside the candidate. Deployment rollback owns production checks and the dependency-ordered private and public merges. The target disables rollback before publishing success, and the final durable stage records the already verified landing.

The first validation worker stopped before the release runner started because a pasted PATH assignment split an inherited application path at a space. Production remains unchanged. The release now has a committed launcher that accepts the supported Node executable and private pipeline as explicit arguments, constructs PATH internally, and invokes the runner without evaluating shell text. Focused validation and the cumulative pool are green. Retained review, push, exact-head checks, and a new immutable handoff remain.

## Agent section

### State

- Phase: Resume the retained reviewer on the argv-safe launcher candidate.
- Public repository: `coletaylor788/puddles`.
- Private coordination: creator session `ef5fc892-f0fb-4ba0-b024-cf08ca61adb8`.
- Private implementation owner: session `66dd0a6d-f143-45c1-8011-15c95b616fb9`.
- Public implementation owner: session `d56235cd-e6be-4c39-b691-f856cb76548e`.
- Parent orchestrator: session `ef5fc892-f0fb-4ba0-b024-cf08ca61adb8`.
- Validation and deployment worker: Assigned only by the parent after the exact candidate handoff.
- Failed validation worker: session `7f09538a-bb2d-494c-8bfc-63c24f239d3e`; exit 127 before Node or orchestrator startup because an inherited PATH entry containing a space was shell-split. Production was untouched.
- Production topology: user LaunchAgent `gui/502/ai.openclaw.gateway`, plist `~/Library/LaunchAgents/ai.openclaw.gateway.plist`, local port `18789`.
- Private contract: Repository `coletaylor788/puddles-private`, executable `docs/openclaw-setup/patches/private-overlay.mjs`, head `4378cdcea1fbfb39fca5d994d7712705d35403b2`.
- Blocker: None.

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
- Record the retained reviewer identity in durable plan state. Use a replacement only after recording an actual failure or irrecoverable unavailability and the replacement identity.
- Use targeted checks during implementation and remediation. Run the full cumulative pool once on the final pre-review candidate, and once more only if batched reviewer fixes change candidate files.
- Keep all edits, pin changes, validation, and retained review with the implementation worker.
- Return the remotely green exact head to the parent orchestrator. The parent creates exactly one sibling validation and deployment worker and routes any failure back to the same implementation worker.
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
- Query GitHub immediately before promotion and again inside the rollback-owned post-deploy check. Merge and verify the private dependency before the public pull request. A changed head, base, check state, review state, or mergeability invalidates promotion.
- Separate orchestration, implementation, and release execution. The implementation worker returns immutable public, base, and private pins to the parent. The parent alone creates the release worker and routes failures. The release worker never edits, resolves conflicts, makes design decisions, reviews, or creates workers, and stops with durable evidence on failure.
- Keep one reviewer identity across the implementation remediation loop. Neither the parent orchestrator nor the release worker creates review agents.
- Bind every successful implementation-worker full run to its candidate head or input hash. Reuse it only while those inputs stay unchanged. Remote CI and release-worker gates do not cause another local full run.
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
- [x] Define the immutable handoff between the implementation worker and the validation and deployment worker.
- [x] Define targeted-first validation cadence and exact-candidate full-run reuse.
- [x] Add focused unit and integration regressions.

### Validation

- Focused package tests will cover canonical tree hashing, receipt validation, atomic state, resume invalidation, private command arguments, package digest checks, SSH options, target completion evidence, and stale pull-request state.
- Deployment fixture tests will cover immutable package consumption, no rebuild during promotion, interruption rollback, the real LaunchAgent topology, explicit path handling, and disconnected-client recovery.
- The cumulative managed command is `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Public validation must pass without the private overlay. Combined validation must pass after the private overlay and must prove interactions across both patch sets.
- Production validation is read-only and checks package version and digest evidence, LaunchAgent state, port 18789, and the payload-free gateway health probe.
- Focused result for the launcher correction: `packages/e2e` type-check and shell syntax checks pass. The 27 release CLI, retained-review workflow, and plan contract regressions pass with both the selected Node path and an inherited PATH entry containing spaces.
- Final full managed result for the launcher correction: Passed with Node 22.23.1. Puddles package suites passed 163 E2E tests, 112 MCP hook tests, 61 calendar tests, 43 Gmail plugin tests, and 175 Gmail Python tests. The patched OpenClaw project groups and candidate suite passed 319 tests across 12 files.
- Failed iterations found two lifecycle defects that are now covered: broad Vitest selection loaded tests into the wrong projects, and this host's Node 24.2.0 did not satisfy the pinned OpenClaw engine. The runner now uses one declared project per mapped test. Validation used the same supported Node 22.23.1 configured in CI.
- Recoverable full-run history for this PR: one earlier implementation run passed before this ownership correction; one run in this session was stopped because the ownership contract changed while it was running; one run passed for the three-role contract; one pre-review run passed after the reviewer identity contract; one run passed after the first retained-review remediation; one run passed after the second remediation; and the final launcher-correction run passed.

### Rollout and rollback

- Push a non-draft pull request after local validation and retained review are clean.
- Record the exact pull-request head and base only after required remote checks and review are green.
- After local and remote gates pass, return the exact public head, base head, private head, check evidence, release paths, and rollback prerequisites to the parent orchestrator, then stop.
- The parent orchestrator starts one sibling validation and deployment worker with those immutable inputs and a new external run directory.
- Encode the release invocation as an argv array plus a separate environment map. Use `packages/e2e/bin/openclaw-release.sh` with explicit `--node` and `--private-pipeline` arguments. Do not hand off inline environment assignments or PATH construction.
- Run the public pipeline on the target Mac mini with local deployment topology and `MINI_HOST` unset.
- Supply `PUDDLES_PRIVATE_PIPELINE` and the reviewed 40-character private head from the coordinating session.
- Preserve public, private, combined-validation, package, deployment, production, and pull-request evidence in the external run directory.
- On package replacement, migration, browser image, runtime state, plist, restart, readiness, production validation, or stale pull-request failure, invoke the recorded rollback and verify restored gateway health.
- The validation and deployment worker stops after any failure and reports its stage evidence to the parent. It never fixes or retries with changed inputs. The parent routes evidence to the same implementation worker, which owns any correction, affected validation, retained-review recheck, and a new immutable handoff with a new run.
- Resume only when all pins are unchanged and all prior inputs and outputs revalidate. Never resume the stopped run after changing a public or private pin.

### Review log

- Independent retained reviewer: `71118f9e-0458-486c-8308-b51e88663719`.
- First pass: Three High findings. Run-directory symlink escape, single-shot remote receipt retrieval, and acceptance of private pull requests with no remote checks.
- Second pass: The first three findings were resolved. Four material findings remained. Merge ambiguity could trigger rollback after merge, private receipts were not sanitized, pre-quiesce failures lacked receipts, and the orchestrator had only source-contract tests.
- Cross-repository pass: Combined validation produced build outputs that the public candidate digest did not cover, while public packaging rebuilt the tree. The private receipt now declares a retained production stage with a complete directory digest. Public verifies and packages that exact stage without rebuilding.
- Earlier corrections: Canonical containment blocks symlink escapes while accepting canonical macOS temporary roots. Remote deployment is detached, boundedly polled, and reconciled by immutable artifact digest. Both pull requests require successful checks. Public run evidence contains sanitized private metadata. Every target terminal path writes or coordinates a receipt. A mocked executable CLI regression covers composition, sanitization, stale heads, ambiguous merge reconciliation, completed-run resume, receipt-to-stage interruption recovery, and exact packaging of the retained combined-validation output without rebuilding.
- Replacement pass at candidate `b914818e96282a9c24263a33090f8512883fb955`: Three High findings. Private execution was not bound to the reviewed private commit, a public landing failure could leave an unlanded candidate in production, and a remote client could observe success before rollback was disabled.
- First remediation: The runner binds the private executable to a clean exact repository head and Git tree before each private stage. Private then public merge and exact landing verification run inside the rollback-owned post-deploy check. The target disables rollback before publishing its passed receipt. Focused regressions cover dirty or changed private checkouts, public merge failure rollback, a new run after a private-only merge, and interrupted receipt reconciliation.
- Replacement recheck at candidate `f2489d4282a5f4b5d715a07923fa2f420c8da60c`: The private binding and receipt ordering findings were resolved. Two High findings remained. A signal after the server accepted the public merge could still roll production back, and a crash after target success but before the local production receipt could leave a completed release that no run could reconcile.
- Second remediation: Signals are deferred during landing and cause the exact landed heads to be reconciled before commit or rollback. The target receipt now binds the public and private pins, candidate and production-stage digests, artifact, and landing result. A missing local production receipt is reconstructed only after target evidence, exact landing, and read-only production health all revalidate.
- Final recheck at candidate `7c739f380f5b3af54458f3e0c149b68ab2988b0b`: The reviewer initially reported that merged public state was not accepted during reconciliation. Current source and regressions showed that both exact merged states are accepted and verified on their default branches. The reviewer withdrew the finding and reported no actionable findings in the complete diff. The remaining production and GitHub landing validation belongs to the designated validation and deployment worker.
- Validation handoff failure after candidate `2e2661ea3bdf02483e8b1fb567b948b41dc6d464`: The worker never started Node because the pasted command prepended an unquoted inherited PATH containing `Copilot.app/Contents/MacOS`. The correction moves executable selection and PATH construction into a committed argv-safe launcher. The same retained reviewer will recheck the complete updated diff after local validation.

### Checklist

- [x] Read the current managed test and deployment lifecycle.
- [x] Identify public, private, production, and publication trust boundaries.
- [x] Record the agreed architecture and locked private executable contract.
- [x] Create and link the tracking issue.
- [x] Implement focused behavior and regression coverage.
- [x] Pass focused local validation.
- [ ] Pass the full cumulative integration pool.
- [ ] Complete the retained independent adversarial review loop for the current candidate.
- [x] Push and open a non-draft pull request.
- [ ] Pass required remote checks and review.
- [x] Confirm the private pipeline is reviewed and remotely green.
- [ ] Promote the exact immutable artifact.
- [ ] Pass read-only production validation.
- [ ] Recheck exact pull-request head, base, checks, review, and mergeability.
- [ ] Return a new exact reviewed and remotely green argv-safe handoff to the parent orchestrator.
- [ ] Merge and verify the default branch.
