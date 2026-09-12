# OpenClaw source patches and native delivery

Puddles maintains source patches against the pinned OpenClaw release. The native
runner applies them in a detached worktree, builds the real runtime, runs the
cumulative regressions, and rehearses the installed package. It never modifies
the configured source checkout or patches installed distribution chunks.

The selected stable release is OpenClaw 2026.9.3 at
`1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`. It requires Node 24.16.0 or later
on 24.x, or Node 26.1.0 or later. Earlier runtimes can truncate SQLite text.
Use the same exact Node binary for packaging, installed rehearsal, and the
activated gateway. Keep the previous interpreter available for rollback.

## Maintained patches

| Patch | Purpose |
|---|---|
| `file-lock-stale-reclaim-guard.patch` | Guard stale file-lock recovery |
| `sessions-yield-block-and-gather.patch` | Block at yield and gather subagent results |
| `subagent-cross-agent-spawn-fix.patch` | Explicit targeting and inherited tools |
| `skill-workshop-sandbox-fix.patch` | Skill workshop in sandboxed agents |
| `imessage-message-part-coalescing.patch` | Selective text, link, and image coalescing |
| `sandbox-discovery-failure-fix.patch` | Surface sandbox discovery failures |
| `browser-userdata-dir-fix.patch` | Browser data directory and singleton cleanup |
| `builtin-memory-migration.patch` | Retired QMD migration and per-agent source isolation coverage |
| `silent-reply-completion-evidence.patch` | Preserve current-attempt silent reply evidence after delivery filtering |
| `stopped-state-migration-sdk.patch` | Expose maintained readonly cron, targeted writes, and config ownership helpers |
| `scoped-container-temp-root.patch` | Carry explicit private staging through sandbox and browser creation |
| `active-memory-cold-recall.patch` | Preserve required recall within one shared cold-setup budget |
| `active-memory-fixture-cleanup.patch` | Join delayed recall fixtures before replacing shared test state |
| `managed-local-service-lifecycle.patch` | Join gateway-owned service groups before stopped-state changes |

Each patch has a neighboring document explaining its behavior and history.
Register new patches and every applicable test in the cumulative manifest at
`packages/e2e/openclaw-patch-suite.json`. Keep the visible patch order in
`apply-and-deploy.sh` synchronized. Do not drop older regression targets.

## Build and rehearse

```bash
OPENCLAW_SRC=/path/to/openclaw E2E_RUN_DIR=/path/to/native-run \
  node packages/e2e/bin/openclaw-test-env.mjs ci
```

The [native test guide](../../../packages/e2e/README.md) describes focused
iteration, fixtures, the optional local extension, and cache invalidation. The
final gate packages the materialized runtime dependency graph into a portable
archive. Installation extracts and verifies that archive in an isolated prefix,
with no registry resolution. A real separate gateway then runs the committed
message scenarios. Artifacts are tied to the exact Node version, OS, and CPU.

Build any required browser image before activation. Select its saved image
archive, digest, and immutable image ID in the target configuration. The
activation preflight loads that prebuilt image and checks its identity before
stopping the gateway. Save it with a separate candidate tag. Preflight reads
the Docker archive manifest and rejects production-tag collisions before load,
then records the prior production image ID before importing candidate layers.
No browser build happens during downtime.

## Integrate, then activate

The engineering owner integrates eligible exact source after the accumulated
gate and installed rehearsal. Before touching the live runtime, the activation
command confirms that the selected integrated Git tree equals the candidate
tree and that the retained proof chain still matches. A pull-request merge is
never part of the live rollback transaction.

```bash
node packages/e2e/bin/openclaw-integrate.mjs \
  /path/to/native-run/candidate.json example/public-repo 123
```

This separate bounded command checks the exact candidate head, current base,
required remote eligibility, and resulting Git tree. A remote race blocks
activation rather than rolling back a healthy running gateway. Fetch the
integrated ref into the target's reviewed tooling checkout before activation.

Create a local target JSON file, outside the repository. This synthetic example
shows the required fields. Set real paths and host identity locally.

```json
{
  "schemaVersion": 1,
  "host": "gateway.example.test",
  "installDir": "/opt/example/lib/node_modules/openclaw",
  "stateDir": "/home/example/.openclaw",
  "plistPath": "/home/example/Library/LaunchAgents/ai.openclaw.gateway.plist",
  "backupRoot": "/home/example/.openclaw-deploy-backups",
  "label": "ai.openclaw.gateway",
  "port": 18789,
  "integration": { "repository": "/path/to/puddles", "ref": "origin/main" }
}
```

`host` must equal the target's operating-system hostname. The install and state
roots must be real directories, not symlinks, and must be disjoint from the
backup root. The service definition must already exist. Optional `browser`
contains `path`, `sha256`, `imageId`, and `tag`. Its current production tag must
be resolvable so rollback has an explicit prior image.

