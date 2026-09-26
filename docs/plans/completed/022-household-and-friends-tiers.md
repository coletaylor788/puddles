# Plan 022: Household assistant tier

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The household tier gives selected people a limited route to the owner’s assistant. It can handle shared-list work, use its own web and browser workers, and send out-of-scope questions to the owner. Private owner data and tools remain outside the tier. A quoted human reply lets the owner’s agent relay an answer back.

### Status

The household tier, its workers, and its guard hooks are implemented and configured on the Mini. This completed plan records the household architecture and the delivered owner-mediated relay.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Household uses its own workspace and restricted tool set, without email, contacts, direct browser access, cron, or upward session messaging.
- Its reader and browser workers are separately scoped and reachable only through allowed delegation.
- Shared reminder access uses per-agent Apple-PIM configuration; no household calendar tools are currently granted.
- Persona inheritance reads the owner’s canonical persona while household retains a separate roster and instructions.
- Message targets are limited to configured household bindings and the owner relay destination.
- Main cron session messaging uses an explicit target allowlist; owner replies relay one-shot without conversational ping-pong.

### Architecture and decisions

- The delivered population is `household`, `household-reader`, and `household-browser-agent`. It is not a completed friends-tier rollout.
- Four internal hooks are configured: `persona-inherit`, `apple-pim-scope`, `message-chat-pin`, and `sessions-send-cron-target-allowlist`.
- Household has `apple_pim_reminder` but not `calendar_read`, `calendar_write`, `apple_pim_contact`, or Gmail tools. The reader currently has both `web_fetch` and `web_search`; the original single-web-tool sketch is stale.
- Owner relay uses a quoted reply carrying the originating session key. A plain reply is not guessed to belong to the most recent question.
- The message guard permits the agent’s configured chats plus the owner destination; it is not strictly limited to the current inbound chat.
- Tool grants and sandbox policy provide containment. Prompt wording alone does not enforce access.
- Provider choice, deployment endpoints, human identities, and authenticated bindings belong in private configuration, not this public plan.
- Persona is injected at bootstrap instead of using symlinks that escape the tier workspace. Worker tool policy remains distinct from tier persona.

### Implementation

- Mini has the household trio in `agents.list` and all four internal hooks enabled and present.
- Main has `sessions_send`; household has only spawn/yield coordination and no `sessions_send`.
- Household’s configured PIM file exists; household-reader has no PIM tools or configuration, consistent with the current reminder-only surface.
- The historical record reports household containment, PIM scoping, cross-chat blocking, worker restrictions, and the quoted-reply return relay implemented and tested.

### Validation

- Read selected Mini agent allowlists, hook enable flags, and per-agent configuration-file existence.
- Original record reports household build validation on 2026-07-05 and a real iMessage return-relay check on 2026-07-09, using an owner-controlled scratch binding.
- No private roster, message, raw binding, or account content was read.

This archive covers the implemented household architecture. It does not assert a new real-partner/group acceptance run. Friends rollout, provider cutover, added calendars, per-tier durable profiles, groups, and other optional expansion have been removed from this completed plan as requested. Current hook presence does not by itself prove every runtime guard execution.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
