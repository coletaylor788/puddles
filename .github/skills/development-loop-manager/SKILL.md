---
name: development-loop-manager
description: "Review recent Puddles development loops and improve their skills, scripts, and process. Put security first while improving release safety, early feedback, efficiency, and disk use."
---

# Development Loop Manager

Investigate recent Puddles development loops and improve the skills, scripts,
and tooling that guide future work. Make each loop safer, faster, and simpler.

## Principles

- Security first; never cut security corners for speed or convenience.
- Keep it simple (KISS); simplify to reduce edge cases and brittleness.
- Keep production healthy and retain one verified production recovery copy.
- Keep feature work and source merges parallel. One release owner pins merged
  source, builds once in CI, and promotes the same artifact DEV -> TEST -> PROD.
  Later main commits do not invalidate that candidate.
- Scripts own bounded execution, recovery, and cleanup even if an agent vanishes.

## Priorities

- Security gaps: weakened controls, exposed secrets, and unsafe untrusted input.
  Use the [security architecture](../../../docs/openclaw-setup/security-architecture.md)
  for context labels, boundaries, and required controls.
- Late failures: investigate every CI, TEST, or PROD failure for earlier detection
  in local builds and tight DEV loops.
- Automation gaps: routine CI/CD needing an agent to usher it through.
  Agents should monitor and react to issues.
- Parallel work: unnecessary serialization or interference. Coordinate only
  shared resources and actual dependencies. Keep main open while feature gates
  run; validate the combined result through the separate merged-batch gate.
- Feedback cost: slow or repeated builds, checks, retries, handoffs, and local/CI
  differences that delay finding issues.
- Disk growth: package-store reuse, incremental builds, and completed scratch
  on both the development machine and OpenClaw server.
- Approval and autonomy: read the plan's Human Status on resume and handoff.
  Act through its full approved scope; ask only for significant deviations or
  scope expansion. Routine publication, commits, PRs, issue updates, and merges
  need no separate approval within scope. Preserve repo checks and publication
  boundaries; never publish credentials, secrets, or private configuration.
- Asynchronous human: investigate first, prepare a recommendation, and bundle
  related high-value asks. Avoid serial trivial questions. Keep authorized work
  moving and checkpoint while waiting; silence does not grant approval.

## Workflow

### Investigate

- Catch up on the last review, recent changes, and others' work. Build on existing
  improvements.
- Inspect recent loops against the priorities. Follow the evidence to the cause
  and the guidance or tooling that can prevent recurrence.
- Identify demonstrated gaps. If a late failure could not reasonably be caught
  earlier, explain why and look for a practical way to reduce its impact.

### Improve

- Invocation authorizes dev-loop fixes through validation and landing without
  separate design approval. Preserve product behavior, the security architecture,
  and release gates. Get approval for changes outside those bounds or material
  increases in cost or operational risk; continue independent work.
- Fix the guiding skill, script, check, or process. Prefer simplification over
  another mechanism; do not manufacture fixes or duplicate an active owner's work.
- Follow [safe-feature-development](../safe-feature-development/SKILL.md) for
  review, validation, and landing. Autonomy does not waive checks or permissions.
- File product bugs and other findings outside the loop in the owning repository.
  Reuse existing issues; include evidence and a clear next step. Filing does not
  authorize product implementation. Keep sensitive details out of public issues.
- Use the [runner guide](../../../packages/e2e/README.md) and
  [coordination rules](../../../packages/e2e/DEPLOYMENT_COORDINATION.md) for reuse
  and cleanup. Protect other owners' work, retained evidence, and rollback state.
- Use the [storage lifecycle](../../../packages/e2e/DEVELOPMENT_STORAGE.md).
  Keep one mutable build per task, a shared host package store, current candidate,
  current PROD, and one PROD recovery copy. TEST is disposable, including its
  completed rollback snapshots. Keep small results instead of full workspaces.
- Notify workers after changes merge and have them clean completed runs promptly.
  Authorized coordinators can clean abandoned generated data after checking live
  consumers and source/recovery preservation, even if a failed worker cannot
  reply. Age or a missing PID alone is insufficient.
- Remove obsolete gates across skills and scripts together. Required repository
  checks remain enforced; report any executable mismatch until its owner fixes it.
  Do not add manual hash rituals or duplicate release builds as a workaround.
- Account for every actionable finding: fixed with evidence, owned by existing work, linked
  to an issue, or awaiting a specific human decision. Record the review date.
- Check later loops for adoption and results, including actual reclaimed space.
  Revise improvements that did not help.

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
