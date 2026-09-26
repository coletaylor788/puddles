# Plan 002: Filter Gmail listings

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

An agent can narrow a Gmail listing by label, category, unread state, or a Gmail search query. The filters combine in one request, so the user can ask for a small relevant set instead of fetching a whole inbox.

### Status

The feature is implemented and present in the Mini’s configured Gmail bridge. The plan describes the current interface and architecture. There is no pending follow-up scope in this plan.

## Agent section

### State

Completed implementation, verified by source inspection and read-only deployed-file comparison on 2026-09-26. Runtime behavior was not changed during this documentation audit.

### Scope and acceptance criteria

- Keep the existing result limit and add label, category, unread-only, and raw-query filters.
- Combine selected filters and return the existing structured listing result.
- Document and test individual filters and combinations.

### Architecture and decisions

The `list_emails` schema in `server.py` includes `max_results`, `label`, `category`, `unread_only`, and `query`. `_list_emails` maps known system labels to uppercase `labelIds`. Custom labels use `label:<name>` in the query rather than a separate label-ID lookup. Category and unread filters add `category:<name>` and `is:unread`; a raw query is appended. Query components are space-joined and sent with any selected system label.

The implementation leaves the raw Gmail query intact. It does not parse or rewrite user-supplied operators into a separate expression tree. Without filters, it omits both `q` and `labelIds`; it does not implicitly restrict the request to INBOX.

### Implementation

`src/gmail_mcp/server.py` contains the schema, filter composition, API call, and metadata result assembly. `README.md` and `docs/tools.md` describe the supported inputs.

Paths in this section are relative to `servers/gmail-mcp/`.

### Validation

`tests/test_server.py` covers system/custom labels, case handling, category, unread state, raw query, combined filters, no-filter behavior, and result limits.

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
