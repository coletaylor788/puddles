---
name: adversarial-review
description: Independently challenge a completed feature for hidden defects, unsafe assumptions, regressions, and incomplete requirements. Use for the mandatory post-implementation review of every feature.
metadata:
  author: Cole Taylor
  version: "1.2.0"
---

# Adversarial Review

Review the complete feature diff and all new files as a skeptical engineer who
did not implement the change. Do not limit review to the latest fix. Read the
relevant requirements, repository instructions, tests, and nearby code before
judging the change.

When resumed after remediation, use the prior review and the implementation
agent's change and validation summary as leads, not as a scope limit. Verify each
claimed correction, account for changed assumptions, and re-check the complete
current diff and all new files. Do not repeat a resolved finding unless it still
exists or has regressed, and do not assume the summary names every relevant
change.

Do not manufacture findings to justify the review or fill a perceived quota. A
clean review is a normal, useful result. Report a defect only when the current
change directly supports it and there is a concrete failure scenario with
material impact. Treat uncertainty or missing proof as a residual validation gap,
not as a defect. Before reporting, verify that the concern is not speculative,
duplicative, already resolved, or unrelated to the current change.

When the implementation agent disputes a significant finding, assess its
evidence and rationale on the merits. Withdraw or revise a finding that is no
longer supported; do not defend it merely for consistency with an earlier review.
Work toward an explicit shared outcome: accepted fix, revised finding,
withdrawal, or documented residual risk or blocker.

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

Report only concrete, actionable, high-confidence findings. For each finding,
include severity, the affected file and line, the failure scenario, the evidence
that the current change permits it, and the smallest sound correction. Do not
report style preferences, speculative concerns, or optional hardening as
defects. If there are no actionable findings, say so and identify any residual
validation gaps.

Apply any additional checks listed below.

## Project-specific concerns

1. Prefer solving features via well established extension patterns such as plugins, MCP tools, etc.
2. If a patch to OpenClaw is required, give extra scrutiny and hold the patch to the bar "this would be accepted and checked-in to OpenClaw itself". Be very careful to ensure it doesn't cause unintended consequences or behavior, doesn't re-invent things, etc. This code base is large and requires extensive research to validate.
3. If a patch to OpenClaw, ensure patch is fully docmented for repeat application in the repo
4. Everything must have integration tests. I can't test this is not acceptable. Mock dependencies, built test harnesses, etc. The integration test suite being complete and thorough is absolutely critical to avoiding regressions.
