# OpenClaw stable upgrade

Status: Final stopped migration correction in progress; activation held
Issue: #114
Last updated: 2026-09-13

## Human section

### Design

Move the maintained runtime to the latest stable OpenClaw release without
losing the local fixes that agents depend on. The public patch stack preserves
file locking, child-agent targeting and result gathering, skill authoring,
message coalescing, sandbox error reporting, and browser profiles. Upstream
removed the external memory engine entirely. The requester approved migration
to builtin search with explicit local embeddings and no remote fallback. Preserve
configured sources, disabled agents, transcript opt-in, and asymmetric access.
An authorized agent may read another agent's scoped memory without granting the
reverse direction. Writes through trusted consolidation do not grant read access
to a mixed knowledge store. Where
upstream moves responsibilities, adapt the patches to the new owner and keep
the same regression coverage. Keep the maintained iMessage plugin inside the
runtime archive instead of letting startup download an unpatched replacement.
Its generated startup schema must match the maintained channel schema.
Completion gathering must not acknowledge a child until its exact tool result
is saved in the requesting session. Keep the stable release's visible-answer
recovery for silent direct replies, rather than restoring older direct-message
silence. Preserve an allowed group's deliberate silence even when the delivery
stream has filtered out its silent token. Only the current response can supply
that evidence. Group silence and classified model-error replies remain separate
installed scenarios.

A small plugin provides separate memory tools for agents that may read only
their own notes. It binds the existing memory manager to the trusted calling
agent and checks arguments, paths, and results at execution. Returned bytes must
come from an authorized opened file, even if another writer replaces a directory
during the read. Search excerpts come from those files rather than untrusted
indexed snippets. It does not
read the shared wiki. Private configuration denies the broader native memory and
wiki tools for these agents. A missing plugin therefore removes their memory
capability rather than exposing a broader fallback. Private consolidation
policy and data remain outside the public repository. Direct reads also support
the agent's own dream notes without expanding the search corpus.

The release requires a newer Node runtime because older builds can truncate
SQLite text. Development and public CI use an explicitly supported version.
Plugin consumers compile against the new release rather than an older SDK.
The existing native pipeline builds isolated source, runs the accumulated
tests, packages dependencies, and rehearses the installed runtime with
recorded messages. Bundled dependencies must be materialized once through the
complete production graph. Installed plugins must load as native modules
without depending on the source checkout. Explicit isolated test paths must
not change production lock ownership. Public code never depends on private
configuration or live accounts. A separately packaged provider must carry a
receipt whose source, build command, complete toolchain, and output identities
match the retained build and packaging proofs. The receipt cannot attest those
identities by itself.

Required pre-reply recall must survive a cold local embedding service. After
the ordinary policy checks, optional trigger lookup and required recall share
one bounded budget. They cannot spend the setup allowance twice. Local
embedding services remain gateway-managed. Before accepting requests, startup
must prove real synthetic vectors within one allowance of up to ninety seconds.
The gateway keeps the embedding model resident for its lifetime. Ordinary
memory requests retain their fifteen-second budget. Restart repeats preparation;
a listener alone does not prove that the model is ready. Graceful
gateway shutdown must stop the owned model service first. A bounded fallback
must terminate only that owned service and its model descendants, then join
their exits before snapshot, replacement, or rollback. Reuse the existing
process supervisor and its private ownership channel. A small record of the
gateway and its service processes permits recovery after gateway loss. Do not
introduce a separate daemon or a new admission framework. Uncertain cleanup blocks
the stopped-state snapshot and runtime swap.

The deployment helper can select a new interpreter without changing a service's
shell wrapper or environment. It verifies both retained interpreters, changes
only the selected service argument, and restores the old interpreter with the
old runtime during rollback. An optional reviewed manifest changes selected
configuration leaves and silences one existing scheduled job. It cannot run
commands or replace unrelated state. The stopped gateway's complete state is
snapshotted first. Activation then repairs only the database schema and runs the maintained core
and plugin config migrations through OpenClaw's writer. Live preflight remains
state-free and binds the stable core migration result, old and new cron
partition paths, and the reviewed job revision. Once stopped, activation reads
fresh row identities and the complete effective job set, applies the full
maintained plugin contracts, and requires a valid result. That migration also
converts a legacy multi-agent roster to explicit ownership without choosing a
default owner or granting access. Selected config values are compared only
after this normalization, in the stopped source-writer transaction and before
any private mutation. This preserves exact compare-and-swap while allowing a
manifest to describe the canonical plugin object. If legacy
`cron.store` is retired, activation copies that effective set to the
post-migration partition before writing config. Both row sets use
compare-and-swap fingerprints. Private selected config changes still precede
ordinary doctor and compilation. The job change uses a fresh read afterward
and checks the same reviewed revision.

