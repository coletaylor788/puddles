# Plan 032 - Unified safe feature and adversarial review lifecycle

**Status:** Complete
**Started:** 2026-07-24
**Original lifecycle completed:** 2026-07-24
**Reopened for unification:** 2026-07-24
**Unified lifecycle completed:** 2026-07-24

## Summary

Make the repository-local `safe-feature-development` skill the canonical
feature and behavior-change workflow. Integrate the focused
`adversarial-review` skill into its full-change audit loop, then reduce the
always-on repository instructions to concise principles, publication safety,
sources of truth, and the entry point into that workflow.

This supersedes the standalone adversarial-review phase introduced in the
original version of this plan. Cole's project-specific adversarial concerns
remain in the focused reviewer skill.

## Workflow contract

- Store the complete safe workflow at
  `.github/skills/safe-feature-development/SKILL.md`.
- Require every feature and behavior change to invoke and follow that skill.
- Keep `.github/skills/adversarial-review/SKILL.md` as the focused independent
  reviewer instructions.
- During the full-change audit, launch a fresh independent reviewer that invokes
  `adversarial-review` and reviews the complete feature diff.
- For every actionable, high-confidence finding, return to local implementation,
  redeploy to the test environment, rerun applicable local gates and the full
  configured integration pool, and repeat with a fresh reviewer until clean.
- Any diff change after a clear review triggers relevant validation and a fresh
  adversarial review.

## Safety and publication model

- Keep the public workflow provider-neutral and reusable.
- Preserve credentials, account data, production state, and message delivery
  boundaries.
- Use component documentation and package scripts as the source of validation
  commands instead of generic repository-wide commands.
- Keep test writes behind deny-by-default mocks or recording adapters.
- Use configured promotion and rollback mechanisms only when deployment is in
  scope.

## Implementation

1. Copy the machine-local safe feature workflow v1.1.0 into a repository-local
   skill and integrate the adversarial-review loop.
2. Replace the duplicated always-on process with a concise requirement to invoke
   `safe-feature-development`.
3. Preserve Cole's project-specific adversarial-review concerns unchanged.
4. Validate both skills, all paths and cross-references, and the complete diff.
5. Run fresh independent adversarial review until no actionable,
   high-confidence findings remain unresolved.

## Validation

- Parse both skill frontmatter blocks and validate required metadata.
- Verify every referenced repository path exists or is explicitly conditional.
- Verify repository instructions invoke `safe-feature-development` and do not
  duplicate a standalone adversarial-review phase.
- Verify the safe workflow invokes `adversarial-review`, requires correction,
  test-environment redeployment, the full configured integration pool, and fresh
  review after later diff changes.
- Check Markdown whitespace and inspect the complete branch diff.
- Run a fresh independent adversarial-review loop over the complete diff.

No runtime API, production state, or deployment artifact changes. The managed
E2E package is not present on this branch, so its conditional lifecycle does not
run for this documentation-only change.

The first fresh independent review found no actionable issues. After this final
plan bookkeeping change, relevant structural validation and a second fresh
review are required before publication.

## Rollout

Merge the focused follow-up pull request. Future feature and behavior-change
agents will enter through `safe-feature-development`, which owns the complete
workflow and delegates its independent audit to `adversarial-review`.

## Rollback

Revert the follow-up merge commit to restore the prior standalone adversarial
phase and remove the repository-local safe workflow. No runtime state or
migration needs restoration.

---

## Checklist

### Implementation
- [x] Research current instructions, skills, plans, and configured lifecycle
- [x] Add the repository-local safe feature workflow
- [x] Integrate fresh adversarial review into the full-change audit
- [x] Rewrite the always-on repository instructions
- [x] Preserve project-specific adversarial-review concerns

### Validation
- [x] Skill frontmatter and structure pass
- [x] Paths and cross-references pass
- [x] Markdown diff and provider-neutrality checks pass
- [x] Fresh independent adversarial review is clean

### Documentation and handoff
- [x] Plan marked complete with date
- [x] Tracking issue is current and pull request handoff is prepared
