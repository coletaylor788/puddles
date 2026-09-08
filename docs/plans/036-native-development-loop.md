# Native development and delivery

Status: Ready for release validation
Issue: #112
Last updated: 2026-09-07

## Human section

### Design

Development starts with a shared Markdown design linked from an issue. Once the
design is approved, one engineering owner takes the change through a fixed
pipeline. Scripts run commands and keep durable evidence. The owner fixes
failures, adds regressions, and resumes the same run. One independent reviewer
stays with the change through corrections. Routine bookkeeping does not start
another review or rebuild.

The test environment is a second real OpenClaw process on a trusted native
host. Its configuration, sessions, indexes, workspace, ports, and processes are
separate from the running assistant. Its message integration receives scripted
incoming events and sends replies to a recorder. A local scripted model makes
conversation and tool behavior repeatable. Every external mutation used by a
scenario needs an explicit recording adapter. This is state isolation, not a
security sandbox against arbitrary host access.

The final candidate runs every accumulated regression. Its package carries its
runtime dependencies and is installed and rehearsed before activation. Exact
source is integrated before the live rollback transaction begins. Activation
consumes the rehearsed artifacts, keeps a recovery snapshot, and rolls back if
read-only health checks fail. Successful proofs are reused only while their
actual inputs and outputs remain unchanged. Optional local extensions compose
additional scenarios and bounded health checks without making public code or
CI depend on another repository.

### Status

The public implementation and retained independent review are complete. Review
findings are corrected with focused regressions. The corrected installed
artifact passed all eight real gateway scenarios twice, with normal workspace
bootstrap and bundled skill discovery. It is ready for separate release
validation. Production is unchanged.

This worker hands off a reviewed candidate and pull request without deploying
or merging it. A separate release worker will run the final accumulated gate,
integrate exact source, and activate the rehearsed artifacts.

## Agent section

### State

- Design approved in the implementation request. No further design checkpoint.
- Base: `7851ded`.
- Public scope only. Production deployment and feature merge are out of scope
  for this implementation worker.

### Scope and acceptance criteria

- Keep `node packages/e2e/bin/openclaw-test-env.mjs ci` as the cumulative gate.
- Boot the installed real OpenClaw runtime with isolated writable paths and
  real iMessage protocol handling, scripted model replies, and recording sinks.
- Commit conversation, split-part, tool, failure, no-output, and state-isolation
  scenarios to the shared pool.
- Fail fixture setup for missing recording adapters. No real external writes.
- Supply opt-in bounded host checks for availability, authentication, and
  protocol only. Required unavailable checks fail, default CI needs no accounts.
- Use durable exact-input evidence, bounded commands, preflight, cached build
  work, offline install rehearsal, explicit target identity, locks, snapshots,
  read-only smoke, and rollback.
- No private resources, identities, configuration, or output in public files,
  CI, logs, plans, examples, or pull requests.

### Architecture and decisions

- Reuse the pinned public OpenClaw patch stack and existing regression targets.
- Extend the native managed runner rather than adding an independent workflow.
- Follow upstream production packaging patterns. Ship a materialized runtime
  tree with dependencies, not a tarball that resolves registry packages while
  the gateway is stopped.
- Use upstream's package file selection, including bootstrap templates and
  bundled skills. Bind package reuse to actual installed dependency bytes.
- Prepare clean source on invalidation and keep the existing build when the
  resulting source bytes match. Bind regression proofs to effective test
  environments, interpreters, and installed test dependencies.
- Optional `E2E_LOCAL_EXTENSION` loads a trusted local module. Only an explicit
  caller enables it. Extension inputs key local evidence, and extension output
  stays in protected local run state.
- Keep source integration outside the activation and rollback transaction.
- Keep one reviewer across remediation. Bookkeeping alone does not restart it.

### Implementation

- Native fixture and recording adapters are implemented in
  `packages/e2e/src/native-fixture.mjs`, `mocks/imsg-mock.mjs`, and the
  `mocks/recording-tools` plugin. The plugin declares exact tool contracts.
- `packages/e2e/scenarios/imessage.mjs` contains eight reusable scenarios.
- `native-pipeline.mjs` owns preflight, source preparation, dependency/build
  reuse, accumulated regression collection, packaging, offline install, and
  runtime rehearsal. `native-state.mjs` owns durable exact-input stage records.
- `native-package.mjs` materializes the installed production graph and creates
  an archive with runtime dependencies. No npm resolution occurs on install.
- `native-extension.mjs` supports explicit local prepare, gate, package, and
  installed commands with bounded execution and declared output hashes.
- Source integration and activation are separate commands. Activation checks
  the exact integrated tree before locking the target and taking snapshots.
- Instructions, skills, documentation, and their contract tests describe the
  approved loop. The old build-and-install deployment script is replaced.

### Validation

- Focused command:
  `corepack pnpm --filter e2e exec vitest run tests/native-loop.test.ts tests/native-pipeline.test.ts tests/native-integration.test.ts tests/deployment-topology.test.ts tests/patch-suite.test.ts tests/review-workflow.test.ts tests/plan-and-issue-writing-contract.test.ts tests/writes.test.ts tests/process-runner.test.ts tests/test-discovery.test.ts tests/agent-setup-contract.test.ts`.
  All 86 tests pass. `corepack pnpm --filter e2e lint` passes.
- Built the actual pinned patched OpenClaw release with Node 22.23.2 and its
  committed package manager. The runtime archive includes its dependency graph
  and installs in a fresh prefix without registry access.
- `OPENCLAW_CANDIDATE_DIR=/path/to/installed/runtime node packages/e2e/bin/openclaw-test-env.mjs scenarios`
  passes all eight scenarios twice on the corrected package, with normal
  workspace bootstrap and bundled skill discovery. The installed bytes remain
  unchanged. Exact digests and detailed evidence stay in local run state.
- The release worker runs the full cumulative command against the final
  frozen candidate. Unit-tested orchestration alone is not release evidence.

### Rollout and rollback

- This worker does not deploy or merge.
- The release worker integrates eligible exact source, then activates exact
  artifacts through `docs/openclaw-setup/patches/apply-and-deploy.sh`.
- No dependency fetch, build, or GitHub merge while the gateway is stopped.
- Keep runtime and service snapshots, target locking, bounded restart checks,
  automatic rollback, and explicit recovery state.

### Review log

- The retained independent reviewer identified seven defects: missing upstream
  package assets, production browser tag collision during preflight, resumed
  rollback using an old CLI, dependency-byte package invalidation, effective
  regression environment identity, missing prepare output validation, and
  rebuilding source for later extension phase edits.
- Corrections and focused regressions are implemented. Corrected installed
  bootstrap and runtime evidence passed.
- Follow-up findings about missing Git worktree registrations and resolved
  extension runtime inputs are corrected. Real Git recovery and environment-
  selected runtime configuration have focused regressions. Stage records retain
  exact input identities without storing raw environment selections.
- The same retained reviewer cleared the complete substantive diff against
  `7851ded`, including all nine corrections and retained input identities.
  No actionable high-confidence findings remain. Final cumulative validation
  and real target activation, health, and rollback remain release-worker work.
  No terminal fresh reviewer is required for bookkeeping.

### Checklist

- [x] Approved design recorded.
- [x] Linked tracking issue.
- [x] Native runtime fixture and committed scenarios.
- [x] Durable pipeline and offline package rehearsal.
- [x] Lifecycle guidance and regression assertions updated.
- [x] Focused tests and repeated real runtime evidence.
- [x] Retained independent review clear.
- [ ] Release worker cumulative gate, integration, and activation.
