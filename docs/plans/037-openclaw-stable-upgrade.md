# OpenClaw stable upgrade

Status: Repairing installed candidate
Issue: #114
Last updated: 2026-09-09

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
is saved in the requesting session.

A small plugin provides separate memory tools for agents that may read only
their own notes. It binds the existing memory manager to the trusted calling
agent and checks arguments, paths, and results at execution. Search excerpts
come from authorized files rather than untrusted indexed snippets. It does not
read the shared wiki. Private configuration denies the broader native memory and
wiki tools for these agents. A missing plugin therefore removes their memory
capability rather than exposing a broader fallback. Private consolidation
policy and data remain outside the public repository.

The release requires a newer Node runtime because older builds can truncate
SQLite text. Development and public CI use an explicitly supported version.
Plugin consumers compile against the new release rather than an older SDK.
The existing native pipeline builds isolated source, runs the accumulated
tests, packages dependencies, and rehearses the installed runtime with
recorded messages. Public code never depends on private configuration or live
accounts.

The deployment helper can select a new interpreter without changing a service's
shell wrapper or environment. It verifies both retained interpreters, changes
only the selected service argument, and restores the old interpreter with the
old runtime during rollback. Production deployment is outside this change's ownership. Source integration
waits for the coordinating release owner to confirm compatibility. Activation
and rollback remain in the existing deployment workflow.

### Status

The channel and completion repairs pass source regressions. The generated
iMessage schema now matches the maintained option at channel and account scope.
Installed rehearsal is continuing. The scoped memory adapter passes its focused
tests and build, and its real-manager proof is registered in the shared pool.

The retained reviewer clears the earlier completion and channel repairs. The
metadata correction and scoped adapter still need a full-diff recheck and the
final accumulated gate. Memory migration is authorized, but derived-data cleanup
is not. Builtin does not retain QMD's model expansion or learned reranking.
Installed access checks remain required before integration.

## Agent section

### State

- Base public source: `8cf0a92`.
- Target OpenClaw tag: `v2026.9.3`, exact commit
  `1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`.
- Selected Node: `26.1.0`. Upstream engine:
  `>=24.16.0 <25 || >=26.1.0`.
- Upstream package manager: `pnpm@12.3.4`. Puddles keeps its own manager.
- Implementation authorized. No design pause. No production deployment.
- Parent confirmation is required before merging public source.
- Parent-assigned worker `5501` exclusively owns `openclaw-plugins/scoped-memory/`
  and, if needed, `packages/e2e/tests/candidate.scoped-memory.test.ts`.
  This owner handles root registration, lockfile, commits, and final integration.

### Scope and acceptance criteria

- Rebase all eight patches without dropping behavior or previous tests.
- Update source and CI pins, Node preflight, public SDK consumers and docs.
- Preserve cumulative manifest collection and fixture-only message delivery.
- Commit regressions for compatibility changes and prerequisite boundaries.
- Add reusable scoped memory tools that preserve local-note access without
  allowing native shared-wiki or broader-memory fallback for restricted agents.
- Pass the full accumulated public gate on the exact committed candidate.
- Complete independent full-diff review and public remote checks.
- Send exact candidate identity and retained evidence to the parent.
- Merge only after parent confirms combined compatibility.

### Architecture and decisions

- Use isolated detached OpenClaw source. Never modify the configured checkout.
- Preserve patch order in `packages/e2e/openclaw-patch-suite.json` and the
  deployment wrapper.
- Port skill authoring to the release's agent-owned persistent collection.
  Do not restore retired workspace ownership or bypass skill policy.
- Use a side-by-side supported Node toolchain, not a host-global upgrade.
- Keep installation offline and keep source integration outside activation.
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
  Permit only `MEMORY.md`, `USER.md`, and Markdown files below `memory/`.
  Reject symlinks and hardlinks. Filter global extra-path results before
  rereading authorized excerpts through the existing manager. No raw indexed
  snippets, backend metadata, or backend exception details escape.
- Generic interpreter migration is included at the parent's request.
  `nodeMigration` retains both executable identities and the exact service
  argument index. The live target and activation remain with the release owner.
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
- CI uses Node 26.1.0 and Corepack 0.36.0. Offline timestamp regression follows
  upstream pnpm 12.3.4. Node preflight rejects unsupported SQLite runtimes.
- `native-activation.mjs` and `native-interpreter-migration.test.ts` include
  parent-assigned interpreter migration with explicit old canonical-path binding.
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

- Run focused component tests while iterating.
- Current focused results: file-lock 2, sandbox 21, workshop 20, candidate
  browser/filesystem 2, public plugins 104, public native loop/pipeline/manifest
  47. Plugin build and type checking pass.
- The file-lock regression covers persistent-guard compatibility and recovery
  with the maintained kernel behavior. Its fixture uses an existing
  persistent guard and a killed child process, never production state.
- Stable focused coverage also includes 99 iMessage monitor/coalescer cases,
  config/parser/ingress cases, scoped gather and timeout cases, moved native/ACP
  target cases, 24 registry cases, and explicit memory migration/recovery cases.
- All eight exported patches apply sequentially to clean stable source and all
  mapped targets exist. Actual project collection is checked before execution.
- Upstream `pnpm tsgo:core` and `pnpm tsgo:extensions` pass.
- The repaired gather passes 502 focused cases and the core type check. Its
  real registry controller test retains pending completion across interruption.
  Its SQLite test rejects an uncommitted or unrelated handoff.
- The first managed run passed prepare, dependencies, build, accumulated
  regressions, extension packaging, root packaging, and offline install.
  The repaired candidate repeats those passes but fails installed startup on
  the stale channel schema. The new parity regression reproduces the defect.
  Regeneration, upstream metadata checking, and 23 channel schema cases pass.
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
  The implementing worker reports 50 unit cases, type checking, and build pass.
  Its real builtin FTS proof passes against the exact published SDK. It proves
  excluded global roots were indexed before asserting filtered output. The
  patched-candidate run remains pending. Integration passes 30 native loop and
  manifest cases plus the e2e type check.
- Run fixture activation and rollback coverage through the accumulated pool.

### Rollout and rollback

- Push a reviewed candidate and open a non-draft pull request.
- Resolve checks and review without routine user handoffs.
- Coordinate exact public source with the parent before integration.
- Production activation is out of scope. Do not invoke deployment against a
  live target from this worker.

### Review log

- Retained independent reviewer found premature durable acknowledgment during
  active gathering. A repair now waits for a committed exact tool result.
  The reviewer cleared the complete diff through `e83da72`, including the channel
  packaging and migration repairs. The metadata correction and scoped adapter
  are now with the same reviewer for a full-diff recheck. No interpreter finding.

### Checklist

- [x] Identify stable source and supported toolchain.
- [x] Complete patch compatibility inventory.
- [x] Rebase patches and public SDK consumers.
- [x] Commit focused compatibility regressions and documentation.
- [x] Integrate the parent-assigned scoped memory adapter and its regressions.
- [ ] Clear retained independent review.
- [ ] Pass exact-candidate accumulated gate.
- [ ] Confirm combined compatibility with parent.
- [ ] Integrate eligible source and verify the landed result.
