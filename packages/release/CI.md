# Triggered CI

Implementation and cutover status: [Plan 064](../../docs/plans/064-triggered-ci.md).
Do not restart feature releases until the live dummy trial in that plan passes.
The release-manager agent and its heartbeat are retired. Scripts own execution;
agents own implementation, focused tests, retained review, and repairs.

## Application loop

1. Build incrementally in the feature's existing development-host workspace.
   Publish a digest-addressed copy of the complete output. A later edit cannot
   change the submitted runtime. Keep private build paths out of GitHub inputs.
2. Call DEV CI with that build ID. It deploys and runs installed checks while
   holding DEV, then stops test processes and cleans the environment. Broad
   source tests belong to implementation and production CI, not the DEV slot.
3. Complete review and repository checks. Before submitting production CI, merge
   or rebase current main into each feature branch; rebuild and repeat affected
   review and DEV checks whenever inputs change. Submit the resulting frozen ID.
4. GitHub schedules the workflow using a separate DEV or production concurrency
   group, `queue: max`, and `cancel-in-progress: false`. At dequeue, stale bases
   fail and notify the owner. No source editing occurs while holding the lane.
5. Production CI runs the full application suite on the development host, checks
   the bound result on the target, and deploys the same output to TEST. It runs
   installed tests, holds production intake, replaces and verifies the one backup,
   deploys PROD, runs read-only tests, merges the exact tested PR heads, and resumes
   intake. TEST teardown must finish before a terminal deployment result.

## Integration requirements

Production preflight requires enforced main protection, strict up-to-date checks,
at least one required successful check, and at least one approving review of the
current PR head with stale approvals dismissed. These are checked before deployment
and enforced by GitHub on the normal PR merge endpoint. A repository plan that does
not support those protections cannot qualify for production. Do not substitute a
direct main push or waive an unavailable gate.

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

Every snapshot includes the complete input manifest, source heads/bases/trees, and
content digests. Loading verifies its identity and runtime bytes. Mutable DEV and
application-suite receipts bind to that identity. Active consumers pin snapshots.
Collection removes only recognized expired unreferenced objects. Registry byte
budgets and disk reserve checks reject admission before space is exhausted.

Run records default to a 100 MiB budget, 500 records, and seven-day delivered-result
retention. Snapshot age defaults to one day. Host configuration sets appropriate
budgets for real payloads. Undelivered results remain bounded; notification failure
does not prevent independent artifact cleanup. Keep warm compiler caches bounded
and register transfer scratch before allocating it. Feature source cleanup still
uses the existing guarded `finalize`/managed-worktree archive lifecycle.

Start and terminal state changes commit their outbox event atomically. Notification
delivery is at least once: the receiver must use the stable event ID to avoid
duplicate follow-up work if delivery succeeded before its acknowledgement was saved.
Workflow results and deployment results have distinct scopes: a cancelled Actions
job may leave the local transaction recovering. Only a terminal deployment record
after cleanup establishes completion. Never put credentials or raw private logs in
event messages; report the status, build ID, run reference, and owning task.
