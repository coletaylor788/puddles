# Plan 032 - Adversarial review lifecycle

**Status:** Complete
**Started:** 2026-07-24
**Completed:** 2026-07-24

## Summary

Add an adversarial review gate to the repository's feature-development
lifecycle. Every feature will receive an independent review after implementation
and validation, and actionable findings will feed back into the implementation
until the review is clear.

The review instructions will live in a repository-local skill so the workflow is
reusable and easy to extend without making the always-on repository instructions
larger.

## Workflow contract

- Store the skill at `.github/skills/adversarial-review/SKILL.md`.
- Require a separate review agent that did not implement the feature after all
  implementation and documentation changes are complete.
- Have the review agent invoke the skill and inspect the complete feature diff.
- Resolve every actionable, high-confidence finding through correction or a
  documented risk decision, rerun applicable validation, and repeat the
  independent review until none remain unresolved.
- Require a fresh review after any post-review diff change, including plan or
  checklist bookkeeping.
- Preserve a blank section in the skill for future repository-specific concerns.

No runtime API, credentials, production state, or external delivery path changes.

## Safety model

- Keep the skill provider-neutral and repository-local.
- Ask for concrete failure scenarios and file references rather than speculative
  or stylistic feedback.
- Require review of requirements, regressions, failure paths, tests, and rollback.
- Record any accepted residual risk or rejected finding with rationale.
- Make the gate apply to every feature and behavior change.

## Implementation

1. Add the adversarial review skill with concise review and reporting guidance.
2. Add a mandatory adversarial review phase to the repository workflow.
3. Place the review after documentation and plan bookkeeping, before commit.
4. Run the new review process against this change and incorporate its feedback.

## Testing

- Check Markdown whitespace and links with `git diff --check`.
- Parse the skill frontmatter and confirm the required name and description.
- Confirm the project-specific concerns heading exists with no seeded concerns.
- Confirm the workflow names the skill and defines the review, correction,
  revalidation, and repeat loop.
- Run an independent adversarial review over the full diff.

## Rollout

Merge the documentation and skill files. Future feature work will pick up the
new repository instructions and load the skill from the repository.

## Rollback

Revert the workflow phase and delete the skill. No runtime state, deployment, or
migration needs restoration.

---

## Checklist

### Implementation
- [x] Research the repository workflow and supported skill layout
- [x] Add the repository-local adversarial review skill
- [x] Add the mandatory review and iteration phase

### Testing
- [x] Structural validation passes
- [x] Independent adversarial review loop exercised
- [x] All adversarial review findings resolved

### Cleanup
- [x] Full diff audited
- [x] No unrelated or provider-specific content added

### Documentation
- [x] Plan marked complete with date
- [x] Tracking issue prepared for review handoff
