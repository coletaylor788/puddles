# Upgrade maintained OpenClaw support to 2026.9.6

**Status:** Proposed, awaiting approval to implement
**Issue:** [#114](https://github.com/coletaylor788/puddles/issues/114)
**Last updated:** 2026-09-26

## Human section

### Design

Target OpenClaw 2026.9.6, the latest stable release verified for this proposal. Upgrade the maintained host, plugins and browser together while preserving message coalescing, child-agent routing and completion gathering, skill authoring, and agent access boundaries. Compare each local patch with the new implementation. Keep only the behavior still needed, with permanent regressions for both retained patches and upstream replacements. The earlier stable compatibility work is a starting point, not release evidence for this version.

Keep the planned move from the retired memory backend to builtin search with gateway-managed local embeddings and no remote fallback. Restricted agents continue to receive only their own-note tools. Preserve disabled memory and explicit session-indexing choices. Retain the ninety-second embedding startup allowance and resident model. Adopt upstream's thirty-second native search budget in place of the old fifteen-second requirement, while explicitly retaining the thirty-second automatic-recall cap. Preparation and queue time must be measured separately from search time. Keep direct tool schemas for this migration where tool search was previously unset, so the new discovery default does not silently change access-sensitive tool behavior.

Use the existing artifact delivery and rollback transaction. The new release changes conversation and memory database storage, so recovery must restore the matching old runtime and complete stopped state, including database journals and any transcript archives. Stage the interpreter, browser, plugins and embedding assets before shutdown. Validate the candidate in development, merge eligible source, and rehearse the exact merged artifacts before production. Use synthetic content and recorded external actions. This proposal adds no new integrations, agents, model choices, automatic archive policy, or replacement delivery framework.

### Status

The target is verified against the stable GitHub release, npm's latest tag and the tagged source. Existing support targets 2026.9.3. A read-only audit found extensive patch drift, a newer package-manager pin, schema 23, and changed tool and memory defaults. No 2026.9.6 implementation, build, migration or deployment has begun.

Approval is requested for this design, including the native search timing change and delivery through production after the required gates. Prior rehearsal results remain historical. The completed 2026.9.3 plan stays archived; this plan tracks the new target.

## Agent section

### State

- Research date: 2026-09-26 America/Los_Angeles (2026-09-27 UTC).
- Assigned branch: `codex/refresh-openclaw-upgrade-proposal`, based on public `c452781146785324d12382fb504fcc8f105af038` after fetching main.
- Verified target: `v2026.9.6`, peeled commit `eb377ac59e6c9fd6c7705028034812becf00271b`. The annotated tag object is not the source commit.
- GitHub marks the release non-prerelease, published 2026-09-23T23:21:10Z. npm `openclaw/latest` reports `2026.9.6`.
- Existing manifest pins `1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7` (`v2026.9.3`). Existing [completed compatibility plan](completed/037-openclaw-stable-upgrade.md) describes delivered support, not this candidate.
- The upstream release records waived soak and advisory CI lanes. Those waivers do not satisfy or weaken Puddles' accumulated, installed or physical gates. The rebuilt macOS app is separate from the unchanged npm package; the desktop app is outside this host upgrade.
- Open PR #111 concerns earlier release hardening. Compare its remaining diff against current main before any overlapping implementation; do not import its branch or reset its owner state. Other active integration designs remain separate scope.
- Approval of the current proposal is pending. All runtime pins and patches remain unchanged.

### Scope and acceptance criteria

- Update the upstream commit, SDK consumers, manifests, lockfiles, toolchain verification and applicable workflow pins consistently to the approved target.
- Preserve every existing behavioral regression, even when a patch is retired. Map moved upstream test paths and projects explicitly; absent or uncollected tests must fail.
- Preserve message-part coalescing, direct reply recovery and intentional group silence, explicit child targeting, durable gathered results, file-lock recovery, sandbox discovery failures, browser profiles and workshop behavior.
- Prove configured plugin registration, tool factories and deferred imports from portable installed artifacts with no ancestor checkout or registry fallback.
- Preserve builtin/local memory source isolation, restricted own-note tools, memory-disabled agents, session-indexing opt-in and no remote embedding fallback.
- Prove real local vectors before readiness, the ninety-second startup limit, residency, ordinary search timing, thirty-second automatic recall, and normal/forced service cleanup. Keyword-only success does not prove embeddings.
- Prove direct old-release-to-target schema migration using synthetic legacy state, including journal-only committed data, histories, reset boundaries, ownership, scheduled jobs and archive references. Confirm schema 23 from the executable source, not the stale release-label column in upstream docs.
- Prove failed migration, failed readiness and interrupted activation restore the old runtime, interpreter and complete state. Do not attempt an in-place database downgrade.
- No runtime work until approval. After approval, completion includes review, CI, DEV, merge, merged TEST, production validation and retained recovery under the existing lifecycle.

### Architecture and decisions

- Authoritative upstream evidence: [release](https://github.com/openclaw/openclaw/releases/tag/v2026.9.6), [tagged package manifest](https://github.com/openclaw/openclaw/blob/v2026.9.6/package.json), [9.4 changes](https://github.com/openclaw/openclaw/blob/v2026.9.6/CHANGELOG/2026.9.4.md), [9.5 changes](https://github.com/openclaw/openclaw/blob/v2026.9.6/CHANGELOG/2026.9.5.md), and [9.6 changes](https://github.com/openclaw/openclaw/blob/v2026.9.6/CHANGELOG/2026.9.6.md).
- Keep Node `26.1.0` and Corepack `0.36.0` as the selected baseline. The tag still accepts `>=24.16.0 <25 || >=26.1.0`. Move pnpm from `12.3.4` to the tag's integrity-bound `12.4.0`; verify native dependencies and all builder/target identities. There is no reason to change unrelated global tools.
- `src/state/openclaw-agent-db-contract.ts` declares schema 23. The [tagged schema history](https://github.com/openclaw/openclaw/blob/v2026.9.6/docs/reference/database-schemas/agent-schema-history.md) explains compressed transcript bodies and binary vectors. Several rows still say Unreleased despite being present in the tag. Old binaries cannot read the upgraded representation.
- Legacy repair now belongs to explicit stopped Doctor work. Preserve the actual transaction order: stop/join owners, snapshot complete state, schema repair, full maintained core/plugin normalization, exact selected config writes, Doctor, revision-bound job writes, then startup. Recheck phase APIs and intermediate commits on the new source. No live inspection may trigger these repairs.
- Existing `native-activation.mjs` already snapshots the full state tree and restores it with the package and service. Extend demonstrated gaps only. Keep the pre-upgrade recovery intact and bind new recovery to the current stopped baseline. Late rollback can lose work created since that snapshot; preserve failed new state for diagnosis and do not automatically merge incompatible databases.
- New native search default is `30_000` in `extensions/memory-core/src/memory/search-deadline.ts`. Adopt it explicitly instead of adding a patch just to retain fifteen seconds. This is not a thirty-second end-to-end guarantee: preparation may precede the search budget. Record cold/warm wall time and cancellation. Preserve the independent recall cap without double-spending cold setup time.
- `src/agents/tool-search-config.ts` enables structured discovery when unset. For migrated deployments, preserve explicit settings; set `tools.toolSearch: false` only when absent. Fresh upstream behavior remains unchanged. Test allowed tools and denied-tool invisibility/execution through the real runtime.
- Keep automatic cold transcript archiving off where unset, preserve authored settings, and test archive-inclusive recovery with synthetic archives. Do not add onboarding, setup helpers, new plugins or automatic updater ownership during migration.
- Upstream Atomic Updates are not a substitute for the composed artifact contract. Retain the existing deployment wrapper and require Doctor/startup not to fetch or replace sealed plugin bytes.
- Browser source/image must match the selected tag. Rebuild changed browser inputs before downtime, keep prior image for recovery, and validate profile persistence and sandbox mounts. A previously prepared image is reusable only if its actual inputs still match.
- Use current [development skill](../../.github/skills/safe-feature-development/SKILL.md), [runner guide](../../packages/e2e/README.md), [deployment coordination](../../packages/e2e/DEPLOYMENT_COORDINATION.md) and [patch guide](../openclaw-setup/patches/README.md). Historical Plan 039 and incremental draft instructions do not override CI-artifact DEV validation or merged-main TEST ownership.

The following audit ran each existing patch with `git apply --check` against the clean tag. It did not apply patches or execute tests. A failed check may reflect upstream edits, a renamed file or a missing predecessor patch. A clean check is only textual compatibility. Neither result settles semantic retention.

| Maintained patch | Clean-tag check | Proposed disposition after approval |
| --- | --- | --- |
| `managed-local-service-lifecycle` | Fails | Reconcile new service ownership code; retain graceful and forced-death guarantees. |
| `gateway-memory-warmup` | Fails | Port readiness/residency only where upstream lacks equivalent behavior. |
| `file-lock-stale-reclaim-guard` | Fails | Audit fs-safe 0.18.1 against the old 0.8.5 patch; retain contention and killed-owner regressions. |
| `sessions-yield-block-and-gather` | Fails | Reconcile current yield/replay flow; keep requester-bound blocking and gathering. |
| `sessions-yield-durable-handoff` | Fails | Rebase after gather work; acknowledge only durably persisted tool results. |
| `subagent-cross-agent-spawn-fix` | Fails | Recheck current spawn/visibility policies; preserve explicit target and inherited restrictions. |
| `skill-workshop-sandbox-fix` | Fails | Reconcile current workshop permissions without broadening access. |
| `imessage-message-part-coalescing` | Fails | Port monitor hooks and regenerate channel metadata from current source. |
| `sandbox-discovery-failure-fix` | Fails | Retain explicit failure behavior; check current upstream equivalent. |
| `browser-userdata-dir-fix` | Pass | Retain provisionally; prove installed profile and singleton behavior. |
| `builtin-memory-migration` | Pass | Retain provisionally; reprove source isolation and current Doctor migration. |
| `silent-reply-completion-evidence` | Fails | Reconcile incomplete-turn recovery and restart replay; preserve intentional silence. |
| `stopped-state-migration-sdk` | Fails | Port supported stopped APIs and schema/cron partition behavior before migration. |
| `scoped-container-temp-root` | Fails | Reconcile current mount mapping; keep test-owned staging and production locking. |
| `active-memory-cold-recall` | Fails | Reconcile concurrent recall and changed budgets; preserve explicit recall cap. |
| `active-memory-fixture-cleanup` | Fails | Keep cleanup assertions in the current fixtures; do not omit old coverage. |
| `gateway-protocol-declaration-portability` | Fails | Old fragment files are gone; prefer upstream composer and port portability regression, adding a fix only if reproduced. |

### Implementation

1. After approval, refresh branch bases and overlap checks. Freeze the selected release commit. Recheck stable metadata; any later stable target needs a reviewed proposal delta before changing the target.
2. Build the per-patch semantic ledger against pristine tagged source. Resolve upstream equivalents first, then port required behavior and cumulative test registrations. Do not reinstall old fs-safe or recreate removed protocol internals merely to make patches apply.
3. Align package-manager, host SDK and packaging inputs. Audit plugin SDK exports, generated iMessage metadata, portable dependency closure and browser source. Retain exact source/package provenance.
4. Adapt the stopped migration and synthetic old-state fixtures to schema 23. Add explicit tool-default preservation and native-search timing acceptance.
5. Prove focused behavior, retain one independent reviewer through remediation, then use the accumulated gate and normal source/artifact lifecycle.

### Validation

- Completed research: current repository instructions and plans, all intervening release-note sections relevant to storage, memory, plugins, sessions, browser and updates, target source contracts, and all seventeen public patch checks. Two checks pass and fifteen fail against pristine source.
- No dependencies installed, application built, tests run, artifacts produced or shared environment mutated for this proposal. Check the documentation diff and links only.
- Required after approval: focused package tests and each applicable upstream regression, then `node packages/e2e/bin/openclaw-test-env.mjs ci` against the exact final candidate. Preserve the complete accumulated pool.
- Add committed cases for old-state-to-23 migration, WAL data, schema rollback, archive closure, changed tool defaults, current memory deadlines and upstream replacements for retired patches. Reuse existing cases where they already establish the same behavior.
- Installed checks must use the packaged host and every configured auxiliary artifact. Cover offline plugin discovery/Doctor/cold import, message coalescing, completion persistence, allowed/denied memory and delegation, embeddings, browser profile reuse and process cleanup.
- Physical TEST must cover successful activation, deliberately induced failure after snapshot/migration, interrupted recovery, exact old-state restoration, and concurrent DEV/PROD availability. Historical 2026.9.3 proofs do not certify 2026.9.6.

### Rollout and rollback

- Design approval authorizes implementation and normal delivery through production within this scope. The current turn is proposal-only.
- Build deployable artifacts in the configured authorized CI environment. Any deployment-specific budget restriction remains binding; no paid execution is implied by this public plan.
- Queue/claim DEV only when CI artifacts are ready. Run installed behavior, release the slot, and merge only after review, accumulated CI and exact DEV eligibility.
- The initiating TEST owner selects current merged main, records all included owners and builds those exact bits. Hold TEST through successful activation, deliberate failure, rollback and cleanup, then release before waiting for PROD.
- Recheck current production baseline before PROD. Changed baseline requires renewed affected TEST evidence. Stage all archives/assets and retain old interpreter/browser before shutdown.
- Activate through `docs/openclaw-setup/patches/apply-and-deploy.sh` and the existing transaction locks. Read-only production checks never send messages. Restore complete state and matching runtime on failure; never lower schema markers or rebuild during downtime.
- Retain compact evidence, failed reproduction and every active/recovery dependency through managed retention. No broad cleanup or removal of other owners' state.

### Review log

- 2026-09-26 proposal re-vet replaces the stale version target and distinguishes completed compatibility work from unperformed production activation.
- Source audit found schema 23 despite stale Unreleased labels, pnpm 12.4.0, changed native search and tool-discovery defaults, fs-safe dependency drift, and removed protocol fragments.
- Independent implementation review and full semantic patch decisions remain pending after approval. Clean textual application is not review approval.

### Checklist

- [x] Verify latest stable release and exact source.
- [x] Read current plans, component contracts and delivery rules.
- [x] Audit every maintained public patch against the clean tag.
- [x] Document material defaults, migration, rollback and scope decisions.
- [ ] Obtain approval of this proposal.
- [ ] Implement target compatibility and committed regressions.
- [ ] Complete retained review, accumulated CI and DEV validation.
- [ ] Merge eligible source and rehearse exact merged artifacts in TEST.
- [ ] Activate production, verify read-only health and retain recovery.
