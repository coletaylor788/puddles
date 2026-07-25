# Plan 033 - Issue and plan lifecycle

**Status:** Reviewing
**Issue:** [#25](https://github.com/coletaylor788/puddles/issues/25)
**Last updated:** 2026-07-24

## Human design

### Problem

Plans and their issues can both accumulate design, status, and evidence, while
workflow and reviewer skills can both accumulate audit criteria. Those
duplications make ownership unclear and allow human design, operational detail,
and review expectations to drift.

### Outcome

Every new or substantively updated repository plan has one predictable two-part
structure. The plan is the detailed source of truth, and its issue is a small
status ledger that links to it. The safe feature workflow owns review
orchestration; the adversarial review skill owns substantive audit criteria and
the reporting contract.

### Approach

Use `Human design` for the concise current problem, outcome, approach, and safety
model. Use `Agent details` for complete operational state, requirements,
decisions, execution, evidence, rollout, review, and checklist state. Rewrite
and synchronize both parts whenever substantive information changes. Untouched
historical plans do not require migration.

Keep the linked issue limited to current status and completed milestones. Keep
`safe-feature-development` focused on launching fresh independent reviewers and
iterating on findings. Keep complete-change review criteria and concrete
reporting requirements in `adversarial-review`.

### Safety and rollout

This is a documentation workflow change with no runtime or production mutation.
Adopt it through pull request
[#27](https://github.com/coletaylor788/puddles/pull/27). Centralizing audit
criteria reduces contradictory guidance while preserving the correction,
revalidation, and re-review loop. Roll back by reverting the documentation
changes if the contract proves unusable.

## Agent details

### State

The strict plan and issue lifecycle and audit-ownership refactor are implemented
in pull request #27. Targeted structural validation is complete: the safe feature
workflow keeps only review orchestration and remediation, while the adversarial
review skill owns all substantive review criteria. A fresh independent review of
both skills and the complete diff is next.

### Scope and acceptance criteria

- Add this plan with only allowed metadata and the exact required H2 and H3
  sections in order.
- Make the plan the detailed source of truth and the linked issue a minimal
  status ledger.
- Require the format concisely for new or substantively updated plans without
  migrating untouched historical plans.
- Define exact plan and issue mechanics in `safe-feature-development` and bump
  its version from 1.2.0 to 1.3.0.
- Keep only independent-review orchestration and finding remediation in the safe
  workflow's audit step.
- Move complete-diff and new-file inspection, requirements completeness,
  architecture, security, isolation, data flow, state, failure atomicity,
  process lifecycle, path and symlink handling, concurrency, compatibility,
  rollback, whack-a-mole, validation-adequacy, and concrete reporting criteria
  into `adversarial-review`.
- Add adversarial-review metadata at version 1.1.0 while preserving the existing
  project-specific concerns exactly in substance.
- Keep public content provider-neutral and exclude user-scoped automation
  behavior.
- Validate both skills, the plan, issue ledger, live plan link, pull request, and
  public-content boundaries.
- Obtain a clean fresh independent adversarial review after final bookkeeping.
- Leave issue #25 and non-draft pull request #27 ready for coordinator review
  without merging.

### Architecture and decisions

- `.github/copilot-instructions.md` is the concise always-on policy entry point.
  Detailed mechanics remain in the skills.
- `.github/skills/safe-feature-development/SKILL.md` owns the development loop.
  Its Plan phase defines the plan and issue contract. Its Audit phase launches a
  fresh independent subagent, requires the adversarial skill against the complete
  diff, and owns correction, test-environment redeployment, applicable local
  gates, the full integration pool, and repeated review.
- `.github/skills/adversarial-review/SKILL.md` is the single owner of substantive
  complete-change review criteria and actionable reporting. Version 1.1.0 marks
  that expanded responsibility.
- Plans carry detailed current design and operational state. Issues carry only a
  plan link, current status, and completed milestones.
- Updates rewrite current truth instead of preserving duplicate narratives or
  append-only status fragments.

### Implementation

1. Added plan 033 and the concise repository-wide plan rule.
2. Defined the exact synchronized plan and minimal issue formats in the safe
   workflow Plan phase.
3. Reduced the safe workflow Audit phase to fresh-review orchestration and the
   existing remediation, redeployment, validation, and re-review loop.
4. Expanded and versioned adversarial review as the owner of complete-change
   criteria, validation adequacy, whack-a-mole analysis, and concrete reporting.
5. Preserved the existing project-specific adversarial concerns in substance.
6. Published the focused branch, linked the issue to its accessible plan, and
   opened non-draft pull request #27.

### Validation

Completed targeted checks:

- parsed both skill frontmatter blocks and verified versions 1.3.0 and 1.1.0;
- verified plan 033's exact metadata and heading names, counts, and order;
- confirmed safe feature development retains orchestration requirements without
  duplicating the substantive audit checklist;
- confirmed every required substantive criterion is present in adversarial review
  and the project-specific concerns remain unchanged in substance;
- verified the issue ledger, live plan link, and non-draft pull request state;
- passed `git diff --check` and changed-public-content boundary scans.

No runtime build, integration environment, deployment, or production validation
applies because only Markdown workflow documentation changes. Fresh independent
review remains pending and will repeat after final bookkeeping.

### Rollout and rollback

Rollout is non-draft pull request
[#27](https://github.com/coletaylor788/puddles/pull/27), linked to issue #25.
After merge, new and substantively updated plans use the synchronized format,
and review criteria have one skill owner. No deployment or data migration is
required.

Rollback is a normal revert of the documentation commits. Untouched historical
plans and runtime state require no restoration.

### Review log

Earlier review rounds corrected stale issue and plan state, clarified historical
plan migration scope, and made the pre-merge plan link accessible. The last
published state was clean before audit ownership was refactored. Both refactored
skills now pass targeted validation. Fresh review of the complete updated diff is
pending. Any actionable high-confidence finding will be fixed, revalidated, and
reviewed again.

### Checklist

- [x] Read the current repository instructions and both lifecycle skills
- [x] Define and implement the strict plan and minimal issue contracts
- [x] Update and version the safe feature workflow
- [x] Move substantive audit criteria into adversarial review
- [x] Preserve safe workflow review orchestration and remediation
- [x] Add and version adversarial review skill metadata
- [x] Publish the branch and open non-draft pull request #27
- [x] Revalidate both skills, plan, ledger, PR, and public-content boundaries
- [ ] Obtain a clean fresh independent adversarial review
- [ ] Update issue #25 to `Ready for review`
