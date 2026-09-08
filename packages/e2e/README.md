# Native development and regression pool

The managed runner builds a pinned, patched OpenClaw and starts a separate real
gateway on the trusted host. There is no VM. Its writable configuration, state,
sessions, indexes, workspace, logs, ports, and processes are isolated. Host
dependencies are deliberately shared. This is not a security sandbox against
arbitrary shell commands or other ambient host access.

## Required cumulative gate

Every feature and fix contributes a committed regression. Run focused tests
while iterating, then run the entire accumulated pool on the final candidate:

```bash
OPENCLAW_SRC=/path/to/openclaw \
E2E_RUN_DIR=/path/outside/checkouts/native-run \
  node packages/e2e/bin/openclaw-test-env.mjs ci
```

Use a Node version supported by the pinned upstream package. Puddles and
OpenClaw each use their own committed package-manager version through Corepack.
Preflight checks the source pin, toolchain, and host capacity before costly
work. CI uses public source only and never needs live account credentials.

The gate runs every workspace build, lint, and test, the isolated Gmail Python
pool, every mapped OpenClaw patch regression, and the cross-component candidate
tests. It then packages the built runtime with its installed production
dependencies, using upstream's npm package file selection with lifecycle hooks
disabled. This includes bundled skills and normal workspace bootstrap assets.
It installs that archive offline in a fresh prefix and executes all
committed native scenarios. A missing test, runtime, dependency, recorder,
scenario, or selected required health prerequisite is a failure, not a skip.

`openclaw-patch-suite.json` retains the cumulative patch order, test targets, and
explicit upstream Vitest projects. New patches must register every added test.
Do not replace earlier regressions with only the newest feature's targets.

## Focused iteration and recovery

```bash
corepack pnpm --filter e2e exec vitest run tests/native-loop.test.ts

# Build, package, install, and rehearse. This is not the full accumulated gate.
OPENCLAW_SRC=/path/to/openclaw E2E_RUN_DIR=/path/to/native-run \
  node packages/e2e/bin/openclaw-test-env.mjs native

# Reuse an installed candidate while changing scenario fixtures.
OPENCLAW_CANDIDATE_DIR=/path/to/native-run/installed/runtime \
  node packages/e2e/bin/openclaw-test-env.mjs scenarios
```

The external run directory holds concise stage records, protected logs, a
detached source worktree, build outputs, artifact digests, and installation
evidence. Reuse the same directory to resume. Successful stages are reused only
when their inputs and outputs match. Source, tests, environment, toolchain,
build options, and artifact changes invalidate affected proofs. Package repairs
rerun installation and runtime rehearsal without rebuilding unchanged source.
Packaging binds the installed dependency bytes, not only the lockfile. Regression
proofs bind the effective environment, selected Python interpreter and installed
test dependencies. Environment values are hashed, not written into receipts.
Local stage records retain the input identities used to compute each proof key.
Runtime evidence includes resolved installed commands, resolved scenarios, and
the fixture environment, not only extension module bytes.
The owner fixes failures with committed regressions and resumes the same run.

The run lock prevents concurrent mutation. If the owner was killed, inspect its
recorded PID and confirm its process group is gone before removing only the
run's `lock` directory. Keep failed fixture diagnostics locally. Do not upload
local extension logs or configuration. Remove retained worktrees with
`git worktree remove --force /path/to/native-run/source` only after their
evidence is no longer needed; remove only that run's named artifact directories.

## Writing native scenarios

`scenarios/imessage.mjs` is the committed pool. The fixture uses the real
installed iMessage channel and its JSON-RPC transport. Incoming messages are
appended to a fixture queue after a real `watch.subscribe`. The bridge emits
protocol notifications, the gateway calls a local scripted model, and outbound
messages go to a recorder instead of Messages.app.

Every scenario declares its incoming events, model responses, and expected
outbound replies. Tool scenarios declare explicit recording adapters. The
fixture registers those tools through the supported OpenClaw plugin interface,
including the manifest's tool contracts. Read adapters return only declared
synthetic results. Write adapters record only declared operations. A missing
adapter or unknown operation fails. There is no fallback to a real tool.

Never write tests that deliver real messages, mutate accounts, or drive the
configured production agent. Every external mutation path must use a recording
adapter, including message delivery, calendar, contacts, notes, email changes,
task writes, and browser actions. Add the adapter before enabling the path.
Do not claim these fixtures prevent an arbitrary shell command from bypassing
them on the trusted host. Test authors are responsible for using the fixture
interfaces rather than host mutation commands.

