# Plan 039 - OpenClaw development and delivery

**Status:** Implementation in progress
**Issue:** [#118](https://github.com/coletaylor788/puddles/issues/118)
**Last updated:** 2026-09-19
**Owner:** Delivery coordinator

## Human section

### Design

Work in the two normal local repositories. Build incrementally and run unit
tests on the development Mac, transfer the built output over SSH to DEV on the
mini, and run integration tests there. The mini is a remote development server,
not another release pipeline. Repeat until the tests pass and the change is
ready, then push it to CI. Ordinary warm edits should give feedback in minutes.

The short version:

```mermaid
flowchart TD
    Local["Code, build and unit test locally"]
    Dev["Deploy to DEV and run integration tests"]
    CI["CI builds and checks a release"]
    Test["Install and validate that release in TEST"]
    Prod["Deploy the same release to PROD"]

    Local --> Dev
    Dev -->|Fix and retry| Local
    Dev -->|Green| CI
    CI -->|Pass| Test
    Test -->|Fix and retry| Local
    Test -->|Pass, merge and approve| Prod
```

After the push, CI does the clean build, complete checks and release packaging.
Public CI runs independently; the private builder combines the selected public
and private changes. The resulting release is installed without rebuilding in
a separate TEST instance. After checks, review and source integration, the same
release can go to PROD with the required authorization. Standard hosted ARM
builders are preferred; the development Mac is the fallback when hosted
capacity or the no-paid-hosting limit prevents that.

DEV, TEST and PROD keep separate state and services. DEV needs ordinary compiler
caches, a small deploy command and integration tests, not release receipts,
certification or a recovery snapshot for every edit. CI tests the complete
deployment and rollback mechanism in TEST. PROD keeps a healthy release and
rolls back only on a real failure. Scripts run these steps without an agent
watching them. Owned temporary files are cleaned up while useful release
evidence, unbounded local diagnostic logs and protected recovery remain safe.

### Status

The complete public pipeline passes on a standard 7 GB hosted ARM runner,
including the fresh build, accumulated regressions, offline installation and
runtime scenarios. The ARM bundle is published and independent review is clear.
DEV now runs on the mini. A representative plugin change completes the local
work, transfer, restart and remote behavior assertion in two minutes fifty-four
seconds, with no external calls. The equivalent core-change measurement is
still local-only. That successful plugin run predates a rollback correction,
so the affected checks must be refreshed for the latest private version.

The private composed release, complete physical release proof, remaining DEV
acceptance checks and workspace cleanup are not yet complete. The fresh local
release run passes the root build and mapped regressions, but is blocked on
offline dependencies and tight disk headroom. Its successful work is preserved.
One concrete storage or bounded hosting decision is being prepared; no cleanup
or paid execution is approved. Neither delivery change is merged. Production
remains unchanged.

## Agent section

### State

- This is the coordinator-owned end-to-end scope and completion checklist for
  issue #118. Do not replace it with the latest failure, commit, or worker
  handoff. Keep both sections current when scope or status changes.
- Plan 038, `docs/plans/038-artifact-delivery.md`, holds the public implementation
  details on PR #117. It is not present on this document's initial base branch.
  The deployment owner keeps host-specific configuration and the private
  implementation plan in the private repository.
- Plan 036 explains the existing native pipeline. Plan 037 holds the current
  OpenClaw upgrade requirements. Their applicable migration, integration, and
  rollback obligations remain in force.
- The original request included the fast local development instance from the
  start. It is not a future enhancement or another name for the release test.
- The requester clarified that deployed integration tests, not only smoke or
  manual inspection, must be green in DEV before the normal CI submission.
  A high pass-through rate from CI to production is an outcome to measure,
  not a reason to suppress an independent release check.
- The requester clarified that DEV is a remote development server for the two
  ordinary local workspaces. Release bundle creation, `build.json`, source
  attestation, certification and per-edit Git identity are not prerequisites
  for normal DEV deployment. Keep that machinery on the release path.
- Public evidence checkpoint:
  `f547621e6b6e3c24260c8530a7b9d2371ddc7c1f`, tree
  `954b2e3e9b566ac7e350f140085dc0430a7a0022`. Hosted cumulative run
  `35316103588` passes prepare, dependencies, the pinned root build, full
  regressions, packaging, offline installation, runtime and nine scenarios
  in about 27 minutes. CodeQL passes and the retained reviewer clears the
  complete diff. This is actual hosted ARM evidence, not a lowered guard alone.
- That run uses `macos-15`, 7,516,192,768 bytes of RAM and three CPUs.
  The owner reports resource-v2 measurements over 107 commands:
  3,467,526,144 bytes peak recursive/process-group-union RSS, at least 49 percent
  free memory, zero swap, and at least 36,548,571,136 bytes free disk.
  The run publishes `public-native-resources-35316103588-1` and a correctly
  labeled `openclaw-public-arm64-build-*` bundle.
- The draft build timeout repair is reviewed and focused-green at
  `5945dc74b339dc6db16f2a87ae9bf94009b79f97`, tree
  `2996dd2847b49bfbe8cce88ae39d0ab03d1751ec`; its cumulative and CodeQL hosted
  checks also pass.
  `E2E_DEV_BUILD_TIMEOUT_MS` accepts an integer from 1,800,000 through 7,200,000
  only for `build`. A retained failed run can use the same `E2E_RUN_DIR` and
  `node packages/e2e/bin/openclaw-test-env.mjs resume build` with the larger
  bound. The actual producing bound remains in proof/provenance, and increasing
  a later draft's requested allowance does not rebuild an unchanged success.
- The retained local DEV run passes the actual root build in 2,031,493 ms
  (33 minutes 51 seconds) under a 3,600,000 ms draft allowance. The timeout
  repair is therefore exercised, not merely configured. This is a full
  `pnpm build`, not a measured warm incremental edit. Preparation/dependency
  reuse and no-op cache hits do not establish incremental compilation.
  `ci`, `source-gate` and other commands reject the override and keep their
  release policy. Unset it before those commands. Keep stage duration distinct
  from overall run duration and preserve managed process-tree termination.
- The private owner has reviewed and pushed the package-before-gate repair,
  separating construction/sealing from certification tests. Its focused
  regression passes without a previous gate invocation. The earlier run failed
  before `build.json` and bundle publication, so the current API cannot adopt
  its raw build-stage outputs under the changed private identity.
- Preserve that failed run and its genuine evidence. Do not rewrite its
  configuration, copy raw stage proofs, or relabel old output as a new attested
  release. The private owner reports corrected comparisons show the package-only
  repair leaves both candidate and root-build inputs unchanged. Its earlier
  comparison omitted public patches after a probe import failed.
- The public owner reports a runtime-changing plugin edit on the persistent
  candidate workspace: recognize `mailto:` in
  `extensions/imessage/src/normalize.ts` and recursively normalize its remainder.
  The assertion is
  `expect(normalizeIMessageMessagingTarget("mailto:User@Example.com")).toBe("user@example.com")`.
  Extension typechecking takes 16.04 seconds, focused `normalize.test.ts`
  passes 8/8 in 22.71 seconds, and `qaRuntime` takes 36.41 seconds.
  The local total for that earlier run is 75.16 seconds. The private owner
  subsequently deployed and asserted this runtime edit remotely; that complete
  loop is recorded below and uses its own measured local segment.
  Small core edit: `pnpm tsgo:core` 39.92 seconds, focused test 24.54 seconds,
  and `qaRuntime` 36.19 seconds, totaling 100.65 seconds locally.
  These are local segments, not end-to-end DEV results.
- The earlier 207.71-second plugin example added only an optional field in
  `monitor/types.ts`. TypeScript erases it, so it does not prove changed emitted
  runtime bytes. It measured typechecking, all 1,289 extension tests and runtime
  building. The corrected example uses focused tests; these totals are not an
  apples-to-apples speed comparison.
- The maintained `qaRuntime` profile builds runtime output, plugin assets,
  external plugin local output, postbuild files and stamps without release
  declarations. Sync `dist/` for installed DEV, not source-checkout-only
  `dist-runtime`. The private owner has measured the plugin's complete loop;
  the equivalent core-edit loop is still outstanding. Dependency, manifest,
  lockfile or toolchain changes require bootstrap/dependency refresh rather
  than this unchanged-dependency fast path.
- The cold DEV inventory bottleneck was tar creation performed by
  `npm pack --dry-run` after file selection, not a need for a larger timeout.
  Public repair `c188fccdf5796e469be86e8b55b011adbe784675`, tree
  `bc7b511efbcbf10ddb55ca35c2494a59072c8c77`, uses npm's exact bundled
  packlist/Arborist selector for DEV. Actual candidate selection takes
  13.9 to 16.6 seconds for 10,063 files. Synthetic npm parity and byte-identical
  bundled-dependency runtime evidence pass; retained full-diff review is clear.
  The release path is unchanged. Private used the repair to complete actual
  cold bootstrap and the runtime-changing plugin loop.
- The private DEV implementation has retained review clearance at `9830b25`.
  Its contract suite reports 68 passing tests and two intentional skips.
  An independent 80 MiB, two-batch transport check with symlink and digest
  verification passes and its test roots are cleaned. That is not bootstrap
  proof by itself.
- The coordinator reports terminal private DEV success at pushed `e50b9bb`:
  cold bootstrap completes and DEV runs with three configured plugins loaded.
  The actual iMessage runtime edit is deployed and asserted in 174 seconds
  end to end. Rounded phase times are 131 seconds local work, nine preparation,
  11 transfer, and 22 activation plus integration; rounding accounts for the
  difference from the reported total. Recording-only execution reports zero
  external calls. PROD remains healthy and TEST is absent.
- That candidate reports 72 contract passes and two intentional skips; the
  retained reviewer is rechecking it. This proves the representative plugin
  loop, not the core-edit end-to-end case or every DEV acceptance item.
  Keep the earlier local-only core timing separate.
- The selected OpenClaw source is
  `1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7` (`v2026.9.3`). The selected
  candidate Node version is `26.1.0`; upstream pnpm is `12.3.4`. Do not silently
  change the release or toolchain while changing the delivery topology.
- Earlier private diagnosis passes retained-bundle import, offline install and
  all 11 installed scenarios, but fails migration preflight before shutdown.
  The corrected migration fixture now has a different manifest digest.
  Artifact-only run `35476744042` on private `9830b25` and public `e6c9a25`
  rejects that mismatch before import or shutdown. Neither retained successful
  build binds the corrected manifest; neither failure proves rollback.
- Stop artifact-only retries against those immutable receipts. The private
  owner is adding a migration-first diagnostic regression. The public owner
  confirms ordinary `ci` in the same maintained `E2E_RUN_DIR`, with
  `E2E_STATE_MIGRATION_MANIFEST` pointing to the corrected file, is the supported
  recovery path. Migration is excluded from `buildStageInputs`: matching actual
  build inputs reuse the successful root stage while migration-bound
  regressions, runtime proofs and receipts regenerate. A committed regression
  verifies the root build count remains one after a manifest-byte change.
- The only plausible surviving reuse candidate is a superseded DEV builder
  bound to old configuration and source heads. The current private release
  workflow has no maintained route from that producer to current TEST.
  Coordinator decision: use a fresh normal release build under existing
  resource and no-paid-hosting gates, rather than add a legacy-run adapter
  solely to avoid this build. Preserve the old run and evidence. This does not
  make ordinary DEV edits run release builds.
- The fresh authorized local release run on public `c188fcc`, private `e50b9bb`
  and upstream `1391f7c` passes prepare, dependencies, root build and mapped
  regressions. It then encounters missing offline keytar/copilot inputs normally
  supplied by hosted setup. The patched store is populated, but a targeted
  private store install encounters repeated optional download resets and
  copilot availability is not yet verified. Preserve the completed build and
  evidence; do not repeat a full build for prerequisite diagnosis.
- Retained review found a DEV rollback shutdown race, corrected at `b543049`
  with 73 contract passes and two intentional skips. The earlier `e50b9bb`
  plugin timing remains historical evidence, not final-head certification.
  Refresh affected review/runtime proofs and verify actual-input reuse for the
  current maintained release run. Do not relabel old receipts or discard
  unrelated successful build evidence.
- The development Mac now reports 26,577,392 KiB free, about 25.35 GiB,
  only 0.35 GiB above the unchanged 25 GiB guard. No safe new build or cleanup
  is authorized. Private hosted billing approval is absent. The coordinator
  owns one requester decision after a bounded packet identifies either an
  exact audited cleanup candidate or verified hosting cost, remaining allowance
  and an enforceable cap. First distinguish remaining same-run disk needs
  from a fresh build's peak; safe supported reuse may avoid a new resource
  decision. No broad audit, repeated full retry or account change is authorized.
- Retained bundle import cannot adopt builder stages or issue a receipt for
  corrected migration bytes; it restores the old immutable identity and has
  no migration body to recover. Never rewrite sealed hashes, copy stages into
  another run, repurpose old configuration or infer missing manifest contents.
- The missing source-gate retention defect is repaired in the public checkpoint.
  The older retained regression record alone cannot recreate its missing source
  attestation because the attestation also binds inventory and extension gate
  identity. Refresh the required source gate without rebuilding unchanged
  runtime inputs.
- Approved historical cleanup is complete. It does not authorize new deletion
  of global caches, unknown fixtures, application sessions, or recovery state.
- The public owner owns shared code and public CI. The private owner owns
  composition, concrete targets, the development command, and private CI.
  The coordinator owns this checklist and exact cross-repository integration.
  Keep the existing engineering owners and retained reviewers.

### Scope and acceptance criteria

- Deliver a usable local edit/build/unit-test/SSH-deploy/integration-test loop
  for a distinct DEV target. It must accept development drafts without
  release receipts, frozen run identity, certification or the full accumulated
  gate after every edit. Relevant local unit and deployed integration checks
  must pass before normal CI submission.
- Prove that real ordinary warm edits, not just unchanged reruns, give feedback
  within minutes. Use a working budget of at most five minutes from a
  representative small edit through compilation, focused unit tests, output
  transfer, DEV restart and relevant integration checks. Record cold bootstrap
  and broad dependency/SDK changes separately; they cannot justify a full root
  build on every ordinary edit. This performance budget is an acceptance
  measurement, not a new process-killing timeout.
- Keep DEV, TEST, and PROD positively disjoint in writable state, runtime
  installation, configuration, workspace, sessions, indexes, ports, processes,
  and service identity. Do not rely only on different labels.
- Validate public and private release builds on real standard 7 GB macOS ARM
  runners, or record the measured blocker and operate the authorized builder
  fallback. Do not claim that the requested hosted profile works if only the
  fallback works.
- Preserve the entire accumulated regression pool. Lower resource use with
  supported concurrency and workspace reuse, not missing tests or fabricated
  proof records.
- Separate release building from target installation. The normal target
  consumer must need neither an OpenClaw checkout nor compiler/dependency
  installation. Build bundles must be useful for diagnosis before certification.
- Bind the composed source, toolchain, platform, runtime archives, additional
  runtimes, prepared assets, migration, browser, destination mappings, test
  inventory, and required target evidence through the maintained receipt types.
- Keep public CI independent and credential-free. Keep private source, bundles,
  configuration, raw diagnostics, and local migration inputs out of public
  artifacts. Hosted builds must not depend on the target host's live home.
- Use explicit recording adapters for automated external writes and synthetic
  content for assertions. Required unavailable read-only host checks fail
  explicitly. No live-message fallback is allowed.
- Prove installation and the real deployment transaction on TEST, including
  startup, post-snapshot configuration failure, automatic recovery, and
  preservation of the intended effective job set.
- Keep the newest two successful bundles with required proof closure and one
  failed reproduction, plus all active, paused, pinned, deployed, recovery, and
  debug dependencies. Keep ordinary local diagnostic logs without expiry or
  byte caps, separate from full homes, databases, recordings, and workspaces.
- Reclaim only explicitly owned disposable state. Cover source checkouts and
  scratch space as well as the artifact pool. Preserve required evidence before
  deleting its producer state, and measure actual free space rather than assume
  directory footprint equals physical reclaim.
- Scripts drive and resume normal stages to a durable terminal result. A
  failure stops with actionable diagnostics. Agents repair defects rather than
  advance each stage, poll unchanged jobs, or rerun unchanged failures.
- Integrate the reviewed compatible source and verify the default-branch result.
  Process completion must not stop at green local tests or open pull requests.
  Actual production activation remains a distinct authorized operation.

### Architecture and decisions

The following diagram is the target workflow, not a claim that every path is
already operational. Failures return to the relevant focused loop. Unchanged
artifacts and genuine evidence remain reusable.

```mermaid
flowchart TD
    Edit["Edit on development Mac"] --> Local["Incremental build and local unit tests"]
    Local --> Dev["SSH built output to DEV on target host"]
    Dev --> Smoke["Relevant deployed integration tests and smoke checks"]
    Smoke --> Ready{"Local unit and deployed integration checks green?"}
    Ready -->|No| Edit
    Ready -->|Yes| Push["Push exact candidate refs and update PRs"]

    Push --> Public["Public ARM CI: public build and regression gates"]
    Push --> Private["Private ARM builder: composed runtime and source gates"]
    Fallback["Development Mac builder fallback"] -.-> Private
    Private --> Bundle["Immutable ARM bundle and source evidence"]
    Bundle --> Test["TEST: artifact-only install, scenarios, deployment and rollback regression"]

    Public --> Gates{"Checks, review and release proofs pass?"}
    Test --> Gates
    Gates -->|No| Diagnose["Diagnose failed stage and reuse valid evidence"]
    Diagnose --> Edit
    Gates -->|Yes| Integrate["Integrate exact source, certify and promote"]
    Integrate --> Authorize["Separate production authorization"]
    Authorize --> Prod["PROD installs the tested artifacts without rebuilding"]
    Prod --> Health{"Required read-only health checks pass?"}
    Health -->|Yes| Keep["Keep new release running"]
    Health -->|No| Restore["Restore previous runtime and state"]
    Restore --> Diagnose
```

- DEV is mutable and explicitly non-production-eligible. TEST evaluates frozen
  artifacts. DEV activity must not overwrite an in-flight TEST installation or
  its evidence. Neither is the production service with a different port.
- Normal DEV uses existing local compiler/component commands and a thin SSH
  deploy-and-test command. Reuse low-level path, transfer and service helpers
  where useful, but do not force release import, rehearsal, certification or
  activation receipt prerequisites onto this command.
- Sync only required built output and runtime dependencies into positively owned
  DEV paths. Handle removed files and dependency changes without stale code,
  refuse production targets, and restart only the DEV service. Do not snapshot
  full state or re-create the workspace for every edit.
- Use focused checks while editing and a defined local integration selection
  before submitting a candidate to CI. Cover the affected installation,
  configuration, migration, restart and interaction boundaries. Reuse unchanged
  components rather than duplicate the entire CI suite on every edit.
- Prefer maintained upstream incremental/watch/component build commands and
  persistent caches. Identify the real source and dependent-output closure for
  a change. Keep required type checking and stale-output detection, but do not
  regenerate every release asset and SDK declaration for a leaf change that
  does not require it. Do not add a general build framework.
- Separate ordinary mutable DEV compilation from frozen release runs. Let the
  maintained compiler and package manager handle incremental invalidation;
  do not design a new proof-based cache system for local iteration. Verify
  changed behavior in integration tests. Clean CI builds and final
  source/target attestations remain independent.
- Do not claim a DEV sync proves final package completeness. CI performs the
  clean packaging/offline-install check. When packaging, dependency or migration
  behavior changes, include the corresponding focused local checks before CI;
  do not impose full release packaging on every ordinary source edit.
- Keep CI's fresh checkout, pinned tools, full accumulated regressions and
  independent artifact verification. A high CI-to-production pass-through rate
  is desirable, not a guarantee or permission to bypass a failure. Hosted-only
  behavior, such as the actual 7 GB runner profile, may require a bounded hosted
  experiment; distinguish that experiment from release certification.
- The hosted target profile is macOS ARM with 7 GB advertised RAM. The previous
  Intel choice followed a hardcoded 8 GiB total-memory preflight, not a recorded
  out-of-memory measurement. The measured `hosted-arm` profile requires macOS
  arm64 and at least 6 GiB reported RAM, uses the pinned compiler's host-aware
  memory budget instead of forcing an 8 GiB Node heap, and runs mapped
  OpenClaw tests with one worker. Its complete hosted run establishes public
  support. Continue measuring the private composition rather than assume it
  has the same resource footprint.
- Do not confuse a Node heap limit with total process-tree memory. Record
  supported worker/concurrency choices and bind relevant environment inputs
  into proof reuse.
- The private builder still applies its root patches before building. Moving
  public CI to ARM does not make its unmodified root archive interchangeable
  with the composed private release.
- Prefer an outbound artifact download by the existing private target runner.
  Do not expose a new inbound service or distribute target SSH credentials to
  public CI. The local builder fallback uses the reviewed SSH path and an
  explicit nonproduction target.
- Hosted private builds use only verified included allowance with enforceable
  no-overage controls unless the requester changes the cost decision. Do not
  move private inputs into public CI to avoid billing.
- Public obsolete PR checks may cancel. Deployment transactions must not share
  that cancellation policy. Serialize target mutation using maintained locks.
- Rehearsal must first satisfy normal migration preconditions. Inject only the
  intended configuration mismatch for the failure case. Rejection before
  shutdown does not prove stopped-state recovery.
- Production rollback is conditional on an actual deployment or required
  post-deployment health failure. Deliberate failure remains a TEST regression,
  not a step that undoes every healthy production deployment.
- Keep capacity policy stage-specific and evidence-based. A historical
  free-space measurement is not a new minimum. A lower-memory builder trial
  does not authorize reducing unrelated disk or production safety checks.
- Keep build deadlines bounded and specific to the execution profile. The
  successful hosted deadline is not evidence that the same deadline fits a
  shared development host. Validate any local override, preserve termination
  and failure diagnostics, and prove the actual local build and integration
  loop rather than only accepting a configuration value.
- Global package caches, unknown legacy fixtures, and sealed production
  recovery directories remain outside automatic collection. Dedicated external
  storage is a possible later capacity choice, not an approved purchase or a
  prerequisite added to this plan.

### Implementation

Stable checklist IDs below identify completion obligations. Component plans
hold code-level detail and link back to these IDs rather than create a competing
end-to-end checklist.

| Workstream | Owner | Dependencies | Next required outcome |
| --- | --- | --- | --- |
| PLAN | Coordinator | Requester decisions | Versioned full scope, diagram, owners and checklist |
| DEV | Public supported build commands and private SSH/test command | Existing compiler outputs and isolated DEV service | Measured warm plugin/core edits and remote integration within the working budget |
| ARM | Public and private | Public profile proven; private composition and cost boundary remain | Complete private builder proof or explicit measured fallback |
| FLOW | Public and private | ARM profile, receipt interfaces | Automated builder-to-artifact-consumer handoff |
| TEST | Private | Valid synthetic seed and imported bundle | Healthy deployment and intended stopped-state rollback |
| STORE | Public and private | Ownership and reference records | Automatic complete evidence retention and scratch cleanup |
| LAND | Coordinator and both owners | Required final proofs and review | Exact compatible source merged and verified |
| PROD | Deployment owner | LAND and separate authorization | Exact-artifact activation with read-only health and recovery |

Public implementation surfaces include
`packages/e2e/bin/openclaw-test-env.mjs`,
`packages/e2e/bin/openclaw-release-bundle.mjs`,
`packages/e2e/bin/openclaw-release.mjs`,
`packages/e2e/bin/openclaw-rehearse.mjs`,
`packages/e2e/bin/openclaw-artifact-retention.mjs`, and
`.github/workflows/integration.yml`. Private target definitions, artifact
transport, CI composition, and wrapper details stay in the private plan.

Record the actual verified developer command, its relevant unit/integration
test selection, and operating instructions in component documentation when DEV
is proven. A diagram or unexecuted command example does not close that item.
Keep shell automation responsible for command execution and durable state; do
not add model calls to CI.

### Validation

- During repair, run the smallest regression that exercises the failing
  boundary. A package-level build is not a substitute for a failing root
  declaration build. A preflight rejection is not a rollback test.
- Use `node packages/e2e/bin/openclaw-test-env.mjs ci` for the final accumulated
  lifecycle on the exact candidate and selected profile. Do not remove prior
  package, patch, or runtime targets to make a smaller runner pass.
- Demonstrate the public profile on an actual 7 GB hosted ARM runner. Capture
  peak process-tree memory, pressure, free-disk minimum, durations, architecture,
  toolchain, selected concurrency and terminal outcome.
- Run the private combined build on its selected builder with no dependency on
  live target state. Retain its genuine source-gate attestation and regression
  proof with the bundle.
- Build a local draft and run unit tests on the development host. Deploy the
  built output and required runtime files to DEV over SSH and pass the relevant
  integration and smoke checks before normal CI submission. Demonstrate that
  the DEV command refuses production targets and cannot issue release approval.
  Verify DEV, TEST and PROD disjointness and recording-only automated effects.
- Import the release in a separate target layout without builder source or
  development dependencies. Verify complete runtime, prepared-file, migration,
  browser, interpreter and destination bindings.
- Repair and test the synthetic fixture's job/revision mismatch without
  weakening migration guards. Then prove both healthy deployment and a
  configuration failure after snapshot followed by actual automatic recovery.
- Delete disposable producer state in an owned regression fixture, re-import
  its retained bundle, recover the genuine source evidence, and certify against
  matching unchanged target evidence. Check two retained builds and collection
  of superseded gates and an evicted third build.
- Exercise cleanup through actual producer and terminal hooks, including
  failures and interrupted cleanup. Keep active/pinned references, diagnostics,
  protected recovery and unknown paths intact.
- Demonstrate a repeated unchanged run reusing expensive successful stages.
  Record stage invalidation reasons for source, tests, tooling, environment,
  artifact or target changes. Documentation-only changes must not invent a
  reason to rebuild unchanged runtime bytes.
- Record local edit-to-integration-feedback time and failures first discovered
  in CI versus DEV. Use that evidence to improve the inner loop without
  inventing an unapproved pass-rate target or weakening release checks.
- Benchmark cold bootstrap, a warm unchanged run, a real small plugin edit,
  and a real small core edit separately. Record compilation, focused tests,
  output staging, transfer, restart and integration durations. The ordinary
  warm edit cases must meet the working five-minute end-to-end budget before
  DEV performance is accepted. A no-op hit or a longer build timeout cannot
  substitute for these cases.
- Prove changed code actually reaches the running DEV instance and the relevant
  integration assertions. Include dependency/type changes that must invalidate
  cached outputs and a packaging-only change that must not recompile an
  unchanged root. Do not optimize by silently testing an old binary.
- Require actionable command-level failure evidence without exposing private
  payloads. Verify normal stage transitions need no agent intervention and an
  unchanged failure does not create an automatic retry loop.
- Preserve the same independent reviewers through meaningful changes.
  Refresh affected proofs and final gates, then verify exact remote heads,
  required checks and default-branch integration.

### Rollout and rollback

Keep the currently healthy production runtime and its protected recovery.
Existing process and dev/test work does not authorize a production upgrade.
Do not retire recovery tooling, pinned interpreters or referenced assets while
they remain needed by that recovery.

Finish focused repairs with retained evidence, validate the selected ARM builder
profile, prove the separate DEV loop and release TEST path, then integrate the
reviewed compatible source. A fallback must be documented as a fallback, not
reported as successful hosted ARM support.

After separate production authorization, consume the exact promoted artifacts
through the maintained wrapper. Prepare recovery before destructive work. Do
not build, fetch dependencies or merge source while the service is stopped.
Check health without sending messages. On failure, restore the recorded old
state/runtime/service and verify health, preserving both the original error
and any recovery error.

### Review log

The public owner reports retained complete-diff clearance for the measured
hosted ARM profile, with its complete hosted gate green at the checkpoint in
State. The same reviewer clears the draft-only build-timeout repair, its
focused and hosted gates pass, and the resumed local root build succeeds.
The private owner reports focused regression and retained review clearance for
the package-phase correction and earlier artifact-only diagnosis. The public
owner reports measured local build/test segments for real plugin and core edits
using the maintained component commands. Private now reports cold bootstrap
and the runtime-changing plugin's complete remote loop at `e50b9bb`.
Retained review then found a rollback shutdown race, corrected at `b543049`;
affected current-head review and runtime evidence still need confirmation.
Core-edit remote timing and remaining DEV acceptance evidence are outstanding.
These results do not establish final private release eligibility.

This master document records agreed scope and available evidence. It does not
grant new production, billing, deletion or external-message permissions. Owners
must update the appropriate evidence and checklist together after meaningful
changes. Do not launch a fresh reviewer merely to repeat bookkeeping.

### Checklist

A checked item establishes only the named milestone. It does not mean the
entire feature is merged or deployed. Open items keep their owner and dependency
visible. Close them with a concrete command, receipt, test result or integration
record in the relevant component plan, not a status assertion alone.

**Scope and durable tracking**

- [x] PLAN-01 (coordinator): Persist the original local DEV -> CI -> TEST -> PROD
  intent, full diagram, decisions, owners and this checklist.
- [ ] PLAN-02 (coordinator, in progress): Publish this plan, make issue #118
  point to it, and link the component plans without duplicate master checklists.
- [ ] PLAN-03 (coordinator): Reconcile every remaining item with component
  evidence before declaring the process upgrade complete.

**Fast development instance**

- [ ] DEV-01 (private, in progress): Provision and verify a distinct DEV target,
  separate from release TEST and PROD in every writable/process identity.
  Cold bootstrap and a running DEV are reported at `e50b9bb`; retain the
  complete identity evidence before closing this item.
- [x] DEV-02 (private/public): Provide a maintained
  incremental-build/unit-test command in the normal local workspaces and a
  thin owned-output SSH deploy to DEV. Prove ordinary compiler reuse, correct
  runtime dependency transfer and service restart without release prerequisites.
  The representative plugin loop at `e50b9bb` completes in 174 seconds.
- [ ] DEV-03 (private/public): Accept uncommitted local development normally.
  Prove the DEV command refuses production targets and cannot issue production
  approval; do not require a new draft receipt or attestation protocol.
- [ ] DEV-04 (private): Pass the relevant deployed integration and smoke checks,
  with recorded interactions and no live external writes or scheduled-message
  fallback, before submitting the normal candidate to CI.
  The representative plugin assertion passes with three plugins loaded and
  zero external calls; do not infer complete integration coverage from it.
- [ ] DEV-05 (private): Document start, stop, deploy, inspect and reset commands;
  prove on-demand resource use and that DEV does not disturb a running TEST.
- [ ] DEV-06 (both): Define the pre-CI unit/integration selection and benchmark
  actual warm small plugin and core edits against the five-minute end-to-end
  feedback budget. Record every phase, cold/no-op cases separately, and which
  changed outputs ran. Run focused packaging checks when that behavior changes,
  not full release packaging or the full CI suite after every local edit.
  The plugin loop meets the budget at 174 seconds. Actual core-edit end-to-end
  evidence is still required.

**Hosted ARM and local fallback**

- [x] ARM-01 (public): Measure the real root build and cumulative pipeline on a
  standard 7 GB hosted ARM machine, including child processes. Run
  `35316103588` supplies the resource evidence recorded in State.
- [x] ARM-02 (public): Implement the documented resource/concurrency profile
  with profile, nested-test propagation and resource-accounting regressions.
  The measured full run and retained review clear this public profile.
- [x] ARM-03 (public; ARM-01/02): Pass the full hosted ARM public gate and publish
  correctly labeled ARM artifacts on the feature branch. The default-branch
  switch remains part of LAND-02/03, not an already completed merge.
- [ ] ARM-04 (private): Verify included hosted capacity and no-overage controls,
  or record why the authorized local builder fallback is required.
- [ ] ARM-05 (private; ARM-02/04): Build the exact composed release and run all
  required source gates on the selected builder without live target inputs.
- [ ] ARM-06 (private/public): Demonstrate the development-Mac builder fallback,
  its own capacity preflight, and sealed-artifact transfer without target builds.

**Artifact flow and unattended operation**

- [x] FLOW-01 (public): Implement separate build, source-gate, bundle transport,
  target proof, certification and promotion contracts on the feature branch.
- [x] FLOW-02 (private): Demonstrate retained-bundle import, offline installation
  and all installed scenarios without another OpenClaw source build.
- [ ] FLOW-03 (private; ARM-05): Split builder and target-consumer jobs. The
  target downloads and verifies a private bundle without source dependencies.
- [ ] FLOW-04 (private/public): Prove complete runtime/asset/target bindings and
  preservation of immutable proof inputs during transport.
- [ ] FLOW-05 (both): Demonstrate one command/job advancing normal stages, durable
  status and actionable failures without model-driven stage advancement.
- [ ] FLOW-06 (both): Demonstrate no-op reuse and affected-only repair; preserve
  the latest useful bundle when a later source or target gate fails.
- [ ] FLOW-07 (private): Verify explicit trusted release triggers, least
  permissions, no public/fork PR execution on the target, and safe concurrency.

**Physical release proof**

- [ ] TEST-01 (private, in progress): Correct the synthetic migration job and
  revision mismatch, with a focused regression and unchanged safety guards.
- [ ] TEST-02 (private; TEST-01): Prove a healthy complete deployment through the
  real wrapper on the isolated TEST target.
- [ ] TEST-03 (private; TEST-01): Reach the intended post-snapshot configuration
  mismatch and prove automatic restoration and old-instance health.
- [ ] TEST-04 (private/public): Bind fresh required source-gate evidence and the
  exact installed/physical results to the final bundle and target inputs.
- [ ] TEST-05 (private): Demonstrate target-only diagnosis/retry without rebuilding
  unchanged artifacts and with safe reset/cleanup of owned TEST resources.

**Retention and capacity**

- [x] STORE-01 (public): Implement the owned pool, reference closure, dry-run/apply
  cleanup and lifecycle hooks, keeping two successes and one failed reproduction.
- [x] STORE-02 (public): Prove retention of genuine source-gate/regression
  sidecars per retained build, including superseded and evicted-build collection.
- [ ] STORE-03 (private/public): Prove complete failure reproduction and
  re-import/certification after disposable state is removed in the final flow.
- [ ] STORE-04 (private): Automatically reclaim owned Actions checkouts and
  scratch state after preserving evidence, not only objects inside the pool.
- [ ] STORE-05 (private/public): Bound CI-owned dependency cache growth and
  preflight the upcoming stage before costly setup. Do not prune global caches.
- [ ] STORE-06 (both): Measure steady-state and peak capacity after the builder
  moves off the target; account for retained bundles, dev/test state and recovery.
- [ ] STORE-07 (both): Demonstrate active/pinned/protected references, interrupted
  cleanup, unbounded separate local diagnostics and no unknown-path deletion.

**Landing and operating handoff**

- [ ] LAND-01 (both): Complete retained full-diff review, committed regressions,
  exact accumulated gates and required hosted checks for the final new profile.
- [ ] LAND-02 (coordinator; DEV/ARM/FLOW/TEST/STORE): Verify exact compatible
  public/private heads and merge the eligible changes, including legacy-writer
  retirement. Do not stop at open pull requests.
- [ ] LAND-03 (coordinator): Verify default-branch contents and post-landing
  workflow behavior. Any runtime-input change requires affected proofs to refresh.
- [ ] LAND-04 (both/coordinator): Publish the working developer commands, release
  command, evidence locations, retry/cleanup procedure and clear remaining limits.
- [ ] LAND-05 (coordinator): Reconcile this checklist and issue status, then
  return the landed process for the requester's final validation.

**Separately gated production operation**

- [ ] PROD-01 (deployment owner, blocked on separate authorization): Confirm
  production target, promoted exact artifacts and protected recovery prerequisites.
- [ ] PROD-02 (deployment owner; PROD-01): Activate without rebuilding and verify
  read-only health. Keep a healthy release; roll back only on a real failure.
- [ ] PROD-03 (deployment owner): Record the resulting release/recovery identity.
  Do not prune the previous protected recovery without its separate retention
  decision. Process completion must explicitly report production as still held
  when this authorization has not been given.
