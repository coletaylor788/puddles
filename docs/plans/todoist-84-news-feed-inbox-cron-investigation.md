# News feed and inbox cron investigation

Status: Awaiting consistent-routing approval
Issue: https://github.com/coletaylor788/puddles/issues/84
Last updated: 2026-08-07

## Human section

### Design

Nothing relevant changed locally between the last correct inbox run and the first wrong one. They used the same runtime version, model identity, model API, thinking settings, tools, structured tool form, system instructions, and cron instructions. After removing the current date and session identifiers, the prompts are identical.

The bug was already present. Worker identity was optional, and omission silently meant “spawn another copy of me.” Earlier runs happened to fill in reader. The first wrong run used the task-handle field and omitted the worker, which was valid under the structured form. The runtime then created main instead of reader.

The exact reason the model changed its structured call is not recorded. A stable model name does not identify an immutable backend build or sampling seed. It may have been normal generation variation, a service-side model update, or sensitivity to the small dynamic parts of the request. Three immediate retries made the same omission, so the behavior preference was persistent at that moment, but local artifacts cannot distinguish those causes.

The system should not depend on that distinction. A probabilistic model will eventually exercise every schema-valid branch. The fix makes ambiguous identity impossible: resolve legal targets first, auto-select only one deterministic target, and require the worker when several targets exist. Scheduled jobs remain fail-closed. The separate completion fix makes result waiting durable and automatic.

### Status

The sudden stop was the first visible activation of a latent routing bug, not a proven local deployment regression. The only local same-day change was unrelated and did not alter the model request surface.

Nothing has changed in code, configuration, prompts, schedules, services, or deployments. Cole's approval is required before implementation.

## Agent section

### State

