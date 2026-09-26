# OpenClaw artifact delivery

**Status:** Complete
Issue: #118
Last updated: 2026-09-26
Owner: Public OpenClaw engineering owner

## Human section

### Design

Build a complete immutable runtime bundle once, then prove it independently on the builder and the target. The bundle carries only declared archives, prepared files and normalized identity records. Source tests produce a separate attestation; the target installs offline and runs recorded scenarios plus physical success and rollback rehearsal. Certification joins evidence for the same bundle before release eligibility. Archived file permissions remain part of the verified identity.

Daily development uses incremental checks and a runtime-only build in a normal source checkout. Built output transfers to a separate development instance for changed-behavior checks. Release CI remains a clean accumulated gate. Durable stage records explain reuse, failure and invalidation, and the artifact pool protects referenced assets while collecting only explicitly owned disposable data. Maintained builds share one pinned package manager and one host-local content store.

Current-production backup is a separate operation. It captures complete installed runtime and state, proves isolated restoration and publishes a healthy reference before separately authorized disposal of an older copy. It preserves process ownership, exact identities and interruption recovery without rebuilding or installing a candidate.

### Status

The implementation and delivery checks are complete and integrated. The Mini retains the matching build and passed physical-target proof, a healthy development-instance record and the published replacement backup. Final recorded delivery evidence covers all eleven combined scenarios, success, deliberate failure and rollback, and fresh artifact replay. This audit did not repeat those operations.

The delivered scope is development, artifact certification and recovery infrastructure. Production still runs its earlier package; this completed record does not claim an upgrade.

## Agent section

### State

- Hygiene audit, 2026-09-26: read-only Mini inspection confirms the retained
  build `bb5c4422fbb62c7716aa3041353e8547e9ab8908a8089f7c6904ad16231eb1c6`
  and a matching physical target proof with `status: passed`. The current DEV
  record reports healthy. The current-backup reference names
  `backup-1789953098154-29840` with no previous transaction. Production package
  metadata still reports `2026.7.1`; rehearsal completion is not an upgrade.
  No deployment, scenario, backup or cleanup operation ran during this audit.

- Tracking issue: #118.
- Canonical cross-repository scope and completion checklist:
  [plan 039](039-development-delivery-master.md). This plan keeps only the
  public implementation detail for that delivery flow.
- Public #117 merged as `042b73281b63bfc64df1f66d8779603a31380ca2`;
  private `coletaylor788/puddles-private#39` merged as
  `75aa7a761b7644cd038d31544a11dc5b93b3d6a4`. Public post-merge
  Integration `36266234464` and CodeQL `36266233422`, and private contract
  `36261272335`, passed.
- The original public engineering owner retained independent review through
  the migration, packaging, backup, toolchain and workflow repairs. No new
  implementation or approval checkpoint is pending.
- Private composition, target values, self-hosted ARM workflow, and production
  activation stay outside the public repository.
- Public hosted output is an arm64 nonproduction bundle from the standard
  `macos-15` runner. The full hosted lifecycle passed. The composed private
  release used the authorized local builder fallback, not a paid hosted run.
- Physical runtime evidence belongs to public `251eff2` and private `74e1389`.
  Later workflow-only commits have separate remote checks. Do not relabel
  runtime receipts with later commit identities.
- Final fresh-pool replay passed root and six additional installs, runtime and
  eleven recording-only scenarios. Certification reused genuine source and
  physical proof and reproduced digest
  `cbc7f795cb5fe05602fc3764acd1b2a851af2cfd65ea71e65c6fea03bdf47f02`.
  Fresh temporary target and payloads are cleaned up; production stayed healthy.
- Stage keys include absolute import/context paths, so fresh replay keys need
  not equal historical keys. Normal certification verifies imported assets
  and retained attestations without rewriting either set of stage keys.
  External target paths must be checked on their bound host.

### Scope and acceptance criteria

- Add a build command that stops after immutable package and asset creation.
  Emit a noneligible build receipt before installed, runtime, or physical-target
  evidence exists.
- Build once after all selected prepare phases. Bind the public and selected
  private source identities plus the exact resulting prepared source tree.
- Export a strict portable bundle containing only the root runtime archive,
  named additional archives, provider provenance, prepared files, optional
  browser artifact, normalized manifest, and required proof identities.
- Reject undeclared files, missing assets, corruption, wrong source, wrong
  architecture, wrong Node, wrong toolchain, changed proofs, and incomplete
  target mappings.
