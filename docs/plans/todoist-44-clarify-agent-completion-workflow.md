# Clarify agent completion workflow

**Status:** Ready for terminal review
**Issue:** https://github.com/coletaylor788/puddles/issues/44
**Last updated:** 2026-07-29

## Human design

### Problem

The development lifecycle previously ended at a reviewed “handoff commit”
without assigning ownership for pull-request checks, review follow-up,
conflicts, merge, or post-landing verification. Recent fully validated and
mergeable changes therefore remained open for a requester to land, turning
routine agent-owned integration into a late human checkpoint.

### Outcome

An approved implementation request now carries workers through validation,
independent review, pull-request completion, landing, and post-landing
verification unless a controlling instruction explicitly limits those actions.
Workers pause for human input at design only when the requester explicitly asks
to review or iterate on the design. The normal return point is a landed result
for final requester validation and the requester’s task-completion decision.

### Approach

The always-on repository instructions define the ownership boundary. The safe
feature workflow prepares remote integration before promotion, promotes and
production-validates the exact remotely approved candidate, then rechecks that
same head immediately before autonomous landing. Terminal review protects a
landing candidate rather than a handoff commit. A shared-pool regression locks
the phase order, design checkpoint, remote gates, candidate identity, rollback,
merge, landed-state verification, and final requester-validation boundary.

### Safety and rollout

Workers still honor repository protections, permissions, explicit
stop-before-landing requests, unresolved material decisions, and every existing
validation and review gate. Remote CI, required review, conflicts, and
mergeability are resolved before promotion. The exact approved head is then
promoted and validated before merge; if its head or gates change, promotion is
rolled back before remediation. This process-only change has no runtime
deployment; rollback is a normal revert.

## Agent details

### State

The complete ownership and checkpoint policy, remote-before-promotion lifecycle,
landing rollback paths, regression, and coverage index are implemented.
Focused and full managed validation pass. Independent complete-diff review is
clean after all accepted findings were remediated. In-diff bookkeeping is final;
terminal exact-commit review and remote landing results belong only in the issue
ledger so they do not invalidate the reviewed candidate.

### Scope and acceptance criteria

- Make workers responsible for local and full managed validation, retained
  independent review, terminal review, PR checks, review feedback, conflicts,
  merge, and post-landing verification.
- State that an implementation request authorizes normal commit, push, PR, and
  merge actions unless a controlling instruction explicitly limits them.
- Pause before implementation only when the requester explicitly asks to review,
  approve, or iterate on design.
- Do not use “ready for review” as the normal terminal state for agent-owned
  work; reserve it for a deliberate stop-before-landing instruction or a
  concrete policy, permission, or material-decision blocker.
- Return landed results for requester validation and the requester’s external
  task-completion decision.
- Preserve repository protections, exact-candidate terminal review, remote
  checks, review-thread resolution, conflict handling, and revalidation after
  any candidate change.
- Keep public guidance provider-neutral and free of personal task details.
- Add a committed regression to the shared pool and pass focused plus full
  managed validation.

### Architecture and decisions

- `.github/copilot-instructions.md` carries the concise, always-on ownership
  boundary and explicit design-checkpoint exception.
- `.github/skills/safe-feature-development/SKILL.md` remains the canonical
  detailed lifecycle at version 1.5.0. Its Plan phase defines the only optional
  human checkpoint, its Audit phase protects an exact landing candidate,
  `Prepare remote integration` resolves remote gates before promotion, and
  `Land and close out` binds merge to the exact promoted head.
- `packages/e2e/tests/review-workflow.test.ts` locks the design checkpoint,
  authorization boundary, PR completion gates, anti-handoff rule, landing, and
  final requester-validation contract into existing default test discovery.
- `packages/e2e/README.md` names worker-owned completion in the cumulative
  coverage index.
- Historical plans remain historical evidence and are not rewritten.
- Existing safeguards remain authoritative: later candidate changes invalidate
  terminal review, protected-branch policy is not bypassed, and a material
  unresolved decision is surfaced rather than guessed.

### Implementation

1. Added repository-wide guidance that an approved implementation request
   authorizes normal commit, push, pull-request, merge, and verification actions.
