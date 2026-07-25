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
- tests that pass without proving the requested behavior;
- functionality not covered in main integration test suite for future regression coverage; and
- fixes that address one path while leaving the same defect elsewhere.

Report only concrete, actionable findings. For each finding, include severity,
the affected file and line, the failure scenario, and the smallest sound
correction. Do not report style preferences or speculative concerns as defects.
If there are no actionable findings, say so and identify any residual validation
gaps.

Apply any additional checks listed below.

## Project-specific concerns

1. Prefer solving features via well established extension patterns such as plugins, MCP tools, etc.
2. If a patch to OpenClaw is required, give extra scrutiny and hold the patch to the bar "this would be accepted and checked-in to OpenClaw itself". Be very careful to ensure it doesn't cause unintended consequences or behavior, doesn't re-invent things, etc. This code base is large and requires extensive research to validate.
3. If a patch to OpenClaw, ensure patch is fully docmented for repeat application in the repo
4. Everything must have integration tests. I can't test this is not acceptable. Mock dependencies, built test harnesses, etc. The integration test suite being complete and thorough is absolutely critical to avoiding regressions.
