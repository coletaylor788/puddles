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

1. restores frozen workspace dependencies when a fresh worktree has none;
2. builds and lints all workspace packages;
3. runs all isolated workspace tests, including deployment and recording-mock
   behavior;
4. creates a disposable Gmail development environment and runs its safe Python
   tests, lint, and compilation without changing the production environment;
5. validates the patch manifest before expensive setup;
6. creates a detached worktree at the pinned OpenClaw revision under the
   canonical macOS temporary path;
7. restores that worktree's frozen dependencies;
8. applies every maintained source patch in deployment order;
9. verifies generated OpenClaw prompt snapshots are current;
10. builds the patched OpenClaw source;
11. executes every mapped OpenClaw regression with explicit Vitest
    configuration and bounded workers; and
12. executes candidate tests that need both the Puddles harness and patched
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

## Resumable release

After local validation, the retained review, and remote checks are green, the
implementation worker returns one exact immutable candidate to the parent
orchestrator, then stops and waits. The parent alone creates one distinct
sibling validation and deployment worker. That worker owns only the scripted
composition, packaging, deployment, production validation, and landing:

```bash
packages/e2e/bin/openclaw-release.sh \
    --node /absolute/path/to/supported-node \
    --private-pipeline /absolute/path/to/private-pipeline \
    -- run \
    --run-dir /absolute/path/to/external-run-directory \
    --source /absolute/path/to/clean-openclaw-checkout \
    --public-repository owner/repository \
    --private-repository owner/private-repository \
    --public-head <40-character-public-head> \
    --expected-private-head <40-character-private-head> \
    --pr-number <number> \
    --expected-base-head <40-character-base-head> \
    --target-host <user@host>
```

Pass this as an argument array, with environment values supplied separately.
Do not copy a shell string that prepends `PATH` or embeds environment
assignments. The launcher validates both executable paths, safely prepends the
selected Node directory to the inherited path, and invokes the release runner
without evaluating shell text.

The implementation handoff includes the repository and pull request, exact head
and base, required checks, private head and manifest inputs, release command and
input paths, an argv array and separate environment map, and rollback
prerequisites. The implementation worker does not promote or create the release
worker.

The validation and deployment worker must not edit files, update pins, commit,
push, resolve conflicts, make design decisions, invoke review, or create
workers. A failed stage ends its run after durable rollback and a structured
report to the parent orchestrator. It must not fix the failure or retry with
changed inputs. The parent routes the evidence to the same implementation
worker. That worker owns the fix, reruns affected local gates and the retained
review, and returns a new exact head and new run to the parent. Never resume an
older run with a changed public or private pin. A completed stage is reusable
only when its recorded input and output hashes still match.

The run directory must be outside the candidate. It contains atomic stage
records, the public receipt, sanitized private receipt evidence, the immutable
package, deployment evidence, read-only production evidence, and landing
evidence. Raw private receipts stay in a sibling private receipt directory so
the public run contains only opaque digests and repository or head identifiers.
Resume revalidates each stage's arguments, input hashes, and output hashes. It
does not trust marker files. The post-deploy check merges the exact private head
and then the exact public head while deployment rollback is still active. It
reconciles each pull request and default branch after an ambiguous merge
response. The durable landing stage records those already verified results
without issuing another merge. The target receipt carries the public and
private pins, candidate and production-stage digests, artifact digest, and
landing result. A resume can reconstruct a missing local production receipt
from that target evidence only after rechecking production health and both
landed heads.

Local deployment is allowed only when the current process can identify its host
and user, read the gateway service definition, and confirm that launchd has the
service loaded. Workstation releases must pass `--target-host` explicitly.
Remote connections use bounded fresh attempts and keepalives with multiplexing
disabled, so a stale socket from an older release cannot be reused. Target
commands use an explicit path that includes the supported Node installation and
the user-scoped npm executable directory.

If the release framework itself needs a repair after immutable candidate stages
have passed, resume the same run with `--release-tooling-head <sha>`. The repair
commit must descend from the pinned public head and may change only the release
scripts, focused release tests, and their direct documentation. The runner
revalidates every preserved receipt against its original recorded producer
arguments and output hashes, then records the repair head and script digests in
the deployment stage without recomputing the candidate or artifact. The repair
attempt uses commit-suffixed deployment receipt and stage paths, so evidence
from the original failed attempt remains unchanged.

Combined validation must retain a production-ready tree beside its raw receipt
at `<validation-receipt>.stage` and declare that absolute path plus its
`puddles-directory-v1` SHA-256 as `candidate.productionStage`. The orchestrator
independently hashes the complete directory before and after `pnpm pack`.
Packaging does not install dependencies or rebuild, so the archive comes only
from the retained tree that passed combined validation.

The private executable receives only the documented `apply` and `validate`
commands. Private code and credentials never enter the public candidate or
repository. It must come from a clean Git checkout whose origin, head, and tree
match the pinned private repository and reviewed commit. The runner records the
tree and rechecks the checkout before each private command. The public run
directory may record only opaque private hashes and repository or head
identifiers.

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
- recording Todoist task writes and denying unsupported Todoist operations;
- Gmail Keychain, refresh concurrency, timeout, and MCP error translation;
- Gmail immutable release promotion, config recovery, and read-only smoke rollback;
- manifest completeness and pinned-source enforcement;
- OpenClaw explanation audience, context, and bounded-depth contracts;
- reusable adversarial-review worker, material-finding threshold, anti-churn,
  worker-owned completion, and clear requester-help escalation contracts; and
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