The same candidate may need immutable files that are not package archives, such
as a local service binary tree or model file. These files are named and hashed
when the candidate is sealed. A target maps every named file to one disjoint
location below its managed state directory. Activation stages and verifies the
bytes before downtime, records whether each destination already exists, and
replaces it only after the existing state snapshot is durable. Rollback restores
the prior state or removes additions owned by the failed transaction. This is a
narrow file delivery contract, not a new package system or service manager.
Browser images, package artifacts, configuration migration, and process
ownership keep their existing mechanisms.

Any mismatch restores the old runtime, interpreter, configuration, job state,
and prepared files. Production deployment is outside this change's ownership.
Activation and rollback remain in the existing deployment workflow.

### Status

The prepared-file contract now carries immutable local service and model bytes
through the existing candidate and rollback transaction. Its focused deployment
and rollback tests pass. Activation remains stopped before live mutation
because an isolated exact-state probe found that private compare-and-swap
cannot run until OpenClaw's maintained legacy config migrations have completed.
Those migrations can retire an old cron partition that still contains the
reviewed scheduled job.

The stopped ordering boundary is implemented and previously passed the full
public gate. Exact private state exposed one final missing roster normalization,
and retained review found that live preflight held volatile cron state across
asset staging. The correction now uses the maintained explicit-ownership
result and takes fresh row identities only after shutdown.

One exact private comparison found all remaining validation-required changes:
retired Active Memory QMD configuration and two retired Canvas host settings.
Doctor-only wizard timestamps are not needed for validity. The stopped repair
now runs the complete maintained plugin migrations after shutdown instead of
hardcoding those keys. Agent permissions and all ten jobs remain unchanged.

The next exact replay exposed one ordering issue: live preflight compared a
private parent-object operation with the obsolete pre-plugin object. The
correction keeps live structural and migration checks, then defers exact config
value comparison until immediately after full stopped normalization. Focused
tests and the managed installed-runtime patch gate pass. Retained review and
the exact cumulative gate remain. Production remains untouched.

## Agent section

### State

- Base public source: `8cf0a92`.
- Target OpenClaw tag: `v2026.9.3`, exact commit
  `1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`.
- Selected Node: `26.1.0`. Upstream engine:
  `>=24.16.0 <25 || >=26.1.0`.
- Upstream package manager: `pnpm@12.3.4`. Puddles keeps its own manager.
- Implementation authorized. No design pause. No production deployment.
- Parent confirmation is required before merging follow-up public source.
- Replacement public engineering owner starts from clean `947f8867a19e1ebb6d1b54765693d7c5b420fc2b`.
  PR #116 supersedes the closed, unmerged PR #115. Do not merge #116 until the
  parent confirms combined compatibility. Preserve previous sealed runs without
  edits.
- PR #116 merged reviewed public head `5b5d9de` as
  `07819c2870886054e72881a146326fae88f5d6ee`; the landed tree
  `49e3bb0ddd5df61eaa2c3346ba0b6778bef393dd` matches the candidate.
  Private `87fefe0981bc3887a0ace2037646aa4c18fc42c1` sealed all eleven
  installed and physical target proofs. Production activation then stopped
  before mutation because immutable embedding assets were supplied outside the
  public candidate and could not participate in deployment rollback.
- Current scope is only generic prepared-file sealing, target mapping,
  pre-downtime staging, checked replacement, and rollback through the existing
  transaction. Private owns the manifest, six additional runtime destinations,
  browser target binding, composition regression, and production activation.
  No provider, daemon, package framework, or runtime source change is in scope.
- Resumed the same run after an agent-service transport reset. No managed
  process or run lock remained. Source, archives, and installed artifacts are
  preserved; successful earlier stage receipts are not a final-candidate gate.
- The parent-assigned worker completed its scoped-memory handoff. Its later
  read-only silence turn ended without findings. The parent released both
  repairs to this engineering owner; no helper owns an active source scope.
- Reviewed public behavior and test checkpoint:
  `d6c442a1d9f2a1c86184411cbd4bf8ee00642dc3`. The same head passes local
  accumulated CI and hosted run `34443062989`, job `102761932660`, in 40m13s.
  All CodeQL checks passed for that historical candidate.
- That historical runtime matched `76854b4`. Current packaging, service, and
  startup corrections require a new sealed runtime for final composition.
- Hosted timings justify a single file-scoped lifecycle allowance, rather than
  case-by-case changes. All real hashes, plist subprocesses, and assertions
  remain intact. This plan update records evidence only, not new behavior.

### Scope and acceptance criteria

- Rebase all eight patches without dropping behavior or previous tests.
- Update source and CI pins, Node preflight, public SDK consumers and docs.
- Preserve cumulative manifest collection and fixture-only message delivery.
- Commit regressions for compatibility changes and prerequisite boundaries.
- Add reusable scoped memory tools that preserve local-note access without
  allowing native shared-wiki or broader-memory fallback for restricted agents.
- Add a digest-bound, versioned stopped-state manifest for exact config leaf
  operations and one existing job's no-delivery migration. Preserve unrelated
  config, job definitions, runtime state, and the existing rollback transaction.
