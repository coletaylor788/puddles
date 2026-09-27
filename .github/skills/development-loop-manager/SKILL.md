---
name: development-loop-manager
description: "Review recent Puddles development loops and improve their skills, scripts, and process. Put security first while improving release safety, early feedback, efficiency, and disk use."
---

# Development Loop Manager

## Principles

- Security first; never cut security corners for speed or convenience.
- Keep it simple (KISS); simplify to reduce edge cases and brittleness.
- Protect production and preserve rollback.
- Support parallel contributors and automated, hands-off CI/CD.

## Priorities

Catch up on recent changes and others' work before proposing fixes. Build on
existing improvements. Start with these areas; investigate as the evidence leads.

- Security gaps: weakened controls, exposed secrets, and unsafe untrusted input.
  Use the [security architecture](../../../docs/openclaw-setup/security-architecture.md)
  for trust rings, boundaries, and known gaps.
- Late failures: investigate every CI, TEST, or PROD failure for earlier detection
  in local builds and tight DEV loops.
- Automation gaps: routine CI/CD needing an agent to usher it through.
  Agents should monitor and react to issues.
- Parallel work: unnecessary serialization or interference. Coordinate only
  shared resources and actual dependencies.
- Feedback cost: slow or repeated builds, checks, retries, handoffs, and local/CI
  differences that delay finding issues.
- Disk growth: package-store reuse, incremental builds, and completed scratch
  on both the development machine and OpenClaw server.
- Approval blockers: fix obvious general guidance gaps behind design reapproval.
  New information sometimes needs approval; do not force a process fix.

## Address findings

- Update the guiding skill, script, check, or process so later features benefit.
  Prefer simplification over another mechanism; do not manufacture fixes or rules.
- Follow [safe-feature-development](../safe-feature-development/SKILL.md) for
  approval, validation, and landing. Preserve security controls, release gates,
  and test isolation.
- Use the [runner guide](../../../packages/e2e/README.md) and
  [coordination rules](../../../packages/e2e/DEPLOYMENT_COORDINATION.md) for reuse
  and cleanup. Protect other owners' work, retained evidence, and rollback state.
- Keep a compact record of findings, changes, open actions, and the last review.
  Revisit later loops to distinguish a landed fix from a measured improvement.
- Explain when a late failure could not reasonably be caught earlier. Reduce
  its impact where practical; do not weaken checks or approval requirements.

## Write skills for an agent

- State what to do, what matters, and how to address it.
- Assume the agent knows ordinary investigation and engineering techniques.
- Prefer short action bullets. Use prose only when it makes guidance clearer.
- Name focus areas and decision criteria; leave room to investigate as evidence leads.
- Rewrite, reorganize, and consolidate instead of bolting on more instructions.
- Resolve conflicts and remove repetition or obsolete rules across related guidance.
- Link the source of truth rather than duplicating it.
- Keep backstory, incident details, and evidence in task records, not skills.
- Review the whole result for clarity and brevity; remove text that adds no useful
  direction. Apply these rules to this skill too.
