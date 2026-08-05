# News feed and inbox cron investigation

Status: Rechecking routing consistency
Issue: https://github.com/coletaylor788/puddles/issues/84
Last updated: 2026-08-05

## Human section

### Design

The inbox flow says reader should do the reading, but that is not the same as the tool form requiring a worker. The investigation must separate plain-language instructions, the structured form shown to the model, runtime policy, and the fallback used when a field is omitted.

Today the structured form requires only a task. If the model omits the worker, native spawning substitutes the requester’s own identity. That is how the broken inbox run created main without naming main. A later runtime check rejects that omission for current main, but the form still tells the model the worker is optional.

Cole also challenged the household exception. That is unresolved. Household has omitted calls and same-household children in retained history, but those may be intended parallel household work or the same ambiguous routing bug. The review is classifying those runs before deciding whether required worker selection should follow local policy or become a consistent coordinator rule.

### Status

The prior approval request is paused. The exact difference between instructions, schema, runtime checks, and fallback routing is being documented, and household routing is being re-evaluated from actual runs.

Nothing has changed in code, configuration, prompts, schedules, services, or deployments.

## Agent section

### State

- Phase: Read-only routing consistency review
- Approval gate: Required before code, configuration, prompt, schedule, deployment, service, or external-state changes
- Todoist task: `6hCQCRgQPm8Fq8X3`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/84`
- Follow-up comment: `6hCpgJwm4m7Pqqq3`
- Repository: `coletaylor788/puddles`
- Branch: `coletaylor788-investigate-cron-failures-m8fq8x3`
- Runtime mutation performed by this worker: None

### Scope and acceptance criteria

- Identify every place `agentId` is described, required, defaulted, or rejected.
- Explain why the flow can say reader while the provider schema still permits omission.
- Trace the exact omitted-target code path from tool input to child session key.
- Identify which part failed on July 28.
- Classify household omitted and same-household spawns as intended or erroneous.
- Decide whether worker identity should be globally required, required for multi-profile coordinators, or policy-specific.
- Preserve plain-language cron prompts.
- Preserve intentional same-agent work only when it is explicit and safe.
- Do not trigger jobs, read live content, mutate external state, or send messages during research.

### Architecture and decisions

- Established layers:
  - Job text says which role should do the work.
  - System prompt gives general delegation guidance.
  - Provider-facing tool schema defines required and optional structured fields.
  - Tool execution parses the call.
  - Target policy validates identity and allowlists.
  - Spawn runtime creates the child and applies tool inheritance.
- Established mismatch:
  - The job text says reader.
  - The provider-facing schema currently requires only `task`.
  - `agentId`, `taskName`, and `label` are optional.
  - Omitted native `agentId` becomes requester identity.
  - `taskName` and `label` do not select identity.
  - Current main runtime policy rejects omission, but that happens after generation.
- Household question:
  - Household allows household, household-reader, and household-browser-agent.
  - It has no explicit `requireAgentId` setting.
  - Retained rows include household self children and explicit worker children.
  - The intent and correctness of each self child must be proven before preserving this difference.

### Implementation

- [x] Verify the tracker after Cole's routing follow-up.
- [x] Reopen the plan before research.
- [ ] Map all required/default/rejection sites for `agentId`.
- [ ] Trace omitted native and alternate-runtime target resolution.
- [ ] Reconstruct household omitted and self-target runs.
- [ ] Compare household task intent with actual child identity and tools.
- [ ] Decide the consistent worker identity contract.
- [ ] Synchronize completion design with the final routing contract.
- [ ] Update the issue and ask one concrete approval question.

### Validation

- Read-only evidence:
  - Captured provider-facing schemas and prompts
  - Tool execution and spawn source
  - Target policy and configuration
  - Main and household transcripts
  - Subagent registry identity, task metadata, tools, and outcomes
  - Existing native and alternate-runtime tests
- Required result:
  - A line-by-line omitted-target explanation
  - A table of instruction, schema, execution, policy, and spawn behavior
  - Household run classification
  - One consistent proposed contract with side effects and migration plan
- No implementation validation runs before approval.

### Rollout and rollback

- No rollout occurs during this review.
- Do not change current guards or coordinator configuration.
- Any eventual fix must preserve a verified recovery snapshot and use the managed patch lifecycle with synthetic checks.

### Review log

- 2026-08-04: Root cause was traced to optional worker plus silent self default.
- 2026-08-05: Exact tool and parameter chain was documented.
- 2026-08-05: Cole identified an unresolved inconsistency between “reader is required” in the flow and optional worker in the schema, and challenged household's different behavior.

### Checklist

- [x] Tracker contract is current.
- [x] No behavior or external state was changed.
- [ ] Required versus optional layers are fully separated.
- [ ] Omitted routing is explained line by line.
- [ ] Household self-spawns are classified.
- [ ] Consistent routing contract is designed.
- [ ] Completion design matches the routing contract.
- [ ] Cole approves implementation.