- Import on a fresh path without a builder checkout, development dependencies,
  prior session roots, or rewritten proof inputs.
- Run source build, lint, tests, mapped patch regressions, and selected gate
  commands on the builder against the exact composed source. Emit a portable
  source-gate attestation bound to the build identity, test inventory, toolchain,
  and environment identities.
- Run offline installation, archive-only installed hooks, installed scenarios,
  and physical deployment from the imported bundle without rebuilding.
- Give artifact-only installed hooks verified `artifact`,
  `additionalArtifacts`, `additionalInstalledDirs`, `preparedFiles`, `source`,
  `repository`, and `toolchain` records. Do not expose package-workspace paths.
- Keep source-dependent extension checks before export.
- Add a nonproduction wrapper rehearsal action. It must require a test-owned
  target and use the same activation and rollback implementation as production.
- Use stopped compare-and-swap drift after snapshot for injected rollback. Do
  not add a separate fault API.
- Derive source and target proof success from maintained stage records and
  deployment recovery journals. Reject caller-created success summaries.
- Emit the only production-eligible receipt after exact bundle, source-gate,
  installed-runtime, physical-target, deployment-success, and rollback proofs
  agree.
- Require production activation to consume that receipt after exact source
  integration. Old candidate receipts remain valid only for their existing
  recovery transactions.
- Persist bounded stage and run status, durations, reuse decisions, input
  invalidation reasons, and actionable failures.
- One command drives or resumes eligible stages to a terminal result. Do not
  retry an unchanged failed stage automatically.
- Prove documentation-only metadata changes reuse unchanged source, build,
  package, install, and runtime evidence. Keep reviewed source identity separate
  from build-content identity.
- Add pull-request-specific public workflow concurrency. Never share its group
  with release or production transactions.
- Publish a successful sanitized public arm64 bundle. Never upload a run tree,
  private input, configuration, environment, log, secret, or private artifact.
- Add a measured `hosted-arm` profile for standard 7 GB macOS ARM runners. It
  must record recursive process-tree RSS, memory pressure, swap, disk, duration, and
  concurrency for each child command.
- Keep the complete accumulated suite. Constrain concurrency through supported
  OpenClaw and Vitest controls, not by skipping tests or adding arbitrary heaps.
- Preserve a fast developer path in an ordinary persistent checkout. Run
  incremental semantic checks, relevant tests, and OpenClaw's `qaRuntime`
  profile. Synchronize `dist/` to the isolated DEV server, restart, and run
  relevant integration checks before CI submission. Do not create release
  receipts or certification evidence per edit.
- Let the draft-only build command raise its compilation timeout through one
  validated bound. Reject the override for release and source-gate commands.
  Keep timeout failure terminal and preserve managed child cleanup.
- Preserve every accumulated regression and the plan 037 migration,
  interpreter, prepared-file, browser, additional-install, and rollback
  contracts.
- Add an explicit owner-managed artifact pool. Keep the newest two successful
  bundles and required package proofs, each selected source-gate attestation
  with its regression proof, the newest failed reproduction, all local
  diagnostic logs, and every protected dependency closure.
- Re-importing a retained bundle must recover its source-gate sidecar without a
  source checkout. Certification must accept the recovered genuine attestation
  with unchanged target evidence after disposable run state is removed.
- Run cleanup before capacity checks and after terminal results. Serialize it
  with build registration, import, activation, reference changes, and cleanup.
- Never infer ownership from a directory name or age. Reject links, escapes,
  changed ownership, missing references, malformed metadata, and held locks.
- Leave unregistered legacy directories, production recovery state, sessions,
  worktrees, package-manager caches, containers, and global caches untouched.
- Preserve logical and physical byte reports separately. A capacity failure
  reports required, free, retained, protected, and removable bytes once.

### Architecture and decisions

- Extend `packages/e2e/src/native-pipeline.mjs` at its existing package boundary.
  Keep its preparation, dependency, build, package, install, runtime, and stage
  reuse implementation.
- Add a normalized build identity that separates:
  - selected reviewed source refs;
  - the exact prepared source tree digest used by dependencies and build;
  - release metadata such as the current pull-request head;
  - toolchain, build command, test, and immutable asset identities.
- Stop binding provider package reuse to documentation-only repository head
  changes. Provider provenance still records reviewed public source, but its
  build identity keys the source and command bytes that can affect output.
