# Plan 030: Scoped shared Apple Notes

**Status:** Pending
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The proposed integration exposes only explicitly configured shared-note folders to the appropriate agent tier. A human establishes the share and records its scope. Read tools redact secrets, and write tools prevent leaking them into a shared folder.

### Status

The scoped Notes integration is not implemented. A generic Apple Notes skill is installed, but the proposed helper, guarded plugin, folder policy, and share-intake workflow are absent. The plan remains paused.

The owner confirmed on 2026-09-26 that this work remains pending.

## Agent section

### State

Pending. Audited against the repository and selected read-only Mini evidence on 2026-09-26. Keep this plan in the active folder until its remaining scope is resolved.

### Scope and acceptance criteria

- Expose `notes_read` list/get/search and `notes_write` create/append/update only for configured folders.
- Bind folder configuration to trusted calling-agent identity, not a model-selected path.
- Require human sharing setup and explicit tier/sharer attestation; optionally verify contact identity when available.
- Retain read redaction and outbound shared-folder leak checks.
- Verify Automation permissions from the actual gateway process chain and test cross-tier/non-configured-folder rejection.
- The concrete share-acceptance interaction and trustworthy pre-accept sharer lookup still need validation.

### Architecture and decisions

- Prefer assistant-owned shared folders with a one-time human invitation flow. Incoming shares require explicit human acceptance and configuration.
- The earlier draft alternates between mandatory contacts validation and optional auto-verification with fallback to configured attestation. A resumed design must choose and document which is the enforced boundary.
- AppleScript sharing metadata, private CloudKit container access, and SQLite blob parsing are historical research claims, not verified current supported APIs.
- A generic `apple-notes` skill is not the planned per-tier `secure-apple-notes` authorization layer.
- Delete/move, browser auto-accept, automatic acceptance of every share, and later tier expansion are excluded from this primary design.

### Implementation

- No `openclaw-plugins/secure-apple-notes/` exists locally or on the Mini.
- No `notes-cli` exists at the proposed Mini local binary path; no Notes plugin entry is enabled.
- Mini has a mirrored generic Apple Notes skill.

### Validation

- Compared proposed implementation paths with repository and Mini inventories.
- Checked only helper existence and enabled plugin names; no Notes database or note content was opened.

The hygiene audit reads source, installed artifacts, and selected configuration. It does not repeat live tool calls, send messages, or certify current end-to-end behavior. Earlier test claims are historical evidence, not fresh test results.

### Rollout and rollback

This change only updates the plan. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. Unmet and uncertain scope remains explicit; no abandonment decision is inferred.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Record implemented and unresolved scope separately.
- [x] Confirm the owner wants to retain this pending integration.
- [ ] Resolve the remaining design questions and implement the scoped integration.
