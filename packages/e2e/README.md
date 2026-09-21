# Native development and regression pool

The managed runner builds a pinned, patched OpenClaw and starts a separate real
gateway on the trusted host. There is no VM. Its writable configuration, state,
sessions, indexes, workspace, logs, ports, and processes are isolated. Host
dependencies are deliberately shared. This is not a security sandbox against
arbitrary shell commands or other ambient host access.

The purpose of this separation is to start and exercise a candidate without
causing outages or changing the live instance. Normal host filesystem access
and existing shared coordination directories are allowed on the trusted host.
Use the runtime's normal locking, keep test databases distinct, and leave
foreign locks and unrelated processes alone. Cleanup removes only resources
owned by the test run, never a shared directory.

Harness-only filesystem permission restrictions are optional. If they block
normal installed startup, doctor, or plugin loading, simplify the harness
restriction rather than patching production locking or adding a special
fixture-entry protocol. Do not require adversarial host confinement unless the
requester explicitly asks for it. This does not relax product agent access
controls or permit live-state mutations, real message delivery, or secrets in
fixtures and logs. Content assertions still use synthetic data, and external
writes still require recording adapters.

## Required cumulative gate

Every feature and fix contributes a committed regression. Run focused tests
while iterating, then run the entire accumulated pool on the final candidate:

```bash
OPENCLAW_SRC=/path/to/openclaw \
E2E_RUN_DIR=/path/outside/checkouts/native-run \
  node packages/e2e/bin/openclaw-test-env.mjs ci
```

The pinned OpenClaw 2026.9.3 requires Node 24.16.0 or later on 24.x, or
26.1.0 or later. Public CI uses Node 26.1.0. Earlier Node releases can truncate
SQLite text and are rejected before native work begins. Node 26 no longer
bundles Corepack, so install Corepack 0.36.0 explicitly before running the gate.
Use a fresh `COREPACK_HOME` when upgrading from an older Corepack cache that
records the retired pnpm CommonJS entrypoint. Upstream uses pnpm 12.3.4.
Puddles uses the same exact pnpm 12.3.4 pin.

Set `PNPM_CONFIG_STORE_DIR` to one stable absolute host-local directory before
installing either repository or running the managed lifecycle. pnpm owns the
versioned content-addressed child beneath that root. Do not rename an older
store version or point installed runtime files at it. Local development,
self-hosted runs, and every composed source checkout on one machine use the
same value. Each hosted runner uses its own runner-local value.

```bash
export PNPM_CONFIG_STORE_DIR="$HOME/.puddles/pnpm-store"
corepack pnpm install --frozen-lockfile
node packages/e2e/bin/verify-pnpm-toolchain.mjs /path/to/openclaw
```

The verifier requires pnpm 12.3.4 in both working directories and requires
`pnpm store path` to resolve to the same child beneath the configured root.
It reads each integrity-bound package-manager declaration, then runs its
version and store queries from a neutral directory so verification cannot
rewrite either repository's manifest or lockfile.
The native pipeline repeats that check before dependency installation and binds
the resolved store path into its build inputs. The store is only an install and
build cache. Portable runtime archives still contain their complete dependency
graph and never link to mutable store content.
Preflight checks the source pin, toolchain, and host capacity before costly
work. CI uses public source only and never needs live account credentials.