- Keep `candidate.json` readable for old recovery and integration records.
  New lifecycle commands use versioned build, bundle, certification, deployment,
  and release receipts.
- Put portable manifest and verification helpers in the existing e2e native
  modules. Do not add a scheduler, daemon, general artifact framework, or
  alternate deployment transaction.
- Export through an explicit whitelist. Normalize paths in the manifest and copy
  only selected assets. Import verifies archive entries before extraction,
  rejects links and path traversal, verifies every digest and identity, and
  materializes new transport paths in an imported receipt.
- Treat transport paths as mutable location data. Keep ids, types, archive
  digests, runtime tree digests, source, toolchain, and proof identities
  immutable.
- `openclaw-test-env.mjs build` drives prepare through package and writes
  `build.json` with `eligibility: "built-not-certified"`.
- Ordinary plugin edits run `tsgo:extensions`, `test:extension <id>`, and
  `build-all.mts qaRuntime`. Small core edits run `tsgo:core`, selected Vitest
  files, and the same runtime profile.
- `qaRuntime` owns the complete mutable runtime output closure while skipping
  declarations, UI, and release metadata. Installed DEV receives `dist/`.
  `dist-runtime/` stays local because it is a source-checkout overlay and is not
  part of upstream package selection.
- Changes to package manifests, the lockfile, workspace manifest, toolchain, or
  installed dependencies invalidate the fast path and require a frozen install
  plus complete DEV dependency refresh. Broad SDK and declaration edits use the
  clean build path.
- `openclaw-test-env.mjs source-gate BUILD_JSON` runs source-dependent
  accumulated checks on the builder and writes `puddles.openclaw-source-gate/v1`
  without changing the bundle.
- `openclaw-release-bundle.mjs export|import` moves the portable bundle. Export
  has a public profile that rejects local extensions and a local profile that
  supports declared compiled assets without exporting the extension module,
  config, environment, logs, raw receipts, secrets, or migration values.
- Imported migration identity contains only its digest. The target supplies an
  explicit local path with the same digest.
- `openclaw-test-env.mjs target IMPORTED_BUILD_JSON TARGET_JSON
  [TARGET_SEED_JSON]` creates a new physical rehearsal root atomically when a
  seed is supplied, then runs archive-only installation, installed hooks and
  scenarios without source or development dependencies. The seed binds the
  prior install, state, and service definition bytes used for rollback.
- `apply-and-deploy.sh` action `rehearse` requires an imported build plus a
  target with `purpose: "rehearsal"`. It invokes `activateNative` and derives
  deployment evidence from its journal. It cannot integrate, promote, or
  activate a production target.
- `openclaw-release.mjs certify` verifies exact build, source-gate, installed,
  runtime, and deployment stage evidence and writes a nonproduction
  certification.
- `openclaw-release.mjs promote` verifies complete physical evidence and writes
  `puddles.openclaw-release/v1`. It performs no deployment.
- Production wrapper action `activate` requires release v1, target purpose
  `production`, exact integrated source evidence, and the existing protected
  target transaction.
- The bundle exists before either proof side completes. Required order is:
  build and export, builder source gate and imported target checks in either
  order, certify, promote, source integration, production activation.
- Extend the existing stage engine to record why reuse failed before replacing a
  prior proof. Keep the last failure terminal until inputs change or an explicit
  resume is requested. Keep lock ownership and interruption recovery.
- Public workflow concurrency keys only the repository and pull-request number.
  Push-to-main and private release jobs do not share that group.
- `E2E_RESOURCE_PROFILE=hosted-arm` requires macOS arm64 and at least 6 GiB of
  reported memory. It removes the wrapper's fixed 8 GiB Node heap so the pinned
  OpenClaw compiler uses its maintained host-aware budget. That compiler already
  documents a measured 4.73 GiB peak in a successful 5 GiB slice and failure in
  a 4 GiB slice. The profile runs mapped OpenClaw tests with one worker.
- Version 2 resource receipts use the union of recursive ancestry and the
  command's original process group. This covers detached child groups and
  reparented descendants without changing immutable bundle identity.
  They contain no command arguments, paths, environment, private input, or
  source content. The hosted workflow publishes their sanitized projection.
- `E2E_RESOURCE_MEASURE=1` belongs only to the top-level hosted run. It is
  removed from child environments so nested pipeline regressions inherit the
  host profile without recursively running the sampler.
