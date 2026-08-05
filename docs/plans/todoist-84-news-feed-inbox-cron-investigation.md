# News feed and inbox cron investigation

Status: Awaiting tool-contract approval
Issue: https://github.com/coletaylor788/puddles/issues/84
Last updated: 2026-08-05

## Human section

### Design

The email job has a clear intended chain. The scheduler starts main. Main reads its rules, delegates untrusted mail reading to reader, waits for reader evidence, makes the triage decisions, confirms mail changes, hands the report to the live main conversation, and that conversation sends the message. The scheduler does not start reader directly.

The July break happened at the delegation step. The model-facing contract required a task but made the worker optional. One run chose the reader correctly. The next run used a task handle and omitted the worker, so the runtime silently started another main worker. That child had no mail-reading tools. The job still looked green even though the intended work never happened.

Making the worker required does not add anything to the cron text. It changes the structured tool form the system gives the model. It should happen only when the requester’s effective policy already requires a worker. Current main already enforces that rule in scheduled and interactive sessions, so exposing it in the schema moves the same failure earlier and makes valid generation more likely. Other coordinators that allow implicit same-agent children keep an optional worker field.

The result-wait problem is separate. Main already gets reader results through the wait tool, but completion delivery also retries in parallel. The runtime fix should make the wait tool durably own the direct children it is collecting. That removes duplicate delivery work without adding gather flags, polling instructions, or delivery plumbing to the cron.

### Status

The exact tool chain, parameter surface, retained usage history, and scheduled versus non-scheduled side effects are complete. The recommendation no longer removes main’s explicit worker policy because retained non-scheduled main traffic already complies with it.

Nothing has changed in code, configuration, prompts, schedules, services, or deployments. Cole's approval is required before implementation.

## Agent section

### State