Public CI uses the standard `macos-15` ARM runner with 7 GB RAM and 14 GB
documented SSD capacity. Set `E2E_RESOURCE_PROFILE=hosted-arm` for this class of
host. The profile requires macOS arm64 with at least 6 GiB reported memory,
uses OpenClaw's measured host-aware compiler heap sizing, and runs mapped
OpenClaw tests one worker at a time. It does not skip or narrow the accumulated
suite. `E2E_RESOURCE_MEASURE=1` enables outer-run sampling and is removed from
child environments so nested fixture pipelines do not recursively instrument
themselves. The runtime free-disk check remains authoritative. The job allows 180
minutes for installation, compilation, regressions, and rehearsal, within
GitHub's six-hour hosted-job limit. See the
[runner specifications](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
and [job limits](https://docs.github.com/en/actions/reference/limits).
Each child command records recursive process-tree RSS, including descendants
that create their own process groups, macOS memory pressure, swap use, free
disk, duration, and the selected concurrency.
The workflow publishes that bounded evidence separately from the run tree.
Hosted artifacts are labeled arm64. Release rehearsal still checks the selected
target's exact Node version, OS, and CPU.

The draft-only `build` command accepts `E2E_DEV_BUILD_TIMEOUT_MS` when a
development Mac needs more than the 30-minute release build budget. The value
must be an integer from 1,800,000 through 7,200,000 milliseconds. It is rejected
for `ci`, `source-gate`, and every other command, so final release gates keep the
30-minute default. The selected bound is part of the build-stage proof and
provider build provenance. A successful build keeps the bound that actually
produced it and remains reusable if a later draft merely requests more time.
Timeout failure stays terminal and the managed runner still terminates the
complete child process tree.

For a retained timed-out draft, resume the same run with a larger bound:

```bash
E2E_DEV_BUILD_TIMEOUT_MS=3600000 \
  node packages/e2e/bin/openclaw-test-env.mjs resume build
```

## Development loop

Ordinary edits use a persistent OpenClaw checkout. They do not create release
receipts or run the declaration-heavy release build. For a bundled plugin edit:

```bash
corepack pnpm tsgo:extensions
corepack pnpm exec vitest run <changed-plugin-test-files...> --maxWorkers=1
corepack pnpm exec node --import ./scripts/tsx.mjs \
  scripts/build-all.mts qaRuntime
```

Use `corepack pnpm test:extension <plugin-id> -- --maxWorkers=1` when the edit
needs the plugin's broader test lane. Routine edits should run the focused
changed files before DEV integration instead of repeating every plugin test.

For a small core edit, replace the first two commands with:

```bash
corepack pnpm tsgo:core
corepack pnpm exec vitest run <changed-test-files...> --maxWorkers=1
```

`qaRuntime` is the installed DEV build profile. It rebuilds the unified runtime,
plugin assets, external plugin output, bootstrap import guard, postbuild output,
and stamps. It skips release declarations, the UI build, and release metadata.
Sync `dist/` into the isolated DEV server's owned installed-runtime root, then
restart it and run the relevant integration tests. Do not sync `dist-runtime/`;
that directory is only the local source-checkout overlay and is not selected by
upstream package installation.

An initial DEV bootstrap calls
`await materializeRuntimeForDev(source, destination)`. It calls the exact
`npm-packlist` and Arborist versions bundled with the selected npm toolchain,
then materializes only that returned inventory. This keeps npm's files,
ignore-rule, and bundled-dependency semantics without making a dry-run tarball.
Release packaging uses `materializeRuntime` and keeps its synchronous 60-second
`npm pack --dry-run` proof path.

The fast path requires unchanged `package.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, Node and pnpm versions, and installed dependency bytes.
When one changes, rerun the normal frozen dependency install and refresh the
complete DEV runtime dependency tree before using the runtime-only profile.
Broad SDK, declaration, or dependency changes can take the clean build path.
CI still performs the fresh complete build, declarations, package, accumulated
tests, installation, and release proofs.

The gate runs every workspace build, lint, and test, the isolated Gmail Python
pool, every mapped OpenClaw patch regression, and the cross-component candidate
tests. It then packages the built runtime with its installed production
dependencies, using upstream's npm package file selection with lifecycle hooks
disabled. This includes bundled skills and normal workspace bootstrap assets.
It installs that archive offline in a fresh prefix and executes all
committed native scenarios. A missing test, runtime, dependency, recorder,
scenario, or selected required health prerequisite is a failure, not a skip.
Archive extraction preserves recorded permissions independently of the caller's
umask. The fresh prefix remains owner-only, while executable, ordinary, and
restrictive runtime entries must retain the modes bound by the portable runtime
digest. Release-bundle import applies the same rule before verifying prepared
directory assets, so transport cannot mask their executable or directory modes.

Installed fixtures require the maintained bundled iMessage plugin before
startup and disable registry package resolution. They also check that startup
preserves its coalescing option. The split-message scenario omits an explicit
debounce and delays the linked payload by 400 milliseconds, so ordinary
debouncing cannot stand in for the maintained behavior. Other scenarios retain
their explicit 250-millisecond debounce. Fixture delays are bounded to one second.
Bootstrap checks follow the stable AGENTS, SOUL, IDENTITY, and USER files.

`openclaw-patch-suite.json` retains the cumulative patch order, test targets, and
explicit upstream Vitest projects. New patches must register every added test.
Do not replace earlier regressions with only the newest feature's targets.

The memory migration entry also runs the scoped-memory adapter against the
built candidate's SDK. Workspace gates build and test that plugin before the
candidate proof. Its synthetic notes and fixed sources must not consult live
workspaces or shared knowledge stores.

The stopped-state migration entry exercises the real SDK on current and
historical SQLite schemas. Installed rehearsal runs the same executor again
from the packaged runtime, with network access denied. Readonly preflight uses
the state-free core migration preview and binds its semantics, both old and new
cron partition paths, and the selected job revision. After the full state
snapshot, activation reads fresh row fingerprints and the complete effective
job set, repairs the schema, then runs the complete maintained core and plugin
doctor migrations with full validation. It copies the jobs to the
post-migration partition, persists legacy config and multi-agent ownership
normalization, then checks every selected config value and applies those writes
in one source-writer transaction. This stopped compare lets a manifest target
the canonical post-plugin object without comparing it to obsolete live input.
Ordinary doctor and the selected cron write follow. The tests cover sole include
ownership, plugin-owned retired settings, parent-object config preconditions,
job revision conflicts, retired `cron.store` paths, unrelated live-staging
state, each failure stage, and interrupted
rollback with the retained interpreter. The historical fixture comes from the
pinned upstream test pool, with its compressed digest checked before use.

An operator may select `E2E_STATE_MIGRATION_MANIFEST` as a canonical absolute
local manifest file for a combined rehearsal. The runner validates its shape,
binds its bytes to regression and runtime evidence, and provides
`context.stateMigration` with `manifestPath` and `sha256` to the explicitly
selected local extension. It never applies that manifest to a live target.
The extension must prove its private values against isolated state. Public CI
leaves this option unset and runs the committed synthetic migration fixtures.
Activation requires the same digest in its local target. See the
[deployment guide](../../docs/openclaw-setup/patches/README.md) for the narrow
manifest and recovery contract.

Public CI initializes a fresh run directory for each hosted attempt and
explicitly disables local extensions. On failure, it retains a seven-day
artifact with bounded, sanitized command and known public fixture logs, plus
stage status. A short excerpt also appears in the job summary and output.
Collection output is retained, and missing mapped tests name their target and
project rather than silently skipping them.

`bin/public-ci-diagnostics.mjs` accepts only that initialized public run.
It redacts environment values and common credential forms, limits each exported
log to 64 KiB, and refuses symlinked inputs. It never exports raw stage inputs,
configuration, context, packages, or the whole run directory. Do not use this
helper to publish local runs or extension diagnostics. Public tests must still
use synthetic data; sanitization is not permission to log real account data.

## Focused iteration and recovery

The Puddles suite runs at most two workers so archive, hashing, and subprocess
tests do not overwhelm standard hosted CPUs. The hosted ARM profile additionally
serializes mapped OpenClaw Vitest groups and asks OpenClaw's own node-test
planner for one plan at a time. The default test deadline stays unchanged.
Native pipeline orchestration and the observed archive and concurrent-config
rollback cases have explicit 15-second limits. Lock fixtures wait for the real
readiness response with a bounded startup allowance, not a fixed sleep or a
global timeout increase. The interpreter migration fixture has a file-scoped
30-second limit because its complete activation and rollback passes repeatedly
hash the real Node binary and run plist subprocesses. Hosted ARM runs measure
up to 15 seconds per multi-pass case; a single allowance covers the whole
fixture instead of chasing individual timeouts. Its assertions and real checks
remain intact. The fixture yields between tests so synchronous work cannot
starve the worker's reporting channel.

```bash
corepack pnpm --filter e2e exec vitest run tests/native-loop.test.ts

# Cheap local build, package, install, and scenario rehearsal.
OPENCLAW_SRC=/path/to/openclaw E2E_RUN_DIR=/path/to/native-run \
  node packages/e2e/bin/openclaw-test-env.mjs native

# Create immutable package output before certification.
OPENCLAW_SRC=/path/to/openclaw E2E_RUN_DIR=/path/to/native-run \
  node packages/e2e/bin/openclaw-test-env.mjs build

# Run the source-dependent accumulated gate on that exact build.
OPENCLAW_SRC=/path/to/openclaw E2E_RUN_DIR=/path/to/native-run \
  node packages/e2e/bin/openclaw-test-env.mjs source-gate

# Export and import without carrying the builder checkout or dependencies.
node packages/e2e/bin/openclaw-release-bundle.mjs export \
  /path/to/native-run/build.json /path/to/release.tar.gz local
node packages/e2e/bin/openclaw-release-bundle.mjs import \
  /path/to/release.tar.gz /fresh/import

# Run archive-only checks against an explicit test-owned deployment target.
E2E_RUN_DIR=/path/to/target-run E2E_LOCAL_EXTENSION=/path/to/adapter.mjs \
  node packages/e2e/bin/openclaw-test-env.mjs target \
  /fresh/import/imported-build.json /path/to/rehearsal-target.json \
  /path/to/rehearsal-seed.json

# Reuse an installed candidate while changing scenario fixtures.
OPENCLAW_CANDIDATE_DIR=/path/to/native-run/installed/runtime \
  node packages/e2e/bin/openclaw-test-env.mjs scenarios
```

`build.json` is immutable package evidence with
`eligibility: "built-not-certified"`. It is useful input for target testing,
but it cannot integrate or activate production. `source-gate` records the
builder-only test inventory. The target command verifies the imported
platform, Node binary identity, local migration file, and every additional and
prepared-file mapping before giving installed hooks a digest-bound
`deploymentTarget`. The target has `purpose: "rehearsal"` and an explicit
test-owned isolation root. It contains host, Node migration, browser,
additional install, prepared-file, and stopped-migration bindings. Installed
hooks receive no source checkout or package workspace. For a new isolation
root, the optional seed argument must use
`puddles.openclaw-rehearsal-seed/v1` and name existing absolute `installDir`,
`stateDir`, and `plistPath` inputs. When the target binds a stopped-state
migration, the seed must also name its `stateMigrationPath`. The command copies
those inputs into a new root atomically, records their digests, creates the
backup root, and then runs the same target checks. The supplied service
definition selects the test-only service identity and recording command shims;
the public creator does not invent private configuration. It refuses an
existing destination or paths outside the declared root. Omitting the seed
keeps support for an already provisioned, explicit target.

Rehearsal validation accepts the maintained `puddles.rehearsal.*` and
`puddles.test.*` service families with matching `puddles-rehearsal-*` or
`puddles-test-*` browser tags. Similar names outside those exact families remain
invalid.

Use `openclaw-release.mjs target-proof` to derive physical success and rollback
evidence from retained stage records and deployment recovery journals. Then use
`certify` and `promote`. Certification is still nonproduction. Promotion emits
the only production release receipt. Production integration and activation
reject a build receipt, a target proof, or a certification used alone.

The external run directory holds concise stage records, protected logs, a
detached source worktree, build outputs, artifact digests, and installation
evidence. Reuse the same directory to resume. Successful stages are reused only
when their inputs and outputs match. Source, tests, environment, toolchain,
build options, and artifact changes invalidate affected proofs. Package repairs
rerun installation and runtime rehearsal without rebuilding unchanged source.
When npm's file selection includes bundled dependencies, the resolved production
graph owns those files. Packaging rejects bundled packages outside that graph.
Required transitive peers stay required, and installation still verifies every
archive and runtime digest without registry access.
Packaging binds the installed dependency bytes, not only the lockfile. Regression
proofs bind the effective environment, selected Python interpreter and installed
test dependencies. Environment values are hashed, not written into receipts.
The patched llama.cpp provider is a separate installable package, so the runner
always seals its built output as a named additional artifact. Its provenance
receipt binds the public repository head, patched provider source, build inputs,
build command, toolchain, archive, and installed runtime digest. Local extensions
cannot replace this artifact with an older registry package. Combined consumers
must select the public archive and verify the provenance receipt instead of
inferring compatibility from the package version.
Dependency fingerprints exclude the generated `.experimental-vitest-cache`
and `.unrun` directories directly under `node_modules`. Files with those names
inside real packages remain part of the fingerprint. These root caches do not
enter the production package graph. Existing proof records are never rewritten
to conceal an input change. The dependency stage keys its fingerprint policy,
so an older policy runs installation once before its result can be reused.
In the root `.pnpm-workspace-state-v1.json`, fingerprints omit only
`lastValidatedTimestamp`, which pnpm refreshes after unchanged validation.
Settings, projects, hooks, unknown fields, file modes, and same-named nested
package files still count. Invalid metadata fails rather than becoming a
success-shaped default.
Local stage records retain the input identities used to compute each proof key.
Runtime evidence includes resolved installed commands, resolved scenarios, and
the fixture environment, not only extension module bytes.
The owner fixes failures with committed regressions and resumes the same run.
`status` prints the durable run state. `resume` is required after an unchanged
failed stage, so an ordinary command never retries the same failure in a loop.

Set `E2E_ARTIFACT_POOL` to an initialized owner-managed pool to enable automatic
retention before the disk-capacity check and after terminal success or failure.
Bundle import registers the immutable build. Target runs protect it while active,
then retain successful stage proofs or one failed reproduction plus diagnostics.
Successful source gates are retained as immutable sidecars with their exact
regression-stage proof and a dependency on the build. Re-importing an existing
build restores the current reference to both objects, and later target proofs
retain the source-gate dependency. This lets certification reuse genuine source
evidence after the disposable source checkout and run context are removed.
Running a changed source gate for unchanged build bytes creates a new sidecar
instead of overwriting or reusing the older attestation.
Initialize, inspect, and apply it with
`openclaw-artifact-retention.mjs init|dry-run|apply`. Producers register exact
owned objects and references. Cleanup keeps the newest two successful build
bundles with their package proofs, the newest failed reproduction, every local
diagnostic log, and the dependency closure of current, pinned, active, paused,
failed-debug, deployed, and latest-healthy-recovery references. Protected
objects do not consume the ordinary two-build or one-failure quota.

The pool never adopts a directory by its name or timestamp. Missing ownership,
references, assets, digests, or lock state stop cleanup. Deletion revalidates
the canonical direct child and ownership digest, rejects links and escapes,
and moves the exact object through pool-owned trash with a resumable journal.
Unregistered legacy directories, production recovery state, Copilot sessions,
worktrees, package-manager caches, containers, and global caches stay outside
this policy. Local diagnostic logs have no age or byte limit. Full homes,
databases, runtime state, and recordings are not diagnostic logs.

`E2E_REQUIRED_FREE_BYTES` may raise the default 8 GiB preflight to a measured
host requirement. A failed capacity check reports required, free, retained,
protected, and removable bytes once. Logical removable bytes are not reported
as physical space freed.

The real pnpm regression uses the pinned upstream package manager from the
Corepack cache populated during managed source preparation. Its synthetic
file-only dependency install is offline, uses an isolated store, and disables
scripts and pnpm hooks. It proves timestamp refresh without changed dependency
identity or rewritten successful evidence.

The run lock prevents concurrent mutation. If the owner was killed, inspect its
recorded PID and confirm its process group is gone before removing only the
run's `lock` directory. Keep failed fixture diagnostics locally. Do not upload
local extension logs or configuration. Remove retained worktrees with
`git worktree remove --force /path/to/native-run/source` only after their
evidence is no longer needed; remove only that run's named artifact directories.

## Writing native scenarios

`scenarios/imessage.mjs` is the committed pool. The fixture uses the real
installed iMessage channel and its JSON-RPC transport. Incoming messages are
appended to a fixture queue after a real `watch.subscribe`. The bridge emits
protocol notifications, the gateway calls a local scripted model, and outbound
messages go to a recorder instead of Messages.app.

Every scenario declares its incoming events, model responses, and expected
outbound replies. Tool scenarios declare explicit recording adapters. The
fixture registers those tools through the supported OpenClaw plugin interface,
including the manifest's tool contracts. Read adapters return only declared
synthetic results. Write adapters record only declared operations. A missing
adapter or unknown operation fails. There is no fallback to a real tool.

Never write tests that deliver real messages, mutate accounts, or drive the
configured production agent. Every external mutation path must use a recording
adapter, including message delivery, calendar, contacts, notes, email changes,
task writes, and browser actions. Add the adapter before enabling the path.
Do not claim these fixtures prevent an arbitrary shell command from bypassing
them on the trusted host. Test authors are responsible for using the fixture
interfaces rather than host mutation commands.

The public pool covers ordinary conversation, conversation history, split
message parts, tool writes, deterministic tool reads, model errors, no-output
responses, and fresh-state replay isolation. Each scenario checks request and
delivery counts, response content, and a quiet tail for duplicate delivery.
Normal workspace bootstrap runs in every scenario. The ordinary conversation
also checks bundled skill discovery through the installed CLI.
Cleanup stops only the fixture process group and removes its successful state.

## Optional local extension

Public development works independently. A caller may explicitly set
`E2E_LOCAL_EXTENSION` to an absolute local `.mjs` file. It exports a default
object with `schemaVersion: 1`, `inputs`, `commands`, `scenarios`, optional
`artifacts`, `preparedFiles`, and `healthChecks`. Nothing in public CI discovers
or fetches that module.

`inputs` lists absolute files whose bytes key extension evidence. Each command
declares `id`, `phase` (`prepare`, `gate`, `package`, or `installed`), `command`, `args`,
optional selected `env`, optional `inputs`, and a positive `timeoutMs` no
greater than 30 minutes. Command inputs must also appear in the extension's
top-level input list. They key only that command's phase. A command that omits
`inputs` conservatively uses every top-level input for backward compatibility.
Prepare runs before build and all regressions. Gate runs after the public
accumulated regressions. Package runs after build and before sealing in both
`ci` and focused `native` runs. Use it to prepare auxiliary artifacts, never
build during installed rehearsal. Installed runs after offline installation and before
scenario startup. Source remains available, but installed artifact bytes must
not change. Use named artifacts for additional runtimes that need activation.
Installed hooks can configure their isolated rehearsal through the supplied
installed paths.

Commands may declare `outputs`, a list of paths relative to the isolated root.
Declare concrete artifact files or narrow directories. The runner records their
bytes in the stage proof and reruns the producing phase if any output is missing
or changed. Do not declare broad workspace trees containing unrelated caches.
Preparation has its own input identity, separate from later command phases.
Its declared outputs and prepared source bytes are checked on resume, even when
it declares no outputs. A rerun receives clean detached source, so transactional
patch application need not be idempotent. If it produces the same source bytes,
the existing dependencies and build are retained. Use the supplied `sourceDir`;
its temporary preparation path is not a stable output location. Declare all
helper inputs that can affect commands. Global inputs conservatively apply to
every phase.

The build receipt binds the preparation and package phase identities, artifact
declarations, and prepared-file declarations. Gate-only inputs remain in the
source-gate proof and do not create a new build identity for unchanged runtime
bytes.

`artifacts` contains `{ id, manifest }` entries. `manifest` is relative to the
isolated root and names the JSON identity returned by `packRuntime`. Both the
manifest and archive must be covered by verified package outputs, either as
explicit files or within a declared directory. They must remain beneath the
isolated root. The runner seals these as `candidate.additionalArtifacts`,
installs them offline before the installed hook, and exposes their paths in
`context.additionalInstalledDirs[id]`. Each has its own install proof, and the
runtime proof binds the complete bundle. Changing one archive reruns its
installation and the combined rehearsal, not an unchanged source build.
Integration and activation reject artifacts that do not match those proofs.
Transport may change local archive paths, not content identities.

`preparedFiles` contains `{ id, manifest }` entries for immutable non-package
files or directories that must be deployed with the candidate. The manifest is
a verified package output with `schemaVersion: 1`, `type` (`file` or
`directory`), an absolute `path` beneath the isolated root, and its exact
`sha256`. Prepared directories may contain relative links that resolve within
the selected tree. Absolute and escaping links are rejected. The runner keeps a
dedicated proof and binds each id, type, and digest into runtime evidence and
`candidate.preparedFiles`. Transport may change the source path, but not that
identity. Prepared files are not packages and are not exposed as installed
runtimes.

Commands receive `E2E_CONTEXT_PATH`, a local JSON file with `schemaVersion`,
`root`, `isolationRoot`, `home`, `stateDir`, `configPath`, `workspace`,
`recordingsDir`, `sourceDir`, and, once available, `installedDir` and
`artifact`, `additionalArtifacts`, `additionalInstalledDirs`, and
`preparedFiles`. The artifact has `path`, `sha256`, `runtimeSha256`, `platform`,
`arch`, and `node`. Prepare, gate, and package use the source directory as cwd. Installed
uses the isolated workspace. The runner selects environment values explicitly
and does not inherit the user's runtime configuration or provider credentials.
Local hooks can initialize a channels-disabled config under the isolated root.

Additional scenarios use the same declarative schema as the public pool. Each
receives a fresh gateway context; installed-hook state is not silently copied
into scenarios. Extension output stays in protected local logs, not public
console summaries, artifacts, or CI.

## Opt-in live read-only health

Deterministic read fixtures and live read-only health checks serve different
purposes. Fixtures support content assertions. Host health checks only establish
basic availability, authentication, and protocol compatibility. They never
assert or log personal content, and never perform writes or message delivery.

```bash
E2E_LOCAL_EXTENSION=/absolute/local/checks.mjs \
  node packages/e2e/bin/openclaw-test-env.mjs host-health
```

Each selected check uses the same bounded command shape, plus `required`.
Its only stdout result is JSON with boolean `available`, `authenticated`, and
`protocol` fields. Results are reduced to booleans. No stdout or stderr payload
is logged. Required checks default to required and fail on unavailable
prerequisites, malformed output, nonzero exit, or timeout. No selected checks
is an error. Public default CI does not run this host gate.

## Back up the current production recovery

`openclaw-backup.mjs` snapshots the current healthy production installation
without a candidate receipt, source build, package install, or activation:

```bash
node packages/e2e/bin/openclaw-backup.mjs plan /absolute/backup-target.json
node packages/e2e/bin/openclaw-backup.mjs capture /absolute/backup-target.json
node packages/e2e/bin/openclaw-backup.mjs verify \
  /absolute/backup-target.json /absolute/backups/backup-EXAMPLE
node packages/e2e/bin/openclaw-backup.mjs materialize \
  /absolute/backup-target.json /absolute/backups/backup-EXAMPLE \
  /absolute/test-owned/restore-check
node packages/e2e/bin/openclaw-backup.mjs current /absolute/backup-target.json
node packages/e2e/bin/openclaw-backup.mjs retire \
  /absolute/backup-target.json /absolute/backups/activation-OLD
```

The target is the normal full production deployment target with `backupNode`
containing exact path, optional canonical `realPath`, SHA256, version, platform,
and architecture. It also requires the single explicit exclusion
`backupExclusions: [{ "path": "deploy-snapshots", "reason":
"legacy-backup-storage" }]`. This is a direct child of `stateDir`, not a glob.
The clone helper rejects other exclusions and retained links into that tree.
The manifest records the exclusion, and verification requires the restored
state to omit it.

Before shutdown, the stop adapter captures the gateway's exact PID, process
start identity, and owned process groups. Current runtimes use their installed
ownership-record API. A predecessor runtime with neither lifecycle export uses
the same platform process-start representation and joins only groups whose
leaders were in the captured gateway process tree. An incomplete API, unreadable
identity, reused group leader, or surviving group fails closed.

Backup verification commands inherit the caller's executable search path.
This lets materialization use host tools such as Docker and SQLite from their
configured installation directories while keeping the backup-specific state
and repair environment explicit.

Capture and publication do not inspect or inherit an older activation recovery.
They remain available when `latest-activation.json` is missing, stale, or uses
an older format. The optional `legacyActivationReceipt` field is used only by
the separate exact cleanup operation after a new recovery is authoritative.

`plan` walks the exact included runtime, state, and service inputs. It reports
allocated and logical bytes, entry counts, filesystem free bytes, and a
conservative peak requirement of twice the included allocated bytes for the
snapshot plus simultaneous isolated materialization. Capture refuses
insufficient capacity before taking a lock or stopping the service.

`capture` holds the deployment target lock and uses the same stop/join and
clonefile operations as activation. It snapshots the installed runtime with
dependencies, complete state, service definition, exact external interpreter,
and current browser image identity. State capture is bounded by a seven-minute
outage budget. Failure immediately attempts to restart the unchanged service;
restart failure remains explicit and has no promised deadline. Capture writes
no healthy reference.

`materialize` is the required recovery consumer. It requires a fresh isolated
destination and checks cloned bytes, configuration JSON, SQLite databases,
service data, the retained interpreter, browser image, and an actual invocation
of the backed-up runtime. It does not start a gateway or deliver anything.
Only after that proof passes does it compare-and-swap
`backup-references/latest-healthy-recovery.json`. A changed reference preserves
both recoveries and fails closed. `current` resolves and verifies the
authoritative new recovery through that reference. Read operations never create
the reference directory; only successful publication initializes it.

`retire` removes one named direct recovery only after a different current
recovery and its materialization proof verify. Exact cleanup of an
`activation-*` recovery additionally requires its retained receipt. The journal
moves only that obsolete activation pointer and recovery through exact
tombstones while the new healthy reference remains guarded. Every interrupted
stage is resumable. Referenced backups, changed receipts or pointers, unknown
entries, escaped paths, and ambiguous ownership block deletion. There is no
conversion, age-based cleanup, or broad pruning.

## Delivery

The approved Markdown design and its issue are the human checkpoint. An
engineering owner handles focused iteration, one retained independent review,
the final accumulated gate, package rehearsal, exact source integration, and
activation. A parent may split ownership without duplicating those stages.

Integrate eligible exact source before starting the live rollback transaction.
Activation uses the rehearsed archive and the existing runtime clone mechanism.
It never builds, fetches dependencies, or merges a pull request while the
gateway is stopped. See the [deployment guide](../../docs/openclaw-setup/patches/README.md)
for explicit target configuration and recovery.
