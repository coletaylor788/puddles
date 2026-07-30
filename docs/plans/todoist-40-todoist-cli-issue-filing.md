# Todoist CLI issue filing

**Status:** Ready for terminal review
**Issue:** [#40](https://github.com/coletaylor788/puddles/issues/40)
**Last updated:** 2026-07-29

## Human design

### Problem

Puddles lacked a repository-managed Todoist CLI capability, so Cole had to
retype requests before the existing task monitor could create actionable
repository issues. The implementation is complete, but its handoff exposed a
second process gap: an unclear request for help did not explain what was blocked,
why the worker could not resolve it, or what Cole needed to decide.

### Outcome

The trusted main agent can create detailed `agent`-labeled Todoist tasks that
the existing monitor routes into the repository workflow. The shared safe
feature workflow also requires every requester-help escalation to state the
blocker, relevant evidence and attempted resolution, why requester input is
necessary, the exact decision or action needed, and what happens next.

### Approach

Retain the locked Todoist CLI sandbox image, source-managed skill,
transactional installer, documentation, and isolated regressions. Integrate the
current `main` lifecycle, add the clear-help requirement to
`safe-feature-development`, add a cumulative regression for that contract, and
rerun the full validation and independent review lifecycle. Then merge the
remotely approved candidate and verify the landed default branch.

### Safety and rollout

Todoist content remains untrusted data, credentials remain in trusted local
state, and automated tests use deny-by-default recording doubles. Help requests
must be concise and actionable without exposing secrets or delegating routine
worker-owned work. No configured production promotion path exists for this
local sandbox capability, so automated validation does not mutate the live
agent. The worker merges only the exact reviewed, remotely green candidate and
returns the landed result to Cole for final validation.

## Agent details

### State

The Todoist implementation passed focused tests, real image smoke validation,
the full managed integration pool, multiple complete-diff reviews, remote
checks, and exact-commit terminal review. Pull request #42 remains open. Current
`main` is integrated, resolving the earlier landing ambiguity. The shared safe
feature workflow is advanced to 1.6.0 with Cole's requested clear-help
escalation contract, and the cumulative regression is implemented. Focused and
full managed validation pass. The first reopened review is clean; its only
residual coverage gap is closed by asserting the concise/self-contained preface
and the plan/issue-before-asking requirement. Focused and full validation pass
again. Because the completed reviewer cannot be resumed through the available
interface, a fresh replacement re-checked the complete current diff and returned
clean. In-diff bookkeeping is final; the exact landing candidate and terminal
review are next.

### Scope and acceptance criteria

- Keep the provider-neutral Todoist skill, locked CLI image, safe credential
  boundary, transactional install/rollback, documentation, and recording tests.
- Preserve task-to-issue ownership: the main agent files one detailed
  `agent`-labeled Todoist task; the existing monitor owns issue deduplication,
  planning, routing, and lifecycle labels.
- Update `safe-feature-development` so any request for human help clearly
  identifies:
  - the concrete blocker and relevant context;
  - what the worker already tried or verified;
  - why the worker cannot safely resolve it autonomously;
  - the exact decision, information, permission, or action requested; and
  - the consequence or next step after the answer.
- Explicitly prohibit vague status-shaped asks and delegation of routine
  worker-owned review, CI, merge, or landing work.
- Add a committed shared-pool regression for the help-request contract.
- Integrate current `main`, pass applicable focused and full managed validation,
  complete the reusable-review and terminal-review gates, pass remote checks,
  merge, and verify the default branch.

### Architecture and decisions

- Todoist CLI remains isolated to the trusted main-agent sandbox. Node 24.18.0
  is digest-pinned and `@doist/todoist-cli` 3.0.5 is npm-lockfile pinned.
- `TODOIST_API_TOKEN` must exist in OpenClaw's trusted global state `.env`; a
  shell-only export fails before build or mutation.
- The source-managed skill treats Todoist output as untrusted and stops after
  task creation rather than creating a duplicate GitHub issue.
- Installer recovery stores no credential, preserves unmarked user skills, and
  restores prior config and sandbox state on failure.
- The shared workflow version will advance from current-main 1.5.0 to 1.6.0.
  The help-request requirement belongs in ownership/checkpoint guidance and
  stopping/escalation behavior, with a contract assertion in
  `packages/e2e/tests/review-workflow.test.ts`.
- Current `main` is authoritative for landing: the worker owns normal review,
  checks, merge, and post-landing verification unless a concrete policy,
  permission, safety, or material-decision blocker requires requester input.

### Implementation

1. Merged current `origin/main` into the feature branch without conflicts or
   weakening current-main policy.
2. Updated `.github/skills/safe-feature-development/SKILL.md` to 1.6.0 with a
   clear, evidence-based help-request contract.
3. Extended the shared review-workflow regression to assert every required
   request element, prohibit vague status-shaped asks, and require continued
   investigation when the needed action cannot be stated clearly. After review,
   also asserted that requests are concise/self-contained and that the plan and
   issue ledger are updated before asking.
4. Updated the cumulative coverage index.
5. Rerun focused tests and
   `node packages/e2e/bin/openclaw-test-env.mjs ci`.
6. Re-run independent complete-diff review, finalize bookkeeping, create the
   exact landing candidate, and run fresh terminal review.
7. Push, resolve remote integration conditions, merge the exact approved
   candidate, verify `main`, and hand off only final live installation
   validation.

### Validation

Previously completed for the Todoist implementation:

- installer shell syntax and recording-mock syntax checks;
- 16 focused Todoist installer/write-sink tests;
- locked candidate image build and `td --version` 3.0.5 smoke;
- repeated full managed lifecycle with all package, patched OpenClaw, candidate,
  cleanup, CodeQL, and remote cumulative gates green;
- complete-diff and exact-commit adversarial reviews with no actionable
  findings.

Required for this reopened cycle:

- focused `review-workflow.test.ts` and Todoist tests: 19 tests passed;
- E2E TypeScript lint and `git diff --check`;
- `node packages/e2e/bin/openclaw-test-env.mjs ci`: workspace build and lint,
  112 mcp-hooks tests, 64 e2e tests, 61 calendar tests, 43 Gmail tests, 319
  mapped OpenClaw tests, one candidate test, and managed cleanup passed;
- after closing the residual contract-coverage gap, repeated the 19 focused
  tests, E2E lint, diff check, and complete managed lifecycle with identical
  green results;
- complete-current-diff adversarial review after integrating current `main`;
- fresh terminal review of the exact landing candidate;
- all required remote checks on that candidate;
- confirmation that the merged default branch contains the expected feature
  and workflow contract.

No automated validation may authenticate to Todoist, create a live task, or
mutate the configured OpenClaw agent.

### Rollout and rollback

There is no configured automatic production deployment for the local sandbox
capability. Merge is the repository landing step; live installation remains a
documented operator action after landing. The installer provides durable
recovery and explicit rollback. If remote state changes before merge, revalidate
the candidate against the current base. If landing cannot be confirmed, treat
it as failed and restart remote integration rather than reporting success.

### Review log

The original feature received multiple clean independent complete-diff reviews
and clean terminal reviews. Review identified and the implementation fixed a
shell-only token success-shaped failure. A transient 1 ms upstream timing
assertion passed on unchanged rerun without weakening CI. The prior vague
automatic-controller question is superseded by current-main worker ownership
and this explicit clear-help contract. Current `main` is integrated and the
contract plus regression are implemented. Focused and full managed validation
pass. The first reopened review found no actionable defects and identified two
unasserted contract lines as a residual gap; both are now covered and validation
is green. A fresh replacement complete-current-diff review returned clean.
Terminal review of the exact landing candidate remains before remote integration
and merge.

### Checklist

- [x] Verify Todoist tracking and issue ledger.
- [x] Implement and validate the Todoist CLI capability and regressions.
- [x] Complete the original review and remote integration gates.
- [x] Identify the vague-help process gap from Cole's follow-up.
- [x] Integrate current `main`.
- [x] Add the clear-help contract and shared regression.
- [x] Pass focused and full managed validation.
- [x] Complete replacement review of the final current diff.
- [ ] Finalize, commit, and terminal-review the exact landing candidate.
- [ ] Pass remote checks, merge, and verify the default branch.
- [ ] Hand off the landed result for Cole's final live validation.
