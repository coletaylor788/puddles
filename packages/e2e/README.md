# Shared integration test pool

This package provides the isolated cumulative integration gate for Puddles and
its maintained OpenClaw source patches. It does not connect to the configured
gateway, model provider, Messages.app, or personal data.

## Required lifecycle

Every feature, behavior change, and bug fix contributes a committed regression
and runs the complete accumulated pool:

```bash
node packages/e2e/bin/openclaw-test-env.mjs ci
```

The pull-request workflow runs this exact command on macOS. The lifecycle:

1. builds and lints all workspace packages;
2. runs all isolated workspace tests, including deployment and recording-mock
   behavior;
3. creates a detached worktree at the pinned OpenClaw revision;
4. restores that worktree's frozen dependencies;
5. applies every maintained source patch in deployment order;
6. verifies generated OpenClaw prompt snapshots are current;
7. executes every mapped OpenClaw regression; and
8. executes candidate tests that need both the Puddles harness and patched
   OpenClaw source.

The temporary worktree is removed on success, failure, and termination.
Cleanup attempts worktree removal, directory deletion, and stale-registration
pruning independently so one failure does not skip the remaining steps.

Set `OPENCLAW_SRC` when the source checkout is not at `~/git/openclaw`:

```bash
OPENCLAW_SRC=/path/to/openclaw \
  node packages/e2e/bin/openclaw-test-env.mjs ci
```

To run only the isolated patch lifecycle:

```bash
node packages/e2e/bin/openclaw-test-env.mjs patches
```

## Safety boundary

- The runner never edits the configured OpenClaw checkout. It uses a detached
  temporary worktree at the revision pinned in
  `openclaw-patch-suite.json`.
- The required lifecycle never drives the live gateway or a real agent profile.
- Automated tests never send messages or mutate personal accounts.
- Write-path tests use deny-by-default recording mocks:
  - `mocks/imsg-mock.mjs` records message sends;
  - `mocks/apple-pim-mock.mjs` records PIM writes and returns empty reads.
- Production validation remains separate, read-only, and cannot substitute for
  the committed integration pool.

Omitting a delivery flag or using a benign prompt is not a safety boundary:
agent tools can still execute. Do not add tests that drive configured agent
profiles. Build an isolated recording adapter or focused source-level harness
instead.

## OpenClaw patch manifest

`openclaw-patch-suite.json` is cumulative and must match the patch order in
`docs/openclaw-setup/patches/apply-and-deploy.sh`.

For every maintained patch:

- add or update focused tests inside the patch;
- map every applicable test path in the manifest;
- add a candidate test when behavior crosses the Puddles/OpenClaw boundary; and
- retain all prior feature regressions.

The offline manifest tests fail when a deployed patch is missing, order
diverges, a changed patch test is unmapped, a test path is duplicated, or a
candidate test does not exist. The managed lifecycle also fails closed when a
mapped OpenClaw test is absent after patch application.

Tests that exist only inside a `.patch`, temporary session mocks, skipped live
suites, and uncommitted checks do not count.

## Current coverage

- all maintained patches applied in deployment order;
- iMessage split-part coalescing, including links, images, commands, replay,
  races, catchup cursors, and separate-message preservation;
- same-agent and cross-agent spawn policy paths;
- skill-workshop sandbox behavior;
- session yield/block/gather behavior;
- local-default versus explicit-remote deployment routing;
- patched browser entrypoint profile and singleton cleanup;
- recording message and PIM write adapters;
- manifest completeness and pinned-source enforcement;
- reusable adversarial-review worker, anti-churn, and worker-owned completion
  workflow contracts; and
- shared utility parsing and complexity regressions.

## Adding coverage

- Keep focused package tests beside implementation.
- Put cross-component, deployment, and patch-stack integration coverage here.
- Route every external write through a recording mock that rejects unsupported
  operations.
- Do not use real credentials, provider names, personal identifiers, or live
  delivery.
- Report the exact managed command and accumulated test results in the pull
  request.