2. Defined design as an explicit checkpoint only when the requester asks for it;
   routine pull-request review and merge are no longer requester handoffs.
3. Advanced the safe feature workflow to 1.5.0, changed terminal-review language
   from handoff to landing candidate, and added the full remote integration and
   closeout phase.
4. Required revalidation and re-review after any candidate change, merge only
   when the reviewed candidate is green and mergeable, default-branch
   verification, and final landed-result reporting.
5. Expanded the existing workflow regression and cumulative coverage index.
6. Tightened the closeout-specific external-completion assertion and reran
   focused and full managed validation.
7. The original reviewer completed and could not be resumed through the
   available worker interface, so a fresh independent replacement reviewed the
   complete corrected diff.
8. Added a closeout-scoped assertion that requires the candidate to be
   terminal-reviewed, remotely green, mergeable, and free of unresolved required
   review before merge, then reran focused and full managed validation.
9. The completed replacement reviewer also could not be resumed through the
   available worker interface, so a final independent replacement reviewed the
   complete latest diff.
10. Required every changed candidate to repeat applicable promotion and
    production validation before merge, bind completion to that same candidate,
    and added scoped regression assertions for candidate invalidation,
    authorization limits, permissions, and protections.
11. Focused and full managed validation passed. The fallback reviewer verified
    the four prior corrections and identified the remote-integration ordering
    defect.
12. Split remote preparation from landing: push and complete remote checks,
    review, conflict resolution, and mergeability before promotion; promote and
    production-validate that exact candidate; then verify the same remote head
    and merge it. Roll back promotion if the remote candidate or gates change
    before merge.
13. Added ordering, candidate-identity, and rollback regression assertions.
    Focused and full managed validation pass; complete another independent
    latest-diff review.
14. Require a post-command landing confirmation. If the exact commit is not
    confirmed on the default branch, roll back the promoted candidate, revalidate
    production health, preserve merge and rollback errors, and restart remote
    remediation. Added regression coverage; focused and full managed validation
    pass.
15. Extend pre-merge rollback to required-review and mergeability drift after
    promotion, and require the regression to prove the merge-command,
    pull-request/default-branch re-fetch, and landing-confirmation sequence.
    Focused and full managed validation pass.
16. Completed clean independent full-diff re-review and finalized this plan for
    the immutable landing candidate.

### Validation

Research evidence:

- The safe workflow version 1.4.0 required implementation, managed validation,
  retained review, terminal review, promotion, and production validation, but
  ended at an “exact commit to be handed off.”
- Its completion gate did not require a pull request, remote checks, merge, or
  post-landing verification and said commit or push occurred only when
  separately requested.
- Recent pull requests #29, #31, and #42 were fully green, mergeable, and had no
  automatic merge request configured, while their issue ledgers delegated merge
  to a requester or unspecified automated process.
- A prior completed workflow merged only after interpreting a later approval as
  separate merge authorization, confirming the implicit authorization gap.

Completed on the final implementation:

- `corepack pnpm --filter e2e exec vitest run
  tests/review-workflow.test.ts` passed with 2 tests.
- `corepack pnpm --filter e2e lint` and `git diff --check` passed.
- `node packages/e2e/bin/openclaw-test-env.mjs ci` passed again: workspace build and
  lint, 239 isolated workspace tests, 298 mapped OpenClaw tests, and 1 candidate
  test completed; the temporary worktree was removed and pruned.
- Independent complete-diff review found no remaining actionable,
  high-confidence defects after the accepted remediation loop.

Remaining external ledger gates:

- terminal fresh review of the exact landing candidate;
- remote PR checks, mergeability, landing, and post-landing verification.

Those remaining results must be recorded only in issue #44; changing this plan
after terminal review would invalidate the candidate.

### Rollout and rollback

The guidance takes effect when this pull request lands on the default branch.
No runtime promotion or production mutation applies. The worker will use the
normal repository pull-request path, honor branch protections, and verify the
merged result. Roll back by reverting the instruction, skill, regression, and
coverage-index changes together.

### Review log

- 2026-07-29: Verified the task’s tracking comment, issue ledger shape, and
  reserved plan path before research.
- 2026-07-29: Research identified the missing integration owner in the canonical
  lifecycle and confirmed the outcome in three recent green, mergeable, open
  pull requests.