For an interpreter upgrade, the optional `nodeMigration` target field records
`argumentIndex`, `expected`, and `desired`. Each identity contains an absolute
`path`, the executable's `sha256`, its `version` in the form `v26.1.0`, and
its `platform` and `arch`. Select a separate installed interpreter outside the
runtime, state, and backup trees. Do not replace or remove the old interpreter.
The desired identity must match the sealed candidate and the activation
process, not merely satisfy the minimum Node version.

If the old service argument passes through a symlinked parent directory,
`expected.path` keeps that literal argument and `expected.realPath` records the
canonical executable. Both must remain outside the swapped trees. Without
`expected.realPath`, the old path must already be canonical. The desired path
must always be canonical; a desired `realPath` override is not accepted.

The index identifies the unique exact old interpreter argument in the existing
service definition. Only that argument changes. Shell wrappers, environment
arguments, and other property-list fields remain intact. Preflight rejects
ambiguous arguments and incompatible service program overrides before stopping
anything. The original service is snapshotted, and the staged replacement is
applied after migration but before restart.

Recovery verifies the retained interpreters and restores the original service.
Old-runtime checks use the old interpreter. Candidate migration, new-runtime
checks, and retained candidate browser recovery use the candidate interpreter.
This keeps native module bindings paired with their matching runtime during
both activation and rollback. No package or interpreter download occurs while
the gateway is stopped.

