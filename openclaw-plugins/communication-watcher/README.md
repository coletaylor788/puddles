# Communication watcher

Reviews a private shared Reminders list on an OpenClaw heartbeat. A dedicated reader sees only checked text. The watcher can make personal calendar plans, keep correspondence in native memory, report to main, and check off reviewed items. Incoming reminders never dispatch agent turns.

This is an implementation candidate. The configuration builder keeps heartbeat paused unless explicitly enabled and denies native writes and sends. No real forwarding or production configuration is enabled. Merging and TEST/PROD are held until the OpenClaw upgrade finishes and the requester releases the hold. See [Plan 033](../../docs/plans/033-communication-awareness.md).

## Data flow

The watcher calls `communication_review`. That tool creates a fresh `communication-reader` session using the public subagent runtime, admits that session to the read tool, waits for its answer, and checks the answer before returning it. Reader transcripts are deleted after the job. A cleanup failure returns only an unavailable status and must be cleared before another reader starts. Installed runtime cleanup behavior still needs DEV validation.

`communication_inbox_read` only reads the configured list. Pending and completed-history reads share the same scope checks, strict verdict validation, secret redaction, and injection check. Results contain bounded text and receipts; no raw provider responses, errors, attachments, or probe evidence are returned. Original sender labels remain untrusted.

The watcher completes a receipt after handling it. Receipts are random, expire after 30 minutes, bind to the watcher session and source fingerprint, and are discarded on restart. They are temporary access grants, not an intake ledger. A fresh read issues fresh receipts. Reminders remain the intake queue; correspondence memory provides context and prevents blind repetition after failed check-off.

The installed CLI has no atomic compare-and-complete operation. The adapter rechecks membership and content before completion and verifies afterward. It cannot prevent an edit made between those calls from being checked off. The phone must create new items rather than modifying existing ones; this race is an explicit rollout limitation, not an exactly-once claim.

## Tools and permissions

| Agent | Tools |
| --- | --- |
| Dedicated reader | `communication_inbox_read` only |
| Watcher | `communication_review`, `communication_inbox_complete`, guarded memory read/search/save, guarded calendar read/plan, `communication_report` |
| Main | `communication_memory_read` for checked handoff reads, plus existing owner-authorized tools |

The tool factory uses runtime agent/session identity. Every exposed tool performs its own guards; the lifecycle hook adds defense in depth. Save uses OpenClaw's safe-file API and rejects stale revisions. Report calls the public native tool factory through a private fixed-main route, preserving the actual source session. Its construction-only configuration grants that backend route without changing runtime configuration or exposing a raw send tool. Native replies and errors are stripped from the tool result. Accepted means queued for main, not received by the owner.

The sandbox mounts every instruction file, including bootstrap `MEMORY.md`, read-only. Exec, process, skill authoring, raw file tools, native messaging, and general account tools are unavailable. Effective agent and sandbox policies deny those alternatives even when the plugin is disabled.

Memory uses the existing OpenClaw built-in manager and ordinary Markdown. Search results are limited to `memory/correspondence/<sender-key>/<date>.md`; current files are reread with the same content checks. There is no new memory database, collector, or timestamp checkpoint. Native automatic recall must stay disabled for these restricted profiles unless the installed recall path is separately proven to run the same guards.

Calendar tools fix the calendar ID, accept explicit offset-bearing dates, prohibit attendees and deletions, and only confirm marked watcher placeholders with no attendees or recurrence. Creates search for the source marker before writing. Provider timeouts remain uncertain; consult memory and the provider before retrying. Calendar scope must be verified as a personal, unshared calendar before real use.

Each process limits source reads to eight per 30 minutes, reports to three, calendar writes to five, and content checks to 64 per 30 minutes / 512 per day. Counters reset on gateway restart. Reader jobs allow two reads and 16 KiB total text, at most 20 items per call. Limits return categorical errors and leave unfinished items pending.

## Configuration and staging

The plugin manifest requires trusted host paths for both Apple-PIM CLIs, a fixed config directory/profile, list/calendar IDs, agent identities, fixed main session, and an `mcp-hooks` LLM provider. The module owns credentials; agents cannot select a binary, profile, provider, list, calendar, or destination. Existing Apple-PIM configuration must independently deny unrelated lists/calendars. Run fixtures with recording CLIs, never real account mutations.

