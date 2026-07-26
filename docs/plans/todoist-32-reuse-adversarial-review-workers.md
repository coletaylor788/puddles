# Reuse adversarial review workers

- **Status:** Ready for terminal review
- **Issue:** https://github.com/coletaylor788/puddles/issues/32
- **Last updated:** 2026-07-25

## Human design

### Problem

The feature workflow starts a new adversarial reviewer after every remediation
round and tells implementers to resolve every high-confidence finding without
an explicit triage or disagreement path. Reviews can rebuild context, repeat
resolved concerns, or manufacture marginal findings, causing long feedback loops
without improving the change.

### Outcome

One independent adversarial review worker remains responsible for a feature
review through remediation. After each change, the implementation agent resumes
that worker with a concise description of what changed and asks it to re-check
the full current diff. Reviewers report only substantiated, actionable defects;
a clean review is a valid result. Implementers exercise engineering judgment,
push back on unsupported feedback, and converge with the reviewer on significant
disagreements instead of blindly changing code or cycling indefinitely. A final
fresh independent review still covers the exact handoff commit.

### Approach

The shared feature-development instructions now launch one fresh independent
reviewer, retain its worker handle, and resume or restart that same worker after
fixes. Each follow-up message identifies resolved findings, changed areas, and
validation results, then requests a complete-current-diff re-check. The
implementation agent triages findings, fixes sound defects, and sends evidence
and rationale back to the same reviewer when significant feedback is disputed.
The reviewer verifies real failure scenarios, treats no findings as normal, and
does not revive resolved concerns without new evidence or regression. If a
material disagreement cannot converge through focused exchange, the workflow
records or escalates it rather than looping. A replacement worker is allowed
only when the original failed or cannot be resumed, and the terminal exact-
commit review remains fresh and separate.

### Safety and rollout

This changes workflow documentation and its isolated contract regression, not
runtime services or production state. Focused validation and the repeated
cumulative integration pool are green, and complete-diff review found no
actionable defects. One terminal review of the exact handoff commit remains.
Rollback is a revert of the instruction and regression-test changes.

## Agent details

### State

The complete reusable reviewer and anti-churn contract is implemented in both
skills and the cumulative regression. Focused validation and the managed
lifecycle pass on the expanded scope, and independent complete-diff review is
clean. In-diff bookkeeping is final for the terminal exact-commit review.

### Scope and acceptance criteria

- Update the canonical shared workflow instructions that govern adversarial
  review remediation.
- Launch one fresh independent reviewer for the initial audit and retain its
  worker handle.
- Require reuse of that reviewer for re-checks after fixes and later pre-terminal
  diff changes whenever the worker remains available.
- Require each resume message to summarize resolved findings, changed files or
  behavior, and validation, then request a full-current-diff re-check.
- Permit a fresh replacement only when the original reviewer fails or cannot be
  resumed.
- Preserve reviewer independence, full-diff scope, and a separate terminal fresh
  exact-commit review.
- Require reviewers to report only defects supported by a concrete failure
  scenario or direct evidence, and state that a clean review is acceptable.
- Require implementation agents to assess feedback rather than automatically
  apply every finding.
- For significant disagreement, require evidence-based pushback to the retained
  reviewer and focused convergence on whether to fix, revise, withdraw, or
  explicitly escalate the concern.
- Prevent endless loops by forbidding repetition without new evidence and by
  escalating unresolved material disagreement instead of cycling.
- Add a committed regression that fails if the workflow returns to fresh
  reviewers for every remediation round or loses the anti-churn contract.
- Keep provider-neutral public wording.

### Architecture and decisions

- `.github/skills/safe-feature-development/SKILL.md` owns orchestration. Its
  audit step retains and resumes one review worker, requires implementer triage,
  and defines evidence-based disagreement convergence with explicit
  replacement-only-on-unavailability semantics.
- `.github/skills/adversarial-review/SKILL.md` owns review scope. It will define
  how a resumed reviewer uses change summaries and previous findings while still
  auditing the complete current diff, and it will prohibit speculative or
  quota-like findings.
- `packages/e2e/tests/review-workflow.test.ts` locks both halves of the
  contract into the default cumulative package test discovery.
- Skill versions mark the behavior contract change; the in-progress versions
  remain 1.4.0 and 1.2.0 because the additions are part of the same release.
- Historical plans remain historical records and are not rewritten.
- Production deployment is inapplicable because no runtime artifact changes.

### Implementation

1. Bumped `safe-feature-development` to 1.4.0 and changed its audit loop to
   retain and resume one reviewer, pass a structured change summary, and replace
   the worker only when unavailable.
2. Bumped `adversarial-review` to 1.2.0 and required resumed reviews to verify
   prior corrections while re-checking the complete current diff.
3. Added `packages/e2e/tests/review-workflow.test.ts` and listed the contract in
   the E2E coverage documentation.
4. Added substantiated-finding, implementer-judgment,
   disagreement-convergence, and anti-loop requirements to both skills and the
   regression.
5. Reran focused validation and the managed lifecycle, then completed clean
   independent complete-diff review.
6. Freeze this plan and checklist, create the handoff commit, and record the
   terminal exact-commit review only in issue #32.

### Validation

Completed for the expanded contract:

- `corepack pnpm --filter e2e exec vitest run tests/review-workflow.test.ts`
  passed with 1 test.
- `corepack pnpm --filter e2e lint` passed.
- `git diff --check` passed.

- `node packages/e2e/bin/openclaw-test-env.mjs ci` passed on the expanded scope,
  including workspace build and lint, 238 isolated workspace tests, 289 patched
  OpenClaw tests, and 1 candidate test; its disposable worktree was removed and
  pruned.

Remaining:

- One fresh terminal independent review of the exact handoff commit.

### Rollout and rollback

No production deployment applies. The change takes effect when the updated
instructions are merged. If workers cannot be resumed in a particular agent
runtime, the documented fallback is a fresh replacement rather than skipping
review. Handoff is through a non-draft pull request after terminal exact-commit
review. Roll back by reverting the instruction and regression-test changes
together.

### Review log

The first independent review reported no actionable findings against the earlier
scope, then became stale when the anti-churn requirement was added. That worker
completed and could not be resumed through the available worker interface, so
the documented unavailable-worker fallback launched one replacement against the
complete expanded diff. The replacement review also reported no actionable
findings. Its residual gaps are inherent to a documentation contract: static
tests cannot force runtime agents to obey instructions, and the reviewer relied
on the already-completed managed lifecycle rather than rerunning it.

### Checklist

- [x] Verify the Todoist tracking comment and issue ledger.
- [x] Create the repository plan as the first artifact.
- [x] Complete repository research and synchronize the design.
- [x] Implement the complete instruction and regression-test changes.
- [x] Run focused validation after the expanded scope.
- [x] Rerun the cumulative integration pool after the expanded scope.
- [x] Complete clean independent review of the expanded diff.
- [x] Finalize in-diff bookkeeping for terminal exact-commit review.