- Pass the full accumulated public gate on the exact committed candidate.
- Complete independent full-diff review and public remote checks.
- Send exact candidate identity and retained evidence to the parent.
- Merge only after parent confirms combined compatibility.
- Preserve always-mode recall during cold embedding startup within the existing
  configured setup grace, consumed once. Keep ordinary preflight and optional
  trigger caps, other modes, authorization, and isolation unchanged.
- Reap owned local provider processes on normal stop, startup failure, and
  forced/crashed parent termination. Preserve preexisting endpoints and unrelated
  processes. Require positive extinction evidence before stopped-state snapshot.
- Gate channels and gateway readiness on two synthetic local vectors within
  one approved 90-second startup allowance. Retain the service lease and model
  residency until gateway shutdown. Keep ordinary memory requests at 15 seconds
  and the Active Memory setup cap at 30 seconds, without combining budgets.
- Seal every selected non-package deployment file with a stable id, exact type,
  and digest. Require one disjoint state-relative target mapping per file.
- Stage and verify prepared files before shutdown. Replace them only after the
  existing state snapshot, and prove both fault rollback and explicit rollback
  restore old destinations or remove transaction-owned additions.
- Rehearse the executable `apply-and-deploy.sh` contract with test-owned state.

### Architecture and decisions

- Use isolated detached OpenClaw source. Never modify the configured checkout.
- Preserve patch order in `packages/e2e/openclaw-patch-suite.json` and the
  deployment wrapper.
- Port skill authoring to the release's agent-owned persistent collection.
  Do not restore retired workspace ownership or bypass skill policy.
- Use a side-by-side supported Node toolchain, not a host-global upgrade.
- Active Memory's lexical trigger lookup still initializes Memory Core's required
  provider. A status-purpose manager does not safely bypass that requirement.
  For eligible `always` recall, arm the existing recall deadline before the
  trigger lookup and do not rearm it. Charge elapsed setup to the existing
  `setupGraceTimeoutMs`; retain the model timeout and settlement allowance.
- Reuse of `createServiceChildRelayAdapter` for POSIX local providers has a boundary. Its private
  host pipe and independent group anchor survive host/relay death long enough
  to clean the owned tree. Do not replace them with PID/name heuristics.
  Reuse preserves one-shot host exit through explicit unref support and
  retains the adapter's extinction failure signal. The approved minimal record
  binds owner, relay, and anchor to existing process start identities before
  model launch. Activation and rollback consume that record through the
  retained candidate SDK after disabling launchd. They join exits before
  mutable state snapshots. No independent daemon or admission framework is added.
  Do not invent process claims or treat port closure as complete extinction.
- Keep installation offline and keep source integration outside activation.
- Reuse the local extension package phase to select prepared files. Retain a
  dedicated proof that connects extension outputs to candidate prepared-file
  identities. Paths may change during approved transport; ids, types, and
  digests may not.
- Map prepared files below `stateDir` with the same real-path and overlap rules
  used for additional installs. Stage them in a transaction-owned sibling on
  the target filesystem before shutdown so replacement is atomic. The existing
  complete state snapshot remains the rollback authority. Journal prior
  existence and digest so recovery never guesses whether an addition was owned.
- The scoped adapter uses distinct tool names and trusted factory agent context.
  Call the existing memory manager directly with fixed memory sources. Guard
  final arguments, paths, and results without a new index or policy framework.
  Private configuration denies native memory/wiki tools for nonreaders and only
  permits scoped tools where memory is enabled. No main-owner migration is needed.
- Plugin id/package `scoped-memory` accepts only `allowedAgents`. Empty or absent
  permission denies access. Tools are `scoped_memory_search` and
  `scoped_memory_get`; final execution rejects unknown argument keys.
  `resolveMemorySearchConfig` enforces effective disablement and
  `resolveAgentWorkspaceDir` resolves the owning root from trusted context.
  Search permits only `MEMORY.md`, `USER.md`, and Markdown below `memory/`.
  GET also permits own-root `dreams.md` with case-insensitive basename and
  lowercase extension, matching the upstream reader. This does not add dreams
  indexing or expose dreams search hits.
  Reject symlinks and hardlinks. Filter global extra-path results before
  reading excerpts through an existing descriptor-bound safe-root reader.
  Do not trust path identity checks around an asynchronous backend read.
  No raw indexed
  snippets, backend metadata, or backend exception details escape.
- Generic interpreter migration is included at the parent's request.
  `nodeMigration` retains both executable identities and the exact service
  argument index. The live target and activation remain with the release owner.