- Ordinary DEV uses incremental checks and the runtime-only build in a mutable
  source checkout. Private `scripts/openclaw-development-loop.sh` transfers
  built output and runs selected installed assertions. It does not require
  bundle export, rehearsal or certification for each edit. The `build` and
  bundle commands remain available for release work, not as DEV prerequisites.
- `E2E_DEV_BUILD_TIMEOUT_MS` is accepted only by `build`, defaults to the
  release budget when unset, and may range from 1,800,000 through 7,200,000
  milliseconds. Its resolved value is bound to the build proof and provider
  provenance. A successful proof keeps the bound that actually produced it and
  remains reusable when a later draft only raises the requested bound. `ci` and
  `source-gate` always keep 1,800,000 milliseconds.
- `E2E_ARTIFACT_POOL` selects an explicitly initialized stable pool. Each
  object owns copied immutable assets and an ownership digest. References name
  current, pinned, active, paused, failed-debug, deployed, or latest healthy
  recovery closure.
- A successful source gate is a separate immutable pool object that depends on
  its build and owns `source-gate.json` plus the exact passed regression stage
  record. Import restores the current reference to both objects. A retained
  target proof depends on the selected source gate so cleanup cannot break
  later certification. Changed gate inputs create a new sidecar for unchanged
  build bytes instead of mutating old evidence.
- Cleanup keeps all diagnostic-log objects without age or size limits. Full
  homes, databases, runtime state, and recordings are never classified as
  logs.
- Pool cleanup writes an interruption journal, revalidates exact direct child
  roots and ownership immediately before moving them to pool-owned trash, and
  resumes only from that journal.
- `packages/e2e/bin/openclaw-backup.mjs` exposes `plan`, `capture`, `verify`,
  `materialize`, and `retire`. It accepts the full production target plus
  `backupNode` and the one exact state-root-relative exclusion
  `{ "path": "deploy-snapshots", "reason": "legacy-backup-storage" }`.
- `packages/e2e/src/native-backup.mjs` reuses `validateTarget`,
  `systemOperations`, the target lock, service stop/join, clonefile, digest,
  Node, browser, and health primitives. Its narrow schemas do not contain or
  rebind a candidate artifact or receipt.
- `plan` applies the same exclusion walk and reports free bytes plus a
  conservative peak requirement equal to twice the included allocated bytes,
  covering capture and simultaneous isolated materialization. It does not use
  the release pipeline's 25 GiB guard.
- `capture` writes an unreferenced recovery. The outage budget is seven minutes
  at most. A timeout or clone failure immediately attempts unchanged restart;
  restart failure remains explicit and is not described as bounded.
- The stop adapter uses installed stopped-group joining when both lifecycle
  exports exist. The known predecessor contract has neither export, so its
  compatibility path captures exact Darwin or Linux process-start identities
  for the gateway and each process group led by its live descendant tree, then
  waits for those groups to exit after launchd shutdown. A partial lifecycle API
  is rejected before shutdown.
- `materialize` requires a fresh root outside install, state, service, and
  backup paths. It runs the backed-up runtime with the exact retained
  interpreter, parses config and service data, checks SQLite, and verifies the
  browser identity before a compare-and-swap update of
  `backup-references/latest-healthy-recovery.json`.
- Capture and publication do not read or inherit legacy activation state.
- `current` resolves and verifies the authoritative new backup without creating
  missing reference storage.
- `retire` accepts one direct new backup or one separately verified activation
  recovery. Legacy cleanup moves the obsolete pointer first and recovery
  second through a compare-and-swap guarded transition of the new healthy
  reference.
  It refuses changed, referenced, unknown, or ambiguous state and never scans
  or prunes by age.
- `packages/e2e/src/pnpm-toolchain.mjs` owns the exact pnpm `12.3.4` identity
  and `PNPM_CONFIG_STORE_DIR` contract. The configured value must be an
  absolute host-local root. Both Puddles and staged OpenClaw must resolve the
  same `pnpm store path` beneath it.
- The root package manager field uses the same integrity-bound pin as selected
  OpenClaw. pnpm 12 settings move the existing overrides and build-script
  policy to `pnpm-workspace.yaml`. The policy still permits only esbuild's
  install script.
- Hosted public CI selects one runner-local store. Native pipeline receipts bind
  the resolved store path as a build input. Offline runtime installation stays
  store-independent.

### Implementation

