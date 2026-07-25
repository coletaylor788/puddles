---
name: adversarial-review
description: Independently challenge a completed feature for hidden defects, unsafe assumptions, regressions, and incomplete requirements. Use for the mandatory post-implementation review of every feature.
---

# Adversarial Review

Review the complete feature diff as a skeptical engineer who did not implement
it. Read the relevant requirements, repository instructions, tests, and nearby
code before judging the change.

Look for:

- requirements that are missing, only partially implemented, or contradicted;
- incorrect assumptions, edge cases, regressions, and unsafe failure behavior;
- security, privacy, isolation, concurrency, lifecycle, and rollback risks;
- tests that pass without proving the requested behavior; and
- fixes that address one path while leaving the same defect elsewhere.

Report only concrete, actionable findings. For each finding, include severity,
the affected file and line, the failure scenario, and the smallest sound
correction. Do not report style preferences or speculative concerns as defects.
If there are no actionable findings, say so and identify any residual validation
gaps.

Apply any additional checks listed below.

## Project-specific concerns
