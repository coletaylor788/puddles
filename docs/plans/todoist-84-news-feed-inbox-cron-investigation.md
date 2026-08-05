# News feed and inbox cron investigation

Status: Awaiting consistent-routing approval
Issue: https://github.com/coletaylor788/puddles/issues/84
Last updated: 2026-08-05

## Human section

### Design

The cron says reader should do the reading, and the current tool description also says scheduled work needs a worker. Neither one makes the worker structurally required. The JSON form shown to the model still requires only the task. That is why the model can produce a valid call with no worker.

When a native spawn omits the worker, the runtime substitutes the requester. For inbox triage, the requester is main, so it creates a main child. For household, the requester is household, so it creates a household child. The task handle and display label do not affect identity. This is the exact point where the flow breaks.

Household is not a valid exception. Every retained household self child was labeled as reader or browser work. Those children received household tools, tried the generic command tool, and failed. Household and main have the same underlying ambiguity.

The consistent rule is to resolve legal targets before showing or executing the tool. If there is one safe target, the runtime may select it automatically. If there are multiple targets, the worker is required. Scheduled jobs remain fail-closed unless they explicitly opt into same-agent spawning. The runtime validation stays behind the schema. Cron text remains plain.

### Status

The difference between prose, JSON schema, runtime defaulting, and policy is fully resolved. Household confirms the same bug instead of a separate contract.

Nothing has changed in code, configuration, prompts, schedules, services, or deployments. Cole's approval is required before implementation.

## Agent section

### State

