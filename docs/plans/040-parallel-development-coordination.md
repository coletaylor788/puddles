# Plan 040 - Parallel development and deployment coordination

**Status:** Approved; implementation in progress
**Issue:** [#124](https://github.com/coletaylor788/puddles/issues/124)
**Last updated:** 2026-09-26
**Owner:** Development workflow owner

## Human section

### Design

Assume other agents are changing the same components. Each agent edits and runs
focused tests in its own worktree on the development machine. CI builds and
checks candidates independently. Agents tell each other about overlapping work
and dependencies, but they do not reserve components or edit each other's
worktrees. Shared DEV, TEST, and PROD each have one deployment slot on the mini.
Agents reserve those slots only for work that needs the installed environment.

The release order becomes DEV validation, review and required CI, merge, TEST,
then PROD. The feature owner stays responsible after merge. At admission to TEST,
the release owner selects the latest merged source and records that revision.
CI supplies its immutable artifacts. TEST and PROD consume those same artifacts;
new merges go into a later release. Several merged features can share one TEST
run and one production deployment, with the initiating agent registered as batch owner. Other feature owners
coordinate with that agent. A failed merged build or TEST run pauses promotion.
The batch owner identifies the responsible commit, lands its revert, alerts
that feature owner to fix the change separately, and continues from TEST using
the corrected latest main without the bad commit. They never reset the
shared branch or assume the most recent feature caused the failure.

A durable record on the mini shows who holds each slot, what is running, when
progress last occurred, and who is waiting. A short atomic update lock protects
the record and its queues. Each environment keeps its existing deployment
transaction lock as well. Owners publish progress, release only after cleanup
or recovery, and notify the next eligible agent. Messages help agents react;
the durable record decides ownership even if a message is missed. An overdue
heartbeat prompts investigation, never automatic takeover of a running deploy.

### Status

The requester approved implementation, including explicit ownership by the agent
that initiates TEST. That owner coordinates all included feature agents, handles
failures and reverts, and continues with corrected merged source. DEV uses the
same queue and communication protocol.

The queue, merged batch ownership, CI artifact consumers, premerge admission,
and lifecycle instructions are implemented. Focused regressions pass and the
retained reviewer has no remaining findings. The mini record and guarded DEV
tools are installed. Owned controllers were checked for all three environments;
the existing runtimes stayed running. Public cumulative CI and landing remain
outstanding. Development and review skills now prohibit prose regression tests.
The separate documentation cleanup landed in PR 123, and this branch is rebased
onto it with those deletions preserved.

## Agent section

### State

- Requested target: local worktrees and focused tests; independent CI builds;
  shared DEV, TEST, and PROD deployment slots; merge between DEV and TEST;
  continued owner monitoring, revert handling, and promotion from merged source.
- The requester approved this workflow on 2026-09-26, then clarified batch
  ownership, revert notification, retry from corrected main, and DEV coordination.
- This plan is the approved workflow. Plan 039 remains historical evidence.
  Do not reinterpret its completed acceptance as proof of this protocol.
- `deploy-coordination.mjs` and `openclaw-deployment-slot.mjs` implement atomic
  ready queues, controller heartbeats, durable messages, recovery, failure holds,
  and batch ownership. `merged-batch.mjs` pins current merged heads and requires
  an explicit owner/contact for every included commit.
- `merge-eligibility.mjs` separates CI/DEV premerge admission from the retained
  post-TEST production receipt. Activation pins a merged commit and checks main
  ancestry. Build receipts bind all selected repository heads and trees.
- The companion worktree supplies an artifact-only DEV consumer. Its CI stops
  at the immutable build handoff; physical TEST belongs to the batch owner.
- Public CI checks the exact PR head or merged main, exports its source gate,
  and remains independent of private composition. The private builder binds
  its own repository head through the generic extension interface.

### Scope and acceptance criteria

- Every agent has a unique task identity and isolated worktree on the local
  development machine, including task-owned patched upstream source when needed.
  Shared dependency caches are allowed; writable source and build output are not.
- Local checks include focused unit tests and typechecks. CI owns deployable
  builds and the full accumulated regression gate. CI jobs do not acquire mini
  deployment slots, including when they use their own isolated runtime fixtures.
- Independent feature work, CI, and different environment slots may progress
  concurrently. At most one owner mutates any one shared environment.
- Merge follows DEV success, retained review, required checks, and exact
  head/base eligibility. Branch protection is never bypassed. TEST on the mini
  follows merge, and PROD follows successful TEST of the same artifacts.
- The owner remains active or arranges a durable continuation through merged CI,
  TEST, promotion, cleanup, and recovery. A successful merge is not completion.
- Per-environment queue records, owner identity, progress, release notification,
  interrupted recovery, and stale-owner detection have committed regressions.
- Live checks remain read-only. All automated delivery and external writes in
  DEV, TEST, and CI use explicit recording fixtures.

### Architecture and decisions

- **Peer coordination:** Before editing shared components, inspect current
  plans, PRs, and available agent/task status. Announce overlap to the relevant
  owners with scope, worktree, and dependencies. This is coordination, not a
  request for permission. Do not reset, stash, clean, or stop another agent's
  resources. Coordinate shared interface changes and refresh from merged source
  before final validation. No global code-edit lock is needed.
- **Record location:** Use `$HOME/.puddles/deploy-coordination/slots.json` on the
  mini, where HOME is the deployment account's home. The configured canonical
  absolute path and mini identity must be shared by every client; a local file
  on a developer machine or an SSH-alias-specific path is not a second authority.
  Keep this runtime file outside repositories and public artifacts. It contains
  a schema version, monotonic generation, DEV/TEST/PROD owners and FIFO queues,
  release batches, a promotion hold, and the last healthy production identity.
- **Atomic updates:** A small host-side helper takes an exclusive `mkdir` lock
  beside the record, re-reads state, validates the expected generation and owner
  token, then writes through atomic rename. The update lock is held only for
  metadata changes, never throughout CI or deployment. Readers may inspect the
  last complete snapshot. Corrupt or missing established state fails visibly;
  it must not silently initialize an empty queue over an active deployment.
- **Owner and ticket fields:** Store a unique request ID, agent/task ID,
  routable message destination and parent contact, feature/PR reference, local
  worktree, run ID, environment, phase, queued/acquired/heartbeat/progress times,
  expected completion, immutable source and artifact identities, target identity,
  transaction/recovery reference, and an unguessable ownership token. Record the
  actual mini process identity with PID and process start time once it exists.
  Private paths and source identities stay in local or private records.
- **FIFO and readiness:** Requests are idempotent by request ID. The oldest
  ready ticket acquires a free slot atomically. A waiting or unready agent owns
  no environment. Missing CI output defers the ticket with a reason; a later
  ready ticket may proceed. Cancellation removes only that agent's queued
  request. Do not hold DEV while waiting for TEST or TEST while waiting for PROD.
  Every mutation, reset, backup, and recovery uses the relevant slot. An idle
  installed DEV runtime may remain, with its source identity recorded.
- **Merge admission:** Use the configured repository merge queue if available;
  otherwise validate head/base and required checks immediately before the
  guarded merge. Rebase or resolve conflicts only in the feature worktree and
  rerun proofs affected by changed inputs. A merge race triggers revalidation,
  never a forced merge or protection bypass. Merging requires the cumulative
  pre-merge CI gate, but no physical TEST receipt. Source integration and
  production eligibility become separate records.
- **TEST admission:** The first ready release owner fetches default-branch state
  and records the latest merged revision as a batch. For composition, record a
  compatible tuple of merged repository revisions and the upstream pin; there
  is no atomic merge across repositories. The agent initiating deployment signs up as the batch owner.
  The record maps included commits to feature owners and notification contacts.
  Other included feature owners attach to that owner and expect to coordinate
  with it instead of deploying again. Batch ownership survives release of TEST
  while awaiting CI or PROD.
  Admission pins the revision before waiting for its CI artifacts and does not
  hold the TEST slot during that wait. A batch is never silently repointed to
  newer main. If a newer batch already covers it, mark it superseded explicitly.
- **Immutable promotion:** The TEST slot covers install, scenarios, physical
  activation/rollback rehearsal, evidence sealing, and cleanup. Retain the
  artifacts and receipts after release. PROD consumes precisely that bundle.
  Re-fetching main before PROD must not substitute untested bytes. Verify that
  the pinned revision remains eligible on the default branch and has not been
  reverted or blocked. Never deploy an ancestor over a newer healthy release.
  A newer batch can subsume older queued work only after its own full proofs.
- **Production baseline:** At PROD acquisition, compare the current healthy
  transaction and migration inputs with those assumed during TEST. If another
  release changed relevant inputs, release PROD and repeat the affected TEST
  proof. Keep existing target validation, transaction locks, stopped-state
  snapshots, read-only health checks, and rollback. Hold PROD until health or
  recovery finishes. A late failure must not roll back a newer owner's release.
  Recheck promotion holds and eligibility immediately before activation. A
  failure reported during an active transaction goes to that transaction's
  owner; another agent must not interrupt it or launch a competing rollback.
- **Monitoring and notification:** Refresh heartbeat every 30 seconds while
  holding a slot; publish stage progress separately. After 2 minutes without a
  heartbeat, or a missed expected completion, message the owner and its parent.
  Completion writes status and releases the slot before messaging the next
  eligible agent with environment, result, and durable record location. The
  next agent must still claim atomically. Waiters also poll at a bounded
  interval so missed notifications cannot strand the queue. A surviving
  controller must keep heartbeats current while the agent waits on long tools.
- **Recovery:** Time alone never grants a slot. Verify the owner and its mini
  process group have stopped, inspect the deployment journal, then record an
  explicit recovery owner and finish recovery before admitting normal work.
  Recover an abandoned metadata lock using its process identity as well. Old
  ownership tokens cannot heartbeat, release, or resume mutations after takeover.
  Every mutating entrypoint checks ownership and retains its underlying target
  transaction lock. Normal queue priority cannot preempt an active transaction;
  urgent recovery takes precedence after that transaction is safe.
- **Failure and revert:** Failed merged CI or TEST sets a durable promotion hold
  with exact revision, evidence, and responsible investigation owner. Unmerged
  work and DEV continue. Infrastructure failures retry the same candidate after
  repair; they do not justify reverting a feature. For a demonstrated code
  regression, use a revert PR against current main, preserving unrelated work
  and coordinating dependent changes. The revert still requires applicable
  checks and branch protections. The batch owner owns that revert, alerts the
  responsible feature agent with the failing commit and evidence, then records
  a successor attempt from latest main without that change. Continue through
  TEST and PROD without waiting for the feature repair. Validate the corrected
  merged batch before clearing the hold. The original feature remains incomplete if reverted.
- **Git and runtime recovery:** A Git revert creates new source and new CI
  artifacts. It does not restore production. Runtime rollback restores the
  exact recorded prior deployment under the current transaction's ownership.
  Keep these operations separate; neither Git merges nor builds belong inside
  a stopped production transaction. Destructive or irreversible migrations
  require an explicit recovery design before merge.

### Implementation

- Add the approved host-side record and queue helper with
  inspect, enqueue, claim, heartbeat, defer, release, cancel, and recover
  operations. Use existing durable-state and lock helpers where suitable.
- Wire all maintained DEV, TEST, production activation, backup, and recovery
  entrypoints to the common coordination record without replacing target locks.
- Split pre-merge eligibility from post-TEST production eligibility. Preserve
  required checks and exact tree/artifact verification. Add batch selection and
  immutable merged-ref evidence to artifact consumers.
- Add CI DEV artifacts and an artifact-only DEV consumer. Wire the authorized
  composed CI separately in a newly fetched paired private feature worktree.
  Verify CI capacity and target compatibility before removing the old builder.
- Update the active lifecycle steps, command guide, and companion instructions
  together after the tooling passes. Label legacy commands as such. Keep
  machine identities and notification routing local.
- Use the same retained independent reviewer through implementation and fixes.

### Validation

- Focused public coordination, release, integration, deployment, and pipeline
  checks: 125 tests passed. Private contract: 80 passed, three native-context
  checks deferred to the complete lifecycle. TypeScript check passed. Both
  private workflows and both edited skill frontmatter blocks parse as YAML.
- Broad local e2e testing exposed missing built plugin prerequisites, a host
  resource sampling failure, and stale documentation assertions removed by
  the separate cleanup task in PR 123.
  The exact cumulative gate runs in CI with its documented prerequisites.
- Retained review found and drove fixes for heartbeat contention, production
  baseline changes, DEV attempt identity, queued takeover after recovery,
  reverted older batches, missing commit attribution, and artifact provenance.
  Final complete-diff review is clean. Private contract CI passes. Public
  cumulative CI built successfully, then reported 422 passing tests and three
  failures in the old documentation assertions. PR 123 removed those tests;
  the rebased candidate requires a fresh cumulative run.
- Implementation tests must cover simultaneous enqueue and claim, idempotent
  retries, FIFO among ready agents, cancellation, lost notifications, heartbeat
  versus progress, interrupted updates, and stale-owner recovery without theft.
- Cover merges during CI/TEST/PROD waits, batch coalescing, incompatible composed
  revisions, failed merged CI, unrelated intervening commits during revert,
  reverted queued candidates, superseded production, and stale rollback.
- Prove no two owners can mutate one environment and no waiting job holds a
  different environment. Inject failures and delivery through recording fixtures.
- Run focused tests while iterating, then the full accumulated
  `node packages/e2e/bin/openclaw-test-env.mjs ci` gate for the final runtime
  implementation, followed by the physical rehearsal and release gates.

### Rollout and rollback

- The shared record is initialized on the mini with DEV, TEST, and PROD ports
  verified from the installed configuration. All slots are released and all
  queues are empty after the owned-controller checks. Guarded DEV tooling is
  installed with the previous tools retained for rollback. An unowned DEV
  mutation was rejected before changing the running instance. Existing DEV and
  production process identities remained unchanged. Active peer tasks received
  the record location and instruction to use owned deployment controllers.
- This rollout installs coordination tooling. It does not promote a new
  OpenClaw runtime or claim a successful application release batch. The first
  application batch must establish its real production baseline and complete
  the merged artifact rehearsal before promotion.
- Bootstrap the coordinator during an agreed idle period. Inspect all active
  deployments and transaction locks first; record active ownership rather than
  assuming a missing queue means the mini is free.
- Update every deployment client before requiring queue ownership. Legacy
  agents with old worktrees must refresh instructions/tooling or stop deployment
  work. A new lock file alone cannot constrain an old entrypoint.
- Enable earlier merge only after its new eligibility checks and merged-source
  consumers are verified. Do not bypass the current receipt contract meanwhile.
- If coordination fails, stop new admissions, preserve records and journals,
  and recover active transactions. Revert tooling through the normal feature
  path; never delete lock files to force progress on a possibly active target.

### Review log

- The retained reviewer checked the complete public and private diffs through
  remediation. Final review has no actionable findings. Regression coverage
  includes ownership contention, proof reuse across attempts, changed production
  baselines, retired batch tokens, reverted queued batches, and exact public
  and private source provenance.

### Checklist

- [x] Review current lifecycle, CI, merge, and deployment lock contracts.
- [x] Specify the proposed sequence, shared record, ownership, and recovery.
- [x] Obtain approval of this design and the clarified batch owner responsibilities.
- [x] Create the implementation tracking issue.
- [x] Implement and review coordination, merge admission, and CI artifact flow.
- [ ] Pass accumulated CI and land the reviewed changes in both repositories.
- [x] Install guarded DEV tools, initialize the mini record, and verify owned
  controllers without changing the existing production runtime.
