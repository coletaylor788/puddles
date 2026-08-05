# News feed and inbox cron investigation

Status: Reviewing tool and policy side effects
Issue: https://github.com/coletaylor788/puddles/issues/84
Last updated: 2026-08-05

## Human section

### Design

The inbox regression began before the named-worker check existed. The last correct run used reader to gather mail evidence, then main made decisions, confirmed archive actions, and handed off the report. The first incorrect run had the same cron text, model identity, tools, and system instructions. It supplied a task handle but omitted the optional worker. The runtime silently created main instead of reader, read no mail, made no archive action, and still marked the run green.

The root cause is an ambiguous tool contract, but Cole wants the full call surface and side effects before approving a fix. The current review is tracing each scheduler, main, reader, mutation, wait, and handoff call. It is also measuring how worker selection behaves in interactive, scheduled, child-agent, and alternate-runtime sessions.

The goal remains a plain-language cron. Cron text should not contain runtime plumbing. Any worker requirement belongs in the system-owned tool contract and must not accidentally break legitimate non-scheduled same-agent work, alternate runtime defaults, nested coordinators, or existing scripts.

### Status

The behavior transition is proven. The proposed required-worker schema and durable yield design are still unapproved while their exact parameter and non-scheduled effects are reviewed.

Nothing has changed in code, configuration, prompts, schedules, services, or deployments.

## Agent section

### State

- Phase: Read-only tool-surface and side-effect review
- Approval gate: Required before code, configuration, prompt, schedule, deployment, service, or external-state changes
- Todoist task: `6hCQCRgQPm8Fq8X3`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/84`
- Follow-up comment: `6hCmVMcx4f26RvGV`
- Repository: `coletaylor788/puddles`
- Branch: `coletaylor788-investigate-cron-failures-m8fq8x3`
- Runtime mutation performed by this worker: None

### Scope and acceptance criteria

- Name every tool used by the scheduler, main, reader, mutation path, result wait, and final handoff.
- List the relevant parameters and which component supplies each one.
- Distinguish `agentId`, `taskName`, `label`, runtime, mode, cleanup, context, result delivery, and timeout semantics.
- Explain exactly what changes when `agentId` moves from optional to required.
- Analyze scheduled native, scheduled alternate runtime, interactive main, interactive worker, nested child, explicit same-agent, omitted same-agent, and invalid-target cases.
- Measure historical non-scheduled spawn calls before deciding whether main's explicit `requireAgentId: true` setting is overbroad.
- Preserve plain-language cron prompts and current schedules.
- Keep the runtime guard fail-closed until a replacement proves equal safety.
- Keep main as decision and mutation owner and reader as untrusted-content reader.
- Do not trigger production jobs, read live content, mutate mail, or send messages during research.

### Architecture and decisions

- Proven root-cause facts:
  - July 27 is the last behaviorally correct scheduled inbox run.
  - July 28 is the first behaviorally incorrect scheduled inbox run.
  - Correct reader children used mail listing, message reading, and attachment reading tools.
  - Correct main runs confirmed archive tool results and handed off reports.
  - The incorrect run called `sessions_spawn` with `taskName: "email_reader"` and no `agentId`.
  - The runtime accepted that call as a main child.
  - The main child had no mail tools, and the parent performed no archive action.
  - Prompt, system context, tool schema, model identity, transport, and hidden message count did not materially change.
- Current target behavior:
  - The provider-facing schema requires only `task`.
  - `agentId`, `taskName`, and `label` are optional.
  - Pre-fix `agentId` had no description while `taskName` had a stable-alias description.
  - Omitted native `agentId` defaults to requester identity.
  - Same-agent children inherit requester tool restrictions.
  - Current execution guards reject omitted scheduled targets and scheduled self-targets unless `requireAgentId: false`.
  - Current main configuration sets `requireAgentId: true`, so omission is rejected outside cron too.
- Current completion behavior:
  - Main uses `sessions_yield` to wait for reader evidence.
  - Correct runs already logged child completion retry exhaustion while yield still returned results.
  - Process-local gather suppression and durable completion delivery disagree about ownership.
  - Completion transport is a separate defect from the July 28 wrong-agent run.
- Pending decisions:
  - Whether provider-facing `agentId` should be required only for scheduled sessions or whenever effective policy requires it.
  - Whether current main `requireAgentId: true` has legitimate non-scheduled callers that rely on optional self-spawn.
  - How one flat provider-compatible schema handles both native and alternate runtime targets.
  - Whether legal target IDs belong in an enum, description, or both.
  - How durable yield claims interact with non-yield auto-announce, nested children, restart, and cleanup.

### Implementation

- [x] Verify the tracker after Cole's parameter follow-up.
- [x] Reopen the plan before further research.
- [ ] Extract exact working and failing parent tool calls and arguments.
- [ ] Extract exact reader tool calls and argument shapes.
- [ ] Map scheduler startup and final handoff calls.
- [ ] Document the full `sessions_spawn` parameter schema and defaults.
- [ ] Survey historical scheduled and non-scheduled target omission.
- [ ] Analyze effective `requireAgentId` policy in every requester context.
- [ ] Analyze schema compatibility for native and alternate runtimes.
- [ ] Recheck durable yield side effects against the full tool chain.
- [ ] Rewrite the plan with final parameter and side-effect conclusions.
- [ ] Update the issue and ask one concrete approval question.

### Validation

- Read-only evidence:
  - Captured parent and child transcripts
  - Captured provider-facing schemas
  - Runtime configuration and policy resolution
  - Subagent registry and completion state
  - Historical session index and tool-call metadata
  - Cron run, gateway, and secure integration audit metadata
  - Source, tests, patch, and deployment history
- Required output:
  - Exact tool sequence for one correct and one incorrect inbox run
  - Parameter table for each tool
  - Context matrix for required versus optional worker selection
  - Compatibility and migration risks
  - Revised no-prompt implementation boundary
- No implementation validation runs before approval.

### Rollout and rollback

- No rollout occurs during this review.
- Do not edit either prompt or schedule.
- Do not change main's `requireAgentId` configuration until non-scheduled behavior is measured and approved.
- Any eventual runtime change must use the managed test and patch lifecycle with synthetic production checks and a verified recovery snapshot.

### Review log

- 2026-08-04: Root-cause analysis proved optional worker plus silent self default caused the first wrong inbox run.
- 2026-08-04: Named-worker execution checks were classified as later fail-closed mitigation.
- 2026-08-04: Completion retries were separated as an older independent defect.
- 2026-08-05: Cole requested exact tools, parameters, required-field effects, and non-scheduled side effects before approval.

### Checklist

- [x] Tracker contract is current.
- [x] Last correct and first incorrect runs are proven.
- [x] No behavior or external state was changed.
- [ ] Exact tool and parameter chain is documented.
- [ ] Scheduled and non-scheduled policy matrix is complete.
- [ ] Historical interactive compatibility is measured.
- [ ] Alternate runtime and nested-child effects are resolved.
- [ ] Durable yield side effects are synchronized with the tool chain.
- [ ] Final fix, validation, rollout, and rollback are documented.
- [ ] Cole approves implementation.
