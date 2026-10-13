# Release tooling

This package deploys a complete application directory. It owns the ready queue,
TEST and PROD deployment, one backup, recovery, and workspace finalization. It
has its own dependencies and build. The application supplies service commands
and acceptance checks. No application build runs when this tool is built or tested.

The new controller is installed for the manager's adoption trial. Normal
ownership has not switched yet. Follow the [adoption checkpoint](../e2e/DEPLOYMENT_COORDINATION.md#adoption-checkpoint)
and preserve the legacy tools needed by outstanding recovery.

## Build and test

```sh
corepack pnpm -C packages/release install --frozen-lockfile
corepack pnpm -C packages/release build
corepack pnpm -C packages/release test
```

Install between tickets with
`node packages/release/scripts/install.mjs CONFIG /absolute/tool-installation`.
This builds and tests the release package, then replaces only its owned installation.
Run subsequent commands from `/absolute/tool-installation/bin/puddles-release.mjs`.

`dist` contains only the standalone controller. The older `native-*` source and
Vitest cases remain for recovery compatibility during adoption. They are not
part of the installed replacement. Application changes use the installed tool
and run the application suite; they do not rerun this package's tests.

## Commands

Run `node packages/release/bin/puddles-release.mjs` with:

| Arguments | Action |
|---|---|
| `status CONFIG` | Read the ready queue and active release |
| `enqueue CONFIG TICKET` | Join the back of the ready queue |
| `cancel CONFIG ID` | Withdraw a waiting feature |
| `run CONFIG` | Finish or recover the active ticket, or take the first ready ticket |
| `recover CONFIG` | Restore an active failed release before releasing its ticket |
| `dev CONFIG REQUEST` | Deploy a draft under a short DEV lock |
| `backup CONFIG` | Replace and verify the one backup; refuses an active release |
| `rebase REPOSITORIES` | Rebase owned branches on main and record their new heads |
| `merge REPOSITORIES` | Merge only those tested heads |
| `workspace-init WORKSPACE` | Register ownership and protected paths |
| `finalize ROOT OWNER` | Remove a finished workspace from outside that workspace |

The manager calls `run` again for the next feature. A failed feature leaves the
queue after recovery; fixes rejoin at the back. A failed final merge retains its
ticket. Retry the merge or use `recover` while intake is still held. Never restore
a backup over new live writes after intake has resumed.

## Configuration

A version-1 configuration has `root`, `backup`, `test`, and `prod`.
`root` holds only current queue, deployment, and lock state.

Each target has a `runtime` directory and `stop`, `start`, `health`, and `tests`
commands. Optional `prepare` resets TEST state or applies that environment's
application configuration. PROD also supplies `quiesce` and `resumeIntake`.
Quiesce must stop new work through acceptance and merge; `stop` must stop every
writer of backed-up state. The service commands live outside the replaced runtime.
PROD tests must be read-only. TEST delivery and external writes use recording
fixtures. Keep all environment state and configuration outside the build.

Every command declares an absolute `command`, an array of `args`, absolute `cwd`,
and bounded `timeoutMs`. Optional `env` adds environment variables.

`backup` has a `root` and explicit `paths`, each with a unique `name` and absolute
`path`. Include the production runtime, configuration, and all writable state.
The paths must not overlap. The script verifies healthy PROD, stops writers,
invalidates the old backup, captures directly into the same location, and verifies
it there. It restarts unchanged PROD even when capture fails. A failed capture
cannot authorize deployment. There is no second backup generation.

An entry may declare `allowAbsent: true` for a path the application can create,
such as a new guidance file. Capture records its absence; rollback removes a file
created by the failed deployment. If the path already exists, capture and restore
its contents normally. All other entries, including the production runtime, must
exist. Declare individual guidance files rather than unrelated workspace parents.

A ticket has `id`, `workspace`, `artifact`, and commands `rebase`, `build`,
`applicationTests`, and `merge`. The artifact must be inside its feature workspace.
`applicationTests` runs the full application suite on the output of `build`.
The controller verifies that tests do not alter that output and copies the same
bytes to TEST and PROD. Store repository heads outside the source checkouts, in
the workspace, so updating the ticket does not dirty a branch.

A DEV request contains `ticket` and `target` with the same target fields above.
It cannot overlap TEST, PROD, backup, or any feature workspace.
DEV, TEST and PROD use the same deployment implementation. Every callback receives
`PUDDLES_RELEASE_PHASE`, `PUDDLES_RELEASE_ARTIFACT`, `PUDDLES_RELEASE_WORKSPACE`, and
`PUDDLES_RELEASE_ID`. Reuse application callbacks across targets; supply environment
bindings through their configuration. Keep application-specific checks out of this
package.

## Finalization

Register a version-1 workspace with `owner`, `root`, `developmentRoot`, `releaseRoot`,
`protectedPaths`, and `worktrees` (each has `path` and kind `git`, `managed`, or `generated`).
The root must be a direct child of the development directory. Keep deployments,
backup, release installation, and shared caches in the protected paths outside it.
Optional `processes` record PID, start identity, and owned command root.

Publish source first. `finalize` refuses dirty checkouts, unpublished commits,
primary checkouts, and wrong ownership. Archive app-managed worktrees through
the app, then finalize their remaining workspace. Keep Git metadata outside the
workspace so retiring a checkout does not erase repository history. An interrupted
cleanup resumes from its small journal. Cleanup is independent of the queue.

Register `generated` source paths before creating them. This marks reproducible
upstream clones or patched build checkouts as disposable. Existing source cannot
be relabeled this way. Finalization removes their linked-worktree registrations
and build data without publishing generated patches. Authored feature checkouts
still require clean, published source, with repository metadata outside the workspace.
