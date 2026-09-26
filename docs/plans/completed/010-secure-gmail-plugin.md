# Plan 010: Secure Gmail MCP tool plugin

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The mail plugin connects to the Gmail service over a local process bridge and checks untrusted message fields before returning them to an agent. Separate agents receive mail-reading and local mail-maintenance tools. Sending mail is outside the implemented tool set.

### Status

The ingress wrapper is implemented and configured on the Mini. It reads the authenticated mailbox and exposes local mail-maintenance tools; outbound mail is outside its delivered scope.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Await injection detection and secret redaction inside tool execution before exposing incoming mail.
- Register the supported Gmail tool surface synchronously and connect the subprocess lazily.
- Preserve hook-free local maintenance operations where configured.

### Architecture and decisions

- These guards run only on the tool paths wired to them. There is no global scan of every execution result, file read, or web response, and no interactive approval ladder.
- Current `EXPOSED_TOOLS` is registered synchronously; the original asynchronous discovery-at-registration pseudocode does not describe the maintained loader.
- `gmailPrefilter` limits model scans to sender-controlled JSON fields. Regex secret scanning still covers the full result.
- There is no send/forward/reply tool in the current plugin, and no egress hook is wired for one.
- The owner confirmed delegated-mailbox API access was unsupported and abandoned. That addendum is removed; `userId="me"` is the implemented mailbox model.

### Implementation

- `openclaw-plugins/secure-gmail/src/{plugin,mcp-bridge,wrap-tool,prefilter}.ts` implements the wrapper.
- Tests cover the bridge, wrappers, prefilter, registration, and synthetic hook integration.

### Validation

- Bounded deployed-bundle inspection confirms injection and redaction errors return `action: "block"` with degraded details; neither bundle contains a fail-open path marker.
- Mini has `secure-gmail` enabled, an existing configured Python interpreter, and an installed bundle with classification logging.
- Mini reader allows `list_emails`, `get_email`, and `get_attachments`; main allows `archive_email` and `add_label`.
- Repository search confirms `userId="me"` API calls and no delegated mailbox schema field.
- Parent audit independently matched all six configured deployed Gmail source modules to this checkout: server, auth, config, keychain, async helper, and logging setup.

The hygiene audit reads source, installed artifacts, and selected configuration. It does not repeat live tool calls, send messages, or certify current end-to-end behavior. Earlier test claims are historical evidence, not fresh test results.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
