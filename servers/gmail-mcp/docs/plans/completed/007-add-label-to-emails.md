# Plan 007: Label Gmail messages

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

An agent can apply an existing Gmail label to one or more messages. Built-in labels resolve directly, while custom names are looked up in the account. Unknown labels produce an error instead of creating a new label unexpectedly.

### Status

The feature is implemented and present in the Mini’s configured Gmail bridge. The plan describes the current interface and architecture. There is no pending follow-up scope in this plan.

## Agent section

### State

Completed implementation, verified by source inspection and read-only deployed-file comparison on 2026-09-26. Runtime behavior was not changed during this documentation audit.

### Scope and acceptance criteria

- Expose an existing label name and an array of message IDs.
- Resolve system and custom labels, with case-insensitive matching.
- Apply labels per message and report partial failures without creating labels.

### Architecture and decisions

The `add_label` schema requires `email_ids` and `label`. `_get_label_id` recognizes the maintained set of system labels by uppercase ID. For a custom name it calls `labels.list` and matches case-insensitively. An unknown name returns an explicit error. `_add_label` loops through message IDs and sends `messages.modify` with `addLabelIds`, collecting successes and failures. It does not create missing labels or perform an atomic batch.

### Implementation

`src/gmail_mcp/server.py` contains `add_label`, `_get_label_id`, and `_add_label`. The same async request helper used by other Gmail tools wraps label lookup and updates.

Paths in this section are relative to `servers/gmail-mcp/`.

### Validation

`tests/test_server.py::TestGetLabelId` and `TestAddLabel` cover system/custom names, case handling, unknown labels, single and multiple messages, missing inputs, and partial/all failures.

On 2026-09-26, read-only inspection followed the enabled secure Gmail plugin's configured bridge executable and working directory. SHA-256 checks of the deployed `server.py`, `auth.py`, `config.py`, `keychain.py`, `_async.py`, and `logging_setup.py` exactly matched this checkout. This establishes installed implementation identity, not a new live Gmail transaction.

The focused mocked suite passed: 169 tests across `tests/test_config.py`, `tests/test_auth.py`, `tests/test_server.py`, `tests/test_async.py`, and `tests/test_logging_setup.py`. The command was `python -m pytest -q -p no:cacheprovider` followed by those five files, with `PYTHONPATH` selecting this checkout's `src`. No OAuth flow, mailbox operation, or integration test ran against a live account.

### Rollout and rollback

The implementation is present in the configured Mini bridge. This audit changes documentation only. Future runtime changes use the maintained deployment workflow and a retained prior release for rollback; the old instructions to reinstall a mutable checkout or trigger a live email cron are not an audit procedure.

### Review log

The hygiene audit compared this plan’s original scope with current tool schemas, implementation, existing tests, and the configured bridge’s source identity. Obsolete setup assumptions were replaced with the implemented design. Historical live test counts are not presented as new audit evidence.

### Checklist

- [x] Confirm the feature in source and existing tests.
- [x] Match the configured Mini bridge to the inspected source files.
- [x] Describe later interface and architecture changes accurately.
- [x] Remove follow-up scope and archive the completed plan.
