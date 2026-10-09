# Shared deployment coordination

Develop and run focused tests in task-owned worktrees on the development
machine. Assume another agent may be changing the same files or interfaces.
Check active plans, PRs, and task status before changing shared contracts. Tell
those owners about dependencies and overlapping edits. Local incremental DEV
builds and final CI builds consume no environment slot. DEV, TEST, and PROD are
shared mini resources.

Iterate with focused local checks, incremental builds, and applicable DEV draft
checks. Merge reviewed source after required repository checks. One release
owner selects merged source and runs cumulative CI once. Promote that artifact
unchanged through DEV, TEST, and PROD. Keep environment configuration and writable
state separate. Main remains open and later commits join the next candidate.

Feature owners hand off source to the release owner and remain available for
fixes. The release owner carries the selected candidate through production and
cleanup, coordinating with included owners. Claim shared environments only while
mutating or checking them. Local builds, isolated DEV instances with separate
ports/state, and CI need no shared deployment slot.

## Record and commands

The mini keeps `$HOME/.puddles/deploy-coordination/slots.json`, outside all Git
worktrees. Run `packages/e2e/bin/openclaw-deployment-slot.mjs` on the mini using
the pinned Node. It performs atomic updates under a short metadata lock. Do not
edit the JSON, replace it with a worktree copy, or delete an occupied lock.
The record contains separate DEV, TEST, and PROD queues, current owners,
process identities, heartbeat and progress times, batch ownership, failed
commits, promotion holds, the last healthy release, and pending notifications.
Existing deployment transaction locks and recovery journals still apply.

Initialize once, after inspecting running operations and recovery journals.
Pass an owner-only JSON file mapping `DEV`, `TEST`, and `PROD` to their actual
`host` and distinct `port`. The host must be the mini's operating-system
hostname. Never initialize over an existing record. Pin existing deployed
source as each repository's initial batch base. Preserve its recovery journal;
the first coordinated TEST must rehearse against that production state.

```bash
node packages/e2e/bin/openclaw-deployment-slot.mjs init /private/path/targets.json
node packages/e2e/bin/openclaw-deployment-slot.mjs status
node packages/e2e/bin/openclaw-deployment-slot.mjs enqueue /private/path/request.json
node packages/e2e/bin/openclaw-deployment-slot.mjs claim /private/path/claim.json
node packages/e2e/bin/openclaw-deployment-slot.mjs run \
  /private/path/lease.json "$HOME/.puddles/deploy-coordination/slots.json" \
  node /reviewed/tooling/command.mjs
```

Each operation returns JSON. Save the returned ticket and claimed lease in
owner-only files. Add `environment` to the returned ticket when forming the
claim and lease inputs. An enqueue request has this shape:

```json
{
  "environment": "DEV",
  "requestId": "task-id:dev:attempt-1",
  "agent": { "id": "task-id", "contact": "thread:task-id" },
  "runId": "attempt-1",
  "worktree": "/absolute/task/worktree",
  "ready": true
}
```

A TEST or PROD deployment also requires `batchId` and `batchToken` from the
registered batch. A claim needs `environment`, `requestId`, and `token`. PROD
also needs `expectedHealthy`, the recorded last healthy transaction or `null`
for the initial adoption. The controller binds its host, PID, and process start
time and passes the ownership variables to children. Run the controller on the
mini, even when commands are initiated over SSH. It heartbeats every 30 seconds,
retries metadata contention, forwards interruption, and joins its subprocesses.
The low-level `run` command leaves the slot occupied after success or failure.
Use `progress` below to automate the sequence, recovery, cleanup, and release.
For individually invoked commands, the owner still completes those terminal
steps before releasing the slot.

Queue when the artifact and prerequisites are ready. Claim the oldest ready
request; never hold another environment while waiting. `ready` can mark an
owned queued request unready with a reason; `cancel` removes it. These operations
use the same environment, request ID, and token. Cancellation and deferral do
not interrupt a running deployment. A maintenance ticket can operate existing
recovery or lifecycle commands without a new batch, but it does not authorize
promotion of untested artifacts. Use it only for the named maintenance action.

Release with the same ownership fields plus `result` and `cleanupEvidence`
after inspecting the outcome, joining the controller, and cleaning only your
resources. A healthy PROD release also records its actual journal `transaction`.
Keep the slot through rollback and recovery. Do not release on a timer.

### Resumable release progression

Run the existing slot controller once with an owner-only local descriptor:

```bash
node packages/e2e/bin/openclaw-deployment-slot.mjs progress /private/path/release.json
```

The descriptor selects reviewed existing build, deployment, verification,
recovery, and producer-cleanup commands. It does not contain credentials. Keep
target paths and configuration outside public repositories. Each command is an
object with an absolute `command`, string-array `args`, absolute `cwd`, and
bounded `timeoutMs` (at most six hours); optional `env` carries its normal
non-secret runner settings. No shell parsing is involved.

