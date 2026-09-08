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
read-only health checks fail. Additional runtime packages join the same verified
bundle and stopped-gateway transaction. Only their selected package subtrees
are replaced; unrelated state and the runtime's existing records of installed
packages are preserved. Successful proofs are reused only while their
actual inputs and outputs remain unchanged. Optional local extensions compose
additional scenarios and bounded health checks without making public code or
CI depend on another repository. Public hosted failures retain only bounded,
sanitized evidence from their own fresh run, never local extension state.

### Status

The native loop and additional-package activation are implemented. Release
validation found one retained test assigned to the wrong test project and
missing hosted failure evidence. The correction preserves the collection guard
and adds bounded public diagnostics. Remote activation can also select an
explicit interpreter and tool path without relying on an interactive shell.
The retained reviewer cleared those corrections. Hosted startup then rejected
the run-directory expression before starting a job. Initialization now sets
that directory after the runner starts. Focused checks pass, and the same
retained reviewer cleared this correction too. Refreshed release validation
remains pending. Production is unchanged.

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
- Seal every declared additional portable runtime into the candidate and its
  install/runtime proofs. Stage before downtime and replace only mapped state
  subtrees after shutdown, with whole-state rollback and exact content checks.
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
- Public CI uses standard `macos-15-intel` (14 GB RAM and 14 GB SSD), not the
  7 GB `macos-latest` host. Keep the 8 GiB native guards. The 90-minute job
  budget covers more than the 15-minute dependency and 30-minute build bounds
  and remains below GitHub's six-hour hosted-job maximum.
- Public hosted attempts use a fresh marked run with local extensions disabled.
  Failure exports contain bounded sanitized logs and projected stage status,
  never raw run state. Environment redaction supplements synthetic test data.
  Derive runner-dependent paths inside the initialization step and persist them
  through `GITHUB_ENV`, not job-level expression evaluation.
- Remote activation accepts optional absolute `PUDDLES_REMOTE_NODE` and
  selected `PUDDLES_REMOTE_PATH`, passed through quoted arguments. Existing
  default lookup and local behavior remain unchanged.
- Prepare clean source on invalidation and keep the existing build when the
  resulting source bytes match. Bind regression proofs to effective test
  environments, interpreters, and installed test dependencies.
- Optional `E2E_LOCAL_EXTENSION` loads a trusted local module. Only an explicit
  caller enables it. Extension inputs key local evidence, and extension output
  stays in protected local run state.
- Keep source integration outside the activation and rollback transaction.
- Optional extension `artifacts` entries name portable archive manifests inside
  verified package outputs. `additionalInstalledDirs` exposes offline installs
  to rehearsal hooks. `additionalInstalls` maps the sealed bundle to relative
  state subtrees. Existing registration/configuration must remain valid at
  those locations; no SQLite updater or general command hook is introduced.
- Source integration and activation verify each artifact against retained
  proof inputs. Archive transport paths are not content identities.
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
- The retained Gmail gate assertion follows delegation to the native pipeline.
  A focused runtime test proves the delegated command forces `CI=true` even
  when the caller sets it to false. The live integration exclusion remains.
- Additional artifacts are staged before shutdown, replace complete managed
  subtrees after the stopped-state snapshot, and retain digest identities in
  recovery state. The same snapshot restores old content or removes a new
  subtree after failure. Registry/configuration outside selected subtrees is
  unchanged.
- `public-ci-diagnostics.mjs` validates hosted run ownership, limits and
  sanitizes allowed logs, rejects symlinks, and produces a bounded job summary.
  The workflow uploads only its export directory on failure, for seven days.
- `yield-gather-state.test.ts` belongs to `agents-tools`, not `unit-fast`.
  Collection failures retain command output and identify the missing target
  and project. No test target or collection guard is removed.

### Validation

- Focused command:
  `corepack pnpm --filter e2e exec vitest run tests/native-loop.test.ts tests/native-pipeline.test.ts tests/native-integration.test.ts tests/deployment-topology.test.ts tests/gmail-keychain.test.ts tests/patch-suite.test.ts tests/plan-and-issue-writing-contract.test.ts`.
  The current focused selection contains 82 tests, including real macOS
  clone/swap rollback. `corepack pnpm --filter e2e lint` passes. Earlier
  lifecycle and process regressions passed in the initial 86-test focused run.
