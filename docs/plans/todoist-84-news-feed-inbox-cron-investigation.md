# News feed and inbox cron investigation

Status: Awaiting redesigned approval
Issue: https://github.com/coletaylor788/puddles/issues/84
Last updated: 2026-08-04

## Human section

### Design

The scheduler is healthy. The first scheduled news brief finished and handed off a report, but it still hit the same hidden orchestration problems as the manual attempts. Inbox triage also runs on time and can finish useful work while its internal reader handoff is marked red.

The named-worker check is a safety boundary, not the cause to remove. A task name or label does not choose an agent. Without the check, an unattended job that forgets the reader identifier silently creates another main worker. That worker has the wrong instructions and inherits the cron job's restricted tools. The exact inbox failure that led to this check first omitted the target, then retried by explicitly choosing main. Reverting the check would allow both broken paths again and would weaken every scheduled job owned by main.

The first suppression proposal is too broad. The current gather code infers after spawn that a child result should not be delivered. That decision races with completion, uses process memory, can lose state on restart, walks nested descendants, marks results before proving they were read, and can suppress more results than it returns. Moving that check earlier in the same route would not fix those design problems.

The revised fix makes gathering explicit when the child is created. A spawn can opt into a gather-only result mode. Gather-only children never enter normal completion delivery, so there is nothing to suppress or retry. Their results stay in the durable run record until the same parent run collects them. Existing spawns keep their current delivery behavior. The news and inbox prompts will name the reader and choose gather-only mode, then collect their direct reader results once.

### Status

The deeper safety and side-effect review is complete. The recommendation now keeps the named-worker check, does not extend the existing suppression hack, and adds a narrow opt-in gather path for these jobs.

Nothing has changed in code, configuration, schedules, services, or deployments. Cole's approval is required before implementation.

## Agent section

### State

