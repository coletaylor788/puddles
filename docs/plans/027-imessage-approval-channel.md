# Plan 027: iMessage approvals for gated tools

**Status:** Pending
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

This proposal connects iMessage to the gateway’s existing approval system. The gateway owns requests, decisions and timeouts; the channel delivers the request and an authenticated owner response. Use the existing text approval command where it supports the required round trip. A separate approval engine or destination trust ladder is outside this scope.

### Status

The native approval engine exists, but the iMessage approval round trip is not implemented or validated. The Mini still configures the skill workshop for automatic approval and has no approval forwarding configuration. The original draft proposed extra channel handlers whose necessity remains unproved.

The owner retained this native approval integration on 2026-09-26. Implementation and validation remain pending. The abandoned custom egress and global injection proposals are not prerequisites.

## Agent section

### State

Pending. Audited against the repository and selected read-only Mini evidence on 2026-09-26. Keep this plan in the active folder until its remaining scope is resolved.

### Scope and acceptance criteria

- Render a pending tool approval to the requesting agent’s authorized owner.
- Bind decisions to the correct request and owner; reject stale or unrelated replies.
- Resolve cancellation, timeout, concurrency, and restart behavior without applying a decision twice.
- Enable pending workshop approvals only after the channel round trip works.

### Architecture and decisions

- The native iMessage channel belongs to the OpenClaw runtime; the draft assumed an `openclaw-plugins/imessage-channel/` implementation in this repository that does not exist.
- Reuse the native `plugin.approval.request`, `plugin.approval.waitDecision`, and `plugin.approval.resolve` methods already present in the installed runtime.
- Upstream `src/auto-reply/reply/commands-approve.ts` routes authenticated `/approve <id> <decision>` commands to exec or plugin approval resolution. `src/gateway/server-methods/plugin-approval.ts` supports the existing approval forwarder. Verify the configured release’s complete iMessage forwarding and decision path before adding any adapter.
- iMessage is absent from the known native-prompt channel set; current channel source advertises no native approval capability. This does not establish that the separate text-command path is unusable.
- The original custom pending-state file and speculative notification API are unverified draft details, not accepted implementation requirements. Request lifetime, timeout and restart ownership must follow the native engine.
- Contacts-based recipient trust does not establish approval-owner identity. Owner authorization must use the gateway’s trusted owner configuration.
- A bare yes/no response is ambiguous with concurrent requests; a resumed implementation must define explicit request matching.

### Implementation

- Mini has the native `imessage` channel configured.
- `skills.workshop.approvalPolicy` is `auto`; this is a workaround, not completion of the proposed approval route.
- No `imessage-channel` approval plugin exists in this repository or the Mini plugin inventory.

### Validation

- Compared proposed plugin path with repository and Mini plugin inventories.
- Read only the Mini workshop approval policy, channel keys and approval forwarding presence; neither exec nor plugin forwarding is configured.
- Inspected installed approval API/capability markers and upstream approval command, gateway handler and iMessage channel source. No approval request or message was sent.

The hygiene audit reads source, installed artifacts, and selected configuration. It does not repeat live tool calls, send messages, or certify current end-to-end behavior. Earlier test claims are historical evidence, not fresh test results.

### Rollout and rollback

This change only updates the plan. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. Unmet and uncertain scope remains explicit; no abandonment decision is inferred.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Record implemented and unresolved scope separately.
- [x] Confirm the owner wants native OpenClaw approvals.
- [ ] Implement and validate the native approval round trip.
