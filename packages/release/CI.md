# Triggered CI

The initial dummy completed the deployment path. Multi-feature operation then
exposed build contention and retained-payload capacity problems. The approved
output queue correction is tracked in [Plan 065](../../docs/plans/065-output-release-queue.md).
Each feature owner takes its feature through implementation, review, CI, merge,
and cleanup, including diagnosing failures and choosing the next recovery step.
Scripts own deployment execution. There is no standing CI-owner or release-manager
agent to hand failures to, and no manager heartbeat is needed.

## Application loop

1. Build incrementally in the feature's existing development-host workspace.
   The build registers a small reference to its output and controls; it does not
   create another full copy. Different worktrees can build concurrently. Leave
   the submitted output unchanged until CI closes. Private paths stay on the hosts.
2. Call DEV CI with that build ID. It deploys and runs installed checks while
   holding DEV, then stops test processes and cleans the environment. Broad
   source tests belong to implementation and production CI, not the DEV slot.
3. Complete review and repository checks. Before submitting production CI, merge
   or rebase current main into each feature branch; rebuild and repeat affected
   review and DEV checks whenever inputs change. Submit the resulting build ID.
4. The source service queues small references in one FIFO for DEV and production.
   It admits one workflow after the previous transaction, callbacks and cleanup
   close. GitHub uses one shared concurrency group as an additional guard. At
   dequeue, stale bases fail and notify the owner; insufficient space holds the
   waiting request with a reason before expensive testing or transfer begins.
5. Production CI runs the full application suite on the development host, checks
   the bound result on the target, and deploys the same output to TEST. It runs
   installed tests, holds production intake, replaces and verifies the one backup,
   deploys PROD, runs read-only tests, merges the exact tested PR heads, and resumes
   intake. TEST teardown must finish before a terminal deployment result.

Submission returns promptly with a durable queued submission ID. Record it and
yield; the workflow ID is attached when admitted. Start and terminal events queue a continuation for the owner; no polling
agent or heartbeat executes, recovers or cleans the run. On wake, inspect the
exact terminal deployment receipt. A workflow outcome alone is not cleanup
proof. Repeated event IDs are the same event.

Use judgment when recovering a failure. Inspect the failed check or run, repair
what needs fixing, and retry the appropriate step. A repository check that never
acquired a runner can be rerun through GitHub without rebuilding unchanged output.
Before retrying a deployment submission, inspect its recorded state so an active
or recovering transaction is not duplicated. Once it closes, use the normal CI
entrypoint for the next attempt. The feature owner carries this recovery through
deployment rather than waiting for a separate CI owner.

Full-suite setup belongs to the maintained application test entrypoint. It creates
separate service Python environments from hash-locked test tools and frozen runtime
dependencies, verifies exact source imports, and keeps native transform caches in
its owned test scratch. Children are joined before scratch removal; interrupted
operations reconcile the same tree. Shared host Python environments and immutable
artifacts are not install destinations. See the [suite prerequisites](../e2e/README.md).

## Integration requirements

This is a single-owner workflow. User authorization and retained agent review
belong to the owning task. GitHub approving reviews, another account, branch
protection, and paid repository features are not prerequisites. Each changed
repository freezes an explicit `requiredChecks` list in the candidate inputs.
Use `[]` when the repository has no separate checks for that change; its
application tests still run in the full production suite.
Production requires those checks to succeed on the exact head, rejects any
reported pending or failed check, and verifies the current main base and tree.

The production lane is the sole main writer during releases. CI uses the normal
PR merge endpoint with the expected head. GitHub does not atomically compare the
expected base, so CI checks it immediately before merging and verifies the PR
merge SHA, exact tree, and ordered base/head parents afterward and on recovery.
An unexpected outside merge may already have changed main when detected; CI
holds intake and reconciliation instead of claiming success or admitting another
release. Source refresh and independent merges stay outside an active release.

