# Explain OpenClaw context in the safe feature workflow

Status: Ready for terminal review
Issue: https://github.com/coletaylor788/puddles/issues/89
Last updated: 2026-08-05

## Human section

### Design

The safe feature workflow keeps its short, conversational style, but now gives that style a clearer technical audience. It assumes the reader is an experienced software engineer who understands agent systems but does not know OpenClaw's internal design or vocabulary.

When OpenClaw is relevant, an unfamiliar part is explained the first time it matters. The explanation says what the part does, where it sits in the request or runtime flow, and why the detail affects the current design, risk, or result. Familiar agent-system ideas can bridge the gap, but an OpenClaw name does not count as an explanation by itself.

The depth follows the decision being discussed. The reader should get enough context to reason about the change without opening the source first. Unrelated internals and general tutorials stay out. The same standard appears in the always-on repository guidance and the detailed feature workflow, and the plan rules apply it directly to architecture descriptions.

### Status

The shared guidance and its regression are implemented. Focused checks and the full isolated test lifecycle pass, and independent review found no actionable issues.

Nothing is blocked. The in-repository bookkeeping is final. An exact-candidate review and the normal pull request landing remain.

## Agent section

### State

- Phase: Terminal review preparation.
- Todoist task `6hCmhqjP4WH57fWV` remains labeled `agent`.
- Issue `#89` uses the required plan link, `Summary`, and `Status` shape.
- The complete diff changes two instruction surfaces, one existing shared-pool test, the coverage index, and this plan.
- Focused and full managed validation pass.
- Independent complete-diff review is clean.
- There is no runtime artifact or production state to promote.

### Scope and acceptance criteria

- [x] Keep the concise, conversational writing style.
- [x] Define the reader as an experienced software engineer who understands agent systems but does not know OpenClaw internals.
- [x] Require an unfamiliar OpenClaw concept to be explained when it first matters.
- [x] Cover the concept's job, its place in the request or runtime flow, and why it affects the current decision.
- [x] Allow familiar agent-system ideas as a bridge without treating OpenClaw names as self-explanatory.
- [x] Scale depth to the current change and reject unrelated internals or broad tutorials.
- [x] Keep the always-on and detailed workflow guidance consistent.
- [x] Add a committed regression for both instruction surfaces and the plan contract.
- [x] Update the cumulative coverage index.
- [x] Pass focused validation and the full managed lifecycle.
- [x] Complete reusable independent review with no actionable findings.
- [ ] Pass terminal review on the exact landing candidate.
- [ ] Land through a non-draft pull request and verify the default branch.

### Architecture and decisions

- `.github/copilot-instructions.md` carries the audience, first-use explanation, request-or-runtime-flow, decision relevance, and bounded-depth rules in the always-on writing summary.
- `.github/skills/safe-feature-development/SKILL.md` carries the same standard with the additional instruction to use familiar agent-system ideas as a bridge.
- The skill's `### Design` contract forbids unexplained OpenClaw internal names as architecture shorthand and requires the relevant job, flow position, and design importance.
- `packages/e2e/tests/review-workflow.test.ts` scopes assertions to the repository writing section, skill writing section, and Plan phase. It checks the audience, required context, bridge, bounded depth, and plan-specific rule.
- `packages/e2e/README.md` names the explanation contract in the cumulative coverage index.
- The skill remains version `1.7.0`. The change tightens writing behavior without changing compatibility or lifecycle structure.
- The wording remains provider-neutral.

### Implementation

- [x] Trace shared instruction copies and existing instruction regressions.
- [x] Add the audience and bounded explanation rules to the always-on repository instructions.
- [x] Add the full explanation rules to the safe feature skill.
- [x] Extend the plan design contract for OpenClaw architecture descriptions.
- [x] Add the shared-pool regression.
- [x] Update the shared coverage index.
- [x] Rewrite the plan and issue for the independently reviewed state.

### Validation

- Focused validation passes:
  - `corepack pnpm --filter e2e exec vitest run tests/review-workflow.test.ts`: 5 tests passed.
  - `corepack pnpm --filter e2e lint`: TypeScript completed without errors.
  - `git diff --check`: no whitespace errors.
- The worktree restored only the pinned lockfile dependencies with `corepack pnpm install --offline --frozen-lockfile` after the focused runner reported that its local binary was missing.
- `node packages/e2e/bin/openclaw-test-env.mjs ci` passes:
  - workspace build and lint completed;
  - 299 isolated workspace tests passed;
  - 471 mapped OpenClaw tests passed;
  - 1 candidate test passed; and
  - the temporary OpenClaw worktree was removed and pruned.
- The managed lifecycle is isolated from configured agents and personal accounts. This feature adds no external write path.
- The final post-review plan-only change requires `git diff --check` before the retained review re-check. It does not change executable behavior or the validated instruction contract.

### Rollout and rollback

- This is repository guidance, not a runtime artifact. No test deployment or production promotion applies.
- Rollout is the merge to the default branch, after which new feature sessions read the updated guidance.
- Rollback is a normal revert of the instruction, regression, coverage-index, and plan changes together.

### Review log

- 2026-08-05: Independent adversarial review of commit `8166ae9` against `origin/main` found no actionable findings and no useful residual validation gap.
- The retained reviewer will re-check the complete diff after this final plan-only synchronization.
- Terminal landing-candidate review is pending.

### Checklist

- [x] Verify the first Copilot-authored Todoist comment tracks issue `#89`.
- [x] Verify issue `#89` has only the plan link, `Summary`, and `Status`.
- [x] Create the repository plan in the required two-part format.
- [x] Complete research.
- [x] Implement the instruction change and regression.
- [x] Pass focused validation.
- [x] Pass the full managed test lifecycle.
- [x] Resolve all actionable independent review findings.
- [ ] Pass retained-review re-check after final bookkeeping.
- [ ] Pass terminal review on the exact landing candidate.
- [ ] Push, open a non-draft pull request, and pass remote checks.
- [ ] Merge and verify the default branch.
- [ ] Update Todoist for Cole's review without completing the task.
