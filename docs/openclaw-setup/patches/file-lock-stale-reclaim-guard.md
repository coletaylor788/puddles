# File-lock stale reclaim guard

## Problem

OpenClaw config writes use the shared `@openclaw/fs-safe` sidecar lock.
Native stale recovery already serializes reclaimers. Its persistent directory
can survive a killed reclaimer and block later writers. It also treats the
persistent guard files from the earlier Puddles implementation as contention.

## Patch

OpenClaw 2026.11.4 uses `@openclaw/fs-safe` 0.26.7. Upstream serializes stale
reclaimers with a sibling directory. That prevents overlapping writers, but a
killed reclaimer leaves the directory behind. It also treats the persistent
guard files from the earlier Puddles patch as permanent contention.

The maintained dependency patch keeps a macOS kernel guard at that same path.
It uses nonblocking `O_EXLOCK`, so normal retry limits still apply. The kernel
releases ownership after process death without deleting the persistent file.
Both synchronous and asynchronous locks use the same guard, and process cleanup
closes held descriptors. Symlink and non-file guards fail explicitly. Other
platforms keep upstream behavior. The new root-scoped lock path retains its
upstream ownership tokens and containment checks; the kernel guard applies to
the existing raw-path locks used by configuration writes.

The source patch registers the dependency patch and its generated lockfile
references. The original multi-process regression still pauses one stale
reclaimer and proves
the second cannot enter its critical section. A new regression starts with an
existing persistent guard, kills its reclaimer, and proves recovery and
synchronous/asynchronous interoperability.

## Validation

The regression is registered in the cumulative OpenClaw patch suite. The
frozen install must also resolve every `@openclaw/fs-safe` importer to the
patched snapshot. Run:

```bash
node packages/e2e/bin/openclaw-test-env.mjs ci
```

Deployment uses `docs/openclaw-setup/patches/apply-and-deploy.sh`. The managed
pipeline builds and rehearses the patched dependency before activation. The
wrapper consumes the sealed artifact and retains rollback snapshots.


## v2026.11.4 audit

Native fs-safe0.26.7 still uses mkdir/rmdir reclaim occupancy, with no Darwin kernel guard. Identical reviewed nested patch applies to0.26.7. Preserve its new filesystem containment implementation and update only patch dependency identity, never downgrade to0.26.5.

Composition is qualified separately from installed runtime behavior. The registered regressions remain required.
