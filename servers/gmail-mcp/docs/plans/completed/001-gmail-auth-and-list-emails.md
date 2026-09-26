# Plan 001: Gmail authentication and listing

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The server authenticates a Gmail account through browser consent and lets an agent list that account’s messages. On macOS, credentials live in Keychain while the server handles access-token refresh. The interface reports missing or unusable authentication instead of making the agent guess why listing failed.

### Status

The feature is implemented and present in the Mini’s configured Gmail bridge. The plan describes the current interface and architecture. There is no pending follow-up scope in this plan.

## Agent section

### State

Completed implementation, verified by source inspection and read-only deployed-file comparison on 2026-09-26. Runtime behavior was not changed during this documentation audit.

### Scope and acceptance criteria

- Browser authentication and authenticated listing are implemented.
- Configuration location, bounded credential access, authentication errors, and listing results are covered by tests.
- Sending messages and delegated access to another mailbox are outside this completed feature.

### Architecture and decisions

`config.py` resolves `GMAIL_MCP_CONFIG_DIR` or `~/.config/gmail-mcp`, creates a missing directory with mode 0700, and resolves `credentials.json`. `auth.py` runs the installed-app OAuth flow, refreshes credentials, and constructs the Gmail client. `server.py` exposes `authenticate` and `list_emails` through MCP.

The original `keyring` design and email-address Keychain account are historical. Current macOS storage uses service `gmail-mcp-stable`, account `token`, and bounded `/usr/bin/security` calls in `keychain.py`. The stored credential JSON includes refresh/client data and may include access-token/expiry fields; the original promise that only a refresh token is persisted was too narrow. Existing records can be migrated with `scripts/migrate_legacy_keychain.py` without removing the legacy item.

Later email tools expanded requested scopes from `gmail.readonly` to `gmail.modify` and `gmail.send`. There is no exposed send tool. `list_emails` returns structured JSON containing `count` and `emails`, with IDs and selected metadata, rather than the original numbered prose example.

### Implementation

`src/gmail_mcp/{config,auth,keychain,server}.py` contain the shipped behavior. Listing defaults to 10 results, caps the requested count at 50, and targets `userId="me"`. Authentication and client construction are offloaded with explicit time bounds; mailbox delegation is not implemented.

Paths in this section are relative to `servers/gmail-mcp/`.

### Validation

`tests/test_auth.py` checks browser-flow errors, credential validation, Keychain boundaries, refresh and concurrent updates. `tests/test_config.py` checks configuration paths and permissions. `tests/test_server.py` checks authentication and listing.

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
