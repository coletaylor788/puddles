# Todoist CLI issue filing

**Status:** Ready for terminal review
**Issue:** [#40](https://github.com/coletaylor788/puddles/issues/40)
**Last updated:** 2026-07-28

## Human design

### Problem

Puddles' sandbox did not contain Todoist's `td` CLI or instructions for using
it. Cole therefore had to retype requests into Todoist before the existing
agent-task monitor could turn them into repository issues.

### Outcome

The trusted main agent can create well-formed tasks in a chosen Todoist project,
including the `agent` label that routes actionable work to the existing issue
worker. The capability is reproducible from this repository, while worker
agents remain unable to access Todoist credentials.

### Approach

A repository-managed OpenClaw skill defines safe Todoist task creation, and a
custom main-agent sandbox image layers a locked official Todoist CLI onto the
existing sandbox base. A transactional installer builds and smoke-tests the
image, installs the skill without clobbering user content, configures only the
selected agent, and recreates its sandbox. The task-to-issue recipe creates one
concise task with a detailed description and the `agent` label; the existing
monitor remains responsible for GitHub issue creation.

### Safety and rollout

Todoist task fields and command output are untrusted data, never instructions.
The token must exist in OpenClaw's trusted global state `.env`; a shell-only
export is rejected because it would not guarantee daemon-time substitution of
the uncommitted `${TODOIST_API_TOKEN}` reference. The token is exposed only to
the selected sandbox. Because that sandbox and Docker metadata can access it,
the installer refuses non-main agents by default and documentation requires a
trusted agent boundary. Automated tests use a deny-by-default recording CLI and
never contact Todoist or GitHub. No automatic production promotion path exists,
so production installation remains an explicit operator action; fixture tests
prove install failure recovery and rollback.

## Agent details

### State

Implementation and full managed validation are complete. The accepted low-risk
review gap is remediated: the installer rejects a token exported only in its
shell because that cannot guarantee that the OpenClaw daemon can resolve the
stored reference. Focused and complete managed validation are green after the
change, and complete-current-diff adversarial re-review is clean. The finalized
diff is ready to commit for terminal exact-commit review. The live OpenClaw
agent and Todoist account have not been mutated.

### Scope and acceptance criteria

- A provider-neutral OpenClaw skill teaches the selected trusted agent to use
  `td`, treat Todoist content as untrusted, and create actionable
  `agent`-labeled tasks only on explicit user request.
- A custom sandbox image uses Node 24.18.0 pinned by multi-platform digest and
  `@doist/todoist-cli` 3.0.5 pinned through an npm lockfile and verified at
  build time.
- The idempotent installer requires daemon-readable trusted token
  configuration, discovers the selected agent, builds and smoke-tests before
  mutation, preserves user-authored skills, records recovery state, applies the
  image and token reference, recreates the sandbox, and rolls back partial
  failures.
- Explicit rollback restores the prior agent config and removes only the
  marked managed skill without deleting unrelated content.
- Real credentials, account data, GitHub credentials, and live writes remain
  outside the repository and test suite.
- Focused installer and contract coverage plus a Todoist recording double are
  part of the cumulative integration pool.
- Documentation covers prerequisites, authentication, task-to-issue usage,
  verification, exposure boundaries, upgrade, and rollback.

### Architecture and decisions

- `scripts/mac-mini/todoist-cli/Dockerfile` copies a locked Node/CLI stage into
  the configured OpenClaw sandbox base. This preserves the base image's tools
  and contract rather than replacing it.
- `scripts/mac-mini/todoist-cli/package-lock.json` locks the official CLI and
  all transitive npm dependencies; image builds use `npm ci --ignore-scripts`.
- `openclaw-skills/todoist-cli/SKILL.md` lives in source control and is copied
  atomically into the selected workspace with `.puddles-managed`. An existing
  unmarked directory fails closed. The skill omits host-binary gating because
  `td` intentionally exists only inside the sandbox.
- `scripts/mac-mini/install-openclaw-todoist-cli.sh` resolves the agent index
  from `agents.list`, defaults only `main` to the standard workspace, and
  requires explicit acknowledgement for any non-main agent.
- `~/.openclaw/.env` is the required trusted local source for
  `TODOIST_API_TOKEN`. A value exported only to the installer shell is
  insufficient because the separately running daemon may not inherit it.
  OpenClaw keeps `${TODOIST_API_TOKEN}` in configuration and resolves it into
  the selected sandbox. OAuth login inside the sandbox is prohibited because
  Linux keyring fallback can persist plaintext credentials in the workspace.
- Recovery state stores no credential. It records the prior per-agent image,
  selected index/workspace, and installed image before config mutation.
  Candidate build and `td --version` run before recovery or OpenClaw changes.
- The selected sandbox can inspect its own credential, which is inherent in
  granting arbitrary `exec` access to an authenticated CLI. Todoist access is
  therefore limited to the trusted main agent; untrusted-input and shared
  agents remain out of scope.
- The workflow files Todoist tasks, not GitHub issues directly. The existing
  monitor remains the single authority for deduplication, issue creation,
  planning, routing, and lifecycle labels.
- No OpenClaw source patch or production auto-deployment is needed. The
  repository supplies a controlled operator installer and deterministic
  rollback.

### Implementation

- Added the source-managed Todoist skill with explicit-mutation, untrusted-data,
  credential, response-validation, and issue-worker handoff rules.
- Added the image overlay, exact package manifest, and generated npm lockfile.
- Added the install/rollback script with trusted global token validation,
  dry-run, main-agent default denial, agent/workspace discovery,
  candidate-first ordering, no-clobber skill installation, durable recovery,
  failure rollback, and explicit uninstall.
- Tightened trusted token validation after review so an installer-shell export
  cannot create a success-shaped configuration that the daemon cannot resolve.
- Added `docs/openclaw-setup/05-todoist-cli.md` and linked it from the setup
  guide index.
- Added `packages/e2e/mocks/todoist-mock.mjs`, expanded shared write-sink
  coverage, and added focused installer/image/skill tests.

### Validation

Completed:

- `bash -n scripts/mac-mini/install-openclaw-todoist-cli.sh`.
- `node --check packages/e2e/mocks/todoist-mock.mjs`.
- `corepack pnpm --filter e2e exec vitest run
  tests/todoist-cli.test.ts tests/writes.test.ts`: 16 tests passed.
- `corepack pnpm --filter e2e lint`.
- Built the actual locked Docker image from the configured local
  `openclaw-sandbox:bookworm-slim` base and verified
  `docker run --rm --entrypoint td <candidate> --version` returned `3.0.5`;
  the temporary tagged image was removed.
- `node packages/e2e/bin/openclaw-test-env.mjs ci`: workspace build and lint
  passed; package suites passed 112, 31, 61, and 43 tests; the isolated patched
  OpenClaw suite passed 298 tests; and the candidate browser suite passed one
  test. Managed cleanup removed the detached candidate worktree.
- After token-source remediation, repeated shell syntax validation and the 16
  focused tests, including explicit denial when only the installer process has
  `TODOIST_API_TOKEN`.
- After token-source remediation, repeated
  `node packages/e2e/bin/openclaw-test-env.mjs ci` with the same green
  workspace, package, patched OpenClaw, candidate, and cleanup results.

Pending:

- Terminal exact-commit adversarial review.

Automated validation makes no authenticated Todoist request or live external
write. The independent reviewers separately checked the shipped CLI's command
flags, env-token behavior, OpenClaw env substitution and config addressing,
skill schema, Docker user contract, dependency lock, and rollback ordering.

Residual first-install checks are intentionally operator-facing rather than
automated live tests: confirm the returned Todoist JSON includes a URL, recreate
the real main sandbox and run a benign in-sandbox smoke, and verify daemon-time
env substitution without printing the credential.

### Rollout and rollback

There is no configured automatic promotion lifecycle for local sandbox
capabilities, so automated validation did not mutate the live agent. After
review, an operator may run the documented installer after placing the token in
the trusted global environment. The installer records prior state before
mutation and restores it plus prior managed skill content if configuration or
sandbox recreation fails. The rollback action restores that state, recreates
the sandbox, and leaves unrelated images, skills, agents, and credentials
untouched.

### Review log

The first independent adversarial reviewer examined the complete diff and
reported no high-confidence defects. After formatting-only cleanup, an
independent replacement again reviewed the complete diff and returned clean.
Both verified the official CLI command shape and authentication behavior
against version 3.0.5, OpenClaw config/env semantics, the skill contract,
sandbox runtime, dependency lock, and installer rollback ordering. The
replacement noted that accepting a shell-only token could produce an apparently
successful install when the separately running daemon lacked that environment.
Although classified as a low-risk validation gap, the concrete failure scenario
was accepted and remediated by requiring the trusted state `.env`; a regression
proves a shell-only export fails before image build or mutation. A replacement
reviewer then re-checked the complete remediated diff, independently verified
the npm artifact, CLI command surface, env-token behavior, rollback,
idempotency, and isolation, and returned clean. Terminal exact-commit review
remains pending.

### Checklist

- [x] Verify Todoist tracking comment and issue ledger.
- [x] Create the required synchronized plan artifact.
- [x] Complete architecture and trust-boundary research.
- [x] Select the design and synchronize the plan.
- [x] Implement image, installer, skill, documentation, and regressions.
- [x] Pass focused validation and an unauthenticated candidate image build.
- [x] Pass focused and shared managed validation after token-source remediation.
- [x] Complete current-diff adversarial re-check with no actionable findings.
- [x] Finalize all in-diff plan and implementation bookkeeping.
- [ ] Commit the final diff and pass terminal exact-commit review.
- [ ] Update the issue and Todoist task for review without completing the task.
