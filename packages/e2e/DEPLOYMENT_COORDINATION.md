# Shared deployment coordination

Develop and run focused tests in task-owned worktrees on the development
machine. Assume another agent may be changing the same files or interfaces.
Check active plans, PRs, and task status before changing shared contracts. Tell
those owners about dependencies and overlapping edits. Local incremental DEV
builds and final CI builds consume no environment slot. DEV, TEST, and PROD are
shared mini resources.

Iterate with focused local tests, incremental local builds, and queued DEV
draft checks. After local DEV success and retained review, run the accumulated
CI gate, validate its exact artifact in DEV, merge, then queue for TEST of the
CI-built merged main batch and PROD. CI is not in the ordinary edit loop.
The feature owner monitors its merge until a batch owner acknowledges it. The
agent that initiates TEST registers itself as owner of the whole merged batch.
Other included feature owners coordinate with that owner and do not start
competing promotions. A batch owner remains responsible while waiting for CI or
PROD even after releasing an environment slot.

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
It leaves the slot occupied after either success or failure for inspection.

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

## Merging and selecting TEST

Ordinary DEV drafts may come from local incremental builds and mutable source.
Use the maintained DEV wrapper and the same slot controller, target locks,
isolated state, recording adapters, and rollback. Prepare before claiming DEV;
release after checks and cleanup, before more editing or waiting for CI. Keep
draft results separate from final eligibility; they must not produce a passing
release-valid `puddles.dev-validation/v1` record.

For final premerge validation, DEV installs the exact selected CI bundle and
checks the changed behavior with recording adapters. Save a
`puddles.dev-validation/v1` record with `status:
"passed"`, exact public `head` and `tree`, `owner`, and retained `evidence`.
A configured companion wrapper produces this record after its installed checks.
Include any feature-specific assertions in the retained evidence.

Create premerge eligibility from the reviewed CI build, full source-gate record,
and matching DEV proof. This does not grant production eligibility.

```bash
node packages/e2e/bin/openclaw-merge-eligibility.mjs \
  /ci/build.json /ci/source-gate.json /dev/dev-proof.json /run/merge-eligibility.json
node packages/e2e/bin/openclaw-integrate.mjs \
  /run/merge-eligibility.json example/public-repo 123
```

The helper binds the eligible feature head and tree, then rechecks the default
target, remote checks, and clean mergeability. Other features may advance main
throughout CI and DEV. Do not ask their owners to delay commits or merges, or
rebuild an unchanged feature merely because main moved. Base movement causes a
fresh mergeability check. The merge request still pins the exact feature head.

Resolve conflicts in the feature worktree and repeat checks affected by the
changed feature. After a clean merge, record both the validated feature identity
and the resulting merged identity. The result requires merged-batch validation;
feature evidence does not certify the combined tree or permit its activation.
The TEST owner selects latest main and builds and validates that exact batch.
Legacy production receipts retain their exact integrated-tree requirement.
Documentation-only changes keep the short path and do not deploy unchanged
runtime artifacts.

Before TEST, use `openclaw-select-batch.mjs SPEC_JSON OUTPUT_JSON` in the tooling
worktree to fetch each repository's main and pin its current merged head and
tree. The spec contains `agent` and a `repositories` array. Each repository
has `id` (`public`, plus `private` for composed delivery), absolute `root`,
`base` (the deployed commit), optional `defaultBranch`, and `owners`, a map
from every commit SHA in `base..main` to its feature agent's `id` and `contact`.
Resolve ownership through PRs and agent messages, including merge commits. A
missing owner is an error, not permission to assign blame to the batch owner.

Register that output with the `batch` operation. Registration names the
initiator as owner, returns `batchId` as `id` and a batch `token`, and notifies
all included owners. Re-registering the same heads returns the existing owner;
coordinate with it. Build those merged heads in CI. TEST and PROD must consume
those immutable artifacts, including the exact private composition. A feature
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
claiming PROD. Superseded or disqualified batches cannot promote.

On the target, set `integration.ref` and `integration.mergedHead` to the selected
merged public commit, with `integration.defaultRef` set to freshly fetched
`origin/main`. The guard requires that exact commit and tree and confirms it is
still on main. Do not point activation at the feature branch or substitute the
newest unchecked main for an already tested batch.

## Failure, reverts, and communication

The batch owner identifies failures, preserves evidence, and records
`batch-fail` with `batchId`, `batchToken`, `agent`, `evidence`, and, once known,
`responsible` commit SHAs. This holds promotion and invalidates every batch
containing those failed commits. Distinguish source regressions from target or
infrastructure failures before reverting. Keep PROD healthy while investigating.

For a confirmed source regression, the batch owner creates and merges a normal
revert on current main, including dependent changes that cannot stand alone.
Never reset or force-push main. Recheck the reverting candidate and required CI.
Message the responsible feature agent with its commit, failure evidence, revert,
and repair request. That agent fixes its change with a regression in its own
worktree and re-enters the DEV and merge loop. Do not wait for that repair to
continue delivering unrelated work.

Fetch current main again and select a successor batch. Include `predecessor`,
`previousToken`, `revertEvidence`, and `reverts: [{"commit": "bad SHA", "revert":
"merged revert SHA"}]` in the selection spec. The same initiating owner owns
the corrected batch, even if it now contains additional merged work. Build it
in CI and repeat from TEST. A successful corrected TEST clears its failed
predecessors' promotion holds, while older artifacts containing reverted code
remain disqualified. If attribution is uncertain or a revert would cause data
loss or cross-feature breakage, preserve the hold and request the concrete
human decision while continuing independent work.

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
Never recover around an active deployment. A leftover metadata lock can be
removed with `recover-metadata` only after its recorded process has stopped;
pass its exact `owner.json`. Preserve uncertain state for manual inspection.
