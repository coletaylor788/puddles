# Sandbox recreate discovery failure propagation

## Problem

The pinned OpenClaw `sandbox recreate` command converts container and browser
discovery errors into empty lists. The command then exits successfully after
reporting that no matching runtimes exist. Deployment cannot distinguish a
genuinely empty match from a locked, corrupt, or unavailable container registry,
so it can restart the gateway with stale sandbox containers.

## Change

The source patch removes the empty-list fallbacks from the recreate-only
discovery path. Container discovery runs only for normal sandbox recreation;
browser discovery runs only for `--browser`. Rejections propagate to the CLI,
which exits nonzero and triggers deployment rollback.

The ordinary `sandbox list` command remains best-effort and keeps its existing
empty-list behavior for diagnostics.

## Validation

The patch adds focused OpenClaw tests for normal-container and browser discovery
rejections. Both assert that the error propagates and no removal is attempted.
The tests are registered in `packages/e2e/openclaw-patch-suite.json` and run by:

```bash
node packages/e2e/bin/openclaw-test-env.mjs ci
```
