# Development loop improvements

**Status:** Implemented and reviewed. Full-gate timing comparison remains open.
**Issue:** [#174](https://github.com/coletaylor788/puddles/issues/174), [#180](https://github.com/coletaylor788/puddles/issues/180)
**Last updated:** 2026-10-07

## Human section

### Design

#### 1. Use plan approval to act autonomously

Keep approval in the plan’s Status, separate from implementation progress:

| Approval | Agent behavior |
|---|---|
| Proposed | Research and design only. |
| DEV approved | Implement and experiment in local/DEV environments. |
| Production approved | Autonomously complete review, checks, landing, deployment, rollback, and cleanup within scope. |

Record the approved scope, explicit limits, and approval reference. Update dev-loop instructions to use that approval to carry work autonomously through the full authorized scope, including on resume or handoff. Resolve routine implementation choices, repairs, and retries without asking again. Return for clarification or approval when work would significantly deviate from the approved design or exceed its scope; continue independent work that remains authorized. Passing tests does not grant authorization. Existing app permissions and publication boundaries still apply.

##### Routine repository work needs no separate approval

As part of the requested work, publish and update designs, create and update issues, commit and push changes, open and update PRs, and merge PRs once required reviews and checks pass. Do not ask for separate permission to check work into the repository. Publishing a proposed design or maintaining its issue does not require approval of the design itself. Implementation and any deployment triggered by a merge must remain within the approved scope.

Follow the target repository's rules and public/private separation. Inspect the content before publishing. Never include credentials, secrets, or private configuration in repository files, commit messages, PRs, issues, or published logs. Keep public material reusable and provider-neutral, with synthetic examples where needed.

#### 2. Combine release automation and storage

Extend the existing controller to create or resume the durable workspace, manage capacity and stage dependencies, advance the pinned candidate through authorized stages, retire consumed files, recover from interruption, and release ownership after verified cleanup. The agent handles engineering failures rather than manually advancing successful commands.

Reuse existing runners, locks, storage helpers, and recovery journals. Preserve release gates, active consumers, unpublished source, and production recovery. Track this combined work in #174.

#### 3. Reuse compiled test helpers in CI

Enable the existing compiled test-helper cache in extension gates, as public CI already does. Optional extension gates must use the same cache opt-in as the public mapped tests. For groups needing those helpers, investigation observed preparation costs about **15–18 seconds cold versus 3–4 seconds with reuse**. Reuse compatible compiled programs while still executing every test; changed inputs trigger rebuilding.

Record helper preparation and full-gate timings before and after under #180. A few minutes off the roughly **27-minute regression gate** is plausible, but unmeasured. Leave DEV performance as it is.

#### 4. Treat the human as asynchronous

Update dev-loop instructions to assume the human is not constantly monitoring. Before asking, investigate enough to make the touchpoint useful: prepare a concrete recommendation, explain the consequential tradeoffs, and bundle related decisions or missing information into one self-contained request. Avoid a series of short questions that each unlock only the next small step.

Use stops for high-value asks that genuinely need human judgment or action. Resolve routine details autonomously, keep authorized work moving while waiting, and save a clear checkpoint. Do not delay an urgent blocker to assemble a larger batch, or treat silence as approval.

### Status

**Approval:** Production approved
**Approval reference:** Requester, 2026-10-07: "designe approved, implement and check-in" following review of all four numbered changes.

Scope: the four changes above, through checks, review, landing, and applicable delivery. No product behavior change or reduction of release coverage. Progress: guidance, resumable release progression, and extension cache reuse are implemented and reviewed. Comparable full-gate timing measurements remain under #180.

## Agent section

### State

Implemented on `codex/dev-loop-autonomy`. Local DEV optimization and individual incident fixes are outside this change. Operational paths and measurements remain in local task records.

### Scope and acceptance criteria

1. Agents act autonomously through the plan's approved scope, including routine repository publication and PR merges without separate approval. Designs and issues can be published during design work. Significant deviations require escalation; DEV-only work cannot promote to production. Published content follows repository rules and excludes credentials, secrets, and private configuration.
2. The controller progresses, recovers, and completes artifact cleanup without routine supervision.
3. The extension CI gate reuses compatible compiled test helpers. Comparable gate timings verify the effect, and every required test still executes.
4. Human requests are prepared, self-contained, and bundled where useful; authorized work continues while awaiting a reply.

### Architecture and decisions

The plan records authority. Existing controller state records execution. The slot controller consumes a reviewed local command descriptor, using existing ownership, proof, process, and task-storage helpers. Commands and configuration follow [release progression](../../packages/e2e/DEPLOYMENT_COORDINATION.md#resumable-release-progression).

### Implementation

1. Make plan approval the basis for autonomous execution within scope. Explicitly cover publishing designs, maintaining issues, commits, pushes, and PR creation, updates, and merges without repeated approval, subject to repository checks and publication rules.
2. Extend `openclaw-deployment-slot.mjs` with a resumable `progress` command under #174, using existing coordination, verification, and storage helpers.
3. Enable existing extension test-helper cache reuse and record helper preparation and full-gate timings under #180.
4. Add asynchronous collaboration and high-value asks to dev-loop guidance.

### Validation

Review guidance directly, including publication during design work and routine repository actions within approved scope. Check consistency with repository review requirements and public/private boundaries. Test authorization handling, restart, recovery, and cleanup protections. Verify helper-cache invalidation and execution of every required test. Compare full-gate runs on the same candidate and host, recording cold and warm results separately.

Focused validation passed on supported Node 24.19: 91 public tests across progression, coordination, task storage, process handling, and native pipeline; E2E type checking also passed. Extension timing and contract checks passed, with installed-runtime cases left to the configured cumulative lifecycle. The focused regressions exercise real child-process ownership, failure recovery, approval changes, interrupted queues, cleanup retry, and protection of unrelated state.

An isolated helper benchmark using the same source, host, dependencies, and Node 24.19 measured preparation at 13.0 seconds with caching disabled, 18.8 seconds for cold cache fill, and 3.3 seconds for warm reuse. Changing a source input caused a cache miss and a 14.6-second rebuild. Including verification and disposal, disabled versus warm took 14.9 versus 4.7 seconds. This exercised helper preparation and invalidation, not the complete regression gate.

No full-gate speedup or installed runtime release is claimed. Gate timing records now capture command duration, helper preparation, and cache hits/misses for the comparison under #180.

### Rollout and rollback

Use the normal development lifecycle and preserve verified recovery paths. Cache misses rebuild normally; disable the cache opt-in if validation reveals a problem.

### Review log

Retained independent review covered both implementations. Fixed guarded PROD recovery after batch failure, cancellation of abandoned waiting tickets, and retirement of raw stage logs. The final review has no actionable findings.

Four numbered recommendations. Item 2 covers manual lifecycle work. Item 3 is limited to compiled test-helper cache reuse and measured verification. Discovery batching and test deduplication are excluded.

### Checklist

- [x] 1. Autonomy within plan approval, including routine repository work and safe publication.
- [x] 2. Combined release progression and artifact cleanup.
- [x] 3. Compiled test-helper cache reuse and timing instrumentation.
- [ ] 3. Comparable full-gate timing measurements under #180.
- [x] 4. Asynchronous collaboration guidance.
