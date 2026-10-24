# Development storage

One feature owns one workspace containing its paired worktrees, prepared upstream
source, incremental output, test state, and temporary files. Share the host package
store. Deployments, environment state, installed release tooling, and the one backup
live outside feature workspaces.

Triggered CI adds a bounded immutable build registry and bounded run/outbox records;
see [CI storage and recovery](../release/CI.md#recovery-and-storage). Active runs
pin their snapshots. The service collects expired unreferenced snapshots and
retries environment teardown without an agent. It keeps environment ownership
until teardown succeeds. Notification outages must not prevent artifact cleanup.
Existing unregistered data and recovery remain subject to the rules below.

Register ownership using the installed controller:

```sh
node /absolute/release/bin/puddles-release.mjs workspace-init /absolute/workspace.json
```

The descriptor has `version: 1`, `owner`, `root`, `developmentRoot`, `releaseRoot`,
`protectedPaths`, and `worktrees` with `path` and kind `git` or `managed`.
The workspace is a direct child of its development root. Protected paths identify
deployments, backup, tooling, and shared caches. Optional processes include their
PID, start identity, and owned command root. See [the schema](../release/README.md).

## Finish a feature

Publish source and complete or hand off every active consumer. Stop owned
development processes. Before archiving source or finalizing its workspace,
confirm that CI build and controls registrations, retained candidates, active
consumers and recovery references no longer depend on it. The legacy finalizer
alone does not verify these CI references. Use maintained lifecycle commands for
eligible resources; preserve referenced or incompletely owned state and report
the hold. Run teardown does not authorize deletion of retained source or warm
output. See [CI storage and recovery](../release/CI.md#recovery-and-storage).
After these prerequisites hold, run this from outside the workspace:

```sh
node /absolute/release/bin/puddles-release.mjs finalize /absolute/feature OWNER
```

The script rejects wrong ownership, dirty or unpublished source, and primary
checkouts. Use the app's archive tool for managed worktrees, then finalize the
remaining workspace. The script retires registered Git worktrees and deletes the
whole owned workspace. Interrupted cleanup resumes from a small journal.

Remove builds, fixtures, archives, logs, receipts, and test output with the workspace.
The conversation keeps results; do not retain a separate test-summary archive.
Keep only active queue/deployment/recovery state outside it. Retry cleanup separately
from the release queue. Actual disk errors stop only the operation needing space.

## Backup and older data

Never delete backups or production state with development cleanup. The controller's
backup command invalidates the old backup and captures directly into the same
location. A failed capture restarts unchanged production and blocks deployment.

Do not claim old unregistered directories as a new workspace to bypass ownership.
Inspect owners, consumers, and recovery references first. Existing recovery and
legacy storage records use [the legacy guide](LEGACY_DEVELOPMENT_STORAGE.md) until
the adoption checkpoint retires them. Age alone does not establish ownership.