The paired merge is not atomic. A partially completed or uncertain merge keeps
the transaction and intake held. Retry queries GitHub state and completes only
the remaining exact PR. Cancellation after merge starts retains the reconciliation
barrier. Never restore over accepted live writes or clear a partially merged pair
to admit another feature. A passing PROD check alone is not release completion.

Each host supplies a stable owner-only configuration with absolute bounded commands.
Application callbacks belong in the installed application adapter, outside disposable
feature workspaces and replaced runtimes. Candidate-specific checks, migration
specifications, and their dependency closure travel in a separate immutable
`controls` directory. Its digest is part of candidate identity; it is never copied
into PROD's runtime. Controls write witnesses into owned per-run scratch, which is
removed only after environment teardown. The target configuration wraps the existing
controller and adds `registry`, `runs`, `dev`, `preflight`, `applicationTests`, `merge`,
`devCleanup`, `testCleanup`, and optional `notify` and `reconcile` commands.
The service runs as the trusted application user under the host service manager.
Do not run a second release controller or mutate active configuration/tool inputs.

`puddles-ci.mjs` provides `request`, `wait`, `status`, `cancel`, `work`, `service`,
`preflight`, `merge`, `deliver`, and `collect`. The GitHub worker admits a request
and waits for durable state; the host service owns the transaction independently
of that worker. Request identity includes the GitHub run and attempt, owner,
candidate, mode, and configuration digest. Duplicate requests do not redeploy.
The application adapter supplies build, DEV dispatch, and production dispatch entrypoints.

## Recovery and storage

An interrupted worker's child PID, start identity, and process scope are reconciled
before recovery. DEV interruption fails that run and tears down. Production uses
the existing backup recovery state machine. Cleanup failure retains environment
ownership; a later run cannot occupy a slot that an old cleanup can still stop.
Host restart resumes registration, interrupted execution, and unfinished cleanup.

Each registration retains source heads/bases/trees and content digests. The
source references its implementer's output; trust and exclusive ownership replace
an extra source snapshot. The Mini receives the selected payload and checks that
transfer. After terminal closure CI removes its payload and controls, retaining
small manifest and DEV gate records. A later production request retransfers the
same output and reuses its DEV receipt. Released payloads cannot be deployed
until retransfer completes. Cleanup resumes after interruption.

Active submissions pin metadata. Capacity preflight accounts for transfer copies,
installed runtime and a missing sandbox image before the full suite. Final
allocation checks still apply because unrelated disk use can change. Failure
receipts retain bounded child-output diagnostics before removing test scratch.
A held request can be cancelled with the adapter's `cancel-queued SUBMISSION`
command; active workflows use GitHub cancellation and normal recovery.

Run records default to a 100 MiB budget, 500 records, and seven-day
delivered-result retention. Unpinned metadata age defaults to one day. Host configuration
sets appropriate budgets for real payloads. Undelivered results remain bounded;
notification failure does not prevent independent artifact cleanup. Keep warm
compiler caches bounded and register transfer scratch before allocating it.

Before archiving source or finalizing its workspace, confirm that CI build and
controls registrations, retained candidates, active consumers and recovery
references no longer depend on it. The legacy finalizer alone does not verify
these CI references. Use maintained lifecycle commands for eligible resources;
preserve referenced or incompletely owned state and report the hold. Run
teardown does not authorize deletion of retained source or warm output.

Start and terminal state changes commit their outbox event atomically. Notification
delivery is at least once: the receiver must use the stable event ID to avoid
duplicate follow-up work if delivery succeeded before its acknowledgement was saved.
Workflow results and deployment results have distinct scopes: a cancelled Actions
job may leave the local transaction recovering. Only a terminal deployment record
after cleanup establishes completion. Never put credentials or raw private logs in
event messages; report the status, build ID, run reference, and owning task.


### Target sandbox gate

Every environment imports the frozen candidate sandbox image through the managed
image path before preparation changes configuration. Installed acceptance
verifies the runtime archive against an already-present image and exercises a
cleanup-owned sandbox container. Missing images fail acceptance without an
implicit load. Recipe and sandbox checks must both pass before the phase receipt
is recorded.
