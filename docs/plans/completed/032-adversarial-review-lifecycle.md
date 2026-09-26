# Unified safe feature and adversarial review lifecycle

**Status:** Complete
**Issue:** None recorded
**Last updated:** 2026-09-26

## Human section

### Design

One repository-local workflow owns feature development from research through validation, independent review, integration and delivery. The always-on instructions point to it instead of duplicating the full process. A separate reviewer guide owns substantive audit criteria and the finding format.

The implementation owner keeps one independent reviewer through meaningful corrections. The reviewer checks the complete current change, verifies previous repairs and reports only concrete material defects. Routine bookkeeping does not require a fresh terminal reviewer.

### Status

The unified workflow is delivered in repository instructions and both skills. The Mini source checkout also contains both skills. This is a documentation contract, so completion does not depend on changing the running gateway.

## Agent section

### State

Complete. The original fresh-reviewer-per-round rule was replaced by the retained-reviewer policy now present in the canonical instructions.

### Scope and acceptance criteria

- Keep one canonical feature lifecycle and one substantive review guide.
- Require complete-change review, finding triage, focused remediation and appropriate revalidation.
- Preserve secret handling, provider-neutral public content, isolated test state and recorded external writes.
- Keep applicable accumulated validation, integration, activation and rollback gates.

### Architecture and decisions

- `.github/copilot-instructions.md` is the concise entry point.
- `.github/skills/safe-feature-development/SKILL.md` owns orchestration.
- `.github/skills/adversarial-review/SKILL.md` owns substantive criteria and reporting.
- `packages/e2e/tests/review-workflow.test.ts` checks the current instruction contract.

### Implementation

The repository instructions require the feature skill. Both skills exist in current source and the Mini checkout. Current guidance keeps the same independent reviewer and places source integration before runtime activation.

### Validation

The audit read both skills, repository instructions and the shared regression. The original plan records successful metadata, reference, whitespace and independent-review checks. Historical test execution is not presented as a new run. No runtime deployment applies.

### Rollout and rollback

The merged repository guidance governs new work. Rollback is a reviewed documentation and contract-test revert, with no production state migration.

### Review log

The audit removed superseded fresh-review-per-round and terminal bookkeeping requirements. Current behavior follows retained review and exact-input evidence reuse.

### Checklist

- [x] Centralize the lifecycle and substantive review ownership.
- [x] Preserve publication, testing and deployment boundaries.
- [x] Confirm current source and Mini skill presence.
- [x] Align this record with the delivered retained-reviewer policy.