- The parent additionally authorized generic stopped-state config and cron
  migration. Keep values and job identities in a local manifest, not public
  source. No arbitrary commands, target callbacks, SQL surgery, scheduler,
  gateway, model, or network activity belongs in the migration helper.
  Bind manifest bytes into target/recovery identity before shutdown. Validate
  include ownership and state boundaries before shutdown and on fresh writes.
  Preflight uses `readConfigFileSnapshotForWrite` with `observe: false` and
  `pluginValidation: "core-only"` so it does not load the SQLite plugin index.
  This live preview binds only state-free core migration semantics. After
  shutdown, reload with full plugin validation, apply all maintained plugin
  doctor config contracts, and require zero remaining validation or legacy
  issue paths. Do not copy doctor-only wizard timestamps, run plugin state
  migrations, delete unknown keys, or encode private plugin policy.
  Preflight checks manifest structure, digest, path and include ownership, but
  does not compare selected values against the core-only projection. The later
  `mutateConfigFile` call performs every exact leaf and parent-object
  precondition against the fresh fully normalized stopped config before
  changing any selected value.
  Use `mutateConfigFile` with `base: "source"`,
  explicit no after-write work, and `skipRuntimeSnapshotRefresh: true`.
  Snapshot before any mutation. The parent approved calling the existing
  `doctor-repair-runtime.repairOpenClawStateDatabaseSchema` before config because
  config writes also need a current SQLite schema. This step is schema-only,
  without compilation, hooks, inference, delivery, package fetching, or startup.
  Reuse doctor's canonical roster migration in the stopped preview and write.
  A markerless multi-agent roster becomes `agents.ownership: "explicit"` without
  choosing a default agent or adding an access binding.
  Carry only stable migration semantics, cron partition path digests, and the
  reviewed job revision from live preflight into the stopped phase. Recompute
  complete jobs and source and target row fingerprints after shutdown, then use
  those fresh values in the partition copy. Runtime-only cron updates and
  unrelated config writes during asset staging must not cause avoidable
  downtime. A changed selected job definition still fails before mutation.
  Apply config before ordinary doctor, then read the
  selected cron partition through the readonly SDK and perform one targeted CAS
  update. Reject drift rather than silently rebaseline or replace the store.
  Cron partition resolution passes `artifactPreservingReadOnly: true` to the
  existing machine-state reader. Ordinary readonly SQLite opens may create
  WAL/SHM files. The maintained private snapshot reader avoids that and keeps
  temporary copies in the recovery directory's cache. Full plugin validation
  remains in the stopped source write; no validation is removed from mutation.
  The selected private architecture retains its global wiki, continuous bridge,
  and dedicated builder. No bridge disable, scope switch, or reowner is in scope.
- Upstream `8b0735e89f2` removes QMD rather than moving it to an extension.
  `legacy-config-migrations.runtime.retired-memory-qmd.ts` migrates external
  paths and session indexing before deleting retired configuration. Do not
  restore the removed backend or declare equivalent search behavior. The requester
  approved builtin/local migration. Builtin retains bounded lexical
  expansion, not QMD's model-generated expansion or learned reranking. Preserve
  QMD derived directories during the rollback window and do not opt into cleanup.
  Session-source opt-in migration does not authorize broader cross-conversation
  recall.
  Public tests cover generic source and agent configuration boundaries. The release owner proves
  configured asymmetric access and local-only embedding through installed routes.

### Implementation

- `native-package.mjs` materializes the production graph before copying npm's
  selected root assets. Selected bundled files are accepted only when their
  owning package is already in that graph and its copy includes those bytes.
  A package-owned asset directory may contain an embedded `node_modules`; that
  does not make it another graph root. Unowned top-level dependency directories
  still fail. This avoids duplicate directories without excluding arbitrary
  dependency content or relaxing required peers.
- The native pipeline packages `dist/extensions/llama-cpp` as the built-in
  `llama-cpp-provider` additional artifact. Its
  `provider-provenance.json` binds the repository head, patched provider source,
  complete build inputs, build command, selected toolchain, archive digest, and
  portable runtime digest. Local extensions cannot replace that artifact ID.
  Installation and runtime proofs bind the provenance digest with the archive.
- Installed secure Gmail and calendar bundles use a `createRequire` build
  banner for their bundled CommonJS dependencies. Keep their registration
  synchronous and external tool execution lazy. No gateway or private loader
  shim is needed.
- `scoped-container-temp-root.patch` forwards `resolveSandboxContext.tempRoot`
  through the backend to both container and browser environment files. The
  low-level option is `{ rootDir }`. Production defaults are unchanged.
  The caller-selected root is not a database or lifecycle-lock override.
- State coordination uses the existing canonical production coordinator on
  the trusted host. Test state remains separate. No environment override or
  process-entry permission seam is needed.
- `managed-local-service-lifecycle.patch` retains POSIX relay ownership through
  exit and exposes the recorded stopped-state join through `process-runtime`.
  `openclaw-service-stop.mjs` calls the exact installed helper. Activation keeps
  its candidate copy for both initial stop and interrupted rollback.
- File-lock patch uses fs-safe 0.8.5 with kernel guards shared by async and
  sync callers. Retain the contention test and add killed-reclaimer recovery.
- Sandbox discovery retains selected-runtime querying and error propagation.
- Workshop preserves configured proposal factory and agent-owned storage.
- Browser patch applies without change.
- Public plugins pin the 2026.9.3 SDK and use `openclaw/plugin-sdk/core`.
- The parent-assigned worker completed scoped-memory code, tests, and local
  documentation. This owner integrated its contract into the workspace and
  cumulative pool.
  Existing root workspace globs include package build, lint, and tests. The
  lockfile links its SDK and build dependencies. The memory migration manifest
  entry registers `tests/candidate.scoped-memory.test.ts`.
