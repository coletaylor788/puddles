# Plan 027: iMessage approvals for gated tools

**Status:** Superseded by the current tool approval proposal
**Issue:** [#68](https://github.com/coletaylor788/puddles/issues/68)
**Last updated:** 2026-10-07

## Human section

### Design

The current design is [Native tool approvals and guarded Gmail
sending](todoist-68-asynchronous-tool-approvals.md). It uses OpenClaw's native
plugin approval authority and iMessage adapter, then adds complete email review
and an explicit deferred operation for the existing Gmail integration.

Native iMessage approval support now exists in the repository's pinned
OpenClaw. There is no need for a new Puddles iMessage channel plugin. Native
origin prompts and explicit forwarded notifications use different paths;
validate the configured route rather than assuming every message supports
reaction-based approval. The current proposal defines the owner route, complete
review, decision authorization, restart behavior, and result continuation.

### Status

This plan is a navigation pointer, not a separate implementation project.
The linked proposal awaits design review. Workshop approval configuration is
outside its Gmail scope and remains unchanged.

## Agent section

### State

Superseded on 2026-10-07. The current proposal contains exact source revisions
and links. Earlier observations of installed configuration were from
2026-09-26; they are not evidence of today's production configuration.

### Scope and acceptance criteria

Use the linked proposal's scope and acceptance criteria. Native iMessage must
bind an authorized owner decision to the correct request. Channel support alone
does not prove final-parameter review or restart-safe deferred execution.

### Architecture and decisions

- Reuse `plugin.approval.request`, `plugin.approval.waitDecision`, and
  `plugin.approval.resolve`, the persistent native operator approval store,
  and the built-in iMessage approval adapter.
- Reuse the authenticated `/approve` path where generic forwarding does not
  provide native controls. Never interpret a bare yes/no as a decision.
- Contacts-based destination trust grants neither owner identity nor approval.
- Native pending requests normally cancel on gateway restart. Only the
  proposed explicit deferred operation changes that behavior for its own work.
- Do not create a custom pending-state file or independent channel resolver.

### Implementation

No runtime changes in this revision. Implementation belongs to the linked
proposal after its design is approved. Do not enable pending workshop approvals
as an incidental Gmail configuration change.

### Validation

Source review confirms native iMessage approval code at the repository's
OpenClaw pin and current upstream. This documentation update checks links,
consistency, and formatting. No live approval or message is sent, and no
installed-runtime validation is claimed.

### Rollout and rollback

Documentation only. Future delivery and rollback follow the linked proposal
and the current repository development lifecycle.

### Review log

The 2026-09-26 uncertainty about whether a native iMessage adapter exists is
resolved by current source inspection. Route behavior and device acceptance
remain explicit validation work in the current proposal.

### Checklist

- [x] Locate native iMessage approval support in current source.
- [x] Consolidate the current design under issue #68.
- [x] Distinguish historical configuration observations from current evidence.
- [ ] Validate the approved implementation's complete owner round trip.
