# OpenClaw source patches and native delivery

Puddles maintains source patches against the pinned OpenClaw release. The native
runner applies them in a detached worktree, builds the real runtime, runs the
cumulative regressions, and rehearses the installed package. It never modifies
the configured source checkout or patches installed distribution chunks.

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
| `qmd-mcporter-per-agent.patch` | Per-agent memory backend configuration |

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

Production checks are read-only. Never validate by sending a message or running
a cron that can deliver one. Do not use the built-in updater for this patched
runtime; it bypasses the cumulative gate, installed rehearsal, and recovery.