| Descriptor field | Meaning |
|---|---|
| `schemaVersion` | `1` |
| `runId`, `agent`, `worktree` | Unique attempt, existing agent/contact identity, absolute checkout |
| `plan` | Absolute plan path; Human Status has `**Approval:**` and `**Approval reference:**` |
| `coordination` | Existing shared slot record on this host |
| `directory` | Canonical durable controller directory, separate from disposable task storage |
| `task` | `root`, `owner`, `developmentRoot`, `protectedPaths`, using the storage guide's task boundaries |
| `batch` | Existing selected merged batch's `id` and `token` |
| `candidate` | Absolute `build` and `sourceGate` receipt paths for the pinned artifact |
| `stages` | Ordered DEV, TEST, PROD entries, or one DEV entry for a DEV-only task |

Each stage has `environment`, optional `prepare`, and required `execute`,
`verify`, `recover`, `cleanup`, and `verifyCleanup` commands. TEST also names
its absolute target `proof`; PROD names its actual activation `recoveryJournal`.
Use the maintained native builder for preparation so its capacity reservations
and shared-store checks remain effective. Preparation happens before claiming
the environment. Release descriptors consume the same pinned artifact at each
stage, never rebuild it during promotion.

The controller initializes or resumes task storage and journals each stage. It
checks the plan before advancing, validates the build/source gate and merged
batch, queues and claims the environment, then runs and verifies the operation.
TEST publishes its actual attempt-bound proof through `tested`; PROD must have
a healthy journal matching the candidate, claim, and production baseline.
Cleanup and its verifier run while ownership is held. Only after their children
have stopped does the parent release the slot and advance. DEV approval stops a
full release before TEST; after a genuine approval update, the same command
continues without repeating DEV. An approval reference records the actual human
decision; changing the field yourself does not grant permission.

On an operation failure or uncertain interrupted operation, `recover` must
inspect the existing transaction, restore or finish its safe recovery, verify
health, and stop any owned descendants. Recovery must be safe to repeat. The
controller marks the batch failed, runs recovery and verified cleanup, and stops
for engineering review. It never retries uncertain activation automatically.
An interrupted or rejected waiting request cancels only its own queue ticket.
Failed recovery retains ownership. Successful deployment followed by cleanup
failure resumes cleanup without rerunning activation. Producer cleanup commands
must be repeatable, preserve active consumers and production recovery, and
retire only acknowledged generated files using the storage helpers.

At the end, whole-task completion uses the storage controller, which refuses
remaining worktrees, recovery state, active consumers, or protected references.
Failure records `cleanup-pending`; rerunning retries completion. Keep the compact
controller record until the task owner has recorded the result and retired it.
Raw command logs live inside task storage and are removed by completion.
SIGKILL or host failure can leave a controller lock: use the existing explicit
owner/process inspection before removing its exact stale lock. Never delete a
lock or take another owner's lease simply because the run is old. Changed
descriptor inputs or a corrected candidate require a new attempt starting at DEV.

## Merging and selecting a release

Ordinary DEV drafts use local incremental builds and mutable source. Prepare
before claiming shared DEV, and release after installed checks and cleanup.
Draft results support feature development and source merge; they never certify
production. Review the feature, run focused and applicable DEV checks, satisfy
required repository checks, and merge. Resolve conflicts in the feature's own
worktree and repeat affected checks. Source merge does not reserve main or wait
for another feature's release.

The release owner selects merged source before the full CI build. Its CI bundle
passes DEV and TEST before PROD, with stage results tied to the same artifact.
Keep artifact/source identity and automatic integrity checks. Do not add manual
whole-workspace hashing or duplicate release builds.

### Existing tooling transition

`openclaw-merge-eligibility.mjs` and legacy `openclaw-integrate.mjs` modes consume
premerge CI/source-gate/DEV receipts. That older workflow is not a requirement to
run a separate full release per feature. Use normal repository source merging
with required checks, for example `gh pr merge --match-head-commit HEAD PR`
with `HEAD` replaced by the reviewed commit. Use the repository's merge method.
No additional merge helper or release receipt is needed. Keep the older commands
for in-flight callers; never fabricate their receipts. Certification and
activation guards still apply to PROD.

Public PR and main-push CI runs repository checks without building OpenClaw.
The release owner can dispatch `integration.yml` on the default branch for a
public cumulative build. That dispatch pins its event commit even if main moves.
An explicitly selected composed builder runs the same cumulative gate locally;
do not dispatch a second public runtime build for that same release.

For in-flight work, reuse valid checks and artifacts. An already built artifact
may continue only if it represents the selected merged candidate; never relabel
a branch artifact with different merged contents. This is a transition check,
not a reason to rebuild every feature before and after merging.

Before building the release, use `openclaw-select-batch.mjs SPEC_JSON OUTPUT_JSON` in the tooling
worktree to fetch each repository's main and pin a merged head and its tree.
The spec contains `agent` and a `repositories` array. Each repository
has `id` (`public`, plus `private` for composed delivery), absolute `root`,
`base` (the deployed commit), optional `defaultBranch`, optional `reviewedHead`,
and `owners`, a map from every commit SHA in `base..selectedHead` to its feature
agent's `id` and `contact`. By default, selection uses the fetched branch tip.
Use an exact 40-character `reviewedHead` SHA to keep a repaired candidate bounded
while unrelated features land. It must contain `base` and be an ancestor of the
freshly fetched default branch. This never makes an unmerged branch eligible.
Resolve ownership through PRs and agent messages, including merge commits. A
missing owner is an error, not permission to assign blame to the batch owner.

