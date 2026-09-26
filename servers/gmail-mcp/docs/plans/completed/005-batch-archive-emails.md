# Plan 005: Archive multiple Gmail messages

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

An agent can archive several messages in one tool call. Each result is tracked independently, so one failed message does not hide successful work or stop the rest of the batch.

### Status

The feature is implemented and present in the Mini’s configured Gmail bridge. The plan describes the current interface and architecture. There is no pending follow-up scope in this plan.

## Agent section

### State

Completed implementation, verified by source inspection and read-only deployed-file comparison on 2026-09-26. Runtime behavior was not changed during this documentation audit.

### Scope and acceptance criteria

- Require an array of message IDs, including for a single message.
- Remove INBOX from each selected message without deleting it.
- Return success counts and identify individual failures.

### Architecture and decisions

The `archive_email` schema requires `email_ids`, an array of strings. `_archive_email` rejects a missing or empty selection, then performs one `messages.modify` call per ID with `removeLabelIds: ["INBOX"]`. This is a sequential per-message loop, not Gmail `batchModify` and not an atomic transaction. It accumulates success and failure results and continues after an individual API error.

### Implementation

`src/gmail_mcp/server.py` contains the schema and `_archive_email`. `README.md` and `docs/tools.md` show array inputs for both single and multiple messages.

Paths in this section are relative to `servers/gmail-mcp/`.

### Validation

`tests/test_server.py::TestArchiveEmail` covers a single message, multiple messages, missing IDs, partial failures, and all-failed results.

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