- 2026-07-29: Implemented the ownership boundary, explicit design checkpoint,
  landing phase, and cumulative contract regression.
- 2026-07-29: Focused contract validation, E2E lint, diff checks, and the full
  cumulative managed lifecycle passed.
- 2026-07-29: Independent review found one medium regression gap: the test made
  `external` optional and could satisfy the assertion from text outside the
  closeout phase. The finding was accepted and fixed by scoping the assertion to
  `Integrate and close out` and requiring the external task-completion boundary.
- 2026-07-29: Focused and full managed validation passed after remediation. The
  completed original reviewer cannot be resumed through the available worker
  interface, so the documented unavailable-worker fallback requires a fresh
  independent replacement.
- 2026-07-29: Replacement review verified the external-boundary correction and
  found one medium regression gap: removing the complete gated-merge clause
  would not fail the test. The finding was accepted and fixed with a
  closeout-scoped assertion for terminal review, remote green status,
  mergeability, and no unresolved required review.
- 2026-07-29: Focused and full managed validation passed after the second
  remediation. The completed replacement reviewer cannot be resumed through the
  available worker interface, so the unavailable-worker fallback is used again
  for a complete latest-diff recheck.
- 2026-07-29: Final replacement review verified both prior fixes and found two
  medium safety gaps: a changed remote candidate could skip applicable
  promotion/production validation, and regression coverage did not lock
  candidate invalidation or authorization limits and protections. Both findings
  were accepted and fixed.
- 2026-07-29: Focused and full managed validation passed after the final
  remediation.
- 2026-07-29: The fallback reviewer verified all four prior corrections and
  found one medium sequencing defect: a candidate could be promoted before
  remote CI and required review, then remain deployed if a remote gate failed.
  The finding is accepted.
- 2026-07-29: Reordered remote integration before promotion, bound landing to the
  exact promoted head with rollback on remote drift, and passed focused contract
  tests, E2E lint, diff checks, and the full managed lifecycle.
- 2026-07-29: Re-review verified the ordering fix and found one medium failure
  path: merge failure or an unconfirmed result could leave production on an
  unlanded candidate. The finding was accepted and fixed with mandatory landing
  confirmation, rollback, production-health revalidation, and explicit error
  preservation.
- 2026-07-29: Focused and full managed validation passed after the merge-failure
  correction.
- 2026-07-29: Re-review verified prior corrections and found two medium
  landing-state gaps: required-review or mergeability drift after promotion did
  not force rollback, and tests did not require the post-merge PR/default-branch
  re-fetch. Both findings were accepted and fixed.
- 2026-07-29: Focused and full managed validation passed after the landing-drift
  remediation.
- 2026-07-29: Final independent complete-diff re-review found no actionable
  high-confidence defects. Its residual gap is the intentionally pending
  terminal exact-commit and remote landing lifecycle.

### Checklist

- [x] Verify the first task comment points to the primary tracking issue.
- [x] Verify the issue starts with the plan link and contains only Status and
  Done.
- [x] Initialize the canonical two-part repository plan.
- [x] Research recent outcomes and affected instruction surfaces.
- [x] Synchronize the complete plan design after research.
- [x] Implement the ownership, checkpoint, integration, and closeout guidance.
- [x] Add the shared-pool regression.
- [x] Pass focused checks and the full managed lifecycle.
- [x] Tighten the external-completion regression and rerun validation.
- [x] Tighten the gated-merge regression and rerun validation.
- [x] Require changed candidates to repeat promotion and production validation.
- [x] Lock candidate invalidation and authorization safety contracts in tests.
- [x] Put remote integration gates before promotion and bind merge to the exact
  promoted candidate.
- [x] Add phase-ordering regression coverage and rerun full validation.
- [x] Add merge-failure confirmation, rollback, and regression coverage.
- [x] Add rollback for post-promotion review or mergeability drift.
- [x] Lock the post-merge state re-fetch sequence in regression coverage.
- [x] Complete independent adversarial review and all accepted remediation,
  using fresh replacements when completed workers could not be resumed.
- [x] Finalize in-diff bookkeeping for the exact landing candidate.
