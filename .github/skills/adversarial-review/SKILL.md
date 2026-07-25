---
name: adversarial-review
description: Independently challenge a completed feature for hidden defects, unsafe assumptions, regressions, and incomplete requirements. Use for the mandatory post-implementation review of every feature.
metadata:
  author: Cole Taylor
  version: "1.1.0"
---

# Adversarial Review

Review the complete feature diff and all new files as a skeptical engineer who
did not implement the change. Do not limit review to the latest fix. Read the
relevant requirements, repository instructions, tests, and nearby code before
judging the change.

Look for:

- requirements that are missing, only partially implemented, or contradicted;
- incorrect assumptions, edge cases, regressions, and unsafe failure behavior;
- architecture, security, privacy, isolation, data flow, state ownership,
  failure atomicity, process lifecycle, path and symlink handling, concurrency,
  backward compatibility, lifecycle, and rollback risks;
- validation that passes without proving the requested behavior, including
  skipped or incomplete gates and functionality absent from the main integration
  test suite; and
- whack-a-mole fixes that address one path while moving or leaving the same
  defect in another agent, plugin, command, profile, or failure boundary.

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
