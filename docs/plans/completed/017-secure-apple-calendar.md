# Plan 017: Secure Apple Calendar plugin

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The calendar plugin owns the local calendar process bridge and separates reading from writing. It checks untrusted event content before returning reads and checks attendee trust before a mutation can send invitations. Other Apple productivity domains use their own tools.

### Status

The calendar wrapper is implemented and installed. Its final tool split and contacts-based trust replace the original single-tool approval design. Contacts-based deployment remains pending separately: the service cannot resolve its helper, so contact-dependent invitations are currently blocked.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Expose calendar read and write actions through wrapped local MCP calls.
- Reject actions outside the selected tool before starting a bridge.
- Scan untrusted event reads for injection and secrets.
- Check every attendee on create, update, and batch-create before calling the calendar service.
- Do not register reminder, contact, mail, or general Apple-PIM tools through this wrapper.

### Architecture and decisions

- These guards run only on the tool paths wired to them. There is no global scan of every execution result, file read, or web response, and no interactive approval ladder.
- Two OpenClaw tools, `calendar_read` and `calendar_write`, call the one upstream MCP `calendar` tool.
- `events/get/search` use ingress guards; `list/schema/delete` do not. Unknown actions are rejected by each tool action gate.
- Attendee mutations use `ContactsEgressGuard`; mutations without attendees are unhooked. The old no-attendee `LeakGuard` and `SendApproval` ladder are not current behavior.
- Recipient domains skip contact lookup but do not replace the guard content checks.
- The plugin registers factories synchronously and resolves a per-config-directory bridge, as completed in Plan 021.

### Implementation

- `openclaw-plugins/secure-apple-calendar/src/{plugin,action-map,wrap-tool,mcp-bridge,bridge-cache,prefilter}.ts` implements the current paths.
- Component tests cover action gates, recipient extraction, hooks, filtering, and bridge reuse.

### Validation

- Contacts deployment limitation: `contactsCliPath` is unset and the gateway service PATH does not resolve `contacts-cli`; lookup therefore fails closed. Pending Plan 018 owns configuration and gateway-context validation. Approved domains bypass lookup but retain content checks.
- Bounded deployed-bundle inspection confirms injection and redaction errors return `action: "block"` with degraded details; neither bundle contains a fail-open path marker.
- Mini has the plugin enabled and its installed bundle contains `ContactsEgressGuard` and `APPLE_PIM_CONFIG_DIR`.
- Mini main allows `calendar_write`; reader allows `calendar_read`.
- Inspected component README, action map, bridge cache, registration source, and tests.

Installation and source behavior are verified. Historical live smoke claims are not rerun; the audit does not create invitations or read personal events. Later optional contact redaction and unrelated domain integrations are excluded.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
