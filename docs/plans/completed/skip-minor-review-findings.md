# Skip minor adversarial-review findings

**Status:** Complete
**Issue:** [#62](https://github.com/coletaylor788/puddles/issues/62)
**Last updated:** 2026-09-26

## Human section

### Design

Independent review reports concrete, actionable defects with material impact. Minor wording, style, optional hardening and low-impact proof gaps do not become remediation work. This threshold applies to code, documentation, tests and configuration alike.

Useful residual validation limits can be recorded separately without turning them into findings. The implementation owner evaluates evidence and discusses significant disagreements with the same reviewer.

### Status

The finding threshold is delivered in the reviewer skill. This is completed repository guidance. It does not require runtime activation.

## Agent section

### State

Complete. Current reviewer instructions explicitly suppress minor and low-severity findings while preserving material cross-artifact review.

### Scope and acceptance criteria

- Suppress minor and low-severity concerns, including optional hardening and low-impact proof gaps.
- Preserve material correctness, safety, security, requirement, lifecycle and regression findings.
- Keep useful residual gaps separate from findings.
- Retain provider-neutral wording and review the guidance directly.

### Architecture and decisions

`.github/skills/adversarial-review/SKILL.md` owns the threshold. Automated tests of this wording were removed at the requester's direction. The feature workflow owns triage and correction rather than duplicating the reviewer checklist.

### Implementation

The reviewer skill includes the materiality rule and explicit suppression examples. The guidance is reviewed directly rather than enforced through prose assertions. Current retained-reviewer guidance replaces the former fresh terminal-review step.

### Validation

The original record reports four focused tests, lint, whitespace checks and a full managed run with 289 workspace and 470 source tests passing. The audit checked the current skill; it did not rerun those historical suites. The Mini checkout contains the reviewer skill.

### Rollout and rollback

Guidance is delivered through source integration. Rollback reverts the skill; no service or state change applies.

### Review log

Original independent reviews found no material issues. The audit removed obsolete landing-candidate and fresh terminal-review to-dos because the policy is present in current integrated source.

### Checklist

- [x] Deliver explicit materiality and minor-finding suppression.
- [x] Preserve review across all changed artifacts.
- [x] Remove automated prose assertions while retaining the reviewer guidance.
- [x] Confirm current source and Mini reviewer guide.
