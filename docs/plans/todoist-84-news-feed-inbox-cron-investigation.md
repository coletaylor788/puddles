# News feed and inbox cron investigation

Status: Awaiting approval
Issue: https://github.com/coletaylor788/puddles/issues/84
Last updated: 2026-08-03

## Human section

### Design

The scheduler is running. The news brief has not missed a scheduled run because it has not reached its first scheduled time yet. Its red entries all came from manual setup attempts. Inbox triage has fired on schedule every day since May except for one host outage in June. The recent red inbox runs still gathered email evidence, handed off a report, and ended normally.

Two changes explain the new pattern. A runtime safety fix installed at the end of July now rejects a worker spawn that does not name the worker. Both job prompts still say to use a reader without telling the model to send the required reader identifier. The model sometimes repairs that call and finishes, but the rejected first call can still mark the run red. The result-gathering guard also checks too late in the completion path. A result already gathered by the parent can enter the retry queue, fail delivery, and turn a useful run into an error.

The proposed fix keeps both schedules and their trust boundaries. It moves gathered-result suppression ahead of all completion routing, then updates both prompts to name the reader explicitly and use the supported gather step instead of polling each child. Tests will replay the live timing with fake readers and recording delivery. No live mail, news delivery, or account mutation is part of validation.

### Status

The read-only investigation is complete. The scheduler is healthy, the current failure modes are identified, and a concrete runtime plus prompt fix is ready.

Nothing has changed in code, configuration, schedules, services, or deployments. Cole's approval is required before implementation.

## Agent section

### State