- Phase: Tool-contract approval checkpoint
- Approval gate: Required before code, configuration, prompt, schedule, deployment, service, or external-state changes
- Todoist task: `6hCQCRgQPm8Fq8X3`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/84`
- Follow-up comment: `6hCmVMcx4f26RvGV`
- Repository: `coletaylor788/puddles`
- Branch: `coletaylor788-investigate-cron-failures-m8fq8x3`
- Runtime mutation performed by this worker: None

### Scope and acceptance criteria

- Keep both cron prompts and cron expressions unchanged.
- Document every tool call and relevant parameter in the correct and incorrect inbox paths.
- Make the provider-facing schema match effective runtime target policy.
- Do not make `agentId` globally required.
- Require `agentId` when the requester configuration or scheduled default already requires it.
- Keep `agentId` optional when `requireAgentId: false` or an allowed non-scheduled requester keeps optional self-spawn semantics.
- Keep execution-time target, allowlist, registry, and scheduled self-target checks.
- Keep plain-language worker intent in the cron.
- Keep main as decision and mutation owner and reader as read-only evidence owner.
- Make result waiting durable and automatic without prompt flags.
- Preserve default completion delivery when a parent does not wait.
- Do not trigger production jobs, read live content, mutate mail, or send messages during automated validation.

### Architecture and decisions

- Scheduler invocation:
  - The scheduled execution does not call the model-facing `cron` tool.
  - The scheduler reads the stored job and starts an isolated `agentTurn`.
  - Current inbox job fields:
    - `agentId: "main"`
    - `sessionTarget: "isolated"`
    - `wakeMode: "now"`
    - schedule `0 18 * * *` in the configured Pacific time zone
    - payload kind `agentTurn`
    - payload timeout `900` seconds
    - light context enabled
    - delivery mode `none`
  - The `cron` tool is used only to add, edit, enable, disable, list, inspect, manually run, or remove job definitions.
- Correct July 27 parent sequence:
  - `read`
    - Parameter: `path` required, with optional `offset` and `limit`.
    - Purpose: load main's triage skill and learning files.
  - First `sessions_spawn`
    - `task`: required reader objective, 388 characters in the captured run.
    - `agentId: "reader"`.
    - `mode: "run"`.
    - All other spawn parameters omitted.
  - First `sessions_yield`
    - Optional `message` supplied, 30 characters.
    - Returned `status: "subagent_results"` with the reader result.
  - Two more `sessions_spawn` calls
    - `task`: required follow-up reader objectives, 394 and 444 characters.
    - `agentId: "reader"`.
    - `mode: "run"`.
  - Second `sessions_yield`
    - Optional `message` supplied, 41 characters.
    - Returned both follow-up reader results.
  - Two `archive_email` calls
    - Required `email_ids` array.
    - Captured batches contained 21 and 4 IDs.
    - Both tool results succeeded.
  - `sessions_send`
    - `sessionKey`: live main conversation.
    - `message`: consolidated triage handoff, 1,961 characters.
    - `timeoutSeconds: 60`.
    - Returned `status: "ok"` with pending downstream delivery.
  - Final parent response was `OK`.
- Incorrect July 28 parent sequence:
  - The same two initial `read` calls.
  - One `sessions_spawn`
    - `task`: required reader objective, 652 characters.
    - `taskName: "email_reader"`.
    - `agentId` omitted.
    - `mode: "run"`.
  - Runtime accepted the call and created a main child.
  - One `sessions_yield` returned the main child's short result.
  - No `archive_email` call occurred.
  - `sessions_send`
    - Same live main target class.
    - `message`: 687-character degraded report.
    - `timeoutSeconds: 60`.
  - Scheduler recorded the parent `ok`.
- Correct reader tool sequence:
  - `list_emails`
    - No required parameters.
    - Available filters: `max_results`, `label`, `category`, `unread_only`, and raw Gmail `query`.
    - Captured reader used `query` and `max_results: 20` in two calls.
  - `get_attachments`
    - Required `email_id`.
    - Optional `filename`.
    - Downloads into the reader workspace under `attachments/`.
  - `read`
    - Required `path`.
    - Optional `offset` and `limit`.
    - Reader used it only on downloaded attachment paths.
  - `get_email`
    - Required `email_id`.
    - Optional `format`, defaulting to full.
    - Captured follow-up reader made six successful calls.
  - Reader never received `archive_email`, `add_label`, `message`, or `sessions_spawn`.
- Incorrect main child:
  - Child identity was main, not reader.
  - It received the same-agent inherited restrictions from the cron parent.
  - It called no mail tool.
  - In a later reproduced failure, a same-agent child tried `exec`, which was not a substitute for reader mail tools and failed.
- Final channel delivery:
  - `sessions_send` does not itself send to the external channel.
  - It starts or wakes the live main session with:
    - one of `sessionKey`, `label`, or `agentId` as target
    - required `message`
    - optional non-negative `timeoutSeconds`
  - The live main session is instructed to use `message`.
  - Relevant `message` fields are:
    - `action`, normally `send`
    - `channel`
    - `target` or `targets`
    - `accountId`
    - message body
  - Runtime records show the downstream live-main runs completed.
- Complete `sessions_spawn` provider-facing parameters:
  - `task`: required string. The child objective.
  - `taskName`: optional stable handle for later targeting. It does not select identity.
  - `label`: optional display label. It does not select identity.
  - `runtime`: optional `subagent` or `acp`; defaults to native subagent.
  - `agentId`: optional today. Native profile ID or alternate runtime harness ID depending on runtime.
  - `model`: optional model override.
  - `thinking`: optional thinking override.
  - `cwd`: optional working directory.
  - `thread`: optional thread binding where supported.
  - `mode`: optional `run` or `session`; non-thread default is run.
  - `cleanup`: optional `delete` or `keep`; tool default is keep and session mode forces keep.
  - `sandbox`: optional `inherit` or `require`; default is inherit.
  - `context`: optional `isolated` or `fork`; default is isolated and cross-agent fork is rejected.
  - `lightContext`: optional boolean for native subagents.
  - `attachments`: optional array of up to 50 snapshot attachments with name, content, optional encoding, and optional MIME type.
  - `attachAs.mountPath`: optional child attachment path hint.
  - `resumeSessionId`: optional alternate-runtime resume target when that runtime is available.
  - `streamTo`: optional alternate-runtime stream target when available.
- Defaults and identity implications:
  - Omitted native `agentId` becomes requester agent ID.
  - Explicit cross-agent target uses the target profile's tools and workspace.
  - Same-agent target inherits the requester's effective allow and deny restrictions.
  - `taskName` and `label` never alter those rules.
  - `agentId` does not change scheduler ownership. The scheduler still starts main.
  - Requiring `agentId` does not change task, model, mode, cleanup, sandbox, context, timeout, result delivery, mail permissions, or final handoff.
- Effective worker policy:
  - Current main:
    - `allowAgents` includes main and its allowed worker profiles.
    - `requireAgentId: true`.
    - Omission is already rejected in scheduled and non-scheduled main sessions at execution time.
    - Scheduled self-target is additionally denied unless the setting is explicitly false.
  - Scheduled default:
    - Native scheduled requesters default to requiring a target when no explicit setting exists.
    - Explicit `requireAgentId: false` opts into omitted and explicit same-agent scheduled children.
  - Household coordinator:
    - Has multiple allowed profiles but no explicit worker requirement.
    - Retained history includes six household self children, including omitted calls.
    - Its schema must stay optional unless its policy is separately changed.
  - Reader and browser profiles:
    - Reader has no spawn tool.
    - Browser's allowlist is empty and its configured tools do not include spawn.
- Retained usage history since May:
  - Main scheduled sessions:
    - 319 spawn calls.
    - 289 explicit cross-agent calls.
    - 27 omitted calls.
    - 3 explicit main calls.
    - No alternate-runtime calls.
  - Main persistent session:
    - 198 calls, all explicit reader.
  - Main iMessage sessions:
    - 33 calls, all explicit reader or browser worker.
  - Other retained main contexts:
    - 119 calls.
    - 116 explicit cross-agent calls.
    - 3 omitted calls, including investigation or explicit sessions that repaired to reader.
  - User-facing non-scheduled main plus iMessage:
    - 231 calls.
    - Zero omitted calls.
    - Zero explicit self calls.
  - Household:
    - 36 retained model calls.
    - 32 explicit cross-agent and 4 omitted.
    - Registry contains 6 household self children.
  - No retained `runtime: "acp"` model calls were found in these coordinator transcripts.
- Required-field design:
  - Generate the schema from requester context and effective policy.
  - If effective `requireAgentId` is true, make `agentId` required in the flat schema.
  - If a native scheduled requester has no explicit setting, apply the existing scheduled default and make it required.
  - If effective policy is false, keep it optional.
  - Keep main's current explicit `requireAgentId: true`; do not remove it in this change.
  - Generate an `agentId` description that separates allowed native profile IDs from allowed alternate runtime harness IDs.
  - Exclude main from the scheduled native suggestions when scheduled self-target is denied.
  - Keep `agentId` as a string rather than a fixed enum because native and alternate runtimes use different ID registries and runtime availability can change.
  - Keep the object schema flat. Some model services reject or rewrite top-level conditional unions.
  - Keep runtime execution checks because programmatic callers can bypass provider schema validation and configuration can reload during a turn.
- What required changes for current main:
  - Before:
    - Model sees `required: ["task"]`.
    - Omission reaches tool execution, then current policy rejects it.
  - After:
    - Model sees `required: ["task", "agentId"]`.
    - Valid structured generation includes a worker before execution.
    - If invalid generation still omits it, execution rejects it exactly as today.
  - Accepted explicit reader and browser calls do not change.
  - Explicit interactive `agentId: "main"` remains allowed by normal allowlist policy.
  - Scheduled explicit main remains denied by the scheduled self-target rule.
  - Current user-facing non-scheduled traffic already supplies a worker, so no retained compatibility break is expected.
- Non-scheduled side effects:
  - Main interactive sessions:
    - Schema becomes required because current main policy is already true.
    - This aligns schema with existing runtime behavior rather than creating a new restriction.
    - Any external automation that relies on omitted main self-spawn already fails current execution policy.
    - Explicit same-agent automation remains possible where allowlist policy permits it.
  - Household and other optional-policy coordinators:
    - Schema stays optional.
    - Existing omitted self-spawns keep working.
  - Child agents:
    - Policy resolves from child identity, not inherited main policy.
    - Profiles without `sessions_spawn` are unaffected.
    - A child coordinator with explicit requirement gets a required schema; one without it remains optional.
  - Alternate runtime:
    - When effective policy requires a worker, scheduled and non-scheduled model calls must supply a harness ID.
    - This can make a configured implicit default explicit in model-generated calls.
    - Direct programmatic runtime calls still face execution policy, not only schema.
    - No retained current usage depends on omitted alternate-runtime target.
  - Tool schema and cache:
    - Required list and description change the tool schema hash.
    - The first run after deployment may miss an existing prompt cache entry.
    - The added description slightly increases prompt tokens.
    - Flat shape avoids provider union compatibility regressions.
  - Configuration reload:
    - Tools are built from the run's configuration snapshot.
    - A mid-run config change can make displayed schema stale.
    - Execution-time policy remains the authoritative final check.
  - Security:
    - Allowed agent IDs are configuration metadata already available through `agents_list` in contexts that expose it.
    - Scheduled sessions currently lack `agents_list`, so the schema description provides only their legal choices.
    - No credentials or private content are added.
- `sessions_yield` parameters and effect:
  - Provider-facing input has one optional string: `message`.
  - If active descendants exist, current code blocks in-turn, waits, returns `subagent_results`, and does not end the turn.
  - If none are active, it calls the runtime yield callback and ends the turn.
  - The default gather timeout is runtime-owned, not a model parameter.
  - The durable design changes internal ownership only. It adds no provider-facing parameter.
- Durable yield side effects:
  - Claims only exact direct child run IDs visible when yield begins, plus same-parent direct children that finish before claim resolution.
  - Grandchildren stay owned by their direct coordinator.
  - Claimed result state is durable across gateway restart.
  - Successfully returned results get a durable gathered marker.
  - Unread or malformed results are not marked gathered.
  - Parent restart can repeat collection from retained result state.
  - Expired abandoned claims return to normal completion routing.
  - Parents that never call yield keep current auto-announce behavior.
  - Process-local suppression is removed only after migration tests prove durable ownership.
  - The result structure grows from combined text to labeled per-child entries. System prompt synthesis guidance must accept that shape, but cron text does not change.
- Status and error implications:
  - Missing required worker becomes model/schema validation or the existing tool denial, never silent main execution.
  - A correct parent that durably gathered results is not made red by duplicate completion retries.
  - A child without required evidence, failed archive call, failed final handoff, parent interruption, or expired uncollected required result remains an error.

### Implementation

- [x] Verify the tracker after Cole's tool-parameter follow-up.
- [x] Extract exact correct and incorrect parent call sequences.
- [x] Extract exact reader tool and parameter shapes.
- [x] Map scheduler startup and final handoff surfaces.
- [x] Document the complete `sessions_spawn` parameter schema and defaults.
- [x] Survey retained scheduled, interactive, explicit, child, and household targeting behavior.
- [x] Build the required versus optional policy matrix.
- [x] Reconcile durable yield with the exact tool chain.
- [ ] After approval, generate policy-aware provider-facing spawn schema.
- [ ] After approval, add durable direct-child yield claims and gathered markers.
- [ ] After approval, keep main policy unchanged and preserve optional household behavior.
- [ ] After approval, complete focused tests, cumulative integration, independent review, promotion, production checks, landing, and post-landing checks.

### Validation

- Required schema regressions:
  - Current main scheduled and interactive schemas require `task` and `agentId`.
  - Household schema keeps only `task` required.
  - Scheduled requester with unset policy requires `agentId`.
  - Scheduled requester with explicit false keeps it optional and allows self.
  - Interactive requester with unset policy keeps it optional.
  - Interactive explicit main and explicit cross-agent calls remain accepted by allowlist policy.
  - Scheduled explicit main remains denied.
  - Legal native and alternate IDs appear in generated descriptions without secrets.
  - Schema remains a flat object after provider projection.
  - Programmatic omission still reaches execution guard and fails closed.
  - Configuration reload cannot bypass execution validation.
- Required exact-path regressions:
  - Replay July 27 explicit reader call and preserve reader tools.
  - Replay July 28 omitted target and reject before child creation.
  - Replay omitted, explicit main, explicit reader scheduled sequence as denied, denied, accepted.
  - Preserve `taskName` as a handle only.
  - Preserve mode, cleanup, sandbox, context, model, thinking, cwd, attachment, and alternate runtime defaults.
- Required non-scheduled regressions:
  - Main interactive schema and runtime agree that target is required.
  - Explicit main interactive self-spawn retains inherited restrictions.
  - Explicit reader interactive spawn gets reader tools.
  - Household omitted self-spawn remains accepted.
  - Household explicit reader and browser spawns remain accepted.
  - Reader and browser profiles do not gain a spawn tool.
  - Nested coordinator policy resolves from the child profile.
- Required durable-yield regressions:
  - One, multiple, and eight direct children are claimed and returned.
  - Child completion during active wait does not retarget or retry.
  - Child completed before wait is returned when it belongs to the same parent run.
  - Grandchildren are not claimed by the top-level parent.
  - Only readable results receive gathered markers.
  - Error, timeout, silent, malformed, missing, and partial results are explicit.
  - Gateway restart preserves claims and gathered deduplication.
  - Parent resume can repeat collection.
  - Abandoned claims expire into normal completion routing.
  - Non-yield auto-announce remains unchanged.
  - Correct gather produces no duplicate direct, steer, retry, suspension, expiry, or raw channel delivery.
- Required synthetic job coverage:
  - Unchanged inbox prompt routes mail reads to reader, decisions and writes to main, and one report to recording delivery.
  - Unchanged news prompt routes reader evidence to main without raw child delivery.
  - Recording mail and message adapters deny unsupported writes.
- Required repository gate after implementation:
  - `node packages/e2e/bin/openclaw-test-env.mjs ci`
- Production validation after approval:
  - Inspect installed schemas for main, household, scheduled, and interactive contexts.
  - Exercise fixed synthetic spawn and gather records with recording delivery.
  - Do not trigger live jobs, read live content, mutate mail, or send a message.

### Rollout and rollback

- No rollout occurs before approval.
- Keep prompts, schedules, and current main `requireAgentId: true` unchanged.
- Preserve a verified runtime and configuration snapshot before promotion.
- Validate schema generation, execution guards, optional-policy coordinators, durable yield, restart, default completion, and rollback in the managed environment.
- Promote the exact reviewed runtime candidate through the documented patch lifecycle.
- Run synthetic read-only production checks.
- Roll back the runtime package and configuration snapshot if any policy context receives the wrong schema, an optional coordinator breaks, a result is lost or duplicated, or normal completion delivery regresses.

### Review log

- 2026-08-04: Root-cause review proved optional worker plus silent self default caused the first wrong inbox run.
- 2026-08-04: Named-worker checks were retained as fail-closed execution validation.
- 2026-08-04: Completion retry exhaustion was separated as an older independent defect.
- 2026-08-05: Exact tool-chain review documented scheduler, main, reader, mutation, wait, and handoff calls.
- 2026-08-05: Retained history found no user-facing non-scheduled main omission or self-target dependency.
- 2026-08-05: Cross-agent history found optional household self-spawn behavior, so global required worker was rejected.
- 2026-08-05: Recommendation changed from removing main's explicit requirement to keeping it and making schema match effective policy.

### Checklist

- [x] Tracker contract is current.
- [x] Exact tool and parameter chain is documented.
- [x] Scheduled and non-scheduled policy matrix is complete.
- [x] Historical interactive compatibility is measured.
- [x] Alternate runtime, nested-child, schema-cache, and reload effects are documented.
- [x] Durable yield side effects are synchronized with the tool chain.
- [x] Validation, rollout, and rollback are complete in the plan.
- [x] No behavior or external state was changed.
- [ ] Cole approves implementation.
- [ ] Implementation and committed regressions are complete.
- [ ] Managed validation and independent review are complete.
- [ ] Promotion, production validation, landing, and post-landing checks are complete.
