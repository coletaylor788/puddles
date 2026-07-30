# Todoist CLI issue filing

**Status:** Landed; awaiting final live validation
**Issue:** [#40](https://github.com/coletaylor788/puddles/issues/40)
**Last updated:** 2026-07-29

## Human design

### Problem

Puddles lacked a repository-managed Todoist CLI capability, so Cole had to
retype requests before the existing task monitor could create actionable
repository issues. The original handoff also exposed a process gap: an unclear
request for help did not explain the blocker, why worker action was exhausted,
or the exact decision needed.

### Outcome

The trusted main agent can create detailed `agent`-labeled Todoist tasks that
the existing monitor routes into the repository workflow. Safe feature
development 1.6.0 requires every requester-help escalation to clearly state the
blocker, evidence and attempts, why requester input is necessary, the exact
action or decision needed, and what happens after the answer.

### Approach

The landed change provides a locked Todoist CLI sandbox image, source-managed
skill, transactional installer and rollback, setup documentation, isolated
recording regressions, and the clear-help lifecycle contract. Repository work is
complete. Final validation is the documented live operator install on the
trusted main agent followed by read-only authentication and one explicit
user-requested task-creation check.

### Safety and rollout

Todoist content remains untrusted data and credentials remain in
`~/.openclaw/.env`, outside the repository and agent workspace. Automated tests
never authenticate or write to live services. The installer records recovery
state before mutation and rolls back config, skill, and sandbox changes on
failure. Cole's remaining action is live environment validation, not repository
review or merge work.

## Agent details

### State

Pull request #42 merged exact terminal-reviewed candidate
`a4d934d2ed53fc6b8891cc5d7fd114acf69a3226` as merge commit
`67d8b2abbda1f19708278eb17bbd3980a993f068`. All post-merge CodeQL,
cumulative integration, and dependency checks passed. `origin/main` contains
the Todoist skill, installer, image lock, documentation, regressions, and safe
feature development 1.6.0. Repository work is complete; final live validation
requires access to Cole's Todoist token and configured main-agent runtime.

### Scope and acceptance criteria

- The trusted main-agent sandbox contains pinned `td` CLI version 3.0.5.
- The source-managed skill treats Todoist output as untrusted, performs only
  explicit mutations, creates detailed `agent`-labeled tasks, and leaves GitHub
  issue creation to the monitor.
- The installer requires daemon-readable trusted token configuration, refuses
  unacknowledged non-main agents, preserves user-authored skills, validates the
  candidate before mutation, and provides deterministic rollback.
- Setup documentation explains credential boundaries, install, read-only
  verification, task filing, upgrade, and rollback.
- Shared integration coverage records Todoist writes and denies unsupported
  operations without contacting live Todoist or GitHub.
- Safe feature development requires concise, self-contained, evidence-based
  help requests that identify exactly what is needed and why, while prohibiting
  routine worker-owned handoffs.
- The exact reviewed candidate is merged, default-branch artifacts and
  post-merge checks are verified, and only live operator validation remains.

### Architecture and decisions

- Node 24.18.0 is digest-pinned and `@doist/todoist-cli` 3.0.5 plus transitive
  dependencies are npm-lockfile pinned in an overlay on the existing OpenClaw
  sandbox base.
- `TODOIST_API_TOKEN` must exist in OpenClaw's trusted global state `.env`; a
  shell-only export fails before build or mutation. The selected sandbox can
  inspect its credential, so installation defaults to the trusted main agent.
- Recovery state stores no credential. Candidate build and `td --version` smoke
  happen before OpenClaw mutation; failure restores prior config and skill
  state and recreates the prior sandbox.
- The Todoist skill creates tasks only. The existing monitor remains the
  authority for issue deduplication, plans, routing, and lifecycle labels.
- Safe feature development 1.6.0 defines the clear-help contract in canonical
  workflow guidance, and the shared review-workflow regression asserts every
  required field and prohibition.
- No automatic production deployment exists for this local capability. The
  repository is landed; live installation is an explicit operator validation.

### Implementation

- Added `openclaw-skills/todoist-cli/SKILL.md`.
- Added the locked image under `scripts/mac-mini/todoist-cli/`.
- Added `scripts/mac-mini/install-openclaw-todoist-cli.sh` with dry-run,
  candidate-first mutation ordering, recovery, rollback, and no-clobber
  behavior.
- Added `docs/openclaw-setup/05-todoist-cli.md` and linked it from the guide
  index.
- Added the Todoist recording mock and installer/write integration tests.
- Advanced `.github/skills/safe-feature-development/SKILL.md` to 1.6.0 with the
  clear requester-help contract.
- Expanded the shared workflow regression and coverage index.
- Integrated current `main`, completed all local and remote gates, merged PR
  #42, and verified the default branch.

### Validation

Completed:

- installer and recording-mock syntax checks;
- 19 focused review-workflow, Todoist installer, and write-sink tests;
- E2E TypeScript lint and diff checks;
- locked image build and `td --version` 3.0.5 smoke;
- repeated `node packages/e2e/bin/openclaw-test-env.mjs ci` runs, including the
  final integrated result: workspace build/lint, 112 mcp-hooks tests, 64 e2e
  tests, 61 calendar tests, 43 Gmail tests, 319 mapped OpenClaw tests, one
  candidate test, and cleanup;
- clean complete-diff review and clean terminal review of exact candidate
  `a4d934d2ed53fc6b8891cc5d7fd114acf69a3226`;
- all required remote checks and clean mergeability before merge;
- merged-candidate ancestry and expected artifacts on `origin/main`;
- successful post-merge CodeQL, cumulative integration, and dependency checks
  on merge commit `67d8b2abbda1f19708278eb17bbd3980a993f068`.

Not automated by design:

- daemon-time token interpolation in the configured main sandbox;
- authenticated `td auth status`;
- creation of a real Todoist task.

Those checks require the operator's local credential and explicit request, and
must not be exercised by repository automation.

### Rollout and rollback

Follow `docs/openclaw-setup/05-todoist-cli.md`: place the Todoist token in
`~/.openclaw/.env`, run the installer dry-run and install commands, then verify
the main-agent image and skill path without printing env configuration. Run
`td auth status --json --no-spinner` as the read-only authentication check.
After that succeeds, explicitly ask the main agent to file one low-risk test
task in the intended project with the `agent` label and confirm the monitor
creates exactly one issue. If installation or recreation fails, the installer
restores prior state. Use its `rollback` action to remove the capability; remove
the token separately only after confirming no other integration uses it.

### Review log

Independent review covered the full implementation repeatedly. It found and the
implementation fixed a shell-only token success-shaped failure. A transient
1 ms candidate-suite timing assertion passed on unchanged rerun without
weakening CI. Reopened review of the clear-help contract was clean; its two
residual unasserted lines were added to the regression, validation was repeated,
and replacement complete-diff review returned clean. Fresh terminal review of
the exact landing candidate returned clean. Remote and post-merge gates passed.

### Checklist

- [x] Implement and document the Todoist CLI capability.
- [x] Add isolated focused and cumulative regressions.
- [x] Add safe feature development 1.6.0 clear-help guidance and regression.
- [x] Pass focused, full managed, review, terminal, and remote gates.
- [x] Merge exact candidate and verify `main` plus post-merge checks.
- [x] Normalize the landed plan and issue ledger.
- [ ] Complete the documented live install and read-only authentication check.
- [ ] File one explicit low-risk task and confirm single-issue routing.
- [ ] Cole validates the live result and decides whether to complete the
  external Todoist task.
