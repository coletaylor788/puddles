# OpenClaw stable compatibility and migration support

**Status:** Complete
**Issue:** [#114](https://github.com/coletaylor788/puddles/issues/114)
**Last updated:** 2026-09-26

## Human section

### Design

The maintained source and plugins support the selected stable OpenClaw release while preserving message coalescing, child-agent targeting and completion gathering, file locking, browser profiles and skill authoring. Upstream retired the external memory engine, so the new source migrates its configuration to builtin search with local embeddings. Separate scoped memory tools preserve access to an agent’s own notes without exposing a shared wiki or broader memory fallback.

The installed package contains its complete dependency graph and maintained message plugin. Local embedding startup proves readiness with synthetic vectors, retains the model for the gateway’s lifetime and joins owned service processes before snapshot or replacement. Required recall shares a bounded cold-start allowance rather than spending it twice.

Deployment support can switch between retained interpreters, deliver immutable service and model files, and apply reviewed configuration and scheduled-job changes while the gateway is stopped. Maintained core and plugin normalization runs before exact private comparisons. The existing transaction snapshots complete state and restores package, interpreter, configuration, jobs and prepared files on failure.

### Status

Stable compatibility and migration support are integrated and have completed the combined installed and physical-target rehearsal recorded by the delivery plan. The Mini retains the matching build and passed target proof. The former stopped-migration and public integration handoffs are resolved.

This completed scope is source compatibility and safe migration infrastructure. The Mini’s production package still reports the earlier release. A production version change was outside this implementation scope and is not claimed here.

## Agent section

### State

Complete public implementation. Target source is OpenClaw `v2026.9.3`, commit `1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`. Public #116 integrated at `07819c2`; completed delivery corrections integrated through #117 at `042b732`. Selected Node is `26.1.0` and package manager is `pnpm@12.3.4`.

On 2026-09-26 the installed production package reports `2026.7.1` and still uses QMD. The retained rehearsal build `bb5c4422fbb62c7716aa3041353e8547e9ab8908a8089f7c6904ad16231eb1c6` has a passed physical target proof. These are different runtime states.

### Scope and acceptance criteria

- Preserve maintained patch behavior and accumulated regression targets on stable source.
- Update source, SDK, Node and package-manager pins consistently.
- Keep the maintained iMessage plugin and generated configuration metadata inside the portable runtime.
- Acknowledge gathered completion only after its exact tool result is persisted in the requesting session.
- Preserve visible-answer recovery for silent direct replies and intentional group silence using current-attempt evidence.
- Replace retired QMD configuration with builtin/local search while preserving sources, disabled agents, session opt-in and asymmetric access.
- Provide own-note tools with descriptor-bound reads, source/path checks and no broad-memory fallback.
- Share bounded cold recall setup time and prove local embedding readiness before channel readiness.
- Join only owned gateway/model process generations before stopped-state changes.
- Bind additional provider provenance and prepared-file identities to the producing proofs.
- Support retained interpreter switching and exact stopped-state config/job migration with complete rollback.
- Run accumulated, installed and physical rehearsal with synthetic content and recording adapters.

### Architecture and decisions

- `packages/e2e/openclaw-patch-suite.json` pins stable source and cumulative test targets. The patch README and wrapper carry the maintained order.
- Public plugins import `openclaw/plugin-sdk/core` at `2026.9.3`.
- `builtin-memory-migration.patch` replaces retired QMD transport coverage with migration and source-isolation coverage. It does not restore QMD expansion or learned reranking.
- `openclaw-plugins/scoped-memory/` binds factory context to the trusted agent, enforces `allowedAgents` and effective memory disablement, rejects unknown arguments, symlinks and hardlinks, and returns excerpts from authorized descriptor-bound reads rather than indexed snippets.
- Search permits own `MEMORY.md`, `USER.md` and Markdown under `memory/`. Direct GET additionally permits own dream notes without expanding indexed sources.
- `sessions-yield-durable-handoff.patch` uses exact requester, tool-call and execution identities before durable acknowledgment.
- `silent-reply-completion-evidence.patch` uses this response only, never historical assistant text.
- Cold-recall, fixture-cleanup, managed-service-lifecycle and gateway-warmup patches preserve one setup allowance, cleanup ownership and model residency. Ordinary memory requests retain their fifteen-second budget.
- `scoped-container-temp-root.patch` carries the explicit test staging root without creating alternate production locks.
- Portable provider provenance is checked against retained source, build-command, toolchain and package inputs; its own receipt cannot self-attest.
- Interpreter migration verifies both executable identities and changes only the exact selected service argument. Shell wrappers and unrelated service fields remain intact.
- Prepared files have stable IDs, types and digests, disjoint state-relative mappings and pre-downtime staging. Complete state snapshots own rollback.
- Live migration preflight is state-free and binds stable semantics and the selected job revision. Fresh stopped reads supply row fingerprints. Schema repair and maintained core/plugin migrations precede exact config comparisons and targeted job updates. No arbitrary command or whole-store replacement is accepted.

### Implementation

- Maintained source patches, companion explanations and cumulative targets are present under `docs/openclaw-setup/patches/` and `packages/e2e/`.
- Native packaging closes the production graph once, preserves embedded package assets and generates provenance for the built local provider.
- Secure Gmail and Calendar bundles use a `createRequire` banner for bundled CommonJS dependencies; installed loading does not depend on the source checkout.
- Scoped memory is included in workspace build/lint/tests and installed-candidate coverage.
- `native-state-migration.mjs` uses the maintained stopped writer and readonly cron APIs, validates include boundaries, preserves effective jobs when partitions migrate, and rejects selected-job drift.
- Explicit agent ownership normalization preserves a legacy roster without choosing a default owner or granting access.
- Full plugin migrations remove retired settings before parent-object compare-and-swap. Unrelated configuration and job definitions remain intact.
- `native-activation.mjs` binds interpreter, prepared-file, additional-runtime, browser, migration and recovery identities.
- Current operating documentation lives in `packages/e2e/README.md`, the patch README and the scoped-memory README.

### Validation

- Historical exact public accumulated runs include `d3159e2` and `0bd7275`; the latter records `accumulated: true`. Hosted run `34443062989` passed on `d6c442a`. Those proofs remain tied to those candidates.
- Retained focused evidence covers descriptor substitution, cold recall, service SIGKILL and descendant cleanup, generated channel-schema parity, group silence, gathered-result persistence, interpreter identity, prepared-file rollback and stopped legacy-config normalization.
- Final delivery records identify runtime source `251eff2` and upstream `1391f7c`, with all eleven combined installed scenarios, physical success, deliberate post-snapshot mismatch, rollback and certification.
- Audit: the Mini retains that exact build ID and a physical target proof marked passed. The installed production version remains `2026.7.1`; no production upgrade is inferred from rehearsal.
- The audit read implementation, manifests and component documentation, without starting services, invoking model requests or changing state. Recorded historical tests were not rerun for this documentation-only correction.

### Rollout and rollback

Source compatibility and migration support are integrated. Rehearsal uses the same guarded transaction with test-owned targets. The transaction stages immutable files before shutdown, snapshots complete state, applies maintained normalization and exact selected changes, then verifies health. Failure restores the previous package, interpreter, jobs, configuration, browser and prepared files. Production activation is outside this completed implementation record.

### Review log

Retained review corrected premature gathered acknowledgments, descriptor substitution during scoped reads, readonly sidecar creation, cold-recall fixture cleanup, provider provenance self-attestation, volatile preflight state and private comparisons before full normalization. Later combined delivery rehearsal resolves the old compatibility handoff. The hygiene audit distinguishes completed source support from the unchanged production version.

### Checklist

- [x] Port maintained behavior and SDK consumers to stable source.
- [x] Deliver scoped-memory and builtin-memory migration boundaries.
- [x] Preserve bounded recall, embedding readiness and owned-service cleanup.
- [x] Deliver provenance, interpreter and prepared-file contracts.
- [x] Deliver stopped normalization and exact config/job migration.
- [x] Complete retained review and accumulated validation.
- [x] Complete combined installed and physical rehearsal.
- [x] Integrate public source and distinguish production from TEST.