- Phase: Redesigned approval checkpoint
- Approval gate: Required before code, configuration, schedule, deployment, service, or external-state changes
- Todoist task: `6hCQCRgQPm8Fq8X3`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/84`
- Follow-up comment: `6hCWHQWjF9HX88XV`
- Repository: `coletaylor788/puddles`
- Branch: `coletaylor788-investigate-cron-failures-m8fq8x3`
- Runtime mutation performed by this worker: None

### Scope and acceptance criteria

- Keep the explicit worker-target guard.
- Preserve the opt-out for a deliberately configured same-agent scheduled child.
- Make both cron prompts name `reader` explicitly.
- Add an opt-in gather-only result mode to `sessions_spawn`.
- Keep default spawn completion delivery unchanged.
- Limit gather-only collection to direct children of the exact parent run.
- Return every gather-only direct child up to the existing child concurrency limit.
- Include child identity, label, outcome, and result in the gather response.
- Never send gather-only raw child output to a channel.
- Retain a gather-only result durably through parent exit, crash, or restart within the configured archive window.
- Do not mark a result consumed before it is available to the parent.
- Keep the current 5:30 AM news schedule and 6:00 PM inbox schedule.
- Preserve main as the decision and mutation owner.
- Preserve reader as the read-only untrusted-content worker.
- Do not trigger production jobs, read live content, mutate mail, or send production messages during automated validation.

### Architecture and decisions

- Current scheduler state:
  - The gateway and scheduler are healthy.
  - Inbox triage has one historical missed trigger during a host outage. Recent concerns are not missed schedules.
  - The first scheduled news run at 5:30 AM completed green and handed off a report.
- First scheduled news evidence:
  - The model made three unnamed reader spawns. All three were rejected by the target guard.
  - The model repaired all three with `agentId: "reader"`.
  - `sessions_yield` returned reader results.
  - A later child poll hit a live session write lock and waited for its timeout.
  - All three reader completion deliveries exhausted retries.
  - Their required completion records stayed suspended for two hours, then expired into compact tombstones.
  - The job still finished green because the parent already had enough reader output and completed its separate report handoff.
- Named-worker guard:
  - Native scheduled requests require an explicit `agentId` by default unless configuration sets `requireAgentId: false`.
  - Scheduled requests also reject an explicit requester target unless that same opt-out is set.
  - Alternate runtime requests apply the default only when their implicit target resolves back to the requester. A distinct configured worker default remains valid.
  - Current main configuration sets `requireAgentId: true` and allows main plus its worker profiles. The explicit setting applies to all main spawns. The scheduled self-target check is an additional boundary.
  - Interactive explicit main-to-main spawning remains available because the self-target denial is limited to scheduled requester keys.
  - A same-agent scheduled workflow can opt in deliberately with `requireAgentId: false`.
  - `taskName` and `label` are handles only. They do not select an agent profile.
- Why reverting is unsafe:
  - An omitted target defaults to the requester profile.
  - A same-agent child inherits the parent run's effective allow and deny policy so it cannot elevate beyond the parent.
  - The inbox cron parent had decision and mutation tools but delegated read work. The accidental main child inherited that restricted policy and could not use the reader profile's email tools.
  - The first repair guard rejected omission, but the model retried with explicit main while keeping a reader-looking label. The second guard was added because labels do not change identity.
  - Removing omission checks recreates the original failure.
  - Removing only self-target rejection recreates the failed repair.
  - Setting `requireAgentId: false` on main is agent-wide, not job-specific. It would weaken every scheduled main job and allow omitted interactive targets too.
- Existing gather and suppression path:
  - `sessions_yield` looks for active descendants, blocks the parent turn, waits for the descendant tree, reads stored replies, and returns combined text.
  - Active suppression is stored in a process-local set keyed by requester.
  - Completed suppression is stored in a process-local set keyed by child session.
  - Direct completion delivery checks those sets, but announce flow may retarget an internal scheduled requester before reaching the check.
  - Live children completed while the parent was gathering, were retargeted, bypassed the active key, retried delivery, and suspended.
- Side effects in the current suppression design:
  - Process-local state is not durable across gateway restart.
  - The active check uses the post-retarget completion key, while gather marks the original parent run key.
  - Completed children are marked gathered before reply reading succeeds.
  - A read error can therefore suppress content that was never returned.
  - Reply collection returns only the latest four children while gather marks every matching descendant.
  - More than four children can lose results.
  - Descendant traversal is recursive. A top-level gather can mark grandchildren that belong to an intermediate coordinator.
  - Completion delivery and cleanup are durable, but gather suppression is not.
  - Required completions that miss suppression retry, suspend, consume backlog capacity, and expire later.
- Alternatives rejected:
  - Revert the named-worker guard: recreates silent wrong-agent execution.
  - Move the current suppression check to dispatch: still depends on volatile inferred state and can suppress legitimate delivery.
  - Mark all current descendants delivered from `sessions_yield`: can acknowledge unread, truncated, nested, or unrelated results.
  - Keep prompt-only child polling: the first scheduled news run hit a session lock and used most of its job timeout.
  - Disable `sessions_yield` globally: changes interactive and scheduled semantics for unrelated callers and revives an older workaround against a newer delivery state machine.
- Revised result contract:
  - Add `resultDelivery: "announce" | "gather"` to `sessions_spawn`.
  - Preserve `"announce"` as the default.
  - A `"gather"` child registers with completion delivery not required. It never enters direct, steer, retry, suspend, or channel delivery.
  - Keep its frozen result in durable run state with cleanup mode `keep`.
  - `sessions_yield` first finds direct gather-mode children for its exact controller run.
  - It waits for active gather-mode direct children and also includes ones that finished before the call.
  - It returns structured entries for all matching direct children, bounded by the existing maximum concurrent children rather than a separate limit of four.
  - It does not recursively consume grandchildren. A direct coordinator child owns its own descendants and returns its synthesized result.
  - Child errors and timeouts are returned as outcomes rather than hidden.
  - If result reading fails, the stored result remains available and no normal delivery is attempted.
  - If the parent crashes or never gathers, the result remains internal through the configured archive window, then normal cleanup removes it. It does not fall back to raw channel delivery.
  - Repeated gather calls may return the same retained result. The tool instruction continues to say to synthesize once and not gather again. This favors no data loss over a fragile consume-before-delivery acknowledgment.
- Prompt changes after runtime support:
  - News calls `sessions_spawn` with `agentId: "reader"` and `resultDelivery: "gather"` for each reader.
  - Inbox uses the same explicit fields for each read-only reader.
  - Both call `sessions_yield` once and use its structured result.
  - News removes per-child `sessions_send` polling.
  - Final report handoff, mail rules, delivery target, and cron expressions remain unchanged.

### Implementation

- [x] Verify the reopened Todoist task still points to issue 84 in its first Copilot-authored comment.
- [x] Verify issue 84 still follows the plan link, Summary, and Status contract.
- [x] Trace the original omitted-target and explicit-main repair failures.
- [x] Trace native and alternate runtime guard scope and opt-outs.
- [x] Trace completion retargeting, suppression, retry, suspension, expiry, and cleanup.
- [x] Inspect the first scheduled news run.
- [x] Identify current test gaps and unsafe suppression assumptions.
- [x] Replace the broad suppression proposal with an opt-in gather result contract.
- [ ] After approval, add the gather result mode to spawn schema and runtime registration.
- [ ] After approval, make yield collect exact direct gather-mode children from durable state.
- [ ] After approval, add focused tests and register them in the cumulative patch suite.
- [ ] After approval, update both prompts only after the runtime supports the new field.
- [ ] After approval, complete managed validation, independent review, promotion, production checks, landing, and post-landing checks.

### Validation

- Read-only evidence:
  - Live scheduler status and full job history
  - Sanitized parent tool-call sequences
  - Child execution, completion, delivery, suspension, and expiry state
  - Gateway completion retry warnings
  - Current runtime configuration
  - Maintained patch source and installed bundle markers
  - Native and alternate spawn policy tests
  - Gather, announce dispatch, delivery state, cleanup, persistence, and restart source
- Test gaps in the current patch:
  - The cumulative gather patch runs only the yield tool and process-local state tests.
  - No maintained patch test joins yield gathering to real completion delivery.
  - The state test does not exercise completed-child marking.
  - No test covers requester retargeting during active gather.
  - No test covers more than four children, nested children, read failure, or restart.
- Required post-approval regressions:
  - Spawn schema preserves default announce behavior and accepts explicit gather mode.
  - Gather mode registers completion delivery as not required and never calls direct or steer delivery.
  - An explicit reader gather spawn keeps the reader's own tools.
  - Omitted and explicit self-target scheduled spawns remain denied.
  - The intentional `requireAgentId: false` same-agent scheduled path remains allowed.
  - Native and alternate runtime target behavior stays aligned.
  - A child that finishes before `sessions_yield` is included.
  - Multiple active direct children are all included after drain.
  - Eight direct children are returned without a hidden four-child loss.
  - Grandchildren are not returned to or consumed by the top-level parent.
  - A direct coordinator's synthesized result is returned after its descendants settle.
  - Error, timeout, silent, missing-result, and malformed stored-result cases are explicit.
  - Parent interruption and gateway restart retain gather-mode results without external delivery.
  - Repeated gather is safe and does not delete the only durable result.
  - Default announce-mode direct, steer, fallback, cleanup, retry, suspension, and restart tests remain unchanged.
  - Synthetic news and inbox prompts produce one final recording-adapter handoff and no raw reader delivery.
- Required repository gate after implementation:
  - `node packages/e2e/bin/openclaw-test-env.mjs ci`
- Production validation after approval:
  - Confirm installed spawn schema and target policy with fixed synthetic calls.
  - Confirm gather mode with fake stored results and recording delivery.
  - Do not trigger live jobs, read live content, mutate mail, or send a message.

### Rollout and rollback

- No rollout occurs before approval.
- Deploy runtime support before editing either prompt.
- Preserve a verified runtime and configuration snapshot before promotion.
- Validate default announce behavior and new gather behavior in the managed test environment.
- Promote the exact reviewed runtime candidate through the documented patch lifecycle.
- Run synthetic read-only production checks.
- Update the prompts only after the installed runtime accepts `resultDelivery: "gather"`.
- Keep both cron expressions unchanged.
- Rollback order matters:
  - Restore the prior prompts first so they no longer use the new field.
  - Restore the prior runtime package and configuration second.
  - Reload through the documented lifecycle and recheck gateway and scheduler health.
- If prompt restoration fails, do not restore the old runtime because the new prompt would be incompatible.

### Review log

- 2026-08-03: Initial read-only investigation found a healthy scheduler, one historical host outage, missing explicit worker targets, recovered inbox runs recorded as red, and gathered child completion retries.
- 2026-08-04: Cole requested deeper analysis of suppression side effects and the named-worker guard.
- 2026-08-04: Review confirmed the guard prevents both the original omitted-target failure and the later explicit-main repair.
- 2026-08-04: Review found that the first suppression proposal was incomplete. Current suppression is inferred, volatile, recursive, and able to acknowledge unread or omitted results.
- 2026-08-04: The recommendation changed to an explicit gather-only spawn contract that leaves existing completion delivery untouched.
- 2026-08-04: No implementation review has started because approval is still pending.

### Checklist

- [x] Tracker contract is current.
- [x] Initial runtime topology and timelines are mapped.
- [x] First scheduled news run is analyzed.
- [x] Named-worker guard purpose, scope, opt-out, and alternatives are documented.
- [x] Suppression routing, retargeting, limits, nesting, persistence, and cleanup are documented.
- [x] The broad suppression move is withdrawn.
- [x] Revised gather-only contract and side-effect boundaries are documented.
- [x] Validation, rollout, and rollback matrices are documented.
- [x] No behavior or external state was changed.
- [ ] Cole approves the redesigned runtime and prompt changes.
- [ ] Implementation and committed regressions are complete.
- [ ] Managed validation and independent review are complete.
- [ ] Promotion, production validation, landing, and post-landing checks are complete.
