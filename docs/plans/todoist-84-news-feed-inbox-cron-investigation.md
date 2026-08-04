# News feed and inbox cron investigation

Status: Awaiting root-fix approval
Issue: https://github.com/coletaylor788/puddles/issues/84
Last updated: 2026-08-04

## Human section

### Design

The email triage regression began before the named-worker check existed. The July 27 scheduled run used the reader, read mail, returned evidence to main, confirmed archive actions, and handed off the report. The July 28 run had the same cron text, model identity, tools, and system instructions. It used a task handle instead of choosing the reader profile. Because the worker field was optional, the runtime silently created another main worker. That child had no mail-reading tools. The scheduler still marked the run green even though no mail was read and no archive action happened.

The root cause is an ambiguous tool contract. The model-facing schema required a task but made the worker optional, while giving the task handle a clear description. The system therefore depended on the model voluntarily filling an optional field correctly. A model can vary between calls, and the service behind a stable model name can also evolve. The runtime treated that normal variation as permission to change agent identity.

The named-worker check came afterward. It correctly changed silent wrong-agent execution into a denial, but it did not fix the model-facing contract. The worker field is still optional in the schema, so current runs often make an invalid first call and repair it later. The check should remain as defense in depth, but scheduled sessions should see a schema where the worker is required and legal worker IDs are described. Cron text stays plain.

Completion retry failures are a separate older defect. Correct July runs already gathered reader results successfully while child completion delivery retried and expired in the background. The replacement design makes yielding own result collection automatically. When main yields, the runtime durably claims its current direct children, stores their results for main, and records which results were returned. It does not depend on prompt flags or process-local suppression. Existing completion delivery remains the fallback when main does not yield.

### Status

The last correct and first incorrect inbox runs are proven. The named-worker check is classified as a useful mitigation, not the root fix. The unrelated completion defect is also separated and has a system-level design.

Nothing has changed in code, configuration, prompts, schedules, services, or deployments. Cole's approval is required before implementation.

## Agent section

### State

