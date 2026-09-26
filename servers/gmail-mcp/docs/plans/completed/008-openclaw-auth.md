# Plan 008: Environment-based Gmail authentication

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The server supports environments that supply Gmail credentials through a secret-backed environment variable, as well as macOS Keychain. The environment credential stays in memory and is refreshed for use without writing changes back to the secret store. A separate setup helper performs initial browser consent and stores the credential in a vault.

### Status

The feature is implemented and present in the Mini’s configured Gmail bridge. The plan describes the current interface and architecture. There is no pending follow-up scope in this plan.

## Agent section

### State

Completed implementation, verified by source inspection and read-only deployed-file comparison on 2026-09-26. Runtime behavior was not changed during this documentation audit.

### Scope and acceptance criteria

- Select environment authentication when the configured variable is present; otherwise use macOS Keychain.
- Parse and cache supplied credential JSON, support refresh, and make environment-backend storage a no-op.
- Provide a separate vault-seeding helper and documented Linux deployment wiring.
- A cloud deployment is not required for this completed reusable authentication backend.

### Architecture and decisions

`GOOGLE_MCP_TOKEN` selects the environment backend when present, including when empty; malformed or unusable content does not silently fall back to a different account. `_env_load_credentials` creates a cached Google credential from authorized-user JSON. Client construction owns refresh. `store_token` is a no-op for this backend, so refreshed state is not written to the environment or vault.

`src/gmail_mcp/scripts/seed_keyvault.py` performs browser OAuth and uses the Azure CLI to store the token; the runtime backend does not require the Azure SDK. Cloud secret injection maps the vault value to `GOOGLE_MCP_TOKEN`. The seeding helper was not executed during this audit.

The old diagram showing `keyring` on macOS is obsolete. The fallback now uses bounded `/usr/bin/security` operations and the stable Keychain service. This backend does not itself establish a sandbox boundary; host and agent credential separation comes from deployment configuration.

### Implementation

`src/gmail_mcp/{auth,config}.py` implement backend selection and credential handling. `src/gmail_mcp/scripts/seed_keyvault.py`, `README.md`, and `docs/auth.md` describe setup. The configured Mini bridge carries the same code; its installation is not evidence of an active Azure deployment.

Paths in this section are relative to `servers/gmail-mcp/`.

### Validation

`tests/test_auth.py` covers backend selection, valid/invalid environment JSON, credential caching, refresh ownership, no-op persistence, and operation without a resolvable Keychain account home.

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
