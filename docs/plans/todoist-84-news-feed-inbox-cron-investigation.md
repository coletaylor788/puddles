# News feed and inbox cron investigation

Status: Investigating follow-up
Issue: https://github.com/coletaylor788/puddles/issues/84
Last updated: 2026-08-04

## Human section

### Design

The scheduler is running. The news brief did not miss its first scheduled run because the earlier red entries were manual setup attempts. Inbox triage has fired on schedule every day since May except for one host outage in June. Recent red inbox runs still gathered email evidence, handed off reports, and ended normally.

A late-July runtime safety change rejects worker spawns that do not name the worker. That stops a scheduled main agent from accidentally creating another main agent with the wrong tools and trust role. Both cron prompts still describe a reader in plain language without requiring the reader identifier, so variable model calls can hit the guard and then recover. The result-gathering path also allows some already gathered child completions to enter retry handling and produce false failures.

Cole asked for a deeper design review before approval. The current work is tracing why the named-worker guard cannot simply be removed, where suppression must happen, and what each proposed change could break. The final proposal will minimize runtime scope, preserve normal completion delivery, and include timing, restart, cleanup, nesting, and failure-path tests.

### Status

The initial diagnosis remains valid, but the fix is not approved. A deeper side-effect and safety analysis is in progress.

Nothing has changed in code, configuration, schedules, services, or deployments.

## Agent section

### State

- Phase: Read-only design follow-up
- Approval gate: Required before code, configuration, schedule, deployment, service, or external-state changes
- Todoist task: `6hCQCRgQPm8Fq8X3`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/84`
- Follow-up comment: `6hCWHQWjF9HX88XV`
- Repository: `coletaylor788/puddles`
- Branch: `coletaylor788-investigate-cron-failures-m8fq8x3`
- Runtime mutation performed by this worker: None

### Scope and acceptance criteria

- Explain what the explicit worker-target guard protects.
- Explain the concrete failure that caused the guard to be added.
- Compare keeping, narrowing, and reverting the guard.
- Trace all completion routes that interact with active and completed yield gathers.
- Identify side effects for interactive sessions, scheduled sessions, nested workers, direct delivery, steer delivery, cleanup, retries, restarts, and result retention.
- Reduce the proposed runtime change to the smallest safe seam.
- Define regressions that fail on the live behavior and prove normal delivery still works.
- Keep the current news and inbox schedules unchanged.
- Preserve main as the decision and mutation owner.
- Preserve reader as the read-only untrusted-content worker.
- Do not trigger either production job or send a production message during research or automated validation.

### Architecture and decisions

- The live scheduler is enabled, uses its SQLite store, has a future wake time, and the gateway service is running.
- Daily news brief:
  - The job was created on August 3 at 3:45 PM Pacific.
  - Its earlier six entries were manual setup runs: three green and three red.
  - The two latest red runs completed reader work and downstream handoff.
  - Its prompt changed during the first investigation. It still did not require `agentId: "reader"` and moved back toward per-child `sessions_send` polling.
- Daily Email Triage:
  - The schedule remains 6:00 PM Pacific and is enabled.
  - From May 8 through August 3, 87 scheduled entries existed. June 25 was the only missing scheduled entry.
  - The June 25 miss occurred while the gateway had no running log activity. A manual run succeeded after restart.
  - Five scheduled runs from July 29 through August 2 were red even though reader children completed, the parent gathered results, the handoff started, and the downstream run ended normally.
  - The August 3 run was green.
- Initial change timeline:
  - Scheduled inbox runs changed model family on July 25. Runs stayed green through July 28.
  - The explicit cron worker-target guard was introduced on July 29 and refined through July 31.
  - Before the guard, an omitted target could silently create another main child.
  - After the guard, an omitted target is rejected and must be repaired.
  - Both live prompts omitted the explicit worker identifier.
- Initial suppression finding:
  - `docs/openclaw-setup/patches/sessions-yield-block-and-gather.patch` keeps the parent turn active, gathers descendant results, and marks gathered child keys.
  - The announce path checks active and completed gather state inside direct completion delivery.
  - Live cron records still show pending completion retries and failed announce delivery for children returned by `sessions_yield`.
  - The first proposal moved suppression ahead of completion routing. That proposal now requires a full side-effect analysis before approval.
- Follow-up questions to resolve:
  - Which exact target omission and self-target paths the guard blocks.
  - Whether reverting the guard would recreate the wrong-agent Gmail failure or weaken other scheduled trust boundaries.
  - Whether suppression should happen in dispatch, cleanup, or gather bookkeeping.
  - How suppression can distinguish an intentionally gathered result from a completion that still needs external delivery.
  - What state must survive restart so a late completion is neither leaked nor lost.
  - Whether the live failure is key mismatch, timing, cleanup state, route selection, or more than one issue.

### Implementation

- [x] Verify the reopened Todoist task still points to issue 84 in its first Copilot-authored comment.
- [x] Verify issue 84 still follows the plan link, Summary, and Status contract.
- [x] Reopen the plan before follow-up research.
- [ ] Trace the explicit target guard from original failure through current native and alternate runtime paths.
- [ ] Compare guard retention, narrowing, and reversion.
- [ ] Trace completion dispatch, gather suppression, cleanup, retry, and restart state.
- [ ] Build a side-effect matrix for every affected route.
- [ ] Revise the proposed fix to the narrowest supported design.
- [ ] Update the plan and issue with the final recommendation.
- [ ] Ask Cole one exact approval question or mark the investigation ready for review.

### Validation

- Prior read-only evidence:
  - Live scheduler status, job definitions, and complete run history
  - Read-only cron, subagent, audit, delivery, and gateway boot metadata
  - Sanitized gateway log correlation
  - Repository history and installed-bundle marker checks
- Required follow-up evidence:
  - Original wrong-agent scheduled run sequence
  - Current explicit-target policy for native and alternate worker paths
  - Call graph from completion to steer, direct delivery, cleanup, retry, and diagnostics
  - Gather state lifetime and key normalization
  - Persistence behavior across gateway restart
  - Existing tests and missing timing cases
- Required post-approval regressions remain pending. No implementation validation runs before approval.

### Rollout and rollback

- No rollout occurs during the follow-up.
- Any approved runtime change must use the managed test environment and the repository patch lifecycle.
- Preserve a verified runtime and configuration snapshot before promotion.
- Keep both cron expressions unchanged.
- Validate production only with synthetic data and read-only policy calls.
- Restore the runtime snapshot and prior prompt definitions if promotion or production checks fail.

### Review log

- 2026-08-03: Read-only investigation found a healthy scheduler, one historical host outage, missing explicit worker targets, recovered inbox runs recorded as red, and gathered child completion retries.
- 2026-08-04: Cole asked for deeper analysis of the suppression design, its side effects, and the reason the named-worker guard should not simply be reverted.
- 2026-08-04: No implementation review has started because approval is still pending.

### Checklist

- [x] Tracker contract is current.
- [x] Initial runtime topology and timelines are mapped.
- [x] Initial root causes are supported by live metadata and repository history.
- [x] No behavior or external state was changed.
- [ ] Named-worker guard purpose and alternatives are fully analyzed.
- [ ] Suppression side effects and route coverage are fully analyzed.
- [ ] Restart, cleanup, nesting, and failure semantics are resolved.
- [ ] Final proposal and regression matrix are documented.
- [ ] Cole approves implementation, or the investigation is returned for another design pass.
