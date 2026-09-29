# Upgrade maintained OpenClaw support to 2026.9.6

**Status:** Production restored; legacy selection capture repair in progress
**Issue:** [#114](https://github.com/coletaylor788/puddles/issues/114)
**Last updated:** 2026-09-29

## Human section

### Design

Bring the existing agents and integrations onto stable OpenClaw 2026.9.6. Keep the behavior we rely on and remove local fixes where upstream now supplies it.

```mermaid
flowchart LR
    A[Existing runtime and data] -->|Snapshot matching runtime and state| B[Stopped migration]
    B -->|Upstream Doctor converts history and config| C[OpenClaw 2026.9.6]
    N[Existing notes] -->|Local embeddings rebuild search| M[Resident memory service]
    M -->|Same agent access rules| C
    C -->|Migration or readiness failure| R[Restore matching runtime and state]
```

#### Host and integrations

Port the maintained patches and plugins to the newer host. Preserve messaging, tool access, concurrency and agent ownership. Upstream now replaces the silent-reply fix, protocol declaration workaround and cold-memory recall fix. Their patches retain only regression tests. The discovery patch also drops its original error-handling fix; a separate registry-selection correction remains. Keep the other fixes only where source comparison or baseline tests show a remaining need. The new iMessage entrypoint also needs a narrow correction to honor the configured policy for unmentioned group messages. It uses upstream’s existing classifier so mentions and direct requests still require answers. Delivery uses the process on main; this plan adds only upgrade requirements.

#### Local memory

The newer host replaces the retired search backend with local embeddings over the existing notes. Notes stay local and each agent keeps its access. Search ranking may change. With the model and index ready, searches should finish in under a second. Measure model startup, index building and automatic recall separately. The upgrade does not increase the upstream search timeout.

#### Conversation history and recovery

Upstream Doctor owns conversion to the new conversation storage. Our deployment integration invokes it and verifies history, ownership, schedules and archive references. The old application cannot read the new format. Recovery therefore restores the matching application and complete stopped-state snapshot together. Browser cleanup must also run through the verified old application and its interpreter, because the restored configuration can contain fields the new application rejects. An interrupted rollback repeats from the same verified snapshots.

#### Migration duration

Doctor imports retained conversation files into the new database. The deployment controller gave it the same one-minute limit as service commands. A production upgrade reached that limit while importing history. The config edit had finished, but the journal still reported the config phase.

Give Doctor a 20-minute limit and record its phase before starting it. The gateway stays stopped during that command; preparation, verification and any rollback add time beyond this limit. The exact release artifact completed a fresh, uninterrupted synthetic migration in 14 minutes 37 seconds. All history content, ownership and database integrity checks passed. Future releases with comparable migration work must measure representative volume before production. Keep service checks and memory search limits unchanged. A timeout still restores the saved runtime, state and external skill directories. Fast regressions cover the timeout contract and rollback; the larger installed measurement is a selected release check, not added work in every CI run.

#### Legacy skill proposal ownership decision

Three applied Skill Workshop records came from the old CLI without owning-agent metadata. Their target skills exactly match the applied drafts, and their rollback records are retained. Multiple agents share the workspace, so the new host cannot infer a unique owner. Doctor refuses migration. Configuration parity does not cover this state, and TEST omitted this legacy shape.

Approved correction:

1. Assign the three records to Main. Add only missing ownership after checking exact metadata and applied-content digests. Preserve skills, drafts, applied status and rollback records.
2. Check ownership before shutting down production. Read both legacy metadata files and records already imported into SQLite. Refuse ambiguous records without changing them.
3. Bind and snapshot the exact external skill directories Doctor can move. Restore them on failure without overwriting unrelated changes.
4. Rehearse with isolated state and mapped workspace copies. Add a committed regression for ambiguous ownership and external directory rollback, then run the corrected release through the shared process.

During the failed attempt, Doctor moved six external skill directories before refusing the ownerless records. Automatic rollback restored the runtime and state, and reviewed recovery restored all six original directories from the retained failed state. Contents and permissions matched; the copies remain available. The new regression must fail when only the state directory is rolled back.

The requester approved assigning these three records to Main on September 28. The repair runs after the stopped snapshot and before Doctor, with exact metadata, draft, rollback and skill-content preconditions. No ownership is inferred from the shared workspace.

The migration binds each agent's workspace and skill destination to the configuration Doctor will use. It checks scheduled jobs for references to skills that will move. It refuses interrupted skill writes, legacy collection backups and destinations outside the saved state until those cases have their own rehearsal. TEST includes completed CLI updates without owners. A separate real Doctor regression uses an external workspace and proves that rollback restores its moved skill.

The candidate ownership check uses the same plugin-aware configuration preview that seals the migration. Core-only normalization can leave legacy plugin settings in place and reject a valid sealed operation. The stable preflight drift checks remain separate.

SQLite inspection must leave the original state untouched. Even a read-only SQLite connection can create journal sidecars. The ownership preflight therefore reads a stable private copy of the database and committed WAL data. It refuses changing inputs or a rollback journal and removes the temporary copy after inspection. This preserves the exact state that rollback must restore.

#### Installed plugin state access

We shipped an incompatible combination: the new OpenClaw host and a maintained agent plugin still installed as a local archive. The host could load the plugin, but refused the persistent state API it needs before answering. A real message reached the channel and failed at that first agent operation.

OpenClaw 2026.9.6 grants this API to bundled plugins and verified official installations. Our patched archive qualified as neither. The test gate checked that the plugin loaded, but never started an actual turn through the installed plugin with its real state API. That was the missing test.

The approved correction ships the same reviewed plugin as part of our certified private runtime bundle. OpenClaw then treats it as a bundled component and permits the state operations it requires. Use that existing mechanism and retain the real source and dependency provenance.

The migration also removes the exact old installation record. Otherwise OpenClaw can keep selecting the external copy instead of the bundled copy. Use the supported registry API under a stopped snapshot, preserve plugin data and unrelated records, and restore the old selection with its package and state on rollback.

```mermaid
flowchart TD
    A[Reviewed host and plugin sources] --> B[One certified distribution]
    B --> C[Normal bundled discovery]
    C --> D[Real plugin state operations]
    D --> E[Agent turn with recorded external effects]
```

#### Full-turn validation

Keep the channel adapter, gateway, installed agent plugin, state API and model SDK real. A loopback HTTP service stands in for the provider API and returns fixed protocol responses. Record external delivery at the last boundary. Unknown requests fail the test; the fixture has no live-provider fallback.

Use this path in DEV and TEST for a greeting, tool execution and a reply, then restart with synthetic pending cleanup and prove the next turn succeeds. Assert the recorded reply as well as plugin state and source selection. Keep a negative case proving that an unrelated local archive remains untrusted. TEST also starts with the old external install record and proves its removal and restoration on rollback.

The requester authorized bounded real-provider calls with synthetic prompts to inspect protocol shapes. Keep credentials and personal data out of recordings. Once per release, run a bounded real-provider greeting in isolated TEST with recorded delivery. This checks authentication and service compatibility that a deterministic fixture cannot establish. A missing, skipped or failed required turn blocks promotion. Both fixtures and the bounded live check use the SDK's supported HTTP streaming transport. This covers the full agent path but does not certify the production-default WebSocket transport.

Make these checks part of the maintained process and scripts for future releases. The requester approved this correction after independent review. It changes the plugin's host capability classification within the existing trusted-host architecture. Agent permissions, sandboxing and data access policies remain unchanged.

#### Legacy plugin selection capture

The replacement passed real turns in DEV and TEST, including a live-provider greeting. Production's final read-only check then found the old external plugin selected again. Its record was stored in the predecessor's schema-1 SQLite table. Capture looked at the new database representation and JSON config, incorrectly reported no selection, and sealed no retirement. Upstream migration preserved the old record correctly. Our fixture covered an external record in the current representation and missed this predecessor shape.

Read the legacy record from a stable private copy of the database and committed WAL data. Never open the source through SQLite. Validate the singleton and records, and reject conflicting database, legacy JSON or config representations. Bind the record values and package contents as before. Canonicalize object field order when hashing records because Doctor may reorder fields; changed values and array order still fail the check. Keep conversion in upstream Doctor.

Retire the bound selection after Doctor, because Doctor can also import a legacy JSON record. Check a sealed requirement for bundled selection after that retirement and before gateway startup, even when capture found no record. A surprise external selection must fail the activation transaction and restore the predecessor automatically. Keep unrelated records, plugin data and the existing trust rules unchanged.

Add a schema-1 regression covering capture, actual upstream migration, retirement and exact rollback. Also cover malformed/conflicting records, source drift, legacy JSON import and a post-Doctor selection appearing when no retirement was sealed. This repairs the approved packaging and retirement design; it adds no new trust exception.

### Status

The failed activation has completed full maintained rollback. Read-only checks verify the original runtime, interpreter and service, with PROD and DEV healthy. The failed candidate is held and the production lease is released. Replacement validation remains pending.

The replacement artifact passed CI, all DEV checks and TEST, including a real-provider greeting with recorded delivery. Production activation reported healthy, but independent read-only verification found the old external plugin selection. The release is not complete. Maintained rollback restored the saved runtime, state and external paths. Read-only checks passed and the production lease is released. Recovery assets remain protected.

The cause is confirmed: predecessor SQLite schema 1 held the plugin record, while capture only saw the current representation. The narrow repair adds legacy capture and a mandatory post-Doctor bundled-selection gate inside activation. Retained review agrees that this stays within the approved correction. A new regression and corrected candidate must pass the release gates before another promotion.

## Agent section

### State

- Candidate validation passed CI, DEV and TEST, including full turns and a bounded real-provider TEST greeting. Post-activation verification found that capture had missed an external selection in the predecessor SQLite representation. Full rollback is verified, the failed candidate is disqualified and the production lease is released. Detailed environment evidence stays in private release records.
- Repair within the approved scope: stable read-only legacy projection with strict singleton/record validation and conflict checks; canonical value digest-bound retirement after Doctor (object field order may change, values and array order may not); sealed required bundled selection checked before startup even with no retirements. Commit actual schema-1 migration/rollback and false-absence regressions, retain the reviewer, then select a new merged candidate. Do not reuse this batch as production-successful.

- Composed CI `36528855519` passed on public `1ae108e` and companion `8700523`. Exact DEV installation stopped before activation: the host archive lists 50,858 entries (4,255,713 bytes), exceeding the generic 4 MiB command capture limit. DEV remained on its prior healthy build; PROD stayed on 2026.7.1. The failed import and empty staging were finalized under the owned controller, with compact evidence retained. DEV and capacity were released, and the batch is held. Repair `installRuntime` with a 16 MiB archive-specific bound. Add a committed real-tar regression larger than 4 MiB, run focused packaging checks, verify the actual failed archive locally, and retain independent review. Focused validation passes: 31 archive/packaging tests, TypeScript, and actual CI archive installation with full runtime digest verification in 20,366 ms. Retained review is clear and independently reproduced the passing real-tar regression. The replacement merged candidate starts again at the shared release gate.

- Repair source landed in public PR #188 and private PR #71. Composed run `36519539909` stopped during input capture before building: restored production has no external agent-plugin selection, but capture required its reader-only SDK seed to contain the future bundle. Return no retirement for an absent selection. The actual retirement guard still requires the replacement in the certified candidate. All 55 focused selection/migration tests and read-only production capture pass; retained review is clear.
- Incident: real message dispatch failed before reply after activation `activation-1790633653886-65893`. Release batch `02e09d78780db5ccdf62d8755b51a72175fe7b8dba0b6756710e116e97089bd3` is held. Explicit rollback completed with exit 0 and journal `rolled-back`, using the original receipt, target and recovery directory. The maintained controller restored state and external paths. Independent read-only verification confirms 2026.7.1, the original Node 22.23.3 and service, PROD/DEV HTTP 200, and preserved failed state/package/service. The controller joined and PROD maintenance lease was released. No test messages were sent.
- Repair branches: `codex/openclaw-bundled-copilot` in the assigned public/private pair, based on freshly fetched main. The correction is approved. Required proofs are actual plugin state capability, deterministic full turns through the real SDK against a fake provider API, one bounded real-provider TEST turn, external-record migration, and full rollback selection.
- The following candidate proofs passed before the incident. They remain evidence for their individual assertions, not proof of working user replies.
- Released public `cf4930115306f9655d8890153a163c68271c5c91` through composed CI `36482565849`, build `04e7da87ee01589135ef8bd1004742b5f47662d52c4ed32cd125d8036eed0c41`. Exact DEV passed four wrapper checks, nine messaging scenarios, 35 installed checks and the real local embedding test. Fresh uninterrupted Doctor migration took 876,810 ms under the 1,200,000 ms limit. All 5,445 synthetic histories and 168,172 events passed full content, ownership and integrity checks; the runtime digest remained unchanged.
- TEST passed all 11 runtime scenarios, injected activation failure and rollback, healthy activation, certification and final rollback. Its owned target was removed. Production transaction `activation-1790633653886-65893` completed successfully. Read-only checks verify version 2026.9.6, Node 26.1.0, health, recovery identity, all eight primary database schemas at 23, and exact preservation of the three approved proposals, skills, drafts and rollback contents with only the approved owner assignment. No verification messages were sent. Retain the production recovery snapshot.
- Source and process changes are landed, but release completion is reopened by the incident. The following attempts are historical evidence.

#### Earlier attempts

- Public PR #184 landed as `36ac7dc638728042d5109b790eeb1a8e8b29d5ef`. Composed CI `36470496541` with companion `f6db8a0e42b232ad5eb0c3c2bf8a1419149d61a5` passed. Exact DEV passed four wrapper checks, nine messaging scenarios, 35 installed checks and real embeddings without skips. TEST passed runtime, injected rollback, healthy activation, certification and final rollback. Production transaction `activation-1790626048764-8221` failed in Doctor after the config operation completed. The controller killed the command at 60 seconds. Automatic rollback and a separate read-only proof verify the original runtime, configuration, service, interpreter, twelve external paths and all three original proposal, draft, rollback and applied-skill hashes. PROD and DEV health pass; PROD is released. Batch `52b1b98afaaf305822e0d21260bf914091538d04d4d1a6d61a1504f34100e876` is failed. Retain its recovery and failed migrated state.
- Branch `codex/doctor-migration-budget` adds a Doctor-only 20-minute limit, a durable Doctor phase, and fast regressions for ordinary command limits and timeout rollback. The synthetic indexing stress test exceeded a provisional ten-minute limit, then completed in a 189.841-second continuation. All synthetic history content, schema versions, foreign keys and database integrity checks passed. This interrupted result is diagnostic only. A fresh uninterrupted exact-artifact rehearsal must pass within 20 minutes before PROD. The longer bound is a routine correction to the approved stopped migration; data handling and rollback are unchanged. Existing small history fixtures prove correctness but do not represent migration scale. Use the maintained lifecycle for the repaired candidate.
- Public PR #183 landed as `2c68774fdbd5a014689c35d4ba9fddac131b6c91`. Composed CI `36462393591` passed with companion `f6db8a0e42b232ad5eb0c3c2bf8a1419149d61a5`. Exact DEV passed four wrapper checks, nine messaging scenarios, all 35 installed upgrade checks and the real embedding check with zero skips. TEST runtime passed, but activation preflight failed before shutdown. The injected CAS change never ran. The real SDK reproduces a selected plugin mismatch with `pluginContracts: false` and matches every sealed operation with `true`. The new Workshop preflight must use the complete preview when applying sealed operations to inspect candidate paths. Preserve the separate stable drift projection. TEST state is accounted for, its service never started, port 18799 is idle and the slot is released. The corrected helper passes against the actual SDK and the same sealed TEST inputs without changing the state tree. All 109 focused lifecycle tests, typechecking and retained review pass. The inactive synthetic target is retired with small failure evidence retained; batch `15b81c5eb92c34fb8839e548cef375abe5e0c1dba50b24d36c8bfeeaf021c3f0` is disqualified.
- Ownership repair landed in public PR #182 (`36b8d87cd159f34ddbbb3c619faa7354fccf42df`). The replacement candidate passes accumulated CI. DEV wrapper checks, nine messaging scenarios and 31 of 35 installed checks pass. The four history rollback checks expose source sidecar creation by the Workshop preflight's SQLite read-only connection. The failed candidate cannot promote. Actual DEV remains healthy and its lease is released. Production remains on 2026.7.1; no production ownership record has changed.
- Corrective branch `codex/workshop-readonly-preflight` starts from that public merge. Inspect a stable private DB/WAL copy, verify original identities and hashes around copying, refuse rollback journals, and remove private inspection state in `finally`. Keep original rollback assertions and unbound-record rejection. All 107 focused Workshop, state-migration and interpreter recovery checks and the e2e typecheck pass. Retained review is clear. Installed schema 1, 21 and 22 migration and exact rollback checks pass against the packaged candidate runtime. The actual July package and interpreter also restart and read restored history in the unchanged installed regression on the target host. All four affected checks pass. Maintained retirement removes successful fixture scratch; actual DEV health passes and its lease is released.
- Production transaction `activation-1790582039867-96594` remains protected. Its runtime, configuration, service, interpreter and six restored external directories are verified. The three approved records retain their original metadata pending a qualified replacement release.
- Replacement public `6373b52e63e6b98d54f43a475f884d4961055bc7` and companion `0573b06fe945844d8117bf53da7afa85fea2eecd` passed composed CI `36388360634`, attempt 3. Build `95ecfc7531da895b85439f51c667efea20794eaf3956db7465ba869a9bb5463a` passed exact-artifact DEV and TEST. DEV ran four wrapper checks, nine messaging scenarios, 34 upgrade assertions and the real embedding test without skips. TEST passed 11 scenarios, injected activation failure and rollback, healthy activation, certification and final rollback. Its owned target is removed and its port is idle. Production activation failed in upstream Doctor on three ownerless legacy skill proposals; production is restored to healthy 2026.7.1.
- The supplemental real 2026.7.1 CLI check passed both sandbox command forms with synthetic legacy configuration under the bound Node 22 interpreter. The candidate specifically rejected that configuration. Runtime and configuration hashes stayed unchanged and no Docker operation ran. This proves command compatibility without existing containers.
- Shared target migrations and full configuration parity are implemented. Selected public `3eab63f419b7ecba9c2971d376fa1b2c9555f1ab` and companion `0573b06fe945844d8117bf53da7afa85fea2eecd` passed composed CI `36382703756` and exact-artifact DEV. TEST migration and activation passed, but final rollback failed when the candidate CLI parsed restored predecessor configuration. Maintained recovery succeeded with the unchanged target and receipt. The predecessor package snapshot remained unchanged; restored runtime, service and configuration match it, and TEST is stopped with port 18799 idle. This candidate is disqualified; the source repair requires a newly selected candidate through the shared process.
- Browser restoration now uses the hash-verified `recovery/package` and the expected canonical Node interpreter. Candidate and predecessor digests, latest transaction checks, locks and slot ownership remain enforced. Browser recovery rejects incomplete predecessor snapshots. Focused validation passes 110 tests across topology and interpreter recovery, including legacy config pairing and interrupted replay. Typechecking and retained independent review pass. The deployment fixture uses a synthetic predecessor CLI. This recovery proves snapshot selection and restoration, not actual predecessor CLI parsing. Separate installed tests use the real predecessor runtime to prove restored history readback.

- Target verified 2026-09-26: `v2026.9.6`, source commit `eb377ac59e6c9fd6c7705028034812becf00271b`; GitHub stable and npm latest agree.
- Existing source pin: `1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7` (`v2026.9.3`). Reuse landed compatibility code; [completed Plan 037](completed/037-openclaw-stable-upgrade.md) remains historical evidence.
- Implementation branch: `codex/openclaw-2026-9-6`, based on main `2437225ebcde955a5c73ea1bc8dd04947ef7fb93`, with process update `73985a748b5acce182adbc8a7bbd61dbef4190e9` merged. The current main process and design structure apply.
- Restart means a new candidate and run under main's process, not continuation of the paused release or reconstruction of its receipts. Preserve existing recovery assets and unrelated owners' state. The compatibility ports, focused tests and combined local DEV draft pass. DEV is healthy and its slot is released. Direct compiler execution and consistent incremental package selection pass focused checks, retained review and installed DEV validation. The declaration repair covers the prepared session and its client tools; type checks, retained review and the complete composed CI build pass. Unit coordination isolation passes 191 focused tests with a deliberately conflicting inherited record and lease, e2e typechecking and retained review. That draft was intermediate evidence. The replacement release evidence above supersedes it.

### Scope and acceptance criteria

- Compatible host, SDK consumers, configured plugins, browser and native dependencies on the exact target. Update all affected version, package-manager, manifest, lockfile and workflow pins consistently.
- Every maintained behavior in the patch table remains covered, including when upstream replaces a local patch. Moved test paths/projects must retain their assertions in the cumulative pool.
- Local embeddings produce real vectors before readiness, remain resident and stop with their owning gateway, including forced loss and on-demand startup. Preserve restricted memory, disabled agents and session-indexing opt-in.
- Use upstream migration to upgrade legacy state to schema 23, including prerequisite migrations, without losing retained histories, reset boundaries, ownership, scheduled jobs, journal-only committed data or archive references.
- Preserve effective tool exposure, messaging policy and concurrency. Keep explicit settings and inheritance intact.
- Installed plugin discovery, Doctor repair, tool factories and deferred imports work from the portable artifacts without ancestor checkouts or registry fallback.
- Failed migration, failed readiness and interruption restore the complete old state with its matching runtime, interpreter and browser.

### Architecture and decisions

- Workshop recovery is part of the activation transaction. Seal agent paths and approved metadata/content hashes in both the target identity and migration manifest. Validate the effective predecessor and candidate config, inspect ownership before shutdown, then repeat inventory after writers stop. Snapshot original state and each referenced external directory before any metadata repair or Doctor migration. Retained original metadata makes ownership repair reversible.
- SQLite inventory never opens the source through SQLite. Copy the database and committed WAL into an owner-only temporary directory, verify original identity, content and sidecar presence around copying, and let SQLite rebuild coordination files only there. Reject source drift and rollback journals. Preserve fail-closed inspection when no Workshop binding is supplied.
- Recovery verifies external snapshots and existing destinations before restoring absent directories with exclusive publication. A changed external directory is a recovery conflict, never permission to overwrite it. Already restored matching directories are safe to reuse after interruption. Bind sources and destinations; reject unsupported collection backups, pending apply recovery and external agent directories before shutdown.
- Fast validation covers ambiguous ownership, hash drift, SQLite-only records, decoded scheduled-job references, external rollback, interruption, configuration path mismatch and the actual upstream Doctor migration. Physical TEST seeds three synthetic completed updates and a completed create. Keep the final cumulative gate and exact artifact progression unchanged.

The current [safe-feature-development skill](../../.github/skills/safe-feature-development/SKILL.md) owns the entire development and release process. The [runner guide](../../packages/e2e/README.md), [deployment coordination](../../packages/e2e/DEPLOYMENT_COORDINATION.md) and [patch guide](../openclaw-setup/patches/README.md) supply its commands and contracts. Read their current main versions when restarting. This plan adds no alternate builder, gate, handoff, slot, review, merge or deployment procedure. Previous upgrade runbooks and Plan 039's historical execution details are not restart instructions.

Upgrade-specific decisions follow.

- **Toolchain:** keep Node `26.1.0` and Corepack `0.36.0`; adopt the tag's integrity-bound pnpm `12.4.0` instead of `12.3.4`. The [tagged manifest](https://github.com/openclaw/openclaw/blob/v2026.9.6/package.json) still accepts Node `>=24.16.0 <25 || >=26.1.0`. Revalidate native modules against the selected interpreter.
- **Database:** OpenClaw ships the schema 23 converter and prerequisite migrations in its maintained Doctor repair path. The [schema contract](https://github.com/openclaw/openclaw/blob/v2026.9.6/docs/reference/database-schemas/agent-schema-history.md) describes transcript compression that preserves the original JSON and binary vector storage. The existing deployment flow already calls `doctor --fix` after stopping writers and taking its snapshot. Reconcile only changed integration APIs and current core/plugin normalization; no custom history converter is proposed. Exact selected writes must compare against the normalized configuration. Do not replace upstream migration with ad hoc SQL or whole-config writes.
- **Memory timing:** requester approved removing a timeout increase as an upgrade requirement. Target under one second for warm local search with the model resident and index ready, including query embedding, lookup and permitted result retrieval. This is a target to validate, not an existing benchmark. Leave upstream's `30_000` failure cutoff in `extensions/memory-core/src/memory/search-deadline.ts` unchanged; it is not the latency target and needs no new override. Measure startup, index building, queueing, warm search and automatic recall separately. Retain the existing ninety-second startup allowance and explicit thirty-second automatic-recall cap. Automatic recall may include an additional model call; embedding speed alone does not measure that flow.
- **Tool discovery:** preserve authored `tools.toolSearch`; set it to `false` only when absent in migrated configuration, retaining direct schemas. Do not change upstream defaults for fresh installations.
- **Messaging:** 9.5 enables `tools.message.crossContext.allowAcrossProviders` when unset. Preserve authored global/per-agent settings and inheritance; materialize the old denied default only where implicit. Preserve within-provider policy and legacy normalization. These controls govern bound-conversation actions, not arbitrary shell or unbound CLI access.
- **Concurrency:** preserve authored limits; where `agents.defaults.maxConcurrent` is absent, carry forward the predecessor's effective value instead of adopting the new CPU-scaled default. Keep separate subagent and cron limits.
- **Other defaults:** keep automatic cold transcript archiving off where unset and preserve authored settings, optional integrations and model choices. Do not introduce upstream Atomic Updates as another deployment owner.
- **Browser and plugins:** use the target's browser inputs and supported SDK exports. Preserve browser profiles, sandbox mounts and generated iMessage configuration metadata. Doctor/startup must preserve the sealed installed package bytes.
- **Release selection:** [2026.9.6](https://github.com/openclaw/openclaw/releases/tag/v2026.9.6) is pinned for approval. Any later target needs a reviewed delta. Its upstream CI/soak waivers do not replace the repository's required validation. The separately rebuilt macOS desktop app is outside this host upgrade.

The audit below distinguishes upstream fixes from behavior we still add. Regression-only patches carry tests into the cumulative suite; they do not modify the runtime. A passing patch application is not evidence that a fix is needed.

| Maintained patch | Current disposition | Evidence or remaining work |
| --- | --- | --- |
| `managed-local-service-lifecycle` | Narrow retained integration | Use upstream clean-stop, lease recovery and relay cleanup. Keep POSIX relay ownership and gateway-loss integration absent upstream. |
| `gateway-memory-warmup` | Retained behavior | Upstream lacks opt-in gateway warmup, the lifetime service lease, two-vector readiness and embedding-only residency. Remove the old extra search timeout. |
| `file-lock-stale-reclaim-guard` | Retained bug fix | Unpatched fs-safe 0.18.1 fails the persistent-guard regression. Patched dependency passes both lock regressions. Preserve the new upstream root-scoped path. |
| `sessions-yield-block-and-gather` | Retained behavior | Keep requester-bound gathering and blocking. Use current upstream handoff ownership and preserve explicit message waits. |
| `sessions-yield-durable-handoff` | Retained integration | Use upstream asynchronous storage and acknowledge only committed tool results, including failure and restart. |
| `subagent-cross-agent-spawn-fix` | Narrow retained behavior | Upstream supplies explicit-target schema support. Keep default explicit targeting for scheduled callers and conditional inheritance of child restrictions. |
| `skill-workshop-sandbox-fix` | Retained access policy | Upstream deliberately requires a library capability in its shared tool gate. Preserve the approved sandbox workshop behavior through that gate. |
| `imessage-group-inbound-policy` | Required upgrade repair | The native no-output scenario reproduces an extra model request because iMessage hardcodes `user_request`. Reuse upstream classification for both ingress and message context; retain direct, mentioned and command requests. |
| `imessage-message-part-coalescing` | Retained feature | Upstream text debounce does not replace selective text, link and media grouping. Current monitor tests pass 64 cases. |
| `sandbox-discovery-failure-fix` | Original bug fix removed; two lines retained | Upstream already propagates discovery errors. Two selected-registry regressions fail on pristine 9.6 and pass with the remaining change. |
| `browser-userdata-dir-fix` | Retained bug fix | The same profile fixture fails on the pristine entrypoint, which still hardcodes the profile directory, and passes with the patch. |
| `builtin-memory-migration` | Regression only | No runtime converter or retired search-backend override remains. Upstream Doctor owns migration. |
| `silent-reply-completion-evidence` | Runtime fix removed | Upstream supplies completion evidence and intentional-silence handling. Retain 57 passing regressions. |
| `stopped-state-migration-sdk` | Retained SDK integration | Expose current upstream repair and cron APIs to the stopped deployment flow. Keep conversion in Doctor; preserve explicit legacy ownership. |
| `scoped-container-temp-root` | Retained isolation behavior | Three selected-root and invalid-root regressions fail on pristine upstream and pass with the patch. |
| `active-memory-cold-recall` | Runtime fix removed | Pristine 9.6 completes both slow-provider cases and trigger-timeout continuation. Retain tests for cold continuation and the unchanged configured recall limit. |
| `active-memory-fixture-cleanup` | Test fixture only | Join delayed provider cleanup so the retained cold-recall tests release their own resources. |
| `gateway-protocol-declaration-portability` | Runtime workaround removed | Upstream's typed protocol registry replaces the deleted fragments. Retain registry identity/type coverage without replacement runtime annotations. |
| `core-declaration-portability` | Required build repair | Explicit types preserve twelve affected Bash-tool, SQLite, prepared-session, client-tool and plugin-schema exports. Bidirectional checks pass before and after annotation. Retained review is clear; the complete composed CI build passes all declaration groups. |

### Implementation

- Reconcile the patch table against current upstream behavior, then port required fixes and cumulative regression registrations. Audit fs-safe 0.18.1 instead of carrying forward the old 0.8.5 dependency patch blindly. Prefer the new protocol composer to recreating deleted fragments.
- Align target, SDK and toolchain pins; adapt configured plugin packaging, generated metadata and browser inputs.
- Adapt the existing integration with upstream stopped repair only where its APIs changed; preserve the selected defaults. Extend existing fixtures to verify upstream conversion, warm search latency and package contracts.
- Execute these changes through the process linked above, starting from current main. General process work belongs in its shared owner, not in this upgrade plan.

### Validation

The exact CI artifact reached DEV, where the wrapper rejected a stale smoke expectation: current iMessage normalization preserves `mailto:`. Maintained rollback restored healthy DEV and removed the failed candidate. The wrapper now expects `mailto:user@example.com`; a committed regression compares its generated expectation with the real selected runtime. The new test fails before the correction and passes after it. Forty local contract tests pass with four conditional checks unselected; retained review is clear. The unchanged CI artifact passes DEV with the corrected tooling: wrapper checks, managed discovery and cold imports, all nine native messaging scenarios, all 33 upgrade assertions and the real local embedding test. Every selected test runs with zero skips. Predecessor history readback and final artifact digests pass. DEV health and fixture cleanup pass; its slot is released. Normal CI for the tooling correction passes, and the next final candidate CI must also cover that revision.

Composed CI run 36308790357 passes the full build and entire regression stage. Packaging then fails because the fixture environment forces npm offline while upstream now packages optional dependencies for all supported platforms. The private package command now permits dependency fetching only during artifact creation. The actual extension runner reproduces an empty-cache failure before the repair and passes after it; prepare, gate, installed and TEST-consumer commands still reject uncached requests. All 13 focused checks pass. A real package rebuild from an empty cache matches all five reviewed artifact hashes. Retained review is clear. Corrected composed CI run 36310537122 passes the full build, entire regression stage, packaging and immutable handoff. Public CI run 36308607527 passes the complete cumulative lifecycle.

The shared process supplies review and cumulative/installed/physical gates. This upgrade must contribute or retain the following assertions within those gates, using synthetic data and recording adapters.

- Each patch behavior, including durable completion ownership, intentional silence, message-part coalescing, explicit child targeting and killed-lock-owner recovery.
- Real installed plugin discovery, Doctor/startup, cold imports, portable dependency closure and unchanged package digests.
- Actual local vectors and recall; measure representative warm searches against the under-one-second target and investigate misses rather than extending timeouts. Record startup/indexing and automatic recall separately. Verify residency, shutdown, forced-death cleanup and allowed/denied memory and delegation flows.
- Tool-discovery preservation, cross-provider allowed/denied cases with inheritance, and unchanged effective concurrency.
- Upstream Doctor conversion from the legacy generation through its prerequisite migrations to schema 23, WAL data, histories, ownership, archives, selected config/job drift rejection and interrupted rollback with the predecessor runtime.
- Browser profile reuse and mount isolation; DEV/PROD availability while TEST exercises the changed runtime.

Focused repository checks cover migration, default preservation, toolchain selection, diagnostics and cumulative test dispatch. The migration fixture checks Doctor's exact normalized output, including implicit primary models, authored model/fallback values and workspace paths. All six candidate migration cases and the e2e typecheck pass locally.

The declaration patch preserves existing exported type shapes, including nullable joins, conditional columns and prepared session tools. All twelve annotations pass bidirectional checks against the unannotated types and retained review. The complete repaired local build passes, with 10,064 runtime JavaScript files unchanged. Composed CI run 36303786437 also passes the full build and all declaration groups. Its subsequent unit failures reproduce when synthetic targets inherit a host record with the same port. The unit Vitest configuration selects its own coordination path and clears inherited leases; explicit fixture records still enforce ownership. Runtime guards and installed-test configuration are unchanged. All 191 tests in the five affected suites pass with a deliberately conflicting inherited record and lease, including explicit-record refusal checks. The e2e typecheck and retained review pass.

Public CI run 36304553773 passes the build, complete accumulated regressions, packaging and installation. The runtime `recorded-tool-write` scenario fails because the new tool-search default catalogs its recording tool instead of exposing the direct schema expected by its scripted model. The fixture now sets `tools.toolSearch: false`, consistent with the direct-tool compatibility mode in the approved design. Keep the real tool call, exact recorded arguments, deny-by-default adapter and delivery assertions. This is fixture configuration, not an upstream default or runtime patch. Seven of nine native scenarios pass locally. The model-error fixture needs the new generic public error text while retaining raw-error exclusion. The no-output group case also fails with the original fixture configuration. The original iMessage entrypoint hardcodes `user_request` and bypasses `messages.groupChat.unmentionedInbound`. A separate patch uses the existing classifier for both ingress binding and message context. Before the change, the route regression fails for unmentioned groups and per-agent opt-in; after it, all nine route cases and four shared classifier cases pass. Retained review is clear. The maintained runtime rebuild, ten public patch-manifest checks and sixty paired lifecycle checks pass. All nine native messaging scenarios pass on the rebuilt runtime in 126.6 seconds. The group no-output case makes one model request and sends nothing; direct silent continuation makes two requests and sends one visible answer. Both tool cases record their exact expected calls, and the generic error case excludes the raw synthetic error. Successful fixture state is cleaned. This ingress regression is independent of the removed terminal-completion fix. Preserve the no-send assertion and test direct, mentioned, control and abort requests plus agent-specific policy precedence.

The declaration regression compiles directly under the cumulative runner's existing deadline. Executable tests cover dispatch, missing projects and compiler failure. Incremental DEV packaging uses the full materializer's npm file selection and copy behavior. Prepared and freshly materialized payloads match. These repairs pass focused checks and retained review.

The latest combined local DEV draft passes four wrapper scenarios, managed discovery and cold imports, all 33 upgrade cases and the official local embedding fixture with zero skips. The actual predecessor restarts and reads restored history after schema 23 rollback. Warm searches take 25–27 milliseconds. Model restart, normal shutdown and forced-loss cleanup pass; DEV is healthy and its slot is released. This is development evidence only. At that checkpoint, the earlier replacement had passed CI, DEV and TEST but failed production activation on legacy proposal ownership. The current release evidence is recorded in State above. No prior 2026.9.3 receipt counts as proof for this target.

### Rollout and rollback

The builder seals the separate TEST and PROD inputs and literal manifests before CI. Each environment selects its bound migration and full configuration checks. Follow the maintained process on main for selection and promotion; later unrelated merges do not invalidate an already selected candidate. Retain the real interpreter proof during handoff. The failed rollback candidate cannot be promoted even though its earlier migration and activation proofs passed. Its replacement starts again at accumulated CI and DEV.

Follow the shared process on main without a plan-specific rollout sequence. The upgrade-specific recovery requirement is a current, verified, complete stopped-state snapshot, including journals and transcript archives, paired with the old runtime, interpreter, service, packages and browser. Schema 23 cannot be downgraded by reinstalling an older package or changing schema markers. A later restore can lose post-snapshot work; preserve the failed new state. Existing backups remain protected but do not substitute for the new run's current production baseline.

### Review log

- Retained independent review confirmed the plugin capability failure and the missing installed-turn assertion. The proposed distribution packaging uses existing bundled trust and retains honest provenance. The requester approved its capability change and the provider-boundary test design. Preserve a negative untrusted-archive case and exact old plugin selection on rollback.

- Retained review clears the Doctor-only 20-minute bound, phase reporting, fast budget and timeout-rollback regressions, and volume guidance. The larger allowance is a routine correction within the approved stopped migration. The fresh uninterrupted exact-artifact volume proof passed before production.

- Independent release-input audit and retained review confirm that the synthetic TEST manifest cannot serve production. No supported target relocation or paired-manifest contract exists. The requester approved the release-provenance repair, including separate DEV configuration and durable process updates.

- Source re-vet identified schema/toolchain drift and changed search, discovery, messaging and concurrency defaults. Independent proposal review's messaging-policy omission was resolved.
- Requester directs a fresh restart through main's process. Both plans reference that process and retain only upgrade requirements, decisions and evidence obligations.
- Requester approved sub-second warm search as the validation target, separate cold/recall measurements and no upgrade-specific timeout increase. History conversion is upstream-owned; our requirement is integration and validation. The requester approved the complete design on 2026-09-26.
- Retained review clears the patch audit, worker bundle correction and candidate migration fixture repair. Main's approved local incremental DEV process applies; installed DEV and final cumulative evidence are still required.

### Checklist

- [x] Verify target and audit all maintained public patches.
- [x] Define upgrade-specific compatibility, migration and preservation requirements.
- [x] Align with current main and remove duplicated execution procedures.
- [x] Obtain design approval.
- [x] Deliver target compatibility, migration and regression coverage.
- [x] Approve the bundled-plugin correction and provider-boundary testing.
- [x] Implement the correction and pass installed capability and full-turn coverage.
- Local draft evidence: deterministic greeting, history, tools, restart and pending cleanup pass through the real installed plugin and SDK. One real-provider greeting passes with recorded delivery. Provider cleanup also passes a synthetic credential interruption test. These are development proofs, not release certification. The actual activation transaction passes migration, unchanged preflight, complete rollback to the old plugin selection, and a subsequent healthy activation. Exact-artifact release checks remain required.
- [ ] Satisfy the shared process's completion gate for this upgrade after the message-handling repair.