- Scoped excerpts use `root(...).read(...)` from the public file-access SDK.
  It returns bytes and identity from the same opened descriptor. Compare that
  identity to the authorized file and recheck the current pathname. Retain
  native symlink/hardlink rejection and the reader's 16 MiB limit. The published
  facade lacks declarations, so a narrow verified local type records its API.
- CI uses Node 26.1.0 and Corepack 0.36.0. Offline timestamp regression follows
  upstream pnpm 12.3.4. Node preflight rejects unsupported SQLite runtimes.
- `native-activation.mjs` and `native-interpreter-migration.test.ts` include
  parent-assigned interpreter migration with explicit old canonical-path binding.
- `native-extension.mjs` validates named prepared-file manifests emitted by
  the package phase. `native-pipeline.mjs` retains their proof and binds them
  into runtime evidence and `candidate.json`.
- `native-activation.mjs` requires exact target mappings, pre-stages and
  verifies file or directory bytes, journals prior destination identity, replaces
  after the state snapshot, and verifies prepared files before health and explicit
  rollback. Recovery continues to restore the complete state snapshot.
- `silent-reply-completion-evidence` uses this attempt's assistant text only
  when the delivery subscription has no visible text. It never uses historical
  `lastAssistant`. Existing silence policy and terminal failure guards remain.
- `active-memory-cold-recall` changes the bundled hook's deadline frontier only
  for eligible `always` recall. Link optional lookup cancellation to the owning
  deadline and debit its elapsed setup from deep recall's grace. The original
  model timeout and other modes stay unchanged.
- `active-memory-fixture-cleanup` tracks the two finite recall mocks that can
  outlive a prompt hook. Join their complete session cleanup before replacing
  test state or one-shot mocks. Force terminal polling to win with cleanup held,
  then prove the cleanup join. Production recall and timers are unchanged.
- Test hosts are trusted. Use supported CLI coordination and its normal shared
  lock directory, without a fixture-entry override. Separate writable test
  state, ports, and deliveries; preserve foreign locks and production fencing.
- Expose maintained `loadCronJobsStoreWithConfigJobsReadOnly`,
  `saveCronJobsStoreChanges`, `resolveCronJobsStorePathFromConfig`, and
  `resolveCronJobConfigRevision` through `cron-store-runtime`. Do not use its
  existing mutating load or whole-store save aliases. The manifest's
  `expectedRevision` uses the maintained config-only `sha256:` token.
  Expose `resolveIncludeWriteBoundary` and `resolveOpenClawStateSqlitePath`
  through their existing narrow SDK facades. Forward the config reader's existing
  `observe` and `pluginValidation` options without changing defaults for current
  callers. Preflight observation must be false; the default records health.
  Forward the existing artifact-preserving behavior through cron path selection.
  `native-state-migration.mjs` validates the manifest and performs fixed phases.
  `E2E_STATE_MIGRATION_MANIFEST` binds its SHA into both cumulative and installed
  proofs, and into the activation target and durable journal.
- iMessage keeps stable durable ingress, per-flush claims, GUID reply context,
  current media facts, and receive-time deadlines. The restored setting is opt-in.
  Restore root package inclusion and `bundledDist` for the maintained channel.
  Doctor must preserve both enabled and disabled root and account settings.
  Regenerate `bundled-channel-config-metadata.generated.ts` with upstream
  `pnpm config:channels:gen`; packaging consumes this snapshot rather than the
  live Zod schema. Only iMessage metadata changes.
- Yield gathering uses current execution fields, current-turn/agent ownership,
  exact run suppression, explicit collector exclusion, and truthful timeouts.
  Active or uncommitted handoffs remain retryable. Only a persisted tool result
  with the exact requester session, tool call, and execution IDs can acknowledge
  completion through the existing durable registry.
- Native and ACP target policy follows relocated request and launch boundaries.
  Prompt fixtures are regenerated with the documented upstream generator.
- `builtin-memory-migration` replaces retired transport code with config and
  source-resolution regressions. The original backend test target remains.

### Validation

- A focused regression packages synthetic patched provider source and built
  output, installs it offline, and verifies both the behavior bytes and
  provenance receipt. Pipeline tests prove the provider is always installed
  before rehearsal and that local artifacts cannot replace it. Integration and
  activation tests bind provenance through runtime, install, and recovery
  identities. Integration also rejects retained provider-package inputs whose
  source, build command, or complete toolchain differs from the provenance
  receipt. The focused native loop, pipeline, integration, and deployment set
  passes 109 cases with Node 26.1.0. E2E type checking passes.
- Prepared-file regressions seal a synthetic model into its own candidate proof,
  reject identity and mapping changes, deploy file and directory forms, and
  recover existing and newly added destinations without their original
  sources. The real `apply-and-deploy.sh` entrypoint covers both success and an
  injected post-replacement failure against test-owned state.
