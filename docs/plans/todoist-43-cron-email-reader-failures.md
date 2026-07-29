# Fix cron email reader failures

**Status:** Terminal review  
**Issue:** [#43](https://github.com/coletaylor788/puddles/issues/43)  
**Last updated:** 2026-07-29

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

Scheduled delegation must name its target profile instead of silently falling
back to the scheduler's profile. A missing target fails immediately with a
repairable error, explicit `reader` delegation retains the reader's Gmail tools,
and the shared managed pool proves both paths with synthetic state.

### Approach

Patch OpenClaw so cron-run `sessions_spawn` calls require an explicit `agentId`
by default for both native and ACP runtimes while retaining the existing
configuration override. Clarify the model-facing schema so `taskName` cannot be
mistaken for profile selection. Cover ambiguous scheduled spawns, overrides,
explicit scheduled `reader` delegation, and explicit scheduled coordinator
self-spawn. Normalize the live coordinator policy before promotion so `main`
remains an allowed explicit target. Include generated prompt snapshots and
upstream documentation for the conditional cron default.

### Safety and rollout

Keep the existing cron job and its least-privilege `toolsAllow` unchanged. Tests
use synthetic session state and mocked gateway calls; they never access Gmail,
send messages, or mutate accounts. Promote only through the maintained OpenClaw
patch lifecycle. Validate the installed guard and reader access with read-only
checks, and rebuild without the patch to roll back.

## Agent details

### State

Native and ACP cron guards, explicit self-target coverage, prompt snapshots,
managed snapshot enforcement, setup examples, and upstream documentation are
implemented and validated. The promotion hazard is remediated: the documented
command derives the new allowlist from the recorded live policy and mutates only
two leaf keys. The inherited-default edge case now fails closed before mutation,
and strict shell error handling prevents partial mutation. ACP-disabled errors
retain precedence, configured top-level ACP targeting is covered, and the source
JSDoc matches the conditional default. Full managed validation and independent
complete-diff review are clean. Initial promotion exposed that the patch
lifecycle still targets 2026.6.11 while the live config/runtime are 2026.7.1-2.
The older package installed but restart was refused; package and policy rollback
restored a healthy 2026.7.1-2 gateway. The changed patches are now ported, the
remaining stack applies cleanly, and the managed lifecycle passes on the live
release commit. Independent review found one low documentation overclaim:
2026.7.1-2 is source-tested and promotion-pending, not yet live-verified.
The patch table and changed patch docs now make that distinction. The cron
definition remains unchanged. Final independent re-check found no actionable
finding; promotion can retry on the matching 2026.7.1-2 release. The final subagent patch header and verification
line now use the same source-tested/live-promotion-pending qualifier.
Matching-release installation then failed during npm dependency resolution.
Investigation traced this to the root package retaining
`@openclaw/ai: workspace:*`; registry substitution would silently discard
patched runtime workspace code. The deploy wrapper now packs patched
`packages/ai`, binds the root artifact to that exact tarball for local and remote
installation, and restores the source manifest on exit. Validation is green;
independent review found prepack/source-mutation and artifact-lifetime gaps.
Those gaps are remediated and the complete managed lifecycle is green.
Re-review found one bounded post-install artifact-retention issue; it is fixed
and revalidated. Final review found one low test gap in the remote root install
path assertion; local and remote install paths are now asserted exactly and the
targeted suite passes. Final independent re-check found no actionable finding;
the reviewed source build is promoted, and read-only production validation
succeeded, including a cron-shaped main-to-reader Gmail read with no delivery or
mailbox mutation.

### Scope and acceptance criteria

- Identify why scheduled runs fail while equivalent interactive runs succeed.
- Make cron-run native subagent delegation fail closed when `agentId` is omitted,
  without changing cron configuration.
- Apply the same default to cron-triggered ACP delegation.
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
- Source deployment packs patched runtime workspaces and installs those exact
  artifacts instead of resolving patched workspace code from the registry.
- Installed file dependencies remain in a durable deployment artifact directory;
  the wrapper restores both manifest and lockfile and disables prepack's
  dependency auto-install.
- The cron-key default applies to the immediate scheduled requester; coordinator
  descendants rely on the promoted `requireAgentId=true` policy.
- Same-agent children continue to inherit parent restrictions; explicit
  cross-agent children continue to use the target profile's tool policy.
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
9. Apply the cron-safe default to ACP spawning with denial, override, and
   explicit-target regressions.
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
17. Pack patched `packages/ai` as a deployment artifact and bind the root package
    to that exact tarball before `npm pack`, with lifecycle regressions and
    rollback.
18. Preserve durable local/remote artifact paths, restore package manifest and
    lockfile, disable prepack dependency mutation, and test exact local/remote
    references plus failure cleanup.

Feature implementation, review remediation, and release porting are complete.
Deployment packaging remediation is implemented and independently reviewed.
The first packaging review produced accepted findings; hardening is complete.
Promotion and read-only production validation are complete.
The final handoff diff is validated and ready for exact-commit review.

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
  - 410 tests across all 14 mapped patched-source files;
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
  - 418 tests across all 14 mapped patched-source files;
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
- Matching-release packaging:
  - source build and root package creation succeeded on 2026.7.1-2;
  - global npm install failed during `workspace:*` dependency resolution before
    gateway restart;
  - rollback restored package, policy, and healthy gateway;
  - throwaway-prefix proof succeeded after packing patched `packages/ai` and
    binding the root package to that local artifact.
- Packaging remediation:
  - deploy wrapper packs patched `packages/ai` before the root package;
  - local artifacts use an absolute local file reference, while remote promotion
    transfers both artifacts and uses the remote `/tmp` reference;
  - root `package.json` is restored on exit;
  - deployment topology tests prove exact workspace binding, local/remote
    transfer behavior, and manifest restoration;
  - targeted tests passed, followed by the complete managed lifecycle with 242
    repository tests, current snapshots, 426 mapped patched-source tests,
    candidate test, and cleanup.
- Packaging review findings accepted:
  - root prepack may auto-install after the temporary manifest rewrite and mutate
    lockfile/workspace links;
  - tests must assert exact local and remote file references;
  - temporary backups and dependency artifacts need explicit lifecycle handling;
  - operator documentation must describe the two-artifact packaging and recovery.
- Packaging hardening:
  - disables pnpm dependency auto-install during root prepack;
  - restores both `package.json` and `pnpm-lock.yaml` and deletes backups;
  - retains local artifacts in a durable directory and transfers remote artifacts
    to a durable target directory;
  - tests exact local/remote `file:` references, source restoration, and failure
    cleanup;
  - complete managed lifecycle passes with 243 repository tests, current
    snapshots, 426 mapped patched-source tests, candidate test, and cleanup.
- Packaging re-review remediation:
  - local artifact retention now begins immediately after successful install, so
    restart or browser-refresh failure preserves recovery tarballs;
  - deployment tests cover local success, remote success, pre-install pack
    failure, and post-install restart failure;
  - full managed lifecycle passes with 244 repository tests, current snapshots,
    426 mapped patched-source tests, candidate test, and cleanup.
- Production promotion and validation:
  - deployed the reviewed `0790d9f` source build and refreshed the browser image;
  - installed root package retains a durable patched `@openclaw/ai` artifact;
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

### Rollout and rollback

Apply and deploy only through
`docs/openclaw-setup/patches/apply-and-deploy.sh` with `MINI_HOST` unset on the
target Mac mini. Before deployment, record the current live
`agents.list[0].subagents` object, preserve all existing worker targets while
adding `main`, set `requireAgentId=true`, and verify that subtree. The wrapper
then builds and packs the complete patch stack, installs the package, migrates
auth, and restarts the gateway. Roll back by installing the previous package and
restoring the recorded policy object; revalidate gateway health after either
failure.

Production now runs the pinned `0790d9f` source build. Recovery package, prior
policy snapshot, and durable deployment artifacts remain available.

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
- Packaging diagnosis: matching-release installation failure was traced to
  unpublishable workspace protocol and unbundled patched runtime code. The
  first review findings are remediated and revalidated; fresh complete-diff
  review found one low artifact-retention issue, now remediated and revalidated;
  final re-check found one low remote install-path assertion gap; remediation
  complete and final re-check completed with no actionable findings.
- Production: reviewed source build promoted successfully; read-only gateway,
  policy, guard, reader, and cron-shaped delegation checks are green.
- Terminal exact-commit review: pending.

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
- [ ] Complete terminal exact-commit adversarial review.
- [ ] Set issue and Todoist task to ready for review without completing the task.