- [x] Add versioned release receipt schemas and strict validators.
- [x] Split the native pipeline at package output and add imported certification.
- [x] Add portable bundle export, import, whitelist, and relocation.
- [x] Add artifact-only installed extension context with explicit target binding.
- [x] Add durable run status, terminal failure, duration, reuse, and invalidation
  records.
- [x] Add isolated wrapper rehearsal and deployment proof recording.
- [x] Add release promotion and production activation receipt checks.
- [x] Preserve old receipt recovery without permitting new old-format
  production activation.
- [x] Add deterministic artifact ownership, references, cleanup, and automatic
  native build hooks.
- [x] Retain source-gate attestations and regression proofs as immutable build
  dependencies that survive import and disposable run cleanup.
- [x] Add public workflow concurrency and immutable bundle publication.
- [x] Add portable declaration types for all 16 gateway protocol fragment
  registries and the five affected root exports. Register the fragment
  regression and full root declaration build in the cumulative suite.
- [x] Update `packages/e2e/README.md`,
  `docs/openclaw-setup/patches/README.md`, and only the lifecycle instructions
  that need the new split.
- [x] Add the hosted ARM resource profile, per-command process-group
  measurements, bounded public evidence, and arm64 artifact labeling.
- [x] Prove the ordinary runtime-only build and selected integration checks on
  the dedicated development target within the five-minute warm-edit budget.
- [x] Add a bounded draft-only build timeout override without changing the
  release timeout.
- [x] Implement and focus-test backup-only current production recovery.
- [x] Add the exact legacy activation-to-backup reference bridge and focused
  interruption regressions.
- [x] Migrate and focus-test the unified pnpm pin and host-local store.

### Validation

- Focused pipeline tests prove:
  - build output exists before tests and remains noneligible;
  - exact no-op resume reuses output;
  - changed source, toolchain, tests, assets, and mappings invalidate only
    affected stages;
  - documentation-only head changes do not rebuild or repackage runtime bytes;
  - unchanged failure stops once and status is inspectable.
- Bundle tests prove:
  - import from a relocated root with builder checkout and dependencies absent;
  - exact identities survive relocation;
  - missing, extra, corrupted, linked, traversal, wrong-platform, wrong-Node,
    wrong-toolchain, source, and proof inputs are rejected;
  - public export includes only the whitelist.
- Offline installation tests run under umask `077` and require exact archived
  modes for a directory, executable, ordinary file, and restrictive file. The
  extracted tree must still match its mode-sensitive portable digest.
- Bundle import tests export a prepared directory before switching to umask
  `077`, then require exact directory, executable, and ordinary-file modes plus
  successful build-receipt verification after import.
- Deployment tests invoke the real `apply-and-deploy.sh` path against test-owned
  state for success and compare-and-swap drift rollback. Both use the normal
  activation transaction.
- Gateway protocol tests preserve exact schema identity and compile-time types
  for every fragment. The root build must emit declarations successfully from
  a fresh pinned pnpm 12 install, including the five root exports.
- Proof tests reject edited source and deployment summaries unless their
  maintained stage records and recovery journals match.
- Retention integration creates source evidence through the real pipeline,
  removes the complete disposable run, imports the retained bundle, recovers
  the attestation and regression proof, and certifies against unchanged target
  evidence.
- Integration tests prove interim receipts cannot integrate or activate,
  promotion requires complete evidence, and production activation rejects
  rehearsal targets.
- Workflow tests prove obsolete checks cancel only within one pull request and
  public jobs never select a self-hosted runner.
- Resource tests prove profile architecture and memory checks, child process
  group accounting, pressure and swap parsing, bounded public projection, and
  one-worker mapped test execution.
- Pipeline tests prove the draft timeout reaches the actual build invocation,
  is recorded in its proof, does not leak to the child environment, rejects
  invalid bounds before preparation, cannot alter release commands, and does
  not rebuild a successful artifact merely because the requested bound changes.
- The hosted ARM trial must run the fresh pinned root build, package, offline
  install, all mapped regressions, and all installed scenarios. Its published
  resource evidence decides support. A lowered guard alone is not evidence.
- Hosted run `35302470356` passed prepare, dependency install, and the pinned
  root build. The build took 673 seconds, swap stayed at zero, free memory stayed
  at or above 55 percent, and free disk stayed above 38.5 GB. Regressions then
  failed because nested pipeline tests did not inherit `hosted-arm`; no package
  or installed result from that run is accepted.
