# Skip minor adversarial-review findings

- **Status:** Ready for landing-candidate commit
- **Issue:** https://github.com/coletaylor788/puddles/issues/62
- **Last updated:** 2026-07-30

## Human design

### Problem

The adversarial-review policy already requires material impact and excludes some
non-actionable feedback, but it does not explicitly suppress all minor or
low-severity findings. Reviewers can therefore promote wording, style, optional
hardening, or low-impact proof gaps into actionable remediation work.

### Outcome

Adversarial reviewers report only concrete, actionable, high-confidence defects
with material impact. Minor and low-severity concerns are omitted from findings,
while material correctness, safety, security, requirement, lifecycle, and
regression defects remain reportable across code, documentation, tests, and
configuration. Residual validation gaps may be recorded without turning minor
gaps into remediation-loop findings.

### Approach

Clarify the canonical adversarial-review skill at its finding threshold, review
scope, and output contract. Extend the existing cumulative review-workflow
contract regression so it requires explicit minor-finding suppression, preserves
material cross-artifact review, and distinguishes residual validation notes from
actionable findings. Bump the skill's contract version and update the cumulative
coverage description.

### Safety and rollout

This is a provider-neutral instruction and contract-test change with no runtime
deployment or production-state mutation. The focused contract test, complete
managed integration lifecycle, and independent complete-diff reviews are green.
One final complete-current-diff check after this state update and the terminal
exact-candidate review remain before landing. Rollback is a revert of the skill,
regression, coverage documentation, and plan changes together.

## Agent details

### State

Implementation and local validation are complete. The adversarial-review skill
is now version 1.3.0, and the existing `review-workflow.test.ts` cumulative
contract test covers the expanded materiality and suppression policy. Focused
validation, the complete managed lifecycle, and initial independent review pass.
The replacement complete-current-diff re-check is also clean. This synchronized
plan is the last in-diff bookkeeping change before one final complete-diff check,
the landing-candidate commit, and terminal review.

### Scope and acceptance criteria

- Explicitly suppress minor and low-severity findings.
- Name style, wording, optional hardening, and low-impact proof gaps as
  non-actionable examples.
- Preserve findings for material correctness, safety, security, requirement,
  lifecycle, and regression defects.
- Preserve material findings in documentation, tests, and configuration as well
  as implementation code.
- Allow residual validation gaps to be recorded without promoting minor gaps
  into actionable remediation-loop findings.
- Update the existing cumulative contract test so regression of any threshold
  requirement fails.
- Keep all wording provider-neutral and avoid unrelated workflow changes.
- Pass focused validation and
  `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Complete clean reusable-worker and terminal exact-candidate adversarial review,
  remote checks, merge, and default-branch verification.

### Architecture and decisions

- `.github/skills/adversarial-review/SKILL.md` remains the sole owner of reviewer
  scope and finding-output policy.
- `packages/e2e/tests/review-workflow.test.ts` remains the cumulative regression
  owner; no disconnected one-off test will be added.
- `.github/skills/safe-feature-development/SKILL.md` already limits remediation
  to material defects and requires triage, so this change does not duplicate the
  reviewer threshold there.
- The adversarial-review skill version will receive a minor contract bump from
  1.2.0 to 1.3.0.
- `packages/e2e/README.md` will describe the expanded cumulative contract.
- Historical plans remain unchanged.

### Implementation

1. Bumped adversarial-review from 1.2.0 to 1.3.0 and made minor or low-severity
   concerns explicitly non-findings.
2. Named style, wording, optional hardening, and low-impact proof gaps as
   suppressed feedback while retaining useful residual validation notes outside
   the remediation loop.
3. Preserved material review across correctness, safety, security, requirements,
   lifecycle, and regression risk in code, documentation, tests, and
   configuration.
4. Extended the existing cumulative review-workflow regression and updated its
   coverage description.
5. Validate, independently review, create the exact landing candidate, and land
   it through the repository lifecycle.

### Validation

Completed:

- `corepack pnpm --filter e2e exec vitest run tests/review-workflow.test.ts`
  passed with 4 tests.
- `corepack pnpm --filter e2e lint` passed.
- `git diff --check` passed.
- `node packages/e2e/bin/openclaw-test-env.mjs ci` passed, including build and
  lint, 289 isolated workspace tests, 470 patched-source tests, and 1 candidate
  test. The disposable source worktree was removed and pruned.

Remaining:

- Final complete-diff check after this state update and terminal exact-candidate
  review.
- Required remote checks and post-merge default-branch verification.

### Rollout and rollback

No configured production deployment applies because no runtime artifact changes.
The policy takes effect when the updated skill lands on the default branch.
Rollback is a single revert of the merged pull request, followed by the focused
contract test and managed lifecycle if rollback is required.

### Review log

The initial independent complete-diff review found no actionable,
high-confidence material findings and independently reran the focused contract
test and diff check successfully. It recorded one residual limitation: the
regression verifies the written contract, while runtime compliance still depends
on the executing reviewer. The completed worker could not be resumed through the
available review interface, so the documented replacement fallback re-checked
the complete synchronized diff and also found no material findings while
independently confirming 4 focused tests and the diff check. One final
complete-current-diff check will cover this state update before the candidate is
frozen; a separate fresh reviewer will then inspect the exact landing commit.

### Checklist

- [x] Read current default-branch repository and skill instructions.
- [x] Identify the cumulative regression owner and validation lifecycle.
- [x] Create the repository plan as the first implementation artifact.
- [x] Create and link the concise tracking issue ledger.
- [x] Implement the skill, cumulative regression, and coverage documentation.
- [x] Run focused validation and the complete managed lifecycle.
- [x] Complete independent full-diff review with no material findings.
- [x] Finalize in-diff bookkeeping for the complete-current-diff re-check.
- [x] Complete the replacement full-diff re-check with no material findings.
- [x] Finalize all in-diff bookkeeping.
- [ ] Complete the final full-diff check and create the landing candidate.
- [ ] Complete terminal exact-candidate review.
- [ ] Push, open a non-draft pull request, and pass required remote checks.
- [ ] Merge and verify the default-branch result.