`scripts/configure.mjs` exports a pure configuration builder. It accepts an already normalized host configuration and returns a candidate; it does not write live settings. It preserves existing heartbeat schedules and adds a paused watcher (`every: "0m"`). Set `enableHeartbeat: true` only after validation to select the approved 30-minute cadence. It rejects an existing watcher and old agent-list layouts. Validate the candidate with the selected host before installation. The bound instruction files must all exist, including otherwise optional bootstrap files, and inherited skill/persona sources must be read-only.

Copy `instructions/AGENTS.md` into the nested watcher workspace, `reader-AGENTS.md` into the dedicated reader workspace, and incorporate `main-AGENTS.fragment.md` into main's instructions. Keep other policy files present with trusted contents. The `memory/` directory remains writable at the mount level; bootstrap `MEMORY.md` is read-only. The guarded save tool writes only sender/date correspondence. Revisions detect stale saves but do not provide atomic coordination with main; follow editing ownership in the notes. The main workspace contains the watcher folder, while the reader has its own restricted workspace.

Read-only per-file overlays need the explicit reserved-target option. This is limited to the fixed instruction paths and is not permission for external host/credential mounts. Atomic replacement by main can leave an old inode visible in an existing container. Verify host bootstrap and sandbox-visible instructions after each rule edit, and use the supported sandbox refresh when needed. Do not claim rule propagation from a host read-back alone.

## Phone shortcut contract

Create one **undated** reminder for each eligible incoming message in the shared list. No alarm, assignment, or due date. Share only with the owner and assistant account; disable participant invitations and list activity notifications. Use the native Reminders action and normal Apple account sign-in, with no webhook credentials.

Use a Shortcuts Dictionary converted to JSON for Notes, so quotes and newlines are escaped correctly:

```json
{"version":1,"sender":"+15555550123","senderName":"Example contact","timestamp":"2026-09-26T18:00:00-07:00","timestampKind":"captured","body":"Dinner tomorrow at six?"}
```

`senderName` is optional. `timestampKind` is `sent` only if iOS supplies the actual message time; otherwise use `captured`. Resolve contact membership before creating the reminder, but treat number matching as a noise filter, not authentication. SMS spoofing and other original-sender uncertainty remain part of the untrusted-content model. Verify locked-phone automation, dynamic sender/body fields, contact filtering, and sync on the actual phone before enabling real forwarding. This repository cannot establish those device facts with fixtures.

## Local verification

Run `pnpm --filter communication-watcher test`, `lint`, and `build` using the repository-pinned toolchain. Runtime regressions cover guard order, invalid verdicts, wrong lists/callers, changed item versions, stale receipts, queue poisoning, concurrent review ownership, reader reasoning blocks, tool escapes, and calendar scope. Review instruction text directly; do not add tests of prose.

The shared cumulative gate collects this workspace's runtime tests and `candidate.communication-watcher.test.ts`. The latter uses the selected native SDK for configuration validation, sender recall, current-file checks, ancestor replacement, guarded main reads, and disabled-plugin tool policy. The gateway fixture exercises four native heartbeats, fresh reader sessions and cleanup, secret/injection checks, calendar/save/report/complete, restart recovery after failed check-off, checked history, and instruction refresh. Its local mode does not prove Docker mounts. DEV runs the same fixture with actual Docker overlays against the extracted CI artifacts.

## Packaging and DEV

The cumulative runner builds and seals `communication-watcher` as an additional artifact. The package binds plugin and bundled guard sources, dependencies, and toolchain; the installed fixture uses the extracted plugin with the selected OpenClaw SDK. Consumers must map this additional artifact in their target, even while the watcher stays paused. The package does not activate the agent or add an Apple account.

Under the maintained DEV slot controller, run `node packages/e2e/bin/communication-dev.mjs <imported-build.json> <new-owned-run-root>`. It installs the verified CI archives offline, uses recording account adapters and a local scripted model, tests the read-only Docker mounts, and writes an exact-source DEV proof after cleanup. It cannot run without the DEV lease. Main's atomic rule replacement uses `openclaw sandbox recreate --agent communication-watcher --force` in the isolated configuration before checking the next heartbeat and container-visible text.

## Activation prerequisites

Stock OpenClaw 2026.9.3 delivers the initial native handoff but can reject its delayed reply after caller authority expires. Stock 2026.9.6 passes the native reply and silent announcement fixture. The fixture records whether it validated that newer reply path; the exact composed CI artifact still needs installed DEV validation. No competing core patch or special notification mechanism is included.

Keep real forwarding paused until locked-phone behavior, account/list/calendar scope, installed mounts, and the upgrade's native reply path pass. The merge hold remains in force; no TEST or production activation is part of this task.