- Existing release tests prove draft builds and rehearsal targets cannot
  certify, promote, or activate production.
- Candidate tests pin the incremental core and extension typecheck commands,
  the exact `qaRuntime` output closure, declaration exclusion, and the installed
  `dist/` versus source-only `dist-runtime/` boundary.
- Package tests prove runtime materialization keeps its synchronous 60-second
  release inventory bound and gives DEV the exact selector bundled with npm.
  A real synthetic package proves parity with `npm pack --dry-run`, including
  ignore rules and bundled dependencies.
- A runtime-visible plugin edit measured 16.04 seconds for incremental extension
  typechecking, 22.71 seconds for its focused test file, and 36.41 seconds for
  `qaRuntime`, 75.16 seconds total. The edit changes iMessage normalization of a
  `mailto:` handle and the focused assertion checks the changed result. The
  broader iMessage lane remains available when an edit needs it.
- A real small core edit measured 39.92 seconds for incremental core
  typechecking, 24.54 seconds for its focused unit file, and 36.19 seconds for
  `qaRuntime`, 100.65 seconds total.
- Final private DEV validation includes sync, restart and installed assertions:
  core edit-to-feedback is 188.03 seconds and plugin is 218.753 seconds.
  Cold cache setup and dependency refresh are separate measurements. The
  five-minute value is an acceptance measurement, not a timeout.
- Backup tests prove exact capacity planning and exclusion, disjoint roots,
  writer stop/join ordering, timeout restart, interrupted capture resume,
  manifest and identity tamper rejection, actual isolated consumer checks,
  reference compare-and-swap, exact retirement, and no broad deletion.
- Stop-adapter tests cover the current installed lifecycle API, the actual
  predecessor shape with neither lifecycle export, exact process-start and
  process-group capture, successful post-stop join, malformed ownership, and
  partial API refusal. Backup, interpreter migration, and deployment tests
  remain the focused recovery boundary.
- On `29fa823`, the stop-adapter suite passed 9/9. The combined backup,
  interpreter migration, deployment topology, and stop suites passed 145/145
  before the final malformed-ownership case was added. The final stop suite and
  `packages/e2e` TypeScript check pass.
- Backup materialization tests use the real command runner with a browser CLI
  available only through the caller's selected executable search path.
- The PATH repair passes all 29 backup tests and the `packages/e2e` TypeScript
  check. Retained review independently reproduced child-environment command
  resolution and cleared the complete diff at `4711737`.
- Toolchain tests reject missing or relative store roots, wrong pnpm versions,
  escaped resolved stores, different Puddles/OpenClaw stores, and a missing
  integrity-bound pin. They also prove inspection leaves both manifest and
  lockfile bytes unchanged.
- pnpm 12.3.4 completed a fresh install and then
  `install --offline --frozen-lockfile` against one explicit test-owned store.