- Phase: Root-fix approval checkpoint
- Approval gate: Required before code, configuration, prompt, schedule, deployment, service, or external-state changes
- Todoist task: `6hCQCRgQPm8Fq8X3`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/84`
- Current direction comment: `6hCWQC9QvwMvV3x3`
- Repository: `coletaylor788/puddles`
- Branch: `coletaylor788-investigate-cron-failures-m8fq8x3`
- Runtime mutation performed by this worker: None

### Scope and acceptance criteria

- Leave both cron prompts unchanged.
- Leave both cron expressions unchanged.
- Make ordinary text such as "use the reader agent" sufficient.
- Require a worker ID in the provider-facing `sessions_spawn` schema for scheduled requesters unless an explicit same-agent opt-out is configured.
- Describe legal worker IDs in that schema without requiring `agents_list`.
- Keep the runtime omission and scheduled self-target checks as defense in depth.
- Preserve deliberate same-agent scheduled children through `requireAgentId: false`.
- Preserve existing interactive target behavior when no explicit policy requires a worker.
- Preserve alternate runtime behavior without introducing provider-incompatible conditional schemas.
- Make `sessions_yield` automatically own durable collection of current direct child results.
- Do not consume grandchildren or unrelated children.
- Do not suppress a result that was not successfully read.
- Return all direct children up to the existing concurrency limit.
- Survive parent interruption and gateway restart without raw duplicate delivery or silent data loss.
- Keep main as the decision and mutation owner.
- Keep reader as the read-only untrusted-content worker.
- Do not trigger production jobs, read live content, mutate mail, or send production messages during automated validation.

### Architecture and decisions

- Proven behavior timeline:
  - July 25, 26, and 27 runs explicitly targeted reader.
  - July 27 is the last proven correct scheduled run.
  - Reader children used mail listing, message reading, and attachment reading tools.
  - Main used confirmed reader evidence, completed archive calls successfully, and handed off the report.
  - July 28 is the first proven incorrect scheduled run.
  - It called `sessions_spawn` with `taskName: "email_reader"` and omitted `agentId`.
  - The runtime accepted the call and created a main child.
  - That child used no mail tool, main performed no archive action, and a report handoff still occurred.
  - The scheduler marked the behaviorally wrong run `ok`.
  - Two manual retries that night repeated the same omission and same-agent child.
- Input comparison:
  - The last correct and first incorrect runs used the same model identity and transport.
  - Their cron prompts differ only in the current date and time.
  - Their system prompts differ only in session identity.
  - Their tool names and `sessions_spawn` schema are otherwise the same.
  - No hidden compiled messages or memory additions were present.
  - An unrelated memory-search setting restarted the gateway before the first wrong run, but it did not alter the compiled prompt, tools, or injected messages.
  - No repository-managed runtime deployment occurred between the runs.
  - The trigger is model-call variation or opaque model-service drift against an already ambiguous schema. The local system cannot safely depend on either being stable.
- Ambiguous spawn contract:
  - The captured schema requires only `task`.
  - `agentId` is an optional string with no description in the pre-fix schema.
  - `taskName` is optional but has a clear stable-alias description.
  - The system prompt encourages `taskName` when a stable handle helps.
  - Omitted native targets default to the requester.
  - A same-agent child inherits the requester run's effective tool restrictions.
  - A task handle or label does not select a profile.
- Named-worker patch classification:
  - The first patch required an explicit target at execution time for scheduled native calls.
  - The real repair attempt then explicitly chose main while keeping a reader-looking label.
  - The follow-up patch denied scheduled self-target repair and listed usable non-requester IDs.
  - These checks correctly fail closed and should stay.
  - They are validators after tool generation, not a complete model-facing contract.
  - The current main configuration also sets `requireAgentId: true`, which applies beyond scheduled sessions. The code already defaults scheduled sessions to strict behavior when this setting is absent.
- Target-contract fix:
  - Build the `sessions_spawn` schema with requester context.
  - For scheduled requesters, make `agentId` a required field in the flat object schema unless `requireAgentId: false` is configured.
  - Generate its description from configured and allowed targets, excluding the requester when scheduled self-target is denied.
  - State that `taskName` and `label` do not select a profile.
  - Keep the schema flat. Do not use top-level conditional unions that some model services reject or flatten incorrectly.
  - For a scheduled tool that exposes both native and alternate runtimes, require `agentId` for both. This deliberately removes implicit scheduled defaults and keeps one provider-compatible contract.
  - Keep execution-time omission, registry, allowlist, and self-target validation unchanged as defense in depth.
  - After promotion, remove the explicit main `requireAgentId: true` configuration. The code default still protects scheduled sessions, while interactive sessions return to their prior optional-target behavior.
  - Keep `requireAgentId: false` as the deliberate scheduled same-agent opt-out.
- Why this meets the plain-language requirement:
  - The cron text continues to say what work belongs to reader in ordinary language.
  - Tool schema is system-owned context, not cron prompt engineering.
  - Required arguments are part of normal structured tool generation.
  - The model chooses a legal role from the tool contract instead of inventing orchestration syntax from the cron text.
  - An invalid generated call still fails closed and receives usable repair choices.
- Completion defect classification:
  - Correct July runs already logged completion retry exhaustion for every reader child.
  - Main still received results through `sessions_yield`, made decisions, and completed correct archive actions.
  - The completion warnings are not the cause of the July 28 behavior break.
  - They are a separate source of false red status, suspended delivery rows, two-hour expiry, duplicate-risk, and session-lock pressure.
  - Re-porting the gather patch alongside the target guard changed patch context only. It did not introduce the completion defect.
- Current completion design defects:
  - `sessions_yield` waits for a recursive descendant tree and reads stored replies.
  - Active and completed suppression use process-local sets.
  - Completion flow may retarget a scheduled requester before checking the active set.
  - Correct runs therefore gather results while completion delivery still retries.
  - Gather marks descendants before proving their replies were read.
  - Reply collection returns only the latest four while marking every matching descendant.
  - Recursive traversal can consume grandchildren that belong to an intermediate coordinator.
  - Process-local completion marks do not survive restart.
- Automatic durable yield design:
  - At `sessions_yield` entry, resolve the exact parent controller run and its current direct child run IDs.
  - Persist a gather claim for those run IDs before waiting.
  - Completion lifecycle checks the durable claim before requester retargeting, steer, direct delivery, retry, or diagnostics.
  - A claimed child stores its frozen result and outcome without external completion delivery.
  - Yield waits only for claimed direct children. A direct coordinator remains responsible for its own descendants.
  - Read results into structured entries containing child ID, label, outcome, and result.
  - Return every claimed direct child up to the existing maximum concurrent children. Remove the unrelated latest-four limit from this path.
  - Mark only successfully read entries as gathered.
  - Keep gathered result text through the normal archive window so a repeated or resumed yield can recover it.
  - A parent crash before collection leaves the claim and result durable. On resumed parent work, yield can collect the same run IDs.
  - If the parent never resumes, the claim expires. Normal completion delivery can retry from the retained result.
  - A durable gathered marker prevents post-restart duplicate delivery after successful collection.
  - Default completion behavior remains unchanged for parents that do not call `sessions_yield`.
  - Retire the process-local active and done sets after the durable path passes migration and rollback tests. Do not layer both as independent owners.
- Status semantics:
  - A wrong-agent child with no required evidence must not produce a green cron result.
  - A child transport warning must not make the parent red when the parent durably gathered that result and completed its requested outcome.
  - An uncollected required child, failed mutation, failed final handoff, or interrupted parent remains an error.

### Implementation

- [x] Verify the tracker contract after Cole's root-cause direction.
- [x] Withdraw prompt-level named-reader and gather-only proposals.
- [x] Classify transition-window runs by actual behavior.
- [x] Prove the last correct and first incorrect runs.
- [x] Compare prompts, system context, tools, model identity, memory context, and local changes.
- [x] Classify the named-worker patch as a mitigation that postdates the break.
- [x] Separate completion delivery failures from the original inbox regression.
- [x] Design a plain-language target contract and automatic durable yield path.
- [ ] After approval, make scheduled target requirements visible in the provider-facing flat schema.
- [ ] After approval, add durable direct-child gather claims and acknowledgments.
- [ ] After approval, remove process-local suppression after compatibility tests pass.
- [ ] After approval, remove the overbroad main `requireAgentId: true` configuration only after runtime promotion.
- [ ] After approval, complete focused tests, cumulative integration, independent review, promotion, production checks, landing, and post-landing checks.

### Validation

- Read-only evidence:
  - Complete inbox cron history
  - Sanitized parent and child transcripts
  - Captured provider-facing tool schemas
  - Captured system prompts, cron prompts, tools, hidden-message counts, model identity, and transport
  - Subagent identity, tool calls, outcomes, delivery state, retry, suspension, and expiry
  - Confirmed main archive tool results and report handoff results
  - Configuration audit and gateway restart metadata
  - Repository and patch history
- Required target-contract regressions:
  - Captured plain-language inbox prompt remains unchanged.
  - Scheduled native schema requires `task` and `agentId`.
  - Scheduled schema uses a flat object with no top-level union keywords.
  - Worker description lists only legal configured targets.
  - `taskName` and `label` descriptions state that they do not select identity.
  - Historical July 28 omission fails schema validation and never creates a child.
  - Historical omitted, explicit requester, and explicit reader execution sequence remains fail-closed, fail-closed, accepted.
  - Interactive unset policy preserves optional target behavior.
  - Explicit `requireAgentId: false` preserves omitted and explicit same-agent scheduled children.
  - Scheduled alternate runtime calls also provide an explicit target.
  - Provider schema projections preserve the required field and flat shape.
- Required durable-yield regressions:
  - Claims exist before a child completion can route.
  - One, multiple, and eight direct children are returned.
  - A child that finishes before yield is included when it belongs to the same parent run.
  - Grandchildren are not claimed or returned to the top-level parent.
  - Error, timeout, silent, malformed, missing-result, and partial-read outcomes are explicit.
  - Only successfully read results are marked gathered.
  - No direct, steer, retry, suspension, expiry, or raw channel delivery occurs for a successfully gathered result.
  - A claim survives gateway restart.
  - Parent resume can collect retained results.
  - An abandoned claim expires and restores normal completion delivery.
  - Successful gather remains deduplicated after restart.
  - Default non-yield completion routing is unchanged.
  - Parent cron status is green only when evidence, required mutations, and final handoff satisfy the job.
- Required synthetic job coverage:
  - Plain-language inbox triage routes reader evidence to main without prompt-level worker syntax.
  - Plain-language news brief routes all readers to main without per-child polling.
  - Recording adapters prove one final handoff and zero raw child deliveries.
  - Mail writes use recording adapters only.
- Required repository gate after implementation:
  - `node packages/e2e/bin/openclaw-test-env.mjs ci`
- Production validation after approval:
  - Check provider-facing scheduled schema and runtime guards with fixed synthetic calls.
  - Check durable gather with synthetic stored results and recording delivery.
  - Do not trigger live jobs, read live content, mutate mail, or send a message.

### Rollout and rollback

- No rollout occurs before approval.
- Keep both prompts and schedules unchanged throughout implementation.
- Preserve a verified runtime and configuration snapshot before promotion.
- Validate target schema, guard behavior, durable gather, default completion, restart, and rollback in the managed test environment.
- Promote the exact reviewed runtime candidate through the documented patch lifecycle.
- Run synthetic read-only production checks.
- Remove main's explicit `requireAgentId: true` only after the installed runtime proves scheduled schemas remain strict by default.
- Rollback order:
  - Restore `requireAgentId: true` first if it was removed.
  - Restore the prior runtime package and configuration snapshot second.
  - Reload through the documented lifecycle and recheck gateway and scheduler health.
- Roll back immediately if the scheduled schema becomes optional, a normal completion is lost, a gathered completion duplicates, or restart cannot recover.

### Review log

- 2026-08-03: Initial investigation found target denials and completion retry failures.
- 2026-08-04: A suppression-focused pass proposed gather-only prompt plumbing.
- 2026-08-04: Cole rejected prompt-level orchestration and required proof of the original inbox break.
- 2026-08-04: Reinvestigation proved July 27 correct and July 28 green-but-wrong with the same semantic inputs.
- 2026-08-04: The root cause is the optional worker field plus silent self default. The named-worker guard came later and is retained as validation.
- 2026-08-04: Completion retry failures were present in correct runs and are classified as a separate runtime defect.
- 2026-08-04: The recommendation now changes only system-owned schema and completion lifecycle. Cron prompts remain unchanged.

### Checklist

- [x] Tracker contract is current.
- [x] Last correct inbox run is proven.
- [x] First incorrect inbox run is proven.
- [x] Working-to-broken input and behavior delta is complete.
- [x] Unrelated config restart and memory context are ruled out.
- [x] Named-worker check is classified as mitigation, not root cause.
- [x] Completion failures are separated from the original behavior failure.
- [x] Plain-language target and completion contracts are designed.
- [x] Validation, rollout, and rollback matrices are documented.
- [x] No behavior or external state was changed.
- [ ] Cole approves the system-level runtime fix.
- [ ] Implementation and committed regressions are complete.
- [ ] Managed validation and independent review are complete.
- [ ] Promotion, production validation, landing, and post-landing checks are complete.
