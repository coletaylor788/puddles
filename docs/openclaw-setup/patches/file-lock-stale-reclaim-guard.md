# File-lock stale reclaim guard

## Problem

OpenClaw config writes use the shared `@openclaw/fs-safe` sidecar lock. Its stale
recovery reads a lock, checks that the file still matches, then removes the
pathname. Another process can publish a new lock between the final check and
removal. The stale reclaimer can then delete the new owner's lock and allow two
config writers to proceed.

## Patch

The dependency patch adds a macOS kernel guard around stale inspection and
removal. It opens a persistent sibling reclaim file with `O_EXLOCK`, so only one
reclaimer can enter that section. The kernel releases the guard automatically
when the process exits or dies. Other platforms keep the existing behavior.

The OpenClaw source patch updates the existing `@openclaw/fs-safe` pnpm patch and
its lockfile hash. A multi-process test pauses the first stale reclaimer inside
approval, starts a second reclaimer, and proves the second cannot enter until
the first releases. It also verifies that their held critical sections never
overlap.

## Validation

The regression is registered in the cumulative OpenClaw patch suite. Run:

```bash
node packages/e2e/bin/openclaw-test-env.mjs ci
```

Deployment uses `docs/openclaw-setup/patches/apply-and-deploy.sh`, which builds
the patched dependency into OpenClaw, snapshots production state, and rolls back
on install, restart, or health failure.
