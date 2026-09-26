# Plan 003: Read, download, and archive Gmail messages

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The server can retrieve a message’s text and HTML, download its attachments, and archive selected messages. The tools keep reading and modification explicit, report useful results, and sanitize attachment filenames before writing them to the selected directory.

### Status

The feature is implemented and present in the Mini’s configured Gmail bridge. The plan describes the current interface and architecture. There is no pending follow-up scope in this plan.

## Agent section

### State

Completed implementation, verified by source inspection and read-only deployed-file comparison on 2026-09-26. Runtime behavior was not changed during this documentation audit.

### Scope and acceptance criteria

- Expose message retrieval with full, text-only, or HTML-only output.
- Download all attachments or attachments matching a filename, with safe local names.
- Archive selected message IDs and report successes and failures.
- Keep sending, drafting, permanent deletion, and label creation outside these tools.

### Architecture and decisions

`_get_email` fetches a full message, recursively extracts text, HTML, and attachment metadata, and returns JSON. Headers include from, to, subject, date, and CC when present. Attachment metadata exposes filenames, MIME types, and sizes rather than attachment IDs.

`_get_attachments` fetches the message afresh, optionally filters by filename, downloads the current attachment IDs internally, and writes decoded bytes under `save_to` (default `~/Downloads`). `_sanitize_filename` replaces path separators and invalid characters, handles empty/dot-prefixed names, and limits length. Existing output names receive numeric suffixes.

The original single `email_id` archive input and public `attachment_id` selector were replaced by completed plans 005 and 004. Current `archive_email` requires `email_ids`; each message loses only its INBOX label. Attachment sizes are available in `get_email`; download does not implement a separate size-confirmation prompt. All Gmail requests target the authenticated account.

OAuth requests `gmail.modify` and `gmail.send`; the latter remains in source from the old integration-test setup. There is no send tool. Historical live integration tests are not appropriate for this read-only audit.

### Implementation

`src/gmail_mcp/server.py` contains `_get_email`, `_extract_body_parts`, `_get_attachments`, `_sanitize_filename`, and `_archive_email`. `src/gmail_mcp/auth.py` declares scopes. `README.md` and `docs/tools.md` carry the current public tool interface.

Paths in this section are relative to `servers/gmail-mcp/`.

### Validation

`tests/test_server.py` checks multipart extraction, output formats, sanitization, file downloads, filename filtering, missing inputs, archive success, and per-message failures.

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