- New bundled-package regressions reproduce EEXIST for both npm bundle field
  spellings. They pack and install synthetic scoped, transitive, and required
  peer dependencies, remove the source tree, execute the installed entrypoint,
  and reject a missing required peer.
  The strengthened fixture also reproduces incorrect rejection of embedded
  module assets. Both aliases now preserve those bytes. All 26 packaging and
  public-bundle cases and e2e types pass. A real previously failing bundled
  archive also packages and installs offline in fresh isolated scratch.
  That is artifact proof only, not a claim of installed model or doctor health.
- Explicit container staging first reproduces an escaped-root failure.
  All 125 context, backend, container, browser, and staging cases pass after
  forwarding the root. Core types pass. Every changed test is mapped in the
  cumulative patch manifest; physical installed composition is still pending.
- `public-plugin-bundles.test.ts` reproduces both native ESM import failures.
  It packages each built dist, installs offline outside the source tree, and
  invokes every registered factory in a child with external activity denied.
  Combined installed baseline now passes both single-plugin and all-plugin
  registry/factory cases. Final rebuilt host, doctor, and stale-registry cases
  remain separate proofs.
- Run focused component tests while iterating.
- Interpreter fixtures retain real plist subprocesses and repeated full Node
  binary identity checks. Use one file-scoped 30-second test allowance, with
  headroom over measured 14.9-second hosted passes. Other files and production
  deadlines stay unchanged. Yield between cases so synchronous work cannot
  starve worker RPC. Thirty local hashes read a 144 MB real executable and take
  2.4 seconds; removing or caching identity checks is not an acceptable shortcut.
  All 68 interpreter/pipeline cases and e2e types pass after the correction.
  The retained full-diff review and local accumulated CI pass on `d6c442a`.
  Hosted run `34443062989` also passes the complete accumulated lifecycle on
  that exact head. Earlier runs `34437364226` and `34439888698` establish the
  timing and worker-reporting failures; the passing run confirms the correction.
- Reproduce delayed cold lookup before the recall repair. Cover shared grace
  expiration, disabled/policy-excluded destinations, and existing warm modes.
  The private owner owns the official-provider cold installed matrix.
  Both new delayed cases reproduce a zero-recall failure before repair. The
  repaired index, trigger, config, and escalation suites previously passed all
  403 cases, then combined repetition exposed late fixture work. Removing the
  new cleanup join deterministically leaves a recall session alive. The join
  repairs that leak without changing timing assertions. A forced terminal-poll
  fixture also holds cleanup past the hook result and joins it before the next
  rotated-transcript test. All 403 cases pass with both repairs; extension types,
  all nine patch-manifest checks, and exact patch applicability pass. These
  results replace neither the final accumulated gate nor installed cold proof.
- Local-service source tests pass 26 cases including real SIGKILL of a synthetic
  gateway during startup and after readiness, with stubborn model descendants.
  All 58 existing generic relay cases remain green. Twelve ownership cases cover
  generation reuse, incomplete records, and relay/group exit. Public installed
  helper, interpreter, and activation tests pass 105 cases, including a failed
  extinction join before any mutable state snapshot. These focused results do
  not replace final cumulative or installed model proofs.
- Gateway warmup and startup ordering pass 133 cases. Managed embedding
  transport passes 35 cases. The llama.cpp provider and preset pass 57 cases,
  including embedding-only idle-sleep retention. Core and extension type
  checks pass.
- Gathered completion recovery passes exact transcript, bounded-map eviction,
  persistence-failure, and SQLite round-trip regressions. The focused gather,
  announcement, and registry suites pass 319 cases with core types.
- `node packages/e2e/bin/openclaw-test-env.mjs ci` passed on exact public head
  `d3159e2bb9a2140072994de3dbc85bf8153c603f` with Node 26.1.0. It passed
  preparation, dependencies, build, all accumulated mapped regressions,
  extension packaging, portable root packaging, offline installation, and all
  nine installed runtime scenarios. The retained independent Sol reviewer
  rechecked the complete diff from `8cf0a92` and reported no actionable
  material findings.
- Current focused results: file-lock 2, sandbox 21, workshop 20, candidate
  browser/filesystem 2, public plugins 104, public native loop/pipeline/manifest
  47. Plugin build and type checking pass.
- The file-lock regression covers persistent-guard compatibility and recovery
  with the maintained kernel behavior. Its fixture uses an existing
  persistent guard and a killed child process, never production state.
- Stable focused coverage also includes 99 iMessage monitor/coalescer cases,
  config/parser/ingress cases, scoped gather and timeout cases, moved native/ACP
  target cases, 24 registry cases, and explicit memory migration/recovery cases.
- All sixteen exported patches apply sequentially to clean stable source and all
  mapped targets exist. Actual project collection is checked before execution.
- Upstream `pnpm tsgo:core` and `pnpm tsgo:extensions` pass.
- The repaired gather passes 502 focused cases and the core type check. Its
  real registry controller test retains pending completion across interruption.
  Its SQLite test rejects an uncommitted or unrelated handoff.
