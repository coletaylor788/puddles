# Plan 034 - Plan and issue writing contract

**Status:** Complete
**Issue:** [#69](https://github.com/coletaylor788/puddles/issues/69)
**Last updated:** 2026-09-26

## Human section

### Design

Plans hold the detailed design, operational state and evidence. Each plan starts with a short human explanation and status, followed by structured agent details. Tracking issues link to the plan and use only a short summary and current status in prose.

The writing contract favors familiar words, short sentences and enough architectural context to understand the decision. Human design explains the system without code pointers. Every substantive update rewrites the human and agent parts together so they describe the same current state.

### Status

The contract is implemented in the repository instructions, feature workflow and committed regressions. The current instructions also explain unfamiliar OpenClaw concepts and keep independent review with one reviewer. This documentation change is complete; no gateway deployment is required.

## Agent section

### State

Complete. Current canonical documents and their structural tests contain the delivered contract.

### Scope and acceptance criteria

- Allow only Status, Issue, Last updated and optional Owner metadata.
- Require Human section with Design and Status, then Agent section with the eight specified subsections.
- Require issue bodies to contain a plan link, Summary and Status, with prose and no lists.
- Keep code pointers and evidence in the Agent section; forbid them in human Design.
- Rewrite both plan parts and issue prose on substantive updates.
- Keep older untouched records outside automatic migration; this hygiene task explicitly updates selected records.

### Architecture and decisions

- `.github/copilot-instructions.md` summarizes the writing rules.
- `.github/skills/safe-feature-development/SKILL.md` owns the exact format and issue template.
- `packages/e2e/tests/plan-and-issue-writing-contract.test.ts` checks these documents and this plan.
- `packages/e2e/tests/review-workflow.test.ts` covers related ownership and explanation rules.
- Retained review has superseded the former fresh terminal-review requirement. Review records remain outside the candidate diff when needed.

### Implementation

The issue ledger was replaced by Summary and Status. Human design and Agent details headings became Human section and Agent section. Writing guidance and structural regression coverage landed with the original change. Current skill versions have advanced beyond the original release.

### Validation

The original implementation record reports the full managed lifecycle and 13 focused contract/review tests passing, plus clean independent review. The hygiene audit re-read the current format and regression sources. Historical test totals are not current suite counts or a newly executed gate.

### Rollout and rollback

Normal source integration delivers this guidance. A rollback reverts the instructions and matching regressions together; no runtime or data restoration applies.

### Review log

Original review fixed obsolete test wording, review-record placement and publication wording. The audit keeps the final contract while removing obsolete release-version and terminal-review status claims.

### Checklist

- [x] Implement exact plan and issue formats.
- [x] Add writing and architecture-explanation guidance.
- [x] Add shared-pool contract regressions.
- [x] Keep this completed plan consistent with current instructions.