- Run focused TypeScript and executable-wrapper tests while iterating.
- Final public candidate runs:
  `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Final local run at `b144f1d` reused exact unchanged prepare, dependency, and
  build proofs, then passed regressions, extension and provider packaging,
  prepared files, portable package creation, offline installation, additional
  runtime installation, installed runtime checks, and all nine scenarios.
- The retained reviewer rechecks the complete diff after focused gates.
- Hosted public checks must pass on `macos-15` and publish the arm64
  nonproduction bundle plus bounded resource evidence.
- Hosted cumulative run `35482638315` passes on exact public source
  `c188fccdf5796e469be86e8b55b011adbe784675`, tree
  `bc7b511efbcbf10ddb55ca35c2494a59072c8c77`. It completes the accumulated
  lifecycle, exports and retains the public ARM bundle, and retains the
  resource evidence.
- The private owner completed the composed ARM source and physical target
  lifecycle before coordinator integration. Plan 039 records the exact runtime
  identities, coexistence qualification and final artifact-only replay.

### Rollout and rollback

- Public #117 and private #39 are merged with green post-merge checks.
- Public release builds run on hosted ARM. The private composed release uses
  the authorized local builder fallback under the same artifact contract.
  Public workflows never consume private input.
- Daily DEV transfers built runtime output without a release receipt. Release
  TEST consumes a sealed bundle without source rebuilding. Neither authorizes
  production.
- Local fallback builds on the development Mac and transfers sealed artifacts
  to TEST. Production activation remains a separate authorized transaction.
- A failed build or certification leaves terminal local evidence and no eligible
  receipt.
- A failed rehearsal uses the existing activation recovery journal and restores
  test-owned package, state, service, prepared files, additional installs, Node,
  and browser state.
- Promotion creates a new immutable release receipt. It never edits a bundle,
  certification, deployment proof, recovery journal, or old candidate.
- Production rollback keeps the plan 037 recovery contract and consumes the
  exact retained release assets.
- The authorized backup-only maintenance and exact old-copy disposal are
  complete. No repeat capture, production stop, live restore or additional
  deletion is authorized by this closeout. Preserve the current healthy backup.

### Review log

The entries below record implementation history, not current blockers.
Retained review and applicable cumulative gates are complete. Plan 039 is the
canonical final operating state; production upgrade remains separately gated.

- 2026-09-14: Retrospective owner and coordinator accepted the single public
  owner and script-owned lifecycle.
- 2026-09-14: Private research confirmed selected private preparation changes
  root OpenClaw. The contract now builds once from the combined selected source.
- 2026-09-14: Coordinator identified a possible eligibility cycle. The contract
  now has an explicit nonproduction rehearsal action.
- 2026-09-14: Process review separated builder-only source gates from
  importer-only archive and physical-target checks. Both produce immutable
  maintained evidence for the same build identity.
- 2026-09-14: The retained reviewer cleared public head `76ed2e4`.
- 2026-09-14: The first fresh private ARM build exposed TS2883 in gateway
  protocol registries. The first capped diagnostic batch named five fragments,
  and the next batch named more. Exact explicit annotations now cover all 16
  fragments, preserving runtime and static schema identity while making
  declaration output portable.
- 2026-09-14: The next ARM build passed the package declaration phase and
  exposed five inferred root exports in the unified declaration phase. Exact
  existing factory return types now cover those exports, and a fresh pinned
  root build passes the complete declaration pipeline.
- 2026-09-15: Artifact-only diagnosis found that successful retention kept
  package proofs but dropped the separate source attestation. Source gates now
  have an immutable retained sidecar and dependency closure, so deleting a
  successful run no longer makes unchanged certification impossible.
- 2026-09-15: Retained review found that the first repair kept only the current
  build's gate. Cleanup now keeps the newest gate for each of the two retained
  successful builds and collects superseded gates. The reviewer reproduced
  two-build retention and third-build eviction, then cleared the complete diff.
- 2026-09-15: The user selected standard 7 GB hosted ARM builders for public
  and private source work, with the mini limited to artifact-only checks.
  Research found the public 8 GiB floor had no benchmark, while pinned OpenClaw
  already carries measured host-aware compiler sizing.
- 2026-09-17: Retained review cleared `557e0d8`. Hosted run `35302470356`
  proved the root build fits, then exposed profile loss in nested pipeline
  tests and incomplete RSS accounting for detached grandchildren. The repair
  propagates the selected profile and measures recursive process ancestry.
- 2026-09-18: Hosted run `35316103588` passed the complete public lifecycle at
  `f547621`, with a 3.47 GB process-tree RSS peak, at least 49 percent free
  memory, zero swap, and at least 36.5 GB free disk. The remaining development
  blocker is the separate draft build timeout on slower local hardware.
- 2026-09-18: The ordinary persistent checkout completed a real plugin edit in
  75.16 seconds and a real small core edit in 100.65 seconds using incremental
  semantic checks, focused tests, and the maintained `qaRuntime` profile. The
  plugin edit changes emitted runtime behavior rather than only a type surface.
- 2026-09-19: Actual DEV bootstrap found npm inventory selection can exceed the
  fixed 60-second release bound for the 10,063-file candidate under host load.
  A first bounded repair then proved insufficient when selection exceeded ten
  minutes. Inspection found `npm pack --dry-run` still builds tarball metadata
  after selecting files. The bundled npm selector alone returns the actual
  candidate inventory in 16.57 seconds and avoids that unnecessary bootstrap
  work. Release packaging still uses the original 60-second command.
- 2026-09-19: Hosted cumulative run `35482638315` passed on the reviewed
  selector repair at `c188fcc`, including the complete public lifecycle, ARM
  bundle export and retention, and resource evidence retention.
- 2026-09-20: The user requested a bounded replacement for recursive production
  recovery storage while the release remains paused. The public design reuses
  the native activation helpers but has a narrow receipt-free backup record
  because activation journals are bound to candidate artifacts. Private
  composition accepts the `plan|capture|verify|materialize|retire` contract.
- 2026-09-20: The user required active Puddles, private, and selected OpenClaw
  workflows to share pnpm 12.3.4 and one content-addressed store per machine.
  The migration keeps portable archives independent and classifies the existing
  primary OpenClaw checkout on pnpm 11.2.2 as a legacy consumer, not a managed
  release input.
- 2026-09-20: Retained review found one blocking hard-kill recovery gap in
  backup capture. Explicit resume now reclaims only a dead owner's exact lock
  after validating the stopped journal and target identity. The retained
  reviewer verified the repair and cleared the complete current diff.
- 2026-09-20: Exact pnpm 12.3.4 verification now reads both integrity-bound
  manifests and queries version and store from a neutral directory, leaving
  both lockfiles byte-identical. Public and private fresh/offline proofs pass.
  The final accumulated public lifecycle passes with nine scenarios.
- 2026-09-20: Backup readiness no longer depends on interpreting the old
  activation format. Fresh capture and same-consumer publication use only the
  current runtime, state, service, Node, browser, and new healthy reference.
  Exact old activation cleanup is a later guarded operation.
- 2026-09-20: The first authorized current-runtime capture exposed that the
  predecessor process SDK has neither lifecycle export used by the new stop
  adapter. The compatibility branch now captures the gateway generation and
  only process groups led by its live tree, then waits for those exact groups
  after launchd shutdown. Current runtimes keep the durable ownership-record
  path.
- 2026-09-20: Retained review cleared `29fa823`. The reviewer also exercised a
  real detached leader with an in-group child, confirmed join blocks until the
  group exits, and confirmed a surviving group reaches the deadline error.
  Remaining notes are fail-closed retry cases or coverage gaps, not findings.
- 2026-09-20: A valid production backup captured and verified, then
  materialization failed before browser inspection because the backup command
  environment omitted the configured Docker path. The one-line PATH repair and
  real-runner regression pass focused tests. Retained review cleared `4711737`.
- 2026-09-20: The accumulated release gate exposed caller-umask mode loss while
  extracting the sealed runtime. Runtime installation and release-bundle import
  now preserve archived permissions before their existing digest checks.
  Retained review found and cleared a test-fixture defect after both regressions
  proved permissive sealing and restrictive extraction under shell umasks `022`
  and `077`.

### Checklist

- [x] Read plan 037, e2e lifecycle, deployment guide, pipeline, state, package,
  extension, activation, integration, workflow, and related tests.
- [x] Confirm sole public ownership and no new coding workers.
- [x] Record issue #118.
- [x] Send the stable command and receipt contract to the process owner,
  coordinator, and private consumer.
- [x] Resolve the combined-source build and rehearsal eligibility cycle.
- [x] Implement receipts, bundle, lifecycle split, status, rehearsal, and
  promotion.
- [x] Add committed focused regressions.
- [x] Update public workflow and documentation.
- [x] Complete retained adversarial review with no material finding.
- [x] Run final cumulative validation, retained review, and hosted checks for
  the source-gate retention repair.
- [x] Push PR #117 updates and verify conflict-free ancestry.
- [x] Pass exact local accumulated CI and hosted public checks.
- [x] Hand stable commands to private ARM consumer for combined proof.
- [x] Define the shared hosted ARM resource and receipt contract.
- [x] Add focused ARM profile, measurement, artifact-label, and development
  nonpromotion regressions.
- [x] Run the branch-only hosted ARM trial and inspect its resource evidence.
- [x] Resume the retained reviewer on the complete ARM profile diff.
- [x] Review and publish the bounded draft-only timeout repair.
- [x] Complete retained review and the accumulated public gate for the final
  receipt-free backup capture and separate exact cleanup path.
- [x] Complete focused validation and retained review for predecessor stop
  compatibility before another production backup attempt.
- [x] Restore backup verification command resolution and complete retained
  review.
- [x] Preserve runtime and release-bundle permissions across caller umasks and
  complete focused validation and retained review.
- [x] Complete the applicable accumulated gate and private binding for the
  backup PATH repair.
- [x] Complete FLOW-06 phase-owned input review and affected-only reuse proof.
- [x] Complete compatibility, retained review, and accumulated gates for pnpm
  12.3.4 and the shared host-local store.
- [x] Complete coordinated integration and post-merge verification.
