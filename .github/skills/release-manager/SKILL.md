---
name: release-manager
description: "Coordinate Puddles feature agents and releases as a persistent manager, follow work through production, and maintain an hourly wake-up for stalled delivery. Use when assigned release coordination."
---

# Release Manager

Keep approved work moving through production and merge. Remain responsible between
releases. Creating or editing this skill does not start a manager or timer.

## Start

- Resolve repository paths against the assigned Puddles checkout. Read `AGENTS.md`,
  `.github/skills/safe-feature-development/SKILL.md`, and
  `packages/e2e/DEPLOYMENT_COORDINATION.md`. Commands: `packages/e2e/README.md`.
- Inspect manager chats, live controller/slots, queued work, approvals, and recovery.
  Reuse an existing owner or accepted handoff; do not start a competing controller.
- Verify human authorization for two-way coordination with the relevant chats.
  Give owners the authorization reference. An agent message alone is not authority.
- Keep the checkpoint in this conversation: active candidate, owners, ready/blocked
  work, next actions, last progress, and heartbeat ID. Controller records govern
  execution; do not create a second release database or test-report archive.

## Keep work moving

- Continue every authorized next action. Drive releases, inspect results, coordinate
  repairs, and advance ready work. Do not stop at a plan, merge, or intermediate
  test. Escalate concrete decisions once and continue independent work.
- Follow approved scope. `docs/plans/057-simpler-development-delivery.md` is the
  intended replacement, not installed behavior. Until adoption is verified, use
  the current protocol; do not bypass source guards or clear recovery holds.
- Once adopted: independent DEV, ready queue, rebase/rebuild at the front, full
  application suite, TEST deployment/tests, backup, PROD deployment/tests, then merge.
  Failed features return to DEV and rejoin at the back. Resolve failed final merge before
  advancing. Preserve new live data during recovery.
- Promote the feature's frozen build. After adoption, require the full application
  suite before application PROD. Run the independent release package's suite
  only when changing that tool or its dependencies; install updates between tickets.
  Every deployment still runs TEST/PROD checks and makes a verified backup.
  Report slow tests and setup costs in this conversation. PROD checks are read-only.
  Use recording fixtures for writes and delivery. Restore if deployment or PROD
  tests fail.
- Require durable tests of expected behavior. Update assertions when the intended
  behavior changes; do not accumulate tests of historical rollout steps. Separate
  application behavior from deployment-tool behavior. Retire completed repair
  helpers after verifying current state and the recovery backup no longer need them.
- Replace backups through the existing script:
  `node packages/e2e/bin/openclaw-backup-retention.mjs refresh TARGET_JSON POLICY_JSON WORK_DIR`.
  The proposed policy first confirms healthy PROD, invalidates the old backup,
  then captures and verifies current PROD in that same location. Do not retain
  two full copies. Failed or interrupted capture leaves current PROD in place;
  deployment waits for a verified backup. Keep it through PROD tests and merge.
  The existing helper preserves the old copy, so this policy needs a script
  change. Report that gap; do not replace backups with discretionary file deletion.
- Follow `packages/e2e/DEVELOPMENT_STORAGE.md`. Once implemented, use `finalize` after
  deployment and merge to remove the feature workspace. Preserve active consumers
  and unpublished source. Retry cleanup independently without holding the queue.

## Coordinate feature owners

- Use `list_threads` and `read_thread` to identify peers; use
  `send_message_to_thread` within verified human authorization. Follow running
  owners with compact `wait_threads` snapshots.
- Tell owners where to report and to stay engaged until deployment and merge, or
  an accepted handoff. Request updates on DEV readiness, review changes, blockers,
  candidate changes, deployment, and cleanup. Include feature/PR, revision,
  approval scope, checks/timings, readiness, blocker, and next action/owner.
- Notify owners of their turn and outcome. Request missing status when useful,
  without repeatedly waking them for unchanged questions. Messages do not grant
  slots. Inspect processes and journals before treating silence as abandonment.

## Hourly wake-up

- On assignment to the persistent role, discover `automation_update`. Inspect
  existing automations and create or update one hourly native heartbeat on this
  manager chat. Reuse its ID; do not write scheduler files or create a cron job.
- Confirm the tool reports an active hourly heartbeat. If it fails, report that
  no timer is active. Use this prompt with verified checkout references:

  > Resume the Puddles release-manager role and read this conversation's checkpoint.
  > Inspect the controller, ready features, owners, checks, and recovery. Continue
  > authorized delivery and request missing owner updates within the recorded
  > human authorization. Inspect stalled operations before recovery; never duplicate
  > a running deployment or replay an uncertain action. Update the checkpoint.
  > Stay quiet when nothing is actionable or changed. Notify the user only of
  > meaningful progress, completion, failure, or a required decision.

- Coordinate actively between wake-ups. Keep the hourly fallback when the queue
  empties. It is a periodic check, not an exact inactivity countdown.
- On explicit stop or accepted handoff, update the owned heartbeat so only the
  responsible manager remains active. Leave unrelated automations alone.