For a stopped-state migration, add `stateMigration` to the local target with
`manifestPath` (a canonical absolute file outside replaced roots) and `sha256`
(the file's SHA256 hex digest). Supply the same manifest through
`E2E_STATE_MIGRATION_MANIFEST` during the combined cumulative rehearsal.
Its digest is bound to the regression and installed-runtime proofs. Activation
rejects a different manifest or a candidate that did not include it.

The manifest contains `schemaVersion: 1`, `configOperations`, and an optional
`cronOperation`. Config operations have `kind` (`set` or `unset`), a nonempty
array of string path segments, and `expected`. An absent leaf uses
`{ "exists": false }`. An existing leaf uses
`{ "exists": true, "sha256": "<value digest>" }`. Only `set` has a `value`.
Generate old-value hashes with `canonicalValueDigest` exported by
`packages/e2e/src/native-state-migration.mjs`, not a separate implementation.
Preconditions describe the maintained source writer's view before runtime
defaults, rather than a stale whole-config snapshot.

Operations cannot overlap, address array positions or prototype keys, change
environment selection or the cron store, or rewrite include directives.
Missing object parents can be created; scalar parents cannot be replaced.
An included config must have one internal sole owner for every changed leaf.
Merged, shared, external, array-owned, and cross-boundary writes fail preflight.
All config, include, backup, audit, and database paths must remain inside the
snapshotted state tree without symlink or hardlink traversal. The source writer
preserves authored secret references and home-relative paths.

The optional job operation is
`{ "kind": "silence-delivery", "jobId": "synthetic-job", "expectedRevision": "sha256:<token>" }`.
Use `resolveCronJobConfigRevision` from `openclaw/plugin-sdk/cron-store-runtime`
for that token. Any reviewed normalization of an older definition must be
proven before selecting it, not silently accepted after doctor. The helper
changes final delivery to `none`, clears known destinations, and disables
failure alerts. It retains the owner, enabled state, schedule, payload, model,
nonrouting fields, and concurrent runtime state. Unknown routing-shaped fields
fail. This does not revoke tools or prevent a job's own agent from using them;
that policy belongs in the operator's reviewed configuration.

Preflight reads config with observation disabled and core-only validation,
without loading the installed plugin index or recording config health. The
stopped source writer still performs full plugin validation before committing.
Cron path selection uses the maintained artifact-preserving reader, so even an
older database without WAL or SHM files remains unchanged. Private temporary
read snapshots use the recovery directory's cache, not the target state.
The selected database must already exist for a job
operation. After stopping and snapshotting, activation records each stage
before it runs: schema-only repair, checked config mutation, ordinary doctor,
then a fresh readonly job snapshot and targeted compare-and-swap write. Only
then can the gateway start. Schema repair uses the existing public doctor
repair API and never compiles memory or starts a service. There are no manifest
commands, callbacks, network access, or direct database writes. Any failure
restores the original state, runtime, and service through the existing journal.
Interrupted recovery uses the retained snapshots, not a new baseline.

When a candidate declares additional runtime artifacts, the target must map
every artifact exactly once through `additionalInstalls`. Each entry has an
`id` matching the candidate and a `path` relative to `stateDir`, for example
`{ "id": "auxiliary", "path": "managed/example-runtime" }`. Paths must be
disjoint real directories below state, without symlink traversal. Select only
the managed runtime subtree, never a parent containing sessions or unrelated
configuration.

All archives are verified and installed into separate staging prefixes before
shutdown. After the gateway stops and state is snapshotted, activation replaces
each selected subtree completely and checks its exact runtime digest. It does
not merge files or apply an earlier whole-state image. Existing registry,
configuration, and session files outside those subtrees remain untouched.
The consumer must prove those records remain valid for the selected stable
install location and package identity. This interface does not migrate
registration metadata or infer configuration changes.

```bash
OPENCLAW_CANDIDATE_RECEIPT=/path/to/native-run/candidate.json \
OPENCLAW_DEPLOY_TARGET=/absolute/local/target.json \
  bash docs/openclaw-setup/patches/apply-and-deploy.sh
```

An unset `MINI_HOST` means local deployment. Set it only for an intentional
approved remote target. Remote activation also requires `PUDDLES_REMOTE_ROOT`,
the reviewed tooling path on that host. Transport the sealed artifact and its
retained proofs before activation and update local path references without
changing the artifact bytes. Receipt and target paths then refer to the remote
host. Transport never runs builds or package managers.

Noninteractive SSH may not load the interactive shell's tool paths. Set
`PUDDLES_REMOTE_NODE` to the absolute supported Node executable on the target
when needed. Set `PUDDLES_REMOTE_PATH` explicitly if activation's child commands
need a selected tool path. Both values are quoted as arguments, not evaluated
as shell code. Without these settings, remote activation uses `node` and the
remote shell's existing PATH. Local activation is unchanged.

## Recovery

Activation holds a target lock, proves offline installation before stopping the
gateway, and snapshots the prior package, runtime, and service definition.
Runtime snapshots use the existing per-file macOS `clonefile` helper. It
preserves links, metadata, ACLs, and extended attributes without a recursive
clone fallback. Unsupported filesystems fail before package replacement.
Package and state replacement use an atomic macOS directory exchange.

Migration runs with externally managed service repair and must leave the
gateway stopped. Activation then switches any selected prebuilt browser image,
recreates its sandboxes, restarts, and checks the explicit local gateway port.
Failures restore package, state, service, and browser snapshots. Sandbox
recovery uses a retained, digest-checked copy of the candidate CLI, even if an
interrupted rollback already restored the older production package. Older CLIs
can hide discovery errors. Critical restoration failures block restart and retain the
original and rollback failures.

The stopped-state snapshot also restores replaced additional runtimes, or
removes a newly introduced subtree during rollback. Recovery does not require
the original additional archives. The local recovery journal retains their
deployed content digests separately from existing package provenance records.

Recovery state is written before destructive steps. Signals request rollback;
additional signals are deferred until recovery reaches a safe state. A killed
owner leaves its lock and journal. Confirm that owner and its child processes
have stopped before removing only the target backup root's `lock` directory.
Then rerun the same wrapper with `OPENCLAW_RECOVERY_DIR` set to the recorded
activation directory. Recovery verifies the target and artifact identities and
restores independent snapshots rather than guessing whether a swap completed.

Ordinary recovery leaves a completed healthy activation alone. If a required
read-only smoke check fails after activation returns healthy, request rollback
explicitly with the same receipt, target, and recorded recovery directory:

```bash
OPENCLAW_DEPLOY_ACTION=rollback \
OPENCLAW_RECOVERY_DIR=/absolute/backups/activation-example \
OPENCLAW_CANDIDATE_RECEIPT=/absolute/release/candidate.json \
OPENCLAW_DEPLOY_TARGET=/absolute/release/target.json \
  docs/openclaw-setup/patches/apply-and-deploy.sh
```

This action holds the same target lock. Before stopping, it checks the latest
transaction marker, current runtime, additional packages, service, browser
identity, and recovery snapshots. It refuses a superseded transaction, even
if a newer activation installed identical package bytes. Old journals without
ownership evidence cannot opt into explicit rollback.

After stopping, rollback durably preserves failed live state, runtime, and
service snapshots under `failed-state`, `failed-package`, and
`failed-service.plist` in that recovery directory. It restores the original
state and all managed package subtrees, the root runtime, service, and browser,
then restarts and checks prior health. Repeating explicit rollback is safe.
Interrupted rollback can resume through either explicit rollback or ordinary
recovery, without archives or caller edits to the journal. Preserved failed
state is not overwritten on replay. A newer transaction blocks stale recovery.

Production checks are read-only. Never validate by sending a message or running
a cron that can deliver one. Do not use the built-in updater for this patched
runtime; it bypasses the cumulative gate, installed rehearsal, and recovery.
