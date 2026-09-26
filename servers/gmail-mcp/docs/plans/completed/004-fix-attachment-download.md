# Plan 004: Select Gmail attachments by filename

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

Attachment download accepts a human-readable filename and resolves the attachment from a fresh message fetch. Users no longer need to copy an opaque attachment identifier from an earlier response. The message display shows the filename, type, and size needed to choose a download.

### Status

The feature is implemented and present in the Mini’s configured Gmail bridge. The plan describes the current interface and architecture. There is no pending follow-up scope in this plan.

## Agent section

### State

Completed implementation, verified by source inspection and read-only deployed-file comparison on 2026-09-26. Runtime behavior was not changed during this documentation audit.

### Scope and acceptance criteria

- Replace the public attachment-ID selector with an optional filename selector.
- Keep attachment IDs internal to the fresh fetch and download operation.
- Display attachment metadata and test filename matching.

### Architecture and decisions

The `get_attachments` schema exposes `email_id`, optional `filename`, and optional `save_to`. `_get_attachments` obtains a fresh message, extracts attachments, and matches the original filename exactly. Omitting the filename selects all attachments; duplicate matching names can select multiple attachments. The downloader uses each current `attachmentId` internally and avoids overwriting local names by adding suffixes.

`_get_email` exposes `filename`, `mime_type`, and `size_bytes`, without an attachment ID. The old plan attributed a reported mismatch to every Gmail request regenerating IDs. The completed contract does not depend on that unverified universal claim; it documents the implemented filename-based selection.

### Implementation

The schema, selector, and output mapping are in `src/gmail_mcp/server.py`. The README and tool reference use `filename`; `attachment_id` is not part of the current public schema.

Paths in this section are relative to `servers/gmail-mcp/`.

### Validation

`tests/test_server.py::TestGetAttachments` covers matching filenames, missing matches, and downloads into temporary directories. Body-extraction and message-output tests cover attachment metadata.

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
