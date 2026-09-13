# File-lock stale reclaim guard

## Problem

OpenClaw config writes use the shared `@openclaw/fs-safe` sidecar lock. Its stale
recovery reads a lock, checks that the file still matches, then removes the
pathname. Another process can publish a new lock between the final check and
removal. The stale reclaimer can then delete the new owner's lock and allow two
config writers to proceed.

## Patch

OpenClaw 2026.9.3 uses `@openclaw/fs-safe` 0.8.5. Upstream now serializes stale
reclaimers with a sibling directory. That prevents overlapping writers, but a
killed reclaimer leaves the directory behind. It also treats the persistent
guard files from the earlier Puddles patch as permanent contention.

The maintained dependency patch keeps a macOS kernel guard at that same path.
It uses nonblocking `O_EXLOCK`, so normal retry limits still apply. The kernel
releases ownership after process death without deleting the persistent file.
Both synchronous and asynchronous locks use the same guard, and process cleanup
closes held descriptors. Symlink and non-file guards fail explicitly. Other
platforms keep upstream behavior.

The source patch registers the dependency patch and its lockfile hash. The
original multi-process regression still pauses one stale reclaimer and proves
the second cannot enter its critical section. A new regression starts with an
existing persistent guard, kills its reclaimer, and proves recovery and
synchronous/asynchronous interoperability.

## Validation

The regression is registered in the cumulative OpenClaw patch suite. Run:

```bash
node packages/e2e/bin/openclaw-test-env.mjs ci
```

Deployment uses `docs/openclaw-setup/patches/apply-and-deploy.sh`. The managed
pipeline builds and rehearses the patched dependency before activation. The
wrapper consumes the sealed artifact and retains rollback snapshots.