- Phase: Consistent-routing approval checkpoint
- Approval gate: Required before code, configuration, prompt, schedule, deployment, service, or external-state changes
- Todoist task: `6hCQCRgQPm8Fq8X3`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/84`
- Follow-up comment: `6hCpgJwm4m7Pqqq3`
- Repository: `coletaylor788/puddles`
- Branch: `coletaylor788-investigate-cron-failures-m8fq8x3`
- Runtime mutation performed by this worker: None

### Scope and acceptance criteria

- Keep inbox and news cron text and schedules unchanged.
- Make tool schema, execution defaulting, and target policy agree.
- Never silently select the requester when multiple legal targets exist.
- Auto-select only when one legal native target exists.
- Require an explicit worker when native routing is ambiguous.
- Keep scheduled sessions fail-closed unless `requireAgentId: false` explicitly opts into same-agent behavior.
- Preserve explicit same-agent spawning when policy allows it.
- Preserve alternate runtime defaulting only when its configured default is deterministic and allowed.
- Keep runtime validation behind provider schema validation.
- Fix household and main through the same target resolver.
- Keep durable automatic yield collection as the separate completion fix.
- Do not trigger production jobs, read live content, mutate mail, or send messages during automated validation.

### Architecture and decisions

- Where “reader is required” exists today:
  - The inbox cron text says to use reader for read-only evidence.
  - The architecture documentation says main owns decisions and reader owns reads.
  - The post-fix `agentId` property description says native scheduled callers require it.
  - The execution guard rejects omission for current main and scheduled native callers.
  - None of those change the provider-facing JSON `required` array.
- What the model actually sees:
  - `sessions_spawn` is a flat object schema.
  - `task` is `Type.String()`, so it appears in `required`.
  - `agentId` is `Type.Optional(Type.String())`.
  - `taskName` and `label` are also optional.
  - Captured working and failing schemas both had `required: ["task"]`.
  - The current description is stronger than the current structural schema.
- Correct and incorrect calls:
  - Correct:
    - `task`: reader objective
    - `agentId: "reader"`
    - `mode: "run"`
  - Incorrect:
    - `task`: reader objective
    - `taskName: "email_reader"`
    - `mode: "run"`
    - no `agentId`
  - Both satisfy the current provider schema.
- Exact native omitted-target path:
  - Tool execution reads required `task`.
  - It normalizes optional `taskName` and `label`.
  - It defaults `runtime` to native subagent.
  - It reads `agentId`; omission becomes `undefined`.
  - Spawn resolves the requester session key.
  - It parses requester identity from that key.
  - Pre-fix code calculates:
    - explicit requested worker if present
    - otherwise requester identity
  - Target policy has an early success path when no worker was requested and the calculated target equals requester.
  - Child session key is built from that calculated target.
  - Main therefore creates `agent:main:subagent:<id>`.
  - Household therefore creates `agent:household:subagent:<id>`.
- Exact current post-fix path:
  - Current main configuration has `requireAgentId: true`.
  - Tool generation still marks `agentId` optional.
  - If the model omits it, execution rejects before child creation.
  - Scheduled native requesters also default to strict omission rejection when no explicit setting exists.
  - Scheduled explicit requester target is rejected unless `requireAgentId: false`.
  - The current flow therefore breaks at `sessions_spawn` with a denial instead of silently creating main.
  - A model repair that chooses reader succeeds.
- Why task handle and label do not route:
  - `taskName` is stored as a stable handle for later targeting.
  - `label` is display metadata.
  - Neither enters target resolution.
  - A value such as `email_reader` or a label such as `household-reader` cannot change child identity.
- Household evidence:
  - Household allows household, household-reader, and household-browser-agent.
  - Household has no explicit `requireAgentId` setting.
  - Six retained children were created as household itself.
  - Five were labeled household-reader.
  - One was labeled household-browser-agent.
  - Two also used reader or browser task handles.
  - The four retained model calls without `agentId` described reading or browsing work.
  - All six self children called `exec`.
  - All six recorded `exec` errors.
  - Correct household worker records exist separately under household-reader and household-browser-agent identities.
  - There is no retained evidence of intentional household self-spawn.
  - Preserving optional household routing would preserve the same bug.
- Current target-policy inconsistency:
  - No allowlist means requester-only by default.
  - An explicit allowlist resolves configured legal targets.
  - The current early omitted-target success bypasses that allowlist and accepts requester even when requester is excluded.
  - A test explicitly locks in that bypass.
  - That bypass is the root implementation defect behind both main and household cases.
- Consistent native resolver:
  - Resolve configured legal target IDs first.
  - Apply requester configuration and registry filtering.
  - If `requireAgentId: true`, require explicit `agentId`.
  - If `requireAgentId: false`, preserve explicit opt-in to omitted requester self-spawn.
  - If policy is unset and requester is scheduled, require explicit `agentId`.
  - If policy is unset and exactly one legal target remains, omitted `agentId` deterministically selects that target.
  - If policy is unset and more than one legal target remains, omission is ambiguous and is rejected.
  - If no legal target remains, reject with a configuration error.
  - Never bypass an explicit allowlist for omitted self.
- Provider-facing schema from the same resolver:
  - If execution would reject omission, put `agentId` in `required`.
  - If execution has one deterministic target, keep `agentId` optional and describe the default.
  - If explicit false permits requester self-default, keep it optional and describe requester default.
  - Include legal native target IDs in the description.
  - Keep schema flat for provider compatibility.
  - Keep execution validation authoritative for programmatic calls and mid-run config changes.
- Main after the fix:
  - Current explicit true means `required: ["task", "agentId"]`.
  - Explicit reader and browser calls behave unchanged.
  - Omitted calls fail schema or execution validation.
  - Explicit interactive main remains allowed because main is in its allowlist.
  - Explicit scheduled main remains denied by scheduled self-target policy.
- Household after the fix:
  - Household has three legal targets and unset strictness.
  - Interactive omission becomes ambiguous and is rejected.
  - Its provider schema requires `agentId`.
  - Explicit household-reader and household-browser-agent behave unchanged.
  - Explicit household self remains allowed because household is in its allowlist.
  - No current configuration mutation is necessary.
- Debug and requester-only coordinators:
  - Debug has no explicit allowlist, so its legal native target resolves to itself only.
  - Interactive debug omission may deterministically select debug.
  - Scheduled debug remains strict by scheduled default unless explicit false opts into self.
- Explicit single-worker allowlist:
  - A coordinator with only one legal worker may omit `agentId`.
  - The resolver selects that worker, not requester.
  - This fixes the current early-self bypass and supports plain-language delegation.
- Wildcard allowlist:
  - Resolve wildcard to configured legal targets.
  - One result can be automatic.
  - Multiple results require explicit selection.
- Alternate runtime:
  - `runtime` defaults to native subagent.
  - Explicit alternate runtime uses its own allowed harness registry.
  - Omitted alternate `agentId` is deterministic only when an allowed default harness is configured.
  - Otherwise execution rejects omission.
  - Because one flat schema serves both runtimes, the description must state the alternate default.
  - When native routing is ambiguous, `agentId` is required for the whole tool and alternate calls also name their harness.
  - No retained current coordinator calls use alternate runtime, so there is no observed compatibility dependency.
- Difference between “required in flow” and required in JSON:
  - Prose is guidance the model may follow.
  - A JSON required field is part of structured generation and provider validation.
  - Runtime validation catches malformed or bypassed calls.
  - All three layers are useful, but only the latter two can enforce identity.
- Which flow component breaks:
  - Original July break: native target defaulting silently chose requester.
  - Current run: provider schema still permits omission, then execution guard denies it.
  - Household: native target defaulting still silently chooses household because its strict flag is unset and the omitted-self bypass remains.
  - Completion retry noise occurs later and is independent.
- Completion design alignment:
  - Durable yield claims operate after a correctly identified child is created.
  - They cannot repair wrong identity.
  - Routing consistency is fixed first.
  - Yield then claims exact direct child run IDs, stores results durably, and prevents duplicate completion delivery.
  - No prompt-level gather mode is added.

### Implementation

- [x] Verify the tracker after Cole's routing follow-up.
- [x] Separate prose requirement, JSON requirement, execution guard, and target fallback.
- [x] Trace omitted native routing line by line.
- [x] Identify current denial point.
- [x] Classify all retained household self children.
- [x] Prove household has the same ambiguity bug.
- [x] Replace household exception with one consistent target resolver.
- [x] Align provider schema with resolver outcomes.
- [x] Align durable completion design behind corrected identity.
- [ ] After approval, replace omitted-self target bypass with deterministic target resolution.
- [ ] After approval, generate required or optional schema from the same resolver.
- [ ] After approval, add durable direct-child yield claims.
- [ ] After approval, complete focused tests, cumulative integration, independent review, promotion, production checks, landing, and post-landing checks.

### Validation

- Required target-resolution regressions:
  - No allowlist, interactive requester: omission selects requester.
  - Explicit false: omission selects requester and scheduled explicit self is allowed.
  - Explicit true: omission is denied in every context.
  - Scheduled unset policy: omission is denied.
  - One legal cross-agent target: omission selects that target.
  - Multiple legal targets: omission is denied.
  - Empty legal target set: configuration error.
  - Explicit valid self and cross-agent targets follow allowlist.
  - Explicit stale or disallowed target is denied.
  - Wildcard is filtered to configured targets before cardinality.
- Required schema regressions:
  - Main schema requires `task` and `agentId`.
  - Household schema requires `task` and `agentId`.
  - Debug interactive schema requires only `task` and describes debug default.
  - Scheduled debug schema requires `task` and `agentId`.
  - Explicit-false scheduled schema keeps `agentId` optional.
  - Single-worker coordinator schema keeps `agentId` optional and describes its worker default.
  - Schema and execution use one resolver result.
  - Provider projections preserve the flat required list and descriptions.
- Required historical replay:
  - July 27 explicit reader remains accepted with reader tools.
  - July 28 omitted main call is denied before child creation.
  - Household omitted reader and browser calls are denied before household child creation.
  - Explicit household reader and browser calls retain correct tools.
  - Current omitted, explicit requester, explicit worker scheduled repair remains denied, denied, accepted.
- Required alternate runtime regressions:
  - Explicit harness remains accepted.
  - Allowed configured default permits omission only when provider schema can describe deterministic behavior.
  - Missing or disallowed default rejects omission.
  - Native and alternate registries are not mixed in allowlist suggestions.
- Required durable completion regressions:
  - Correctly routed direct children are claimed by yield.
  - Wrong or denied routing creates no claim.
  - One, multiple, and maximum direct children are returned.
  - Grandchildren remain with direct coordinator.
  - Restart, retry, expiry, malformed result, and deduplication paths remain explicit.
  - Non-yield completion behavior is unchanged.
- Required synthetic job coverage:
  - Unchanged inbox cron text produces reader evidence, main decisions and recording mail writes, and one final recording message.
  - Unchanged news cron text produces correctly routed readers and no raw child delivery.
  - Unchanged household language routes explicit legal workers after structured generation.
- Required repository gate after implementation:
  - `node packages/e2e/bin/openclaw-test-env.mjs ci`
- Production validation after approval:
  - Inspect installed schemas for main, household, debug, scheduled, and interactive contexts.
  - Exercise synthetic omitted and explicit target calls.
  - Exercise synthetic durable yield with recording delivery.
  - Do not trigger live jobs, read live content, mutate mail, or send a message.

### Rollout and rollback

- No rollout occurs before approval.
- Keep prompts, schedules, and coordinator configuration unchanged.
- Preserve a verified runtime and configuration snapshot before promotion.
- Validate target cardinality, schema generation, execution validation, household repair, alternate runtime, durable yield, restart, and rollback in the managed environment.
- Promote the exact reviewed runtime candidate through the documented patch lifecycle.
- Run synthetic read-only production checks.
- Roll back the runtime package and snapshot if any schema disagrees with execution, a deterministic target changes unexpectedly, household routes to itself, or result delivery loses or duplicates data.

### Review log

- 2026-08-04: Root cause was traced to optional worker plus requester self-default.
- 2026-08-05: Exact call and parameter chain was documented.
- 2026-08-05: Cole challenged the difference between prose-required and schema-optional worker, and the household exception.
- 2026-08-05: Source review confirmed provider JSON requires only `task`; omitted native target is assigned requester identity.
- 2026-08-05: Household review found six mislabeled self children, all intended as reader or browser work and all failing through `exec`.
- 2026-08-05: Household exception was withdrawn. The proposed rule now depends on deterministic target cardinality plus explicit strictness.

### Checklist

- [x] Tracker contract is current.
- [x] Required versus optional layers are fully separated.
- [x] Omitted routing is explained line by line.
- [x] Current failure point is identified.
- [x] Household self-spawns are classified as misrouting.
- [x] Consistent routing contract is designed.
- [x] Completion design matches corrected identity.
- [x] Validation, rollout, and rollback are documented.
- [x] No behavior or external state was changed.
- [ ] Cole approves implementation.
- [ ] Implementation and committed regressions are complete.
- [ ] Managed validation and independent review are complete.
- [ ] Promotion, production validation, landing, and post-landing checks are complete.
