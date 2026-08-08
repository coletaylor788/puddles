# News feed and inbox cron investigation

Status: Investigating sudden trigger
Issue: https://github.com/coletaylor788/puddles/issues/84
Last updated: 2026-08-07

## Human section

### Design

The routing bug existed before inbox triage visibly failed. For several days the model happened to include the reader worker in an optional field, so the system behaved correctly. The first bad run omitted that field, and the runtime silently used main instead.

Cole is asking what changed at that exact transition. The investigation is separating local code, configuration, prompt, process, and model-family changes from behavior that can change behind a stable model name. It will state what is proven, what is ruled out, and what cannot be recovered from local evidence.

The eventual fix still needs to remove reliance on a model voluntarily filling an optional identity field. No implementation is approved.

### Status

The routing root cause is proven. The immediate trigger for the first bad model call is being rechecked against local and retained request evidence.

Nothing has changed in code, configuration, prompts, schedules, services, or deployments.

## Agent section

### State

- Phase: Read-only sudden-trigger investigation
- Approval gate: Required before code, configuration, prompt, schedule, deployment, service, or external-state changes
- Todoist task: `6hCQCRgQPm8Fq8X3`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/84`
- Follow-up comment: `6hFJMCqwH9MRGCV3`
- Repository: `coletaylor788/puddles`
- Branch: `coletaylor788-investigate-cron-failures-m8fq8x3`
- Runtime mutation performed by this worker: None

### Scope and acceptance criteria

- Reconfirm the last correct and first incorrect model calls.
- Compare exact local prompt, system prompt, tool schema, tools, model identity, transport, hidden context, and runtime package.
- Identify all local changes between those calls.
- Distinguish a local regression from model sampling or an opaque service-side change.
- Explain why several correct runs do not prove the optional contract was safe.
- State whether the exact external trigger is knowable from retained evidence.
- Keep prompts, schedules, configuration, services, and runtime unchanged.

### Architecture and decisions

- Proven root cause:
  - `sessions_spawn` required only `task`.
  - `agentId` was optional.
  - Omission defaulted to requester identity.
  - The first wrong inbox run omitted `agentId`, created main, read no mail, and made no archive action.
- Trigger hypotheses:
  - Local runtime or configuration change
  - Cron prompt or system prompt change
  - Tool schema or tool availability change
  - Model-family change
  - Process restart or prompt-cache state
  - Normal model sampling variation
  - Unversioned service-side model behavior change
- Evidence standard:
  - Proven means retained local artifacts directly show it.
  - Ruled out means before and after artifacts are equivalent for the relevant surface.
  - Possible means local evidence cannot distinguish it.

### Implementation

- [x] Verify the tracker after the sudden-trigger follow-up.
- [x] Reopen the plan before research.
- [ ] Compare retained request and response metadata.
- [ ] Recheck repository, package, config, and gateway events between runs.
- [ ] Recheck model-family transition and run sequence.
- [ ] Evaluate prompt-cache and process-restart relevance.
- [ ] Write the proven explanation and confidence limits.
- [ ] Update the issue and ask one concrete approval question.

### Validation

- Read-only evidence:
  - Correct and incorrect parent transcripts
  - Captured prompts, schemas, tools, model metadata, and usage
  - Gateway and configuration audit logs
  - Installed runtime timestamps
  - Repository and deployment history
  - Cron run sequence before and after the transition
- No implementation validation runs before approval.

### Rollout and rollback

- No rollout occurs during this investigation.
- Any eventual fix remains subject to the managed test, review, promotion, and rollback lifecycle.

### Review log

- 2026-08-04: Routing root cause was traced to optional worker plus requester fallback.
- 2026-08-05: Household confirmed the same latent routing bug.
- 2026-08-07: Cole asked why the latent bug became visible suddenly despite no intended local behavior change.

### Checklist

- [x] Tracker contract is current.
- [x] No behavior or external state was changed.
- [ ] Local transition evidence is complete.
- [ ] External trigger confidence is stated accurately.
- [ ] Final explanation is documented.
- [ ] Cole approves implementation.