- The first managed run passed prepare, dependencies, build, accumulated
  regressions, extension packaging, root packaging, and offline install.
  The generated schema correction passes parity, upstream metadata checking,
  and 23 channel schema cases. Its native iteration passes build, package,
  offline install, and maintained channel startup.
  Installed ordinary/history/coalescing/read/write cases pass. Direct silent
  continuation passes with two model calls and one send. Model-error delivery
  now expects the stable classified HTTP 400 copy and rejects raw error text.
  Fresh-state replay passes. Installed inspection confirms group silence is
  allowed, but its subscription texts are empty despite an authored NO_REPLY.
  Two terminal regressions reproduce that failure before the repair. All 52
  terminal-resolution cases and core types pass with current/completed response
  fallback. The rebuilt native iteration passes all nine installed scenarios,
  including zero sends for group silence and direct visible-answer recovery.
- Run `node packages/e2e/bin/openclaw-test-env.mjs ci` with a supported Node
  and explicitly selected isolated source and external run directory.
- Retain collection evidence for every cumulative target.
- Installed scenarios use the real channel protocol with scripted models and
  deny-by-default recording adapters. No live accounts or delivery.
  Require bundled iMessage before startup, disable registry package resolution,
  require generated channel and account schema support, and assert that startup
  retains the opt-in setting. The split-message case
  has no explicit debounce and delays its second source row by 400 milliseconds.
- Rehearse scoped-memory tools against deterministic per-agent notes. Prove
  restricted reads cannot reach other agents or the shared wiki, including
  hostile tool arguments and missing-plugin behavior in the private composition.
  The descriptor repair passes 60 unit cases, type checking, and build.
  Its real builtin FTS proof passes against the exact published SDK. It proves
  excluded global roots were indexed before asserting filtered output. The
  patched-candidate run also passes, including actual file-open substitution
  and restoration before validation. The previous pathname reader reproduced
  the foreign-byte leak before the repair. Integration passes 31 native loop and
  manifest cases plus the e2e type check.
- Run fixture activation and rollback coverage through the accumulated pool.
- Add focused candidate-proof tests for prepared-file manifest/output binding,
  transportable source paths, tamper rejection, and exact runtime-proof
  identity.
- Add activation tests for file and directory destinations, overlap and symlink
  rejection, pre-stop staging, replacement after snapshot, health failure,
  explicit rollback, missing-destination cleanup, and interrupted recovery.
- Run the actual `apply-and-deploy.sh` entrypoint against test-owned state for
  successful migration ordering and injected post-replacement rollback.
- Migration proofs must cover old/new schemas, readonly preflight, source
  include/secret-reference preservation, all-leaf precondition validation,
  markerless eight-agent ownership, same-job drift, concurrent unrelated
  config/job/runtime updates, and interruption between config and cron
  operations. Assert no delivery, scheduler, RPC, or model startup. Recovery
  must preserve the original failure and rollback errors.
- The maintained 2026.7.1-2 SQLite fixture reproduces config-health writes during
  default snapshot reading and the old-schema prerequisite for config writes.
  Current/include/conflict cases pass in the installed artifact. The historical
  installed case exposes sidecar creation missed by checking only DB bytes.
  The strengthened regression asserts the old directory's files are unchanged.
  Core-only inspection and artifact-preserving path resolution pass four SDK
  cases, 75 retained cron cases, and core types. The broader public lifecycle
  set passes 135 cases and e2e types. The latest focused subset passes 86.
- The final stopped-migration correction passes 85 focused public migration and
  activation cases under Node 26.1.0, the e2e type check, and six real OpenClaw
  SDK tests. The managed `patches` lifecycle passes prepare, dependencies,
  build, all mapped regressions, extension and provider packaging, prepared
  files, portable packaging, offline install, additional install, runtime, and
  all nine installed scenarios. Its installed legacy-config fixture uses an
  eight-agent markerless roster and preserves all effective jobs.
- The complete plugin-migration correction passes 39 public executor cases and
  14 real OpenClaw stopped-repair and startup-repair cases. The rebuilt managed
  `patches` lifecycle passes every stage and all nine installed scenarios. The
  installed legacy-config case now also removes retired Active Memory QMD and
  Canvas host settings through their maintained doctor contracts.
- The deferred precondition correction passes 86 focused migration and
  activation cases, the e2e type check, and the managed `patches` lifecycle.
  Its installed legacy-config case applies an exact parent-object operation for
  Active Memory only after maintained plugin normalization.
- Native iteration on `76854b4` passes prepare, dependencies, build, package,
  offline install, all nine message scenarios, and all four migration modes.
  The historical case now preserves the complete state digest across preflight.
  The separate rebuilt-candidate run passes all five scoped-memory and migration
  cases using `vitest.candidate.config.ts`.
  Archive SHA256:
  `9f2ec16dbfddf20da466f050020e85cb150c9844807a86d9b7bd159b44f8f4db`.
  Installed runtime tree:
  `bf74f4e247d900d72681088086b81d690a7d2c474f21ec1035b5b8ee08d796f2`.
  That iteration records `accumulated: false` and cannot replace final CI.