- Phase: Approval checkpoint
- Approval gate: Required before code, configuration, schedule, deployment, service, or external-state changes
- Todoist task: `6hCQCRgQPm8Fq8X3`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/84`
- Tracking comment: `6hCQCgQmGg3VWfwV`, confirmed as the first Copilot-authored comment
- Repository: `coletaylor788/puddles`
- Branch: `coletaylor788-investigate-cron-failures-m8fq8x3`
- Runtime mutation performed by this worker: None

### Scope and acceptance criteria

- Explain whether each job missed triggers, failed during work, or failed during delivery.
- Identify the runtime, prompt, model, configuration, and deployment changes that line up with the failures.
- Preserve main as the decision and mutation owner.
- Preserve reader as an untrusted-input, read-only worker.
- Keep the current 5:30 AM news schedule and 6:00 PM inbox schedule.
- Require every reader spawn to name the reader worker explicitly.
- Gather child results once through the supported in-turn gather path.
- Suppress completion delivery before steer or direct routing when the result is already being gathered or was gathered.
- Treat a suppressed gathered result as terminally handled so it cannot enter the retry queue or emit a fatal diagnostic.
- Prove the fix with synthetic jobs, fake reader results, and recording delivery.
- Do not trigger either production job or send a production message during automated validation.

### Architecture and decisions

- The live scheduler is enabled, uses its SQLite store, has a future wake time, and the gateway service is running.
- Daily news brief:
  - The job was created on August 3 at 3:45 PM Pacific.
  - Its first scheduled run is August 4 at 5:30 AM Pacific.
  - It has six manual setup runs: three green and three red.
  - The two latest red runs completed their reader work and completed the downstream handoff. The final run status does not describe the useful outcome.
  - The live prompt changed during this investigation from 1,990 to 2,513 characters. It now asks for three parallel readers and polls each child with `sessions_send`. It still does not require `agentId: "reader"` and does not prescribe `sessions_yield`.
- Daily Email Triage:
  - The schedule remains 6:00 PM Pacific and is enabled.
  - From May 8 through August 3, 87 scheduled entries exist. June 25 is the only missing scheduled entry.
  - The gateway stopped producing logs after 3:23 PM on June 25 and did not start again until 8:06 PM. There is no clean shutdown record. A manual triage run succeeded at 8:08 PM.
  - Of the 87 scheduled entries, 79 are green and eight are red. Three older failures were a provider request rejection, a timeout, and a gateway restart.
  - Five scheduled runs from July 29 through August 2 are red. Their reader children all completed successfully, the parent gathered results, the direct handoff started, and the downstream run ended normally.
  - Four of those five red entries are completion diagnostics tied to the reader spawn. The fifth is a real attachment-evidence lookup error that the parent recovered from before sending the report.
  - The August 3 scheduled run is green. The job has no consecutive errors or skipped-run count now.
- What changed:
  - Scheduled inbox runs changed model family on July 25. Runs stayed green through July 28, so that change alone does not explain the failures.
  - The explicit cron worker-target safety guard was introduced on July 29 and refined through July 31.
  - Before that guard, an omitted target could silently create another main child. After the guard, the same variable model call is rejected and must be repaired.
  - The June snapshot of the inbox job used a short prompt and a direct-session target. The live job uses an isolated target and a longer main-reader workflow. The schedule itself is unchanged.
  - Neither live prompt includes the required worker identifier.
- Runtime defect:
  - `docs/openclaw-setup/patches/sessions-yield-block-and-gather.patch` suppresses gathered completion only inside direct delivery.
  - Live cron records show completion retries and `announce deferred or direct delivery failed` for children whose results were returned by `sessions_yield`.
  - The suppression decision must happen before the dispatcher chooses steer or direct delivery and before cleanup creates pending final delivery.
  - Suppression must recognize the requester controller key, requester run key, target key, and child session key used by the actual cron route.
- Proposed change:
  - Move gathered-result suppression to the start of the shared completion dispatcher.
  - Return a terminal delivered result for both an active gather and a late announce from an already gathered child.
  - Record that terminal result as delivered so cleanup clears pending delivery and does not retry or emit an error diagnostic.
  - Update both job prompts to call `sessions_spawn` with `agentId: "reader"`.
  - Update both job prompts to call `sessions_yield` once after parallel spawns.
  - Remove per-child `sessions_send` polling from the news prompt.
  - Leave final report handoff, schedules, mail rules, and delivery targets unchanged.

### Implementation

- [x] Verify the Todoist task points to issue 84 in its first Copilot-authored comment.
- [x] Normalize issue 84 to the plan link, Summary, and Status contract.
- [x] Create the plan before runtime research.
- [x] Map the live scheduler, gateway, job definitions, and run history.
- [x] Compare scheduled, manual, successful, failed, and downstream runs.
- [x] Correlate the failure window with runtime and model changes.
- [x] Inspect the installed target guard and gathered-result suppression.
- [x] Identify the suppression routing gap and prompt contract gaps.
- [ ] After approval, add the exact cron gather regression to the maintained source patch.
- [ ] After approval, move suppression ahead of all completion dispatch paths.
- [ ] After approval, update both prompts through the supported cron edit command.
- [ ] After approval, complete the full test, review, promotion, landing, and production validation lifecycle.

### Validation

- Read-only investigation commands:
  - `openclaw cron status`
  - `openclaw cron list --all --json`
  - `openclaw cron get <job>`
  - `openclaw cron runs --id <job> --limit 120`
  - Read-only SQLite queries against cron run, subagent, audit, delivery, and gateway boot metadata
  - Sanitized gateway log correlation
  - Repository history and installed-bundle marker checks
- Investigation results:
  - Scheduler health and next-wake state confirmed.
  - News job creation, schedule, six manual attempts, and no scheduled attempts confirmed.
  - Inbox schedule gap analysis confirmed one historical missed trigger during gateway downtime.
  - Recent inbox reader outcomes and downstream completion confirmed.
  - Current prompt target and gather omissions confirmed.
  - Installed target guard and gather patch markers confirmed.
  - During-gather and late completion retries confirmed in live records.
- Required post-approval regression:
  - Start a synthetic isolated cron parent with two fake reader children.
  - Require `expectsCompletionMessage=true`, matching the live reader runs.
  - Finish one child while the parent is gathering and one child just after the gather boundary.
  - Confirm one combined result reaches the parent.
  - Confirm no steer or direct completion delivery occurs for gathered children.
  - Confirm no pending final delivery, retry, error diagnostic, or raw child delivery remains.
  - Confirm an ungathered child still follows normal completion delivery.
  - Confirm omitted and self-targeted cron spawns remain denied while an explicit reader spawn succeeds.
  - Confirm the prompt contract names the reader and uses one gather step.
- Required repository gate after implementation:
  - `node packages/e2e/bin/openclaw-test-env.mjs ci`
- Production validation after approval must use a fixed synthetic harness or direct policy call. It must not trigger the live jobs, read live messages, mutate mail, or deliver a message.

### Rollout and rollback

- No rollout occurs before approval.
- After approval, validate the runtime patch and prompt contract in the managed test environment first.
- Preserve a verified production runtime and configuration snapshot before promotion.
- Promote the exact reviewed runtime candidate through `docs/openclaw-setup/patches/apply-and-deploy.sh`.
- Run read-only production policy and gather checks against synthetic data.
- Edit the two prompts only after the runtime candidate is healthy.
- Do not change either cron expression.
- On failure, restore the runtime snapshot and the two prior prompt definitions, reload through the documented lifecycle, and recheck gateway and scheduler health.

### Review log

- 2026-08-03: Tracker contract confirmed before research.
- 2026-08-03: Read-only investigation found a healthy scheduler, one historical host outage, recovered inbox runs recorded as red, missing explicit worker targets in both prompts, and gathered child completion retries that bypass the intended suppression.
- 2026-08-03: No implementation review has started because approval is pending.

### Checklist

- [x] Tracking comment points to the primary issue.
- [x] Issue has only the plan reference, Summary, and Status.
- [x] Plan follows the two-section contract.
- [x] Runtime topology is mapped.
- [x] News run timeline is established.
- [x] Inbox trigger and failure timeline is established.
- [x] Runtime and prompt change timeline is established.
- [x] Root causes are supported by scheduler, transcript, subagent, audit, and gateway evidence.
- [x] Proposed fix, validation, and rollback are documented.
- [x] No behavior or external state was changed.
- [ ] Cole approves the proposed runtime and prompt changes.
- [ ] Implementation and committed regression are complete.
- [ ] Managed validation and independent review are complete.
- [ ] Promotion, production validation, landing, and post-landing checks are complete.
