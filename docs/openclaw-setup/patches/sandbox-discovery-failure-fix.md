# Sandbox recreate discovery failure propagation

## Problem

Earlier OpenClaw `sandbox recreate` commands converted container and browser
discovery errors into empty lists. The command then exited successfully after
reporting that no matching runtimes exist. Deployment cannot distinguish a
genuinely empty match from a locked, corrupt, or unavailable container registry,
so it can restart the gateway with stale sandbox containers.

## Change

OpenClaw 2026.11.3 natively propagates discovery errors and scopes discovery to
the selected runtime type. Its local-state owner also guards inspection and
removal. The runtime hunk is retired; the retained patch contains regressions
only. Container discovery runs only for normal sandbox recreation;
browser discovery runs only for `--browser`. Rejections propagate to the CLI,
which exits nonzero and triggers deployment rollback.

The ordinary `sandbox list` command is unchanged.

## Validation

The patch adds focused OpenClaw tests for normal-container and browser discovery
rejections. Both assert that the error propagates and no removal is attempted. Additional
cases prove that the unselected registry is not queried. Both selection cases
failed against unpatched 9.6. Stable now provides the two discovery conditions
natively. The retained tests still require execution on the composed candidate.
The tests are registered in `packages/e2e/openclaw-patch-suite.json` and run by:

```bash
node packages/e2e/bin/openclaw-test-env.mjs ci
```