- `node packages/e2e/bin/openclaw-test-env.mjs ci` then passes on `0bd7275`.
  All accumulated regressions execute. Unchanged build, package, installation,
  and installed runtime proofs are reused by their exact inputs and outputs.
  The resulting receipt records `accumulated: true` with regression proof
  `58ee65c87e3a02dd571ca0858d22a75b6853416eda0fc3c9c75d6bc04136c0ce`.
  This is public evidence only. Private cold recall and service lifetime remain
  unresolved; any later public behavior change requires the full pool again.

### Rollout and rollback

- Push a reviewed candidate and open a non-draft pull request.
- Resolve checks and review without routine user handoffs.
- Coordinate exact public source with the parent before integration.
- Production activation is suspended and private-owned. Do not invoke
  deployment against a live target from this worker.

### Review log

- Retained independent reviewer found premature durable acknowledgment during
  active gathering. A repair now waits for a committed exact tool result.
  The reviewer cleared the complete diff through `e83da72`, including the channel
  packaging and migration repairs. Generated metadata changes are confirmed
  limited to the intended iMessage properties. No interpreter finding.
- The retained review found a P1 race in `scoped-memory/src/plugin.ts`: an
  ancestor may be replaced during `manager.readFile` and restored before the
  post-read file check. The accepted finding is repaired with the existing
  descriptor-bound SDK reader and replacement-and-restoration regressions.
  The same reviewer must recheck the complete current diff before clearance.
- The retained reviewer clears all of `8cf0a92..75407a1`, including the scoped
  descriptor repair, silence, and migration. The installed sidecar failure then
  requires a focused correction and the same reviewer's full-diff recheck.
- The same reviewer clears all of `8cf0a92..76854b4` and every new file after
  readonly and cold-recall remediation. No actionable material defects remain.
  Installed cold recall, service lifetime, and private compatibility
  remain separate release gates, not claimed successful review evidence.
- The retained reviewer also clears the complete `8cf0a92..d6c442a` diff and
  all new files after both hosted fixture corrections. No actionable material
  defects remain. This evidence-only plan update does not change those inputs.
- Physical combined rehearsal found that the separately selected
  `@openclaw/llama-cpp-provider` archive predated the warmup behavior. The
  public runner now produces that package directly from the patched build and
  records exact provenance. The retained reviewer accepted the build-only
  symlink handling, then found that later verification still let the provenance
  receipt self-attest its source, build command, and toolchain. The verifier now
  compares each value with retained build and provider-package inputs. The same
  reviewer is rechecking that correction before the candidate is frozen.
- The retained Sol reviewer cleared the complete merged public behavior through
  `5b5d9de`. Resume that reviewer after the prepared-file behavior change and
  keep it through remediation.
- The retained reviewer found that the first stopped-migration correction held
  full config hashes and mutable cron row state from live preflight through
  asset staging. The accepted repair carries only stable migration semantics,
  partition identities, and selected revision across that boundary. Fresh
  stopped-state fingerprints protect the atomic copy. The same reviewer must
  recheck the complete current diff after focused and installed validation.
- The same reviewer cleared the complete `8cf0a92..43d5192` diff after the
  volatile-state and full plugin-migration corrections. No actionable material
  findings remain. Loading full plugin contracts only after shutdown can still
  turn an unrepairable private plugin config into bounded downtime and rollback;
  this is an accepted operational limit of keeping live preflight state-free.

### Checklist

- [x] Identify stable source and supported toolchain.
- [x] Complete patch compatibility inventory.
- [x] Rebase patches and public SDK consumers.
- [x] Commit focused compatibility regressions and documentation.
- [x] Integrate the parent-assigned scoped memory adapter and its regressions.
- [x] Complete stopped-state config and one-job migration with regressions.
- [x] Repair bounded cold recall and owned local-service cleanup.
- [x] Repair bundled dependency and installed plugin compatibility.
- [x] Repair scoped temporary-state and asynchronous memory fixtures.
- [x] Add a provenance-bound provider artifact from patched source.
- [x] Clear retained independent review for the integrated runtime behavior.
- [x] Pass accumulated and hosted gates for the integrated runtime behavior.
- [x] Confirm combined runtime compatibility and integrate exact source.
- [x] Bind immutable prepared files into candidate and runtime proofs.
- [x] Rehearse actual deployment and rollback with test-owned state.
- [x] Preserve effective cron jobs while maintained legacy config migrations retire old store paths.
- [x] Persist canonical multi-agent ownership before private config CAS.
- [x] Apply every validation-required maintained plugin migration after shutdown.
- [ ] Rehearse deferred exact private config CAS after full built-in normalization.
- [ ] Clear retained review for the deployment correction.
- [ ] Pass affected and accumulated gates for the deployment correction.
- [ ] Integrate the follow-up and hand activation back to private.
