# Fix cron email reader failures

**Status:** Complete
**Issue:** [#43](https://github.com/coletaylor788/puddles/issues/43)  
**Last updated:** 2026-07-30

## Human design

### Problem

Interactive main-agent runs explicitly target the `reader` profile and can read
email. Three consecutive scheduled triage runs instead omitted
`sessions_spawn.agentId`, supplied `taskName="email_reader"`, and silently
spawned a same-profile `main` child. The cron run's restricted tool policy then
correctly propagated to that child, leaving it without Gmail read tools. Existing
tests covered cross-agent policy isolation and the optional explicit-target
configuration separately, but not this scheduled omission path.

### Outcome

Scheduled delegation now requires the intended target instead of silently
falling back to the scheduler's profile. A missing target fails immediately with
a repairable error, explicit `reader` delegation retains the reader's Gmail
tools, and the shared managed pool proves both paths with synthetic state.

### Approach

OpenClaw now makes native cron `sessions_spawn` calls require an explicit
`agentId` by default, and ACP cron calls do so only when their configured default
resolves to the requester profile. Retain explicit configuration overrides and
distinct ACP harness defaults. Clarify the model-facing schema so `taskName`
cannot be mistaken for profile selection. Cover ambiguous scheduled spawns,
overrides, explicit scheduled `reader` delegation, and explicit scheduled
coordinator self-spawn. Preserve same-agent tool restrictions when global ACP
scope identifies the requester through an explicit override. Normalize the live
coordinator policy before promotion by enabling explicit targeting before adding
`main` as an allowed target, so interrupted updates fail closed. Include
generated prompt snapshots and upstream documentation for the conditional
defaults.

### Safety and rollout

The existing cron job and its least-privilege `toolsAllow` remain unchanged.
Tests use synthetic session state and mocked gateway calls; they never access
Gmail, send messages, or mutate accounts. The exact reviewed build was promoted
through the host-combined lifecycle with a durable marker and rollback snapshot.
Production validation used fixed no-match reads only, with no delivery or mailbox
mutation. Coordinator policy updates apply the restrictive flag before the
expanded allowlist, and rebuilding without the patch remains the rollback path.

## Agent details

### State

The native and ACP cron guards, cross-agent policy isolation, generated
snapshots, setup guidance, and cumulative regressions are landed on `main`.
ACP compatibility checks run after target resolution and enforce the requester's
required host command access for every ACP target, preventing escalation through
an external harness. Compatible cross-agent ACP calls omit inherited session
policy, while native cross-agent reader calls use the reader profile. Public PR
#48 landed exact head `5b771f9`; private PR #6 landed exact host-combined head
`d97c1b3`. Production runs deployment `8491ddf6-668b-487d-8623-7c7dff0a0e31`
on OpenClaw `2026.7.1-2` / `0790d9f` with all maintained patches. Gateway,
marker, policy, reader, cron-shaped delegation, and iMessage checks are green.
The cron definition remains unchanged.

### Scope and acceptance criteria

- Identify why scheduled runs fail while equivalent interactive runs succeed.
- Make cron-run native subagent delegation fail closed when `agentId` is omitted,
  without changing cron configuration.
- Require explicit ACP targets only for cron-triggered same-profile defaults;
  preserve distinct configured ACP harness defaults.
- Preserve existing interactive reader behavior and explicit failure handling.
- Preserve an explicit configuration override for installations that intentionally
  allow implicit same-agent cron children.
- Prove that an explicit cron `main -> reader` spawn does not inherit the cron
  parent's restricted tool allowlist.
- Add focused source coverage mapped into the cumulative `packages/e2e/` suite.
- Keep automated tests isolated from live accounts and message delivery.
- Run all applicable component gates and
  `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Complete independent adversarial review with no unresolved actionable finding.

### Architecture and decisions

- `taskName` is only a stable handle; it never selects an agent profile.
- Cron runs require explicit native subagent targets by default because they are
  unattended and often carry a narrower per-run tool policy.
- `subagents.requireAgentId=false` remains an explicit escape hatch and takes
  precedence over the cron-safe default.
- Coordinator profiles that set `requireAgentId=true` include their own ID in
  `allowAgents`, preserving intentional same-agent fan-out while keeping every
  target explicit.
- Promotion normalizes and verifies the live coordinator policy before
  installing the patched runtime.
- Promotion records the current object and mutates only
  `subagents.allowAgents` and `subagents.requireAgentId`; it never replaces the
  whole object or drops existing targets.
- Promotion aborts when `allowAgents` is absent from the per-agent object and
  requires the operator to merge inherited defaults explicitly.
- Promotion runs under strict shell error handling so derivation or the first
  leaf update cannot fall through to a partial second mutation.
- The patch manifest and deployment source must match the live runtime release;
  version regressions are not promotable.
- The cron-key default applies to the immediate scheduled requester; coordinator
  descendants rely on the promoted `requireAgentId=true` policy.
- Same-agent children continue to inherit parent restrictions; explicit
  cross-agent children continue to use the target profile's tool policy.
- ACP inheritance compares against the already-resolved requester agent ID so
  global session scope honors `requesterAgentIdOverride`.
- ACP command compatibility checks run after effective target resolution and
  apply to every resolved ACP target; the tool wrapper no longer duplicates
  them.
- Coordinator promotion sets `requireAgentId=true` before expanding
  `allowAgents`; interruption therefore leaves delegation fail-closed.
- The fix belongs in the existing provider-neutral
  `subagent-cross-agent-spawn-fix` source patch and configured deployment order.
- Model-facing schema changes include their generated OpenClaw prompt snapshots
  and pass the upstream snapshot boundary check.

### Implementation

Implemented:

1. `subagent-cross-agent-spawn-fix.patch` defaults native cron callers to
   explicit `agentId`, while `subagents.requireAgentId=false` preserves the
   prior opt-in behavior.
2. The `sessions_spawn` schema now says `taskName` is only an alias and scheduled
   callers must set `agentId`.
3. Source regressions cover omitted-target denial, the explicit false override,
   and an explicit cron `main -> reader` spawn that retains the reader policy.
4. The cumulative patch manifest runs every changed source test.
5. The patch lifecycle and agent/Gmail setup guides document the new contract
   and recommend `requireAgentId=true` for coordinator profiles while including
   the coordinator in `allowAgents`.
6. `packages/e2e/tests/agent-setup-contract.test.ts` parses both setup examples
   and enforces explicit reader targeting plus preserved coordinator self-spawn.
7. Regenerate the patched candidate's prompt fixtures and include every resulting
   JSON and Markdown snapshot hunk in the maintained source patch.
8. Run `prompt:snapshots:check` inside the managed candidate lifecycle after all
   patches apply, with a repository regression that enforces command ordering.
9. Apply the cron-safe default to same-profile ACP spawning, preserve distinct
   `acp.defaultAgent` routing, and cover denial, override, and explicit targets.
10. Include upstream documentation hunks for the conditional cron default.
11. Before promotion, update the live `main.subagents` policy to require explicit
    targets and allow `main` alongside its existing worker targets; verify only
    that policy subtree.
12. Use leaf-level config commands so unrelated current or future `subagents`
    settings and worker targets remain intact.
13. Fail closed when the per-agent allowlist is absent, documenting how to merge
    inherited defaults explicitly and the immediate-cron-key boundary.
14. Make the promotion block atomic under strict shell error handling.
15. Preserve ACP-disabled error precedence, cover top-level ACP
    `requireAgentId=true`, and update the source JSDoc for the conditional cron
    default.
16. Port the complete patch stack and cumulative manifest to the live
    2026.7.1-2 commit.
17. Investigate source-workspace packaging after a standalone install failure;
    use the host's reviewed combined lifecycle for the materialized runtime graph.
18. Preserve current `main`'s atomic deployment, rollback, readiness, and
    sandbox recovery lifecycle during landing.
19. Keep the integration workflow's OpenClaw checkout ref synchronized with the
    cumulative patch manifest, enforced by a repository contract test.
20. Keep the integration workflow on a Node release whose embedded SQLite meets
    the pinned OpenClaw WAL-reset safety floor.
21. Compare ACP targets with the resolved requester ID and cover global-scope
    same-agent inheritance.
22. Order coordinator policy updates so the restrictive explicit-target flag is
    committed before the self-target allowlist expansion, with a repository
    contract test.
23. Centralize ACP inherited-policy compatibility validation in
    `spawnAcpDirect` after target resolution, enforce it for every ACP target,
    and cover both same- and cross-agent denial plus compatible cross-agent
    non-inheritance.

Feature implementation, review remediation, release porting, promotion, and
read-only production validation are complete. Cole requested full landing, so
the reviewed feature history is integrated with current `main` and is being
rerun through all invalidated validation and review gates.

### Validation

Planned:

- Run the mapped OpenClaw spawn tests against the pinned source with all maintained
  patches applied.
- Run repository build, lint, and tests.
- Run `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Exercise omitted-target denial, explicit-target success, the explicit false
  override, cross-agent policy isolation, cleanup, and patch rollback.
- After promotion, confirm gateway health, the installed cron guard, and direct
  reader Gmail access without performing any mailbox mutation or message
  delivery.

Completed:

- Focused patched-source tests:
  `src/agents/subagent-spawn.test.ts` and
  `src/agents/tools/sessions-spawn-tool.test.ts` — 83 passed.
- The regenerated source patch applies cleanly after its preceding maintained
  patch.
- The initial `node packages/e2e/bin/openclaw-test-env.mjs ci` run passed:
  - repository build and lint;
  - 238 repository package/plugin tests;
  - 410 tests across all 8 mapped patched-source test files;
  - the candidate browser test;
  - detached-worktree cleanup and stale-registration pruning.
- The managed regressions prove omitted-target denial, explicit override,
  explicit cron `reader` success under a restrictive parent policy, and
  preservation of same-agent restrictions.
- Review remediation:
  `packages/e2e/tests/agent-setup-contract.test.ts` — 2 passed.
- The complete managed lifecycle passed again after remediation:
  - repository build and lint;
  - 240 repository package/plugin tests;
  - all 410 mapped patched-source tests;
  - the candidate browser test and managed cleanup.
- Prompt-snapshot remediation:
  - regenerated three Codex dynamic-tool JSON fixtures and three Markdown prompt
    fixtures from the patched candidate;
  - direct `prompt:snapshots:check` passed;
  - targeted setup and patch-suite contracts — 7 passed;
  - the complete managed lifecycle passed again with the new snapshot gate:
    repository build/lint, 241 repository tests, current prompt snapshots, 410
    mapped patched-source tests, candidate test, and cleanup.
- Final focused remediation:
  - native and ACP spawn suites plus the schema suite — 155 passed;
  - prompt snapshot check remained current.
- Final managed lifecycle after ACP and upstream-doc remediation passed:
  - repository build and lint;
  - 241 repository package/plugin tests;
  - current prompt snapshots;
  - 418 tests across all 8 mapped patched-source test files;
  - candidate browser test and managed cleanup.
- Promotion-guidance remediation:
  - leaf-level policy contract — 3 passed;
  - complete managed lifecycle passed again with 242 repository tests, current
    snapshots, 418 mapped patched-source tests, candidate test, and cleanup.
- Inherited-default remediation:
  - fail-closed promotion contract — 3 passed;
  - complete managed lifecycle passed again with repository build/lint, 242
    repository tests, current snapshots, 418 mapped patched-source tests,
    candidate test, and cleanup.
- Final shell/ACP/source-doc remediation:
  - focused native, ACP, and schema suites — 157 passed;
  - atomic promotion contract — 3 passed;
  - complete managed lifecycle passed with repository build/lint, 242 repository
    tests, current snapshots, 422 mapped patched-source tests, candidate test,
    and cleanup.
- Initial promotion and rollback:
  - snapshotted the live coordinator policy and installed 2026.7.1-2 package;
  - normalized the policy without dropping any worker target;
  - installed the pinned 2026.6.11 candidate, but its restart was refused because
    the live config was written by newer 2026.7.1-2;
  - restored the prior package and policy;
  - confirmed CLI and gateway 2026.7.1-2, running service, and successful
    connectivity probe.
- Live-release port:
  - pinned the managed lifecycle to
    `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`;
  - ported sessions-yield and explicit-target patches while the other three
    maintained patches continued to apply cleanly;
  - regenerated prompt snapshots for the live release;
  - complete managed lifecycle passed with repository build/lint, 242 repository
    tests, current snapshots, 426 mapped patched-source tests, candidate test,
    and cleanup.
- Deployment integration:
  - early standalone source-install attempts failed safely and rolled back;
  - the release port and maintained patch pool remained green throughout;
  - current `main`'s atomic package/state/browser rollback lifecycle superseded
    the draft standalone packaging changes during conflict resolution;
  - the host combined lifecycle materialized the full runtime dependency graph,
    preserved all maintained patches, and completed production promotion.
- Production promotion and validation:
  - deployed the reviewed `0790d9f` combined source build and refreshed the
    browser image;
  - installed runtime graph contains the expected patched AI workspace;
  - gateway connectivity and event-loop health are green;
  - coordinator policy preserves all existing targets and requires explicit
    agent IDs;
  - installed native and ACP guard strings are present;
  - direct reader smoke called `list_emails` and returned `READ_OK` without
    delivery;
  - cron-shaped main smoke denied an implicit spawn, explicitly spawned
    `reader`, completed the Gmail read, and returned `CRON_READER_OK` without
    delivery or mutation.
- Final handoff lifecycle:
  - `node packages/e2e/bin/openclaw-test-env.mjs ci` passed after production
    documentation updates;
  - repository build/lint and 244 package/plugin tests passed;
  - prompt snapshots are current;
  - all 426 mapped patched-source tests and the candidate browser test passed;
  - managed worktree cleanup completed.
- Landing:
  - required CI failure traced to the integration workflow checking out the old
    OpenClaw pin while the cumulative manifest uses `0790d9f`;
  - workflow/manifest pin contract added;
  - current `main` integrated with its six-patch atomic deployment lifecycle
    intact;
  - complete managed lifecycle passed with 275 repository tests, current
    snapshots, 447 mapped patched-source tests, candidate test, and cleanup.
  - remote Integration then reproduced cross-file mock contamination under
    the upgraded pin; terminal review showed 146 ACP failures were deterministic
    Node/SQLite runtime rejection, with six secondary iMessage assertions;
  - local CI-equivalent validation was green on safe Node 22.23.1;
  - workflow now uses Node 22.23.1 with a WAL-safety floor contract;
  - full CI-equivalent lifecycle passed with 276 repository tests, current
    snapshots, 447 mapped patched-source tests, candidate test, and cleanup.
  - latest `main` integration passed with 286 repository tests and 447 mapped
    patched-source tests;
  - ACP compatibility remediation passed 158 focused tests and the complete
    lifecycle with 286 repository tests, current snapshots, 449 mapped
    patched-source tests, candidate test, and cleanup.
  - pull request #48 was remote-green and mergeable at `7c887496` over the
    previously integrated base;
  - current `main` advanced to `a385758`;
  - the reviewed feature history merged conflict-free onto that base as
    `9cfdd05`;
  - `node packages/e2e/bin/openclaw-test-env.mjs ci` passed on the integrated
    candidate with repository build/lint, 286 repository tests, current prompt
    snapshots, 449 mapped patched-source tests, the candidate browser test, and
    managed cleanup.
  - fresh reusable full-diff review found no actionable findings; refreshed
    remote CI and post-merge validation remain the only validation gaps.
- Terminal exact-commit review of `796a52a` found two actionable issues:
  global-scope same-agent ACP inheritance ignored the explicit requester
  override, and the documented coordinator update expanded the self-target
  allowlist before enabling explicit targets. Both are remediated.
- Terminal-review remediation validation:
  - focused coordinator setup contract — 3 passed;
  - complete managed lifecycle — repository build/lint, 286 repository tests,
    current prompt snapshots, 451 mapped patched-source tests, candidate browser
    test, and cleanup.
- Fresh independent replacement review verified both remediations and all 15
  changed files with no actionable findings. Remote CI, production confirmation,
  and post-merge validation remain.
- Revised exact commit `0ef8ed1` received a clean terminal review and passed
  refreshed Integration and CodeQL checks.
- Before promotion, `main` advanced to `3e1f3d1` with only the unrelated
  Todoist-filing plan changed. That base merged conflict-free as `9b919e0`;
  the complete managed lifecycle passed again with repository build/lint, 286
  repository tests, current prompt snapshots, 451 mapped patched-source tests,
  the candidate browser test, and cleanup.
- Fresh complete-diff re-review verified the corrected schema contract across
  implementation, assertion, three JSON snapshots, and three Markdown metadata
  snapshots with no actionable findings.
- Before promotion, `main` advanced to `863666f` with the reviewed iMessage and
  deployment lifecycle. The sessions-yield patch conflict resolves to current
  `main`'s newly ported version. The complete managed lifecycle passed with
  repository build/lint, 288 repository tests, current prompt snapshots, 464
  mapped patched-source tests, the candidate browser test, and cleanup.
- Fresh complete-diff review of the current-base integration found no actionable
  findings; terminal review and remote validation remain.
- Terminal exact-commit review found one medium ACP isolation defect: duplicate
  wrapper/runtime compatibility preflights rejected restrictive requester policy
  before cross-agent classification. The wrapper preflight is removed, runtime
  checks are same-agent-only after target resolution, and the complete managed
  lifecycle passes with repository build/lint, 288 repository tests, current
  prompt snapshots, 470 mapped patched-source tests, the candidate browser test,
  and cleanup.
- Fresh complete-diff re-review found no actionable findings, verified all 15
  generated source blob hashes, and passed targeted repository contracts.
- Exact candidate `8d4a474` passed terminal review and remote Integration/CodeQL.
  `main` then advanced to `6dc4e03` through only an unrelated plan update, now
  integrated as `2892b93`; no managed runtime gate was affected.
- Combined-lifecycle preflight correctly blocked production mutation because the
  host-local manifest still pins repository head `7c887496`. Production remains
  healthy on OpenClaw `2026.7.1-2` / `0790d9f`; no recovery snapshot was needed.
- Final-base review found one medium test-quality gap: the explicit
  `requireAgentId=false` ACP regression used a distinct default that would be
  accepted even without the override. The regression now uses a same-profile
  implicit `main` target. The full managed lifecycle passed again with repository
  build/lint, 286 repository tests, current prompt snapshots, 451 mapped
  patched-source tests, the candidate browser test, and cleanup.
- Remediation re-check confirmed the override regression and found one low source
  JSDoc mismatch. The comment now distinguishes native and same-profile ACP cron
  defaults. The complete managed lifecycle passed again with repository
  build/lint, 286 repository tests, current prompt snapshots, 451 mapped
  patched-source tests, the candidate browser test, and cleanup.

### Rollout and rollback

Apply and deploy only through
`docs/openclaw-setup/patches/apply-and-deploy.sh` with `MINI_HOST` unset on the
target Mac mini for the provider-neutral stack. The wrapper serializes build and
deployment, snapshots package/runtime/service/browser state, probes readiness,
and rolls back automatically on failure. Hosts requiring additional local
components must use their reviewed host-combined lifecycle so the complete
runtime dependency graph promotes atomically.

Production runs a combined build at pinned source `0790d9f` containing these
maintained patches. Checksummed rollback snapshots are retained by the host
lifecycle. The landed deployment marker is
`8491ddf6-668b-487d-8623-7c7dff0a0e31`; its rollback snapshot is
`20260730T084333Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`.

### Review log

- Tracking gate: Todoist's first signed tracking comment points to issue #43.
- Ledger gate: issue #43 begins with the plan link and contains only `Status`
  and `Done`.
- Research: scheduled failures spawned `agent:main:subagent:*` with
  `taskName="email_reader"` and no `agentId`; successful runs spawned
  `agent:reader:subagent:*` with `agentId="reader"`.
- Research: the restricted cron policy was inherited only by the accidental
  same-agent child; existing explicit cross-agent records retained the reader
  policy as designed.
- Independent implementation review: one medium documentation/config
  compatibility finding accepted and remediated. Both coordinator examples now
  include `main` in `allowAgents`, and the shared pool enforces the contract.
  Re-review found one medium upstream-readiness defect: six prompt snapshot
  fixtures were stale after the model-facing schema change. The fixtures are
  regenerated, included in the patch, and enforced by the managed lifecycle.
  Complete-current-diff re-check found one medium live-policy promotion gap and
  two low completeness gaps (ACP parity and upstream docs). All are accepted;
  ACP parity, explicit cron self-target coverage, upstream docs, and
  promotion/rollback guidance are implemented and revalidated. Fresh
  complete-current-diff review found one medium hazard in the promotion snippet:
  whole-object replacement could revoke live household targets. Finding
  accepted and remediated with derived leaf-level updates; fresh re-check
  found one inherited-defaults edge case and one documentation limitation. Both
  are remediated and revalidated; fresh complete-diff re-check pending.
  Final re-check found one medium shell atomicity defect and two low
  upstream-readiness gaps (ACP ordering/coverage and stale source JSDoc).
  Findings accepted, remediated, and revalidated. Fresh complete-diff re-check
  completed with no actionable findings.
- Promotion review: deployment failed safely on the stale 2026.6.11 release pin;
  automatic rollback restored package, policy, and gateway health. Porting to
  2026.7.1-2 is complete. Independent port review found no technical defect and
  one low status-wording overclaim. Re-check is technically clean and found one
  remaining qualifier in the subagent patch doc; remediation complete and final
  re-check completed with no actionable findings.
- Deployment integration review: source-workspace packaging and rollback risks
  were investigated and independently reviewed. Current `main` superseded the
  draft standalone wrapper with its atomic lifecycle; the host combined
  lifecycle preserved the maintained patches and validated the materialized graph.
- Production: reviewed source build promoted successfully; read-only gateway,
  policy, guard, reader, and cron-shaped delegation checks are green.
- Landing: prior current-main conflicts and workflow pin drift are resolved.
  Terminal landing review rejected the serial-test diagnosis and identified
  Node/SQLite runtime drift. Workflow 22.23.1 and per-major floor contracts are
  green. ACP default-agent review remediation preserves distinct harness defaults
  and passed the complete lifecycle. Pull request #48 then became remote-green,
  but `main` advanced to `a385758`. Candidate `9cfdd05` integrates the reviewed
  feature history onto that exact base and passed the complete managed lifecycle;
  refreshed reusable review was clean. Terminal exact-commit review found one
  high ACP inheritance defect and one medium policy-update ordering defect. Both
  findings are accepted, remediated, and fully revalidated. The original
  completed reviewer cannot be resumed through the available worker interface,
  so a fresh independent replacement re-checked the complete current diff and
  found no actionable defects.
- Final-base review found one medium ineffective-regression defect in ACP override
  coverage. The finding is accepted, remediated with a same-profile implicit
  target, and fully revalidated; review re-check is pending.
- Re-check confirmed the functional fix and found one low source-comment
  overclaim about ACP cron defaults. The comment is aligned with the implemented
  same-profile condition and fully revalidated; final review remains.
- Final complete-diff review found one low publication-boundary defect in plan
  wording. Nonessential deployment-topology details are removed in favor of
  provider-neutral host-combined lifecycle terms.
- Terminal exact-commit review found one remaining low topology disclosure
  in rollout wording. It is replaced with provider-neutral guidance for hosts
  requiring additional local components.
- Terminal exact-commit review found one low model-facing contract mismatch:
  schema text required `agentId` for every cron caller despite the supported
  distinct ACP default. Schema coverage and snapshots now state that exception;
  the complete managed lifecycle passed again with repository build/lint, 286
  repository tests, current prompt snapshots, 451 mapped patched-source tests,
  the candidate browser test, and cleanup.
- Corrected-schema complete-diff re-review found no actionable findings.
- Terminal review of `30e8e6c` found two medium ACP defects: requester command
  policy was checked before cross-agent target resolution, and the purported
  regression used a permissive parent. Both findings are accepted.
- Commit `8d4a474` gates requester policy validation on same-agent ACP targets
  and adds restrictive cross-agent and same-agent allow/deny/group/pattern
  coverage. The full managed lifecycle passed with 288 repository tests, current
  snapshots, 470 mapped patched-source tests, the candidate browser test, and
  cleanup. Independent review and remote Integration and CodeQL were green.
- Current `main` `6dc4e03` and remote candidate `b482a80` are integrated locally.
  Exact merge `8f3e030` passes the complete managed lifecycle with repository
  build/lint, 288 repository tests, seven current prompt snapshots, 470 mapped
  patched-source tests, the candidate browser test, and cleanup. Re-review the
  exact committed result before publishing it.
- Terminal review of `5e870b5` found that same-agent-only ACP compatibility
  checks permit restricted requesters to escalate through a cross-agent ACP
  harness. Accept the high-severity finding: preserve post-resolution ordering,
  enforce required command-policy compatibility for every ACP target, and
  replace the escalation-encoding regression with ACP-compatible cross-agent
  non-inheritance coverage.
- ACP escalation remediation is implemented. Required command-tool
  compatibility now applies to every resolved ACP target; compatible
  cross-agent calls omit inherited session policy, while restrictive allow,
  deny, group, pattern, and wildcard cases fail. The isolated patched-source
  lifecycle passes with seven current snapshots, 470 mapped tests, the
  candidate browser test, and cleanup.
- Complete remediation validation passes with repository build/lint, 288
  repository tests, seven current prompt snapshots, 470 mapped patched-source
  tests, the candidate browser test, and cleanup.
- Security remediation re-review found no code defect and mutation-tested the
  cross-agent escalation regression. It found stale architecture wording and an
  inverse-gate coverage gap because every incompatible-policy case used a
  cross-agent target. The plan wording is corrected and one table case now uses
  a same-agent requester so either relation-specific gate regresses the suite.
  The isolated patched-source lifecycle passes with seven current snapshots, 470
  mapped tests, the candidate browser test, and cleanup.
- Final cumulative validation after the inverse-gate coverage change passes with
  repository build/lint, 288 repository tests, seven current prompt snapshots,
  470 mapped patched-source tests, the candidate browser test, and cleanup.
- Final exact-commit review found no actionable defects. It independently
  verified all patch hunks and counts, unconditional ACP compatibility after
  target resolution, both same- and cross-agent inverse-gate regressions,
  cron-target semantics, promotion ordering, and publication safety.
- Exact published head `83b0d08` over base `6dc4e03` passed hosted cumulative
  Integration and all CodeQL analyses. Promotion must pin and verify this exact
  remote-green public SHA before production mutation.
- A host-combined promotion of the predecessor proved direct `READ_OK` and
  cron-shaped `CRON_READER_OK`, then rolled back successfully on substantive head
  drift. Current production is the healthy unmarked predecessor with config
  restored byte-for-byte and no deployment lock.
- Current head `4b5d84a` is byte-identical to `83b0d08` outside this plan. Final
  plan synchronization and exact terminal review remain before private repinning.
- Exact plan-only head `03b9b0a` over base `6dc4e03` passed terminal review,
  cumulative Integration, and all CodeQL analyses. Host-combined repinning and
  revalidation are in progress against that frozen tuple.
- Final public head `5b771f9` and host-combined head `d97c1b3` passed terminal
  review and landed through PRs #48 and #6. Deployment `8491ddf6` passed durable
  marker, gateway, installed guard, sandbox, iMessage, fixed no-match Gmail,
  direct `READ_OK`, and cron-shaped `CRON_READER_OK` checks. No cron invocation,
  definition change, delivery, or mailbox mutation occurred.

### Checklist

- [x] Verify Todoist tracking comment and issue ledger structure.
- [x] Create the synchronized repository plan.
- [x] Research and reproduce the execution-context difference.
- [x] Implement the shared-path fix.
- [x] Add focused regressions and map them into the cumulative pool.
- [x] Pass component validation and the full managed integration pool.
- [x] Complete reusable-worker adversarial review and remediation.
- [x] Complete applicable promotion and read-only production validation.
- [x] Finalize and commit the exact handoff diff.
- [x] Prepare the exact handoff commit for terminal adversarial review; record
  its result only in the issue ledger.
- [x] Revalidate the integrated current-main candidate and complete reusable
  full-diff review.
- [x] Validate and re-review terminal-review remediation.
- [x] Complete exact-commit review of candidate `e3ae601`.
- [x] Complete pull request landing and post-merge validation.
- [x] Set issue and Todoist task to ready for review without completing the task.
