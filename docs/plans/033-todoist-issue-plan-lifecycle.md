# Plan 033 - Issue and plan lifecycle

**Status:** Reviewing
**Issue:** [#25](https://github.com/coletaylor788/puddles/issues/25)
**Last updated:** 2026-07-24

## Human design

### Problem

Plans and their tracking issues can both accumulate design, status, and evidence.
That duplication makes it unclear which record is authoritative and allows the
human-facing summary to drift from the operational implementation detail.

### Outcome

Every new or substantively updated repository plan has one predictable two-part
structure. The plan is the detailed source of truth: a concise current design
for people followed by complete operational detail for agents. Its issue remains
a small status ledger that links to the plan.

### Approach

Use the format when creating a plan or making a substantive update to an
existing plan; untouched historical plans do not require migration. Use `Human
design` for the current problem, outcome, approach, and safety model. Use `Agent
details` for state, requirements, decisions, execution, evidence, rollout,
review, and checklist state. Rewrite and synchronize both parts whenever
substantive information changes rather than adding chronological fragments.

Keep the linked issue limited to current status and completed milestones. Put
all design reasoning and operational detail in the plan.

### Safety and rollout

This is a documentation workflow change with no runtime or production mutation.
Adopt it through the repository instructions and safe feature workflow. Roll
back by reverting those documentation changes if the format proves unusable.

## Agent details

### State

Implementation is complete on the issue branch. Two review rounds identified a
stale issue ledger, ambiguous historical-plan migration scope, and a plan link
that cannot resolve until the branch is published. The ledger status is
synchronized, adoption is now scoped to new or substantively updated plans, and
post-fix validation plus branch publication are next. A fresh independent review
will follow with an accessible branch plan link.

### Scope and acceptance criteria

- Add this plan using exactly two top-level content sections after its title and
  allowed metadata.
- Keep `Human design` limited to the required four subsections and `Agent
  details` limited to the required eight subsections, in the specified order.
- Make the plan the detailed source of truth and the linked issue a minimal
  status ledger.
- Add a concise always-on requirement for all repository plans.
- Apply the format to newly created or substantively updated plans without
  forcing an unrelated migration of untouched historical plans.
- Define the exact plan and issue mechanics in `safe-feature-development` and
  bump its version.
- Keep the public contract provider-neutral and exclude user-scoped automation
  behavior.
- Validate structure and consistency, then obtain a clean fresh independent
  adversarial review over the complete diff.
- Update issue #25 to `Ready for review`, commit and push the focused branch,
  and open a non-draft pull request linked to the issue without merging it.

### Architecture and decisions

- `.github/copilot-instructions.md` is the concise always-on policy entry point.
  It requires the format and synchronization for new or substantively updated
  plans but delegates mechanics.
- `.github/skills/safe-feature-development/SKILL.md` is the canonical
  operational contract. Its Plan phase defines allowed metadata, exact heading
  names and order, whole-plan synchronization, and the minimal issue shape.
- Repository plans carry detailed current design and operational state. Issues
  carry only a plan link, current status, and completed milestones.
- Updates rewrite current truth instead of preserving an append-only chronology.
  Review history remains concise and current in the required `Review log`.
- The skill version moves from 1.2.0 to 1.3.0 because this adds a backward-
  compatible workflow contract.

### Implementation

Implemented changes:

1. Added plan 033 in the strict format.
2. Added the concise repository-wide plan rule to the sources-of-truth guidance.
3. Replaced the skill's issue-as-source language and expanded its Plan phase
   with the exact two-part plan and minimal issue contracts.
4. Re-read and updated this whole plan after implementation, validation, and the
   first two reviews; final review remains.
5. Synchronized issue #25 after the first review identified its stale status,
   while retaining only the allowed ledger content.
6. Scoped adoption after the second review identified that an unconditional
   rule could prompt unrelated migration of untouched historical plans.
7. Publish the branch, update the issue to its accessible branch plan link, and
   rerun validation and fresh independent review.

### Validation

Completed targeted checks:

- parsed both lifecycle skill YAML frontmatter blocks and verified version
  1.3.0 for the safe workflow;
- verified plan 033's exact H1, H2, and H3 names, counts, and order;
- verified plan metadata uses only the allowed keys and required order;
- confirmed that repository instructions and the safe workflow enforce one
  consistent contract without duplicating detailed mechanics;
- passed `git diff --check`;
- passed changed-public-content scans for prohibited provider, non-public, and
  user-scoped automation references.

No runtime build, integration environment, deployment, or production validation
applies because only Markdown workflow documentation changes. Targeted checks
must run again after the second review corrections and branch-link update.

### Rollout and rollback

Rollout is the non-draft pull request linked to issue #25. After merge, future
repository plans and their issue ledgers follow this contract. No deployment or
data migration is required.

Rollback is a normal revert of the documentation commit. Existing plans are not
rewritten by this change, and no runtime state needs restoration.

### Review log

The first review found one medium-severity synchronization defect: issue #25
still described implementation as next after the plan recorded completed work.
The issue ledger is corrected.

The second review found two medium-severity rollout defects: the unconditional
plan rule could cause unrelated migration of untouched historical plans, and the
issue's main-branch plan link returns 404 before merge. Adoption is now scoped
to new or substantively updated plans. The branch will be published and the
ledger switched to its accessible branch plan link before fresh review. Any
further actionable high-confidence finding will be fixed, revalidated, and
reviewed again.

### Checklist

- [x] Read the current repository instructions and both lifecycle skills
- [x] Inspect issue #25 and the existing plan convention
- [x] Define the strict plan and minimal issue contracts
- [x] Add plan 033 in the required two-part format
- [x] Update the concise always-on repository instructions
- [x] Update and version the safe feature workflow
- [ ] Revalidate the complete post-fix diff and accessible issue link
- [ ] Obtain a clean fresh independent adversarial review
- [ ] Update issue #25 to `Ready for review`
- [ ] Commit, push, and open a non-draft pull request
