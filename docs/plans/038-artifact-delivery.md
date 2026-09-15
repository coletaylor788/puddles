# OpenClaw artifact delivery

Status: Implementation in progress
Issue: #118
Last updated: 2026-09-14
Owner: Public OpenClaw engineering owner

## Human section

### Design

Separate building an OpenClaw release from proving that it is safe to activate.
The build step applies the selected public and private source changes once,
packages the resulting runtime and its required assets, and produces an
immutable bundle. That bundle is useful before installed and physical-target
testing finishes, but it is explicitly not eligible for production.

The bundle contains only a strict list of release files and normalized identity
records. It does not contain the builder checkout, dependency workspace,
configuration, credentials, logs, or private extension inputs. A consumer can
import it at a different path or on another host and verify the same source,
toolchain, archive, provider, prepared-file, and browser identities. Installed
checks use these verified records instead of reaching back into the build
workspace.

Source tests continue to run on the builder because they need the composed
source and development dependencies. They produce a separate immutable
attestation bound to the bundle's build identity. The importer runs only
archive-based checks: offline installation, installed runtime scenarios, and an
isolated deployment rehearsal. Rehearsal uses the same staging, stopped
migration, startup, recovery, and rollback implementation as production. It is
allowed only for a test-owned target and cannot authorize production. A final
release receipt is created only after the source tests, installed runtime,
physical target, successful deployment, and injected-failure rollback evidence
all bind to the same bundle. Production activation requires that receipt and
confirmed source integration.

Ordinary scripts own this lifecycle. Each command records a bounded terminal
result, duration, reuse decision, and failure or invalidation reason. A stopped
or failed run can be inspected and resumed without an agent watching logs.
Public pull requests remain credential-free. They publish only an Intel test
bundle and cancel obsolete checks for the same pull request. Private ARM builds
run only through the private self-hosted workflow.

An owner-managed artifact pool keeps disk use bounded without guessing which
directories are safe to delete. Producers register exact assets, ownership,
dependencies, and lifecycle references. Cleanup keeps two successful bundles
and their package proofs, one failed reproduction, every local diagnostic log,
and everything reachable from active, paused, pinned, deployed, recovery, and
debug references. It runs before capacity checks and after terminal results.
Unknown or malformed state blocks deletion. Production recovery state and
unregistered legacy directories are never adopted automatically.

### Status

The existing build, package, offline install, installed scenarios, activation,
and rollback paths are the implementation base. The stable command and receipt
contract is shared with the coordinator, process owner, and private consumer.
The contract builds once from the combined selected source and keeps source-only
checks before export.

The portable bundle, source attestation, archive-only target context, split
certification and promotion receipts, isolated wrapper rehearsal, durable
status, selective reuse, public workflow publication, and deterministic
artifact retention are implemented. Bundle import and target runs now register
their build, active, success, diagnostic, and failed-reproduction evidence
automatically. Focused delivery tests and the real wrapper success and rollback
cases pass. Retained review, the exact accumulated gate, hosted checks, and
private ARM adoption remain.

## Agent section

### State

- Tracking issue: #118.
- Follow-up pull request: #117, based on `main`.
- Current public branch includes the reviewed stopped migration and deployment
  correction from plan 037. Those behaviors remain prerequisites.
- Implementation is authorized without a design pause.
- This session is the sole public coding owner. No coding worker may be added.
- Retain reviewer `2da2a59c-534c-4e28-b63a-bbc02fbb1b2b` for the complete
  current diff.
- Private composition, target values, self-hosted ARM workflow, and production
  activation stay outside the public repository.
- Public hosted output is Intel x64 test evidence. It is never labeled or
  accepted as an ARM production release.

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
- Publish a successful sanitized public x64 bundle. Never upload a run tree,
  private input, configuration, environment, log, secret, or private artifact.
- Preserve every accumulated regression and the plan 037 migration,
  interpreter, prepared-file, browser, additional-install, and rollback
  contracts.
- Add an explicit owner-managed artifact pool. Keep the newest two successful
  bundles and required package proofs, the newest failed reproduction, all
  local diagnostic logs, and every protected dependency closure.
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
- `openclaw-test-env.mjs source-gate BUILD_JSON` runs source-dependent
  accumulated checks on the builder and writes `puddles.openclaw-source-gate/v1`
  without changing the bundle.
