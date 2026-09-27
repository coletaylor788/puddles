# Communication watcher

Reviews a private shared Reminders list on an OpenClaw heartbeat. A dedicated reader sees only checked text. The watcher can make personal calendar plans, keep correspondence in native memory, report to main, and check off reviewed items. Incoming reminders never dispatch agent turns.

This is a paused implementation candidate, not an active watcher. The staging helper keeps heartbeat disabled and denies native writes and sends. No real forwarding or production configuration is enabled. Merging and TEST/PROD are held until the OpenClaw upgrade finishes and the requester releases the hold. See [Plan 033](../../docs/plans/033-communication-awareness.md).

## Data flow

The watcher calls `communication_review`. That tool creates a fresh `communication-reader` session using the public subagent runtime, admits that session to the read tool, waits for its answer, and checks the answer before returning it. Reader transcripts are deleted after the job. A cleanup failure returns only an unavailable status and must be cleared before another reader starts. Installed runtime cleanup behavior still needs DEV validation.

`communication_inbox_read` only reads the configured list. Pending and completed-history reads share the same scope checks, strict verdict validation, secret redaction, and injection check. Results contain bounded text and receipts; no raw provider responses, errors, attachments, or probe evidence are returned. Original sender labels remain untrusted.

The watcher completes a receipt after handling it. Receipts are random, expire after 30 minutes, bind to the watcher session and source fingerprint, and are discarded on restart. They are temporary access grants, not an intake ledger. A fresh read issues fresh receipts. Reminders remain the intake queue; correspondence memory provides context and prevents blind repetition after failed check-off.

The installed CLI has no atomic compare-and-complete operation. The adapter rechecks membership and content before completion and verifies afterward. It cannot prevent an edit made between those calls from being checked off. The phone must create new items rather than modifying existing ones; this race is an explicit rollout limitation, not an exactly-once claim.

## Tools and permissions

| Agent | Tools |
| --- | --- |
| Dedicated reader | `communication_inbox_read` only |
| Watcher | `communication_review`, `communication_inbox_complete`, guarded memory read/search, guarded calendar read/plan, native `write` and `sessions_send` remain denied in the staged configuration |
| Main | `communication_memory_read` for checked handoff reads, plus existing owner-authorized tools |

The tool factory uses runtime agent/session identity. The current candidate has a `before_tool_call` guard for tool escapes, memory writes, and reports, but native writes and sends remain denied. The revised design puts save/report checks inside plugin-owned tools, following `secure-gmail`, and retains normal OpenClaw handoffs with runtime source identity. Those wrappers are not implemented yet. The proposed sandbox mounts every instruction file, including bootstrap `MEMORY.md`, read-only; no exec, process, skill authoring, arbitrary file reads, or general account tools are allowed. Use the effective configuration, not just this plugin's hook, as the permission boundary. Disabling the plugin must not expose broader replacements.

Memory uses the existing OpenClaw built-in manager and ordinary Markdown. Search results are limited to `memory/correspondence/<sender-key>/<date>.md`; current files are reread with the same content checks. There is no new memory database, collector, or timestamp checkpoint. Native automatic recall must stay disabled for these restricted profiles unless the installed recall path is separately proven to run the same guards.

Calendar tools fix the calendar ID, accept explicit offset-bearing dates, prohibit attendees and deletions, and only confirm marked watcher placeholders with no attendees or recurrence. Creates search for the source marker before writing. Provider timeouts remain uncertain; consult memory and the provider before retrying. Calendar scope must be verified as a personal, unshared calendar before real use.

Each process limits source reads to eight per 30 minutes, reports to three, calendar writes to five, and content checks to 64 per 30 minutes / 512 per day. Counters reset on gateway restart. Reader jobs allow two reads and 16 KiB total text, at most 20 items per call. Limits return categorical errors and leave unfinished items pending.

## Configuration and staging

The plugin manifest requires trusted host paths for both Apple-PIM CLIs, a fixed config directory/profile, list/calendar IDs, agent identities, fixed main session, and an `mcp-hooks` LLM provider. The module owns credentials; agents cannot select a binary, profile, provider, list, calendar, or destination. Existing Apple-PIM configuration must independently deny unrelated lists/calendars. Run fixtures with recording CLIs, never real account mutations.

`scripts/configure.mjs` exports a pure configuration builder. It accepts an already normalized host configuration and returns a candidate; it does not write live settings. It preserves existing heartbeat schedules and adds a paused watcher (`every: "0m"`). The approved operating cadence remains 30 minutes. It rejects an existing watcher and old agent-list layouts. Validate the candidate with the selected host before installation. The bound instruction files must all exist, including otherwise optional bootstrap files, and inherited skill/persona sources must be read-only.

Copy `instructions/AGENTS.md` into the nested watcher workspace, `reader-AGENTS.md` into the dedicated reader workspace, and incorporate `main-AGENTS.fragment.md` into main's instructions. Keep other policy files present with trusted contents. The `memory/` directory remains writable at the mount level; bootstrap `MEMORY.md` is read-only. This initial behavior writes only sender/date correspondence once the guarded save tool is implemented and validated. The main workspace contains the watcher folder, while the reader has its own restricted workspace.

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

The shared cumulative gate collects this workspace's runtime tests and `candidate.communication-watcher.test.ts`. The latter uses the selected native SDK for configuration validation, sender recall, current-file checks, ancestor replacement, guarded main reads, and disabled-plugin tool policy. Mounts, heartbeat, provenance, recovery, and complete DEV behavior still require installed assertions against the selected CI artifact. Passing unit fixtures does not clear those gates.

## Remaining activation work

Replace hook-only native write/send access with plugin-owned guarded save/report tools. Raw alternatives stay denied at both agent and sandbox policy layers. The existing native SDK regression proves the paused configuration leaves no raw fallback when the plugin is absent; it does not prove the planned wrappers.

Retain normal OpenClaw handoffs. Its bounded peer replies are allowed: the heartbeat controls inbox intake, not every main/watcher conversation. Follow-ups must preserve main’s ownership, avoid another inbox sweep, and not repeat actions or alerts. Verify a supported messaging interface that preserves runtime source identity and exact-main routing while raw sends remain denied. The proposed system-event notification is withdrawn. See the [implementation decision](../../docs/plans/033-communication-awareness-appendix.md#implementation-compatibility-decision).

The watcher remains paused pending wrapper implementation and complete installed DEV checks, including mounts, rule propagation, bounded replies, and recovery. No competing core patch is included during the upgrade. The user’s separate merge hold remains in force; changing only the heartbeat to 30 minutes would not complete the system.