Register that output with the `batch` operation. Registration names the
initiator as owner, returns `batchId` as `id` and a batch `token`, and notifies
all included owners. Re-registering the same heads returns the existing owner;
coordinate with it. Build those merged heads once in CI. Validate that artifact
in DEV, then TEST and PROD, including the exact private composition. Save DEV's
installed assertions in the existing `puddles.dev-validation/v1` result. A feature
branch artifact never substitutes for the merged batch. Later merges belong
to a later batch; do not chase moving main in the middle of a rehearsal.

Acquire TEST only after the merged artifacts are available. Run the artifact
consumer, installed scenarios, deliberate failure, rollback, and healthy
activation proofs. Certify and promote through the normal receipt commands.
Record success with `tested`, the TEST lease fields, `build` (the retained
build JSON path), and `proof` (the retained target-proof JSON path). The helper
validates their identity, batch source, and the actual TEST attempt and
production baseline recorded by the activation journals. An older proof cannot
be republished under a fresh claim. Release TEST and queue for PROD.
The same artifacts must reach PROD. If production changed since TEST acquired
its slot, repeat the affected TEST rehearsal against the new baseline before
claiming PROD. Reuse the artifact only while its sealed configuration and
migration inputs remain valid; otherwise replace the candidate and start at DEV.
Superseded or disqualified batches cannot promote.

On the target, set `integration.ref` and `integration.mergedHead` to the selected
merged public commit, with `integration.defaultRef` set to freshly fetched
`origin/main`. The guard requires that exact commit and tree and confirms it is
still on main. Do not point activation at the feature branch or substitute the
newest unchecked main for an already tested batch.

## Failure, corrections, and communication

The batch owner identifies failures, preserves evidence, and records
`batch-fail` with `batchId`, `batchToken`, `agent`, `evidence`, and, once known,
`responsible` commit SHAs. This holds promotion and invalidates every batch
containing those failed commits. Distinguish source regressions from target or
infrastructure failures before reverting. Keep PROD healthy while investigating.

For a confirmed source regression, merge a reviewed fix or revert on current
main, with a committed regression and required repository checks. Prefer a
revert when a repair would delay unrelated delivery. Never reset or force-push
main. Notify the responsible feature owner with the cause and correction.

Select a successor with `predecessor` and `previousToken`. A fix uses
`repairEvidence` and `repairs: [{"commit": "bad SHA", "repair": "merged fix SHA"}]`.
A revert uses `revertEvidence` and
`reverts: [{"commit": "bad SHA", "revert": "merged revert SHA"}]`. Both may appear
for different failed commits. Each correction must be a different merged commit
in the same repository. Preserve existing correction mappings; do not label a
fix as a revert or omit known failure attribution to bypass disqualification.
Infrastructure failures still hold the failed batch even without a responsible
source commit.

The successor owner builds selected merged source once and starts validation at
DEV. Successful TEST clears predecessor promotion holds and records the proven
correction. A batch selected before that proof arrived rechecks its recorded
invalidations when publishing its own TEST success. It must contain the proven
correction in the same repository and still pass its own attempt, artifact,
and production baseline checks. Batches without the correction remain
disqualified. If attribution is uncertain,
preserve the failure evidence while investigating. Escalate only a concrete
decision outside the approved scope, such as data loss or cross-feature breakage.

Owners actively monitor their slot, CI, batch, and notification records until
healthy production or a verified recovery and explicit ownership handoff.
At release, the helper durably notifies the next ready owner. The releasing
agent also messages that agent through its recorded contact with the outcome
and any cleanup caveat. Every waiting agent checks status before claiming;
messages are wakeups, not ownership grants. Poll notifications and `ack` each
with its `id` and your `agent` after handling it. Notify included owners when
their batch passes TEST, reaches PROD, is reverted, or changes owner. Use peer
task messaging for this authorized coordination, without contacting outsiders.

A heartbeat older than two minutes, an exceeded expected completion time, or
unchanged progress is a reason to inspect and message the owner. Age alone
never permits taking the slot. Inspect the controller's PID and start time,
its subprocess group, the environment lock, and recovery journal. `recover-owner`
requires the old lease, new `agent`, stopped controller (or no bound controller),
and inspection `evidence`; it rotates ownership tokens and transfers the batch.
For an abandoned batch with no active slot, `recover-batch` takes `batchId`,
`previousAgent`, old `batchToken`, new `agent`, and contact/inspection `evidence`.
It cancels that batch's old queued tickets so the new owner can requeue.
An absent owner need not reply before an authorized coordinator recovers
confirmed abandoned work. Never recover around an active deployment. A leftover metadata lock can be
removed with `recover-metadata` only after its recorded process has stopped;
pass its exact `owner.json`. Preserve uncertain state for manual inspection.
