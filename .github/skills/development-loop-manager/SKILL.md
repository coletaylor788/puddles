---
name: development-loop-manager
description: "Review recent Puddles development loops and improve their skills, scripts, and process. Put security first while improving release safety, early feedback, efficiency, and disk use."
---

# Development Loop Manager

## Priorities

- Put security first; never cut security corners for speed or convenience.
- Protect production and preserve rollback.
- Catch issues in local builds and tight DEV loops.
- Support multiple contributors developing and merging to main in parallel.
- Make CI/CD automated and hands-off; agents monitor and react to issues rather
  than ushering routine stages through.
- Reduce redundant builds, checks, retries, and handoffs.
- Limit disk growth on the development machine and OpenClaw server.
- Reduce avoidable design-approval interruptions.
- Keep skills concise and consistent.
- Confirm improvements help later loops.

## Inspect recent loops

Use these focus areas to start; choose how deeply to investigate each and follow
the evidence into related issues.

- Others also improve the loop. Catch up on recent changes and work in progress
  before revisiting findings or proposing fixes. Build on existing improvements;
  avoid duplicating or undoing them.
- Look for weakened access controls, exposed secrets, unsafe handling of untrusted
  input, and bypassed security checks.
- Investigate every failure beyond DEV, including CI, TEST, and PROD. Identify
  what could have caught or prevented it earlier.
- Look for recurring delays, local/CI differences, and missed integration checks.
  Treat routine CI/CD steps needing agent intervention as automation gaps.
- Look for unnecessary serialization or interference between parallel contributors.
  Keep coordination scoped to shared resources and actual dependencies.
- Check package-store reuse, incremental builds, and completed scratch left behind
  on either host, including outside the artifact pool.
- Review returns for design approval. Fix only obvious general guidance gaps;
  new information sometimes requires approval, and no process change is needed.

## Address findings

- Update the guiding skill, script, check, or process so later features benefit.
  Prefer a small reusable correction; do not manufacture fixes or new rules.
- Follow [safe-feature-development](../safe-feature-development/SKILL.md) for
  approval, validation, and landing. Preserve security controls, release gates,
  and test isolation.
- Use the [runner guide](../../../packages/e2e/README.md) and
  [coordination rules](../../../packages/e2e/DEPLOYMENT_COORDINATION.md) for reuse
  and cleanup. Protect other owners' work, retained evidence, and rollback state.
- Use the [storage lifecycle](../../../packages/e2e/DEVELOPMENT_STORAGE.md) for
  read-only previews and owner-confirmed cleanup. Keep one mutable build and one
  ready payload per task. Age, an idle chat, or a missing PID is not ownership.
- After storage tooling merges, notify affected owners to apply it to their own
  completed work and report actual reclaimed space.
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