The public pool covers ordinary conversation, conversation history, split
message parts, tool writes, deterministic tool reads, model errors, no-output
responses, and fresh-state replay isolation. Each scenario checks request and
delivery counts, response content, and a quiet tail for duplicate delivery.
Normal workspace bootstrap runs in every scenario. The ordinary conversation
also checks bundled skill discovery through the installed CLI.
Cleanup stops only the fixture process group and removes its successful state.

## Optional local extension

Public development works independently. A caller may explicitly set
`E2E_LOCAL_EXTENSION` to an absolute local `.mjs` file. It exports a default
object with `schemaVersion: 1`, `inputs`, `commands`, `scenarios`, and
`healthChecks`. Nothing in public CI discovers or fetches that module.

`inputs` lists absolute files whose bytes key extension evidence. Each command
declares `id`, `phase` (`prepare`, `gate`, `package`, or `installed`), `command`, `args`,
optional selected `env`, and a positive `timeoutMs` no greater than 30 minutes.
Prepare runs before build and all regressions. Gate runs after the public
accumulated regressions. Package runs after build and before sealing in both
`ci` and focused `native` runs. Use it to prepare auxiliary artifacts, never
build during installed rehearsal. Installed runs after offline installation and before
scenario startup. Source remains available, but installed artifact bytes must
not change. Install other managed packages under isolated state instead.

Commands may declare `outputs`, a list of paths relative to the isolated root.
Declare concrete artifact files or narrow directories. The runner records their
bytes in the stage proof and reruns the producing phase if any output is missing
or changed. Do not declare broad workspace trees containing unrelated caches.
Preparation has its own input identity, separate from later command phases.
Its declared outputs and prepared source bytes are checked on resume, even when
it declares no outputs. A rerun receives clean detached source, so transactional
patch application need not be idempotent. If it produces the same source bytes,
the existing dependencies and build are retained. Use the supplied `sourceDir`;
its temporary preparation path is not a stable output location. Declare all
helper inputs that can affect commands. Global inputs conservatively apply to
every phase.

Commands receive `E2E_CONTEXT_PATH`, a local JSON file with `schemaVersion`,
`root`, `isolationRoot`, `home`, `stateDir`, `configPath`, `workspace`,
`recordingsDir`, `sourceDir`, and, once available, `installedDir` and
`artifact`. The artifact has `path`, `sha256`, `runtimeSha256`, `platform`,
`arch`, and `node`. Prepare, gate, and package use the source directory as cwd. Installed
uses the isolated workspace. The runner selects environment values explicitly
and does not inherit the user's runtime configuration or provider credentials.
Local hooks can initialize a channels-disabled config under the isolated root.

Additional scenarios use the same declarative schema as the public pool. Each
receives a fresh gateway context; installed-hook state is not silently copied
into scenarios. Extension output stays in protected local logs, not public
console summaries, artifacts, or CI.

## Opt-in live read-only health

Deterministic read fixtures and live read-only health checks serve different
purposes. Fixtures support content assertions. Host health checks only establish
basic availability, authentication, and protocol compatibility. They never
assert or log personal content, and never perform writes or message delivery.

```bash
E2E_LOCAL_EXTENSION=/absolute/local/checks.mjs \
  node packages/e2e/bin/openclaw-test-env.mjs host-health
```

Each selected check uses the same bounded command shape, plus `required`.
Its only stdout result is JSON with boolean `available`, `authenticated`, and
`protocol` fields. Results are reduced to booleans. No stdout or stderr payload
is logged. Required checks default to required and fail on unavailable
prerequisites, malformed output, nonzero exit, or timeout. No selected checks
is an error. Public default CI does not run this host gate.

## Delivery

The approved Markdown design and its issue are the human checkpoint. An
engineering owner handles focused iteration, one retained independent review,
the final accumulated gate, package rehearsal, exact source integration, and
activation. A parent may split ownership without duplicating those stages.

Integrate eligible exact source before starting the live rollback transaction.
Activation uses the rehearsed archive and the existing runtime clone mechanism.
It never builds, fetches dependencies, or merges a pull request while the
gateway is stopped. See the [deployment guide](../../docs/openclaw-setup/patches/README.md)
for explicit target configuration and recovery.