- `openclaw-release-bundle.mjs export|import` moves the portable bundle. Export
  has a public profile that rejects local extensions and a local profile that
  supports declared compiled assets without exporting the extension module,
  config, environment, logs, raw receipts, secrets, or migration values.
- Imported migration identity contains only its digest. The target supplies an
  explicit local path with the same digest.
- `openclaw-test-env.mjs target IMPORTED_BUILD_JSON TARGET_JSON` runs
  archive-only installation, installed hooks and scenarios, plus deployment
  rehearsal without source or development dependencies.
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
- `E2E_ARTIFACT_POOL` selects an explicitly initialized stable pool. Each
  object owns copied immutable assets and an ownership digest. References name
  current, pinned, active, paused, failed-debug, deployed, or latest healthy
  recovery closure.
- Cleanup keeps all diagnostic-log objects without age or size limits. Full
  homes, databases, runtime state, and recordings are never classified as
  logs.
- Pool cleanup writes an interruption journal, revalidates exact direct child
  roots and ownership immediately before moving them to pool-owned trash, and
  resumes only from that journal.

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
- [x] Add public workflow concurrency and x64 bundle publication.
- [x] Update `packages/e2e/README.md`,
  `docs/openclaw-setup/patches/README.md`, and only the lifecycle instructions
  that need the new split.

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
- Deployment tests invoke the real `apply-and-deploy.sh` path against test-owned
  state for success and compare-and-swap drift rollback. Both use the normal
  activation transaction.
- Proof tests reject edited source and deployment summaries unless their
  maintained stage records and recovery journals match.
- Integration tests prove interim receipts cannot integrate or activate,
  promotion requires complete evidence, and production activation rejects
  rehearsal targets.
- Workflow tests prove obsolete checks cancel only within one pull request and
  public jobs never select a self-hosted runner.
- Run focused TypeScript and executable-wrapper tests while iterating.
- Final public candidate runs:
  `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- The retained reviewer rechecks the complete diff after focused gates.
- Hosted public checks must pass and publish the x64 nonproduction bundle.
- Private owner must prove the combined ARM flow with the same commands before
  coordinator integration.

### Rollout and rollback

- Push coherent commits to PR #117 so public checks overlap implementation.
- Do not merge or activate production from this session. Coordinator session
  `972af1c7-a25d-46c6-8e49-cf5250d74b8b` owns the integration decision.
- Private self-hosted workflow builds the combined exact source on the selected
  ARM host. Public workflows never call that runner.
- A failed build or certification leaves terminal local evidence and no eligible
  receipt.
- A failed rehearsal uses the existing activation recovery journal and restores
  test-owned package, state, service, prepared files, additional installs, Node,
  and browser state.
- Promotion creates a new immutable release receipt. It never edits a bundle,
  certification, deployment proof, recovery journal, or old candidate.
- Production rollback keeps the plan 037 recovery contract and consumes the
  exact retained release assets.

### Review log

- 2026-09-14: Retrospective owner and coordinator accepted the single public
  owner and script-owned lifecycle.
- 2026-09-14: Private research confirmed selected private preparation changes
  root OpenClaw. The contract now builds once from the combined selected source.
- 2026-09-14: Coordinator identified a possible eligibility cycle. The contract
  now has an explicit nonproduction rehearsal action.
- 2026-09-14: Process review separated builder-only source gates from
  importer-only archive and physical-target checks. Both produce immutable
  maintained evidence for the same build identity.
- Retained complete-diff review is pending implementation and focused tests.

### Checklist

- [x] Read plan 037, e2e lifecycle, deployment guide, pipeline, state, package,
  extension, activation, integration, workflow, and related tests.
- [x] Confirm sole public ownership and no new coding workers.
- [x] Record issue #118.
- [x] Send the stable command and receipt contract to the process owner,
  coordinator, and private consumer.
- [x] Resolve the combined-source build and rehearsal eligibility cycle.
- [ ] Implement receipts, bundle, lifecycle split, status, rehearsal, and
  promotion.
- [ ] Add committed focused and cumulative regressions.
- [ ] Update public workflow and documentation.
- [ ] Push PR #117 updates and verify conflict-free ancestry.
- [ ] Complete retained adversarial review with no material finding.
- [ ] Pass exact local accumulated CI and hosted public checks.
- [ ] Hand stable commands to private ARM consumer for combined proof.
- [ ] Hold merge and production activation for coordinator authorization.