- Built the actual pinned patched OpenClaw release with Node 22.23.2 and its
  committed package manager. The runtime archive includes its dependency graph
  and installs in a fresh prefix without registry access.
- `OPENCLAW_CANDIDATE_DIR=/path/to/installed/runtime node packages/e2e/bin/openclaw-test-env.mjs scenarios`
  passes all eight scenarios twice on the corrected package, with normal
  workspace bootstrap and bundled skill discovery. The installed bytes remain
  unchanged. Exact digests and detailed evidence stay in local run state.
- The release worker runs the full cumulative command against the final
  frozen candidate. Unit-tested orchestration alone is not release evidence.
- Public CI run `34174012214` rejected the old 7 GB host at the new memory
  preflight. Runner specifications and available job time are verified against
  GitHub's official runner and Actions limit references. The existing actual
  candidate source, artifact tree, and installed tree occupy about 3.3 GiB;
  the free-disk guard remains in place rather than assuming all advertised
  storage is available.
- The workflow-only correction has a focused resource-contract regression in
  `tests/patch-suite.test.ts`. No OpenClaw source, package, or fixture bytes
  change, so their retained build and runtime evidence is not rerun here.
- Pipeline commands and host test-tool identity are mocked for the delegated
  Gmail orchestration proof. Runtime
  implementation, source builds, packages, and real gateway fixtures do not
  change for the Gmail assertion correction.
- Additional bundle coverage checks offline portable installation, declared
  output containment, proof binding, per-artifact invalidation, target paths,
  exact subtree replacement, preservation of sessions arriving before shutdown,
  unchanged registry bytes, and interrupted rollback without archived inputs.
  Root source/build/artifact bytes are retained. Installation verification and
  bundle proofs have changed and require refreshed release evidence.
- The diagnostics, mapping, and remote-path repair passes 67 tests across public diagnostics,
  deployment topology, patch mapping, native pipeline, and plan contracts.
  E2E TypeScript, shell syntax, and diff checks also pass. It executes a real
  failing child and the diagnostic CLI, proving bounded redacted output without
  publishing context. Fake SSH exercises interpreter, PATH, and argument
  quoting without accessing a real target.
- Actual retained source collection under
  `test/vitest/vitest.agents-tools.config.ts` finds
  `src/agents/tools/yield-gather-state.test.ts`; its four tests pass.
  The other mapped groups passed in release validation. No source patch or
  package bytes change in this repair. Refresh affected regression evidence,
  not unchanged source builds, according to actual input identities.
- Hosted run `34178227458` rejected `runner.temp` in job-level `env` before any
  job started. The startup regression uses the established `yaml` parser to
  inspect job and step scope, then executes the actual initialization shell.
  It checks the public marker and persisted environment and rejects the
  runner-dependent setting at job scope. The parser is a test dependency only.
  All 25 diagnostics, mapping, and plan tests pass for this startup correction,
  together with e2e TypeScript and shell checks.

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
- The same reviewer cleared the complete feature diff including the
  runner/resource correction. No runtime implementation changes accompany it.
  A successful hosted cumulative run remains required.
- The same reviewer cleared the complete feature diff including the retained
  Gmail contract and additional-artifact transaction corrections. The refreshed
  cumulative gate and real complete-bundle rehearsal remain required.
  No terminal fresh reviewer is required for bookkeeping.
- The same reviewer cleared the complete feature diff including diagnostics,
  mapping, and remote interpreter selection. No actionable high-confidence
  findings remain. Hosted cumulative success and target-specific bundle
  rehearsal remain required; fake SSH does not prove target tool availability.
- The same reviewer cleared the complete diff including the initialization
  scope correction and parsed workflow regression. Hosted workflow acceptance
  and cumulative success remain required.

### Checklist

- [x] Approved design recorded.
- [x] Linked tracking issue.
- [x] Native runtime fixture and committed scenarios.
- [x] Durable pipeline and offline package rehearsal.
- [x] Lifecycle guidance and regression assertions updated.
- [x] Focused tests and repeated real runtime evidence.
- [x] Retained independent review clear for current correction.
- [ ] Release worker cumulative gate, integration, and activation.