- Phase: Consistent-routing approval checkpoint
- Approval gate: Required before code, configuration, prompt, schedule, deployment, service, or external-state changes
- Todoist task: `6hCQCRgQPm8Fq8X3`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/84`
- Follow-up comment: `6hFJMCqwH9MRGCV3`
- Repository: `coletaylor788/puddles`
- Branch: `coletaylor788-investigate-cron-failures-m8fq8x3`
- Runtime mutation performed by this worker: None

### Scope and acceptance criteria

- Explain why behavior changed without a relevant local change.
- Separate proven local equivalence from unknowable external model behavior.
- Keep prompts and schedules unchanged.
- Remove ambiguous native target fallback.
- Auto-select only one legal target.
- Require explicit identity when multiple legal targets exist.
- Keep scheduled sessions fail-closed unless explicitly configured for same-agent spawning.
- Apply the same rule to main and household.
- Keep durable automatic yield collection as the separate completion fix.
- Do not trigger production jobs, read live content, mutate mail, or send messages during automated validation.

### Architecture and decisions

- Last correct and first wrong runs:
  - Last correct local run: July 27 at 6:00 PM.
  - First wrong local run: July 28 at 6:00 PM.
  - Both used runtime version `2026.6.11`.
  - Both used the same visible model identity and API.
  - Both used fast mode, medium thinking, and reasoning off.
  - Both exposed 25 tools.
  - Both exposed the same `sessions_spawn` schema with `required: ["task"]`.
  - Both had no hidden compiled messages.
  - Their system prompts normalize to the same hash after replacing session identifiers.
  - Their cron prompts normalize to the same hash after replacing date and time.
  - Their first model calls used the same cache-read scale.
- Correct generation sequence:
  - July 25: explicit reader.
  - July 26: explicit reader.
  - July 27: explicit reader.
- Incorrect generation sequence:
  - July 28 scheduled run: omitted worker, used `taskName: "email_reader"`.
  - First manual retry minutes later: same omission and task handle.
  - Second manual retry later that hour: same omission and task handle.
  - All three were accepted by the pre-guard schema and native fallback.
- Response metadata:
  - Every call has a distinct response ID.
  - Retained response metadata names only the public model identity.
  - It does not include an immutable backend revision, rollout cohort, random seed, or sampling trace.
  - Local evidence cannot prove whether the three-call shift was sampling, a backend rollout, or another provider-side behavior change.
- Local events between runs:
  - No repository-managed runtime deployment changed spawn behavior.
  - One memory-search configuration setting changed on July 28 afternoon.
  - That change restarted the gateway.
  - The restarted gateway reported the same runtime version and model identity.
  - Captured request context after restart remained semantically identical.
  - The changed memory setting injected no hidden messages into either run.
  - It is ruled out as the routing cause by retained request evidence.
- Earlier model-family transition:
  - The scheduled inbox job changed model family several days before the failure.
  - Three scheduled runs under the later family explicitly chose reader and completed correct behavior.
  - The family change may affect general generation tendencies, but it is not the adjacent-run trigger.
- Why “nothing changed” and “it stopped” are both true:
  - No relevant local contract changed between adjacent runs.
  - Model output is not deterministic.
  - The optional schema admitted both explicit-reader and omitted-worker calls.
  - The runtime assigned materially different identities to those two valid calls.
  - Correct behavior before July 28 was contingent on model choice, not guaranteed by the system.
  - July 28 is the first retained occurrence where the model selected the unsafe valid branch.
- Confidence:
  - High confidence: local prompt, schema, tools, runtime, and configuration did not cause an identity-contract change between adjacent runs.
  - High confidence: omitted worker caused main-to-main spawning and the behavior failure.
  - High confidence: the latent bug predated the failure.
  - Medium confidence: a model-generation behavior shift occurred, because three correct calls were followed by three similar omissions.
  - Low confidence on cause of that shift: no retained backend revision or seed exists.
- Household corroboration:
  - Household had the same optional-worker fallback.
  - Six household self children were labeled as reader or browser work.
  - All six tried `exec` and recorded errors.
  - This confirms the defect is generic and can surface whenever a coordinator has several roles.
- Routing fix:
  - Resolve legal native targets before choosing a default.
  - Explicit `requireAgentId: true` always requires identity.
  - Explicit false preserves intentional requester self-default.
  - Scheduled unset policy requires identity.
  - Interactive unset policy may auto-select exactly one legal target.
  - Multiple legal targets require identity.
  - No legal target is a configuration error.
  - Omission never bypasses an explicit allowlist.
  - Provider schema and execution use the same resolver.
  - Main and household both receive required `agentId` schemas because both have multiple legal targets.
- Completion fix:
  - Correct identity is resolved first.
  - `sessions_yield` durably claims exact direct child run IDs.
  - Completion delivery checks the claim before retarget, retry, or diagnostics.
  - Successfully returned results receive durable gathered markers.
  - Grandchildren remain with their direct coordinator.
  - Parents that do not yield keep existing completion behavior.

### Implementation

- [x] Verify the tracker after the sudden-stop follow-up.
- [x] Compare retained request and response metadata.
- [x] Recheck repository, package, configuration, and gateway events.
- [x] Recheck model-family transition and run sequence.
- [x] Evaluate prompt-cache and restart relevance.
- [x] State the external trigger confidence limits.
- [x] Preserve the consistent routing and durable completion design.
- [ ] After approval, implement deterministic target resolution and schema generation.
- [ ] After approval, implement durable direct-child yield claims.
- [ ] After approval, complete focused tests, cumulative integration, independent review, promotion, production checks, landing, and post-landing checks.

### Validation

- Required target-resolution regressions:
  - No allowlist interactive requester auto-selects requester.
  - Explicit false preserves requester self-default.
  - Explicit true denies omission.
  - Scheduled unset policy denies omission.
  - One legal cross-agent target is selected deterministically.
  - Multiple legal targets deny omission.
  - Empty target set is a configuration error.
  - Explicit valid, stale, and disallowed targets follow policy.
- Required schema regressions:
  - Main and household require `task` and `agentId`.
  - Requester-only interactive coordinator requires only `task` and describes its default.
  - Scheduled requester-only coordinator still requires identity unless explicit false.
  - Schema and execution share one resolver result.
  - Provider projections preserve the flat object.
- Required historical replay:
  - July 27 explicit reader remains accepted.
  - July 28 omission is denied before child creation.
  - Household omitted reader and browser work is denied before self child creation.
  - Explicit household reader and browser work remains accepted.
- Required durable completion regressions:
  - Correctly routed direct children are claimed by yield.
  - Wrong or denied routing creates no claim.
  - Multiple direct children, errors, timeouts, restart, expiry, and deduplication are covered.
  - Non-yield completion behavior remains unchanged.
- Required synthetic jobs:
  - Unchanged inbox text produces reader evidence, main decisions, recording mail changes, and one recording message.
  - Unchanged news text produces correct readers and no raw child delivery.
  - Household plain language produces legal worker routing.
- Required repository gate after implementation:
  - `node packages/e2e/bin/openclaw-test-env.mjs ci`
- Production validation after approval:
  - Inspect installed schemas and exercise synthetic routing and yield records.
  - Do not trigger live jobs, read live content, mutate mail, or send a message.

### Rollout and rollback

- No rollout occurs before approval.
- Keep prompts, schedules, and coordinator configuration unchanged.
- Preserve a verified runtime and configuration snapshot before promotion.
- Validate routing, schema, historical replay, household behavior, durable yield, restart, and rollback in the managed environment.
- Promote the exact reviewed runtime candidate through the documented patch lifecycle.
- Run synthetic read-only production checks.
- Roll back if schema and execution disagree, a deterministic target changes unexpectedly, a coordinator routes to itself incorrectly, or result delivery loses or duplicates data.

### Review log

- 2026-08-04: Root cause was traced to optional worker plus requester fallback.
- 2026-08-05: Main and household were proven to share the same defect.
- 2026-08-07: Adjacent-run request metadata was normalized and compared.
- 2026-08-07: No relevant local semantic change was found.
- 2026-08-07: The exact model-generation trigger was classified as unrecoverable from local artifacts.
- 2026-08-07: The failure is understood as first visible activation of a pre-existing unsafe schema branch.

### Checklist

- [x] Tracker contract is current.
- [x] Local transition evidence is complete.
- [x] Relevant local changes are ruled out.
- [x] External trigger confidence is stated accurately.
- [x] Final explanation is documented.
- [x] Routing and completion fixes remain system-owned.
- [x] No behavior or external state was changed.
- [ ] Cole approves implementation.
- [ ] Implementation and committed regressions are complete.
- [ ] Managed validation and independent review are complete.
- [ ] Promotion, production validation, landing, and post-landing checks are complete.
