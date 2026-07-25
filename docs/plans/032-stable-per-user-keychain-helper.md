# Plan 032 — Stable per-user Keychain helper

**Status:** ✅ Complete (2026-07-24)
**Owner:** Implementation agent
**Last updated:** 2026-07-24
**Issue:** [#23](https://github.com/coletaylor788/puddles/issues/23)

---

## Summary

Homebrew upgrades replace Node and Python binaries. Their current ad-hoc code
signatures use build-specific `cdhash` designated requirements, so a Keychain
`Always Allow` grant stops matching after an upgrade.

Implement a minimal native command-line helper with a stable install path and
immutable approved binary. The helper reads only explicitly allowlisted
generic-password items and writes the selected secret as raw bytes to stdout.
Interpreters call the helper instead of accessing Keychain directly.

This is a per-user helper, not a daemon. A persistent process and an IPC listener
would add lifecycle and authentication surface without improving the same-user
trust boundary. There is no TCP, HTTP, Unix socket, Mach service, or secret
enumeration API.

## Current consumer inventory

Read-only repository and host inspection identified these upgrade-sensitive
consumers:

| Consumer | Current path | Keychain selector | Migration |
|---|---|---|---|
| Gmail MCP | Homebrew Python → `keyring` | service `gmail-mcp`, account `token` | Not migrated here. Issue #15 owns the active repair, found the value truncated to 128 bytes, and is moving Gmail to stable `/usr/bin/security`. |
| Todoist CLI | Homebrew Node → native keyring module | service `todoist-cli`, account `user-<Todoist user id>` | Start the CLI through the wrapper, setting `TODOIST_API_TOKEN` from alias `todoist-api-token`. Resolve the account suffix from `td auth status --json`; do not hard-code a personal identifier in the repository. |

The gateway's currently configured `SecretRef` values use a local file provider,
not direct Keychain access, and do not need migration. The installed GitHub CLI
has a stable Developer ID requirement and does not need this helper. The admin
login password documented for OS updates is deliberately excluded because
exposing it to the same-user helper surface would be an unjustified privilege
increase.

## Threat model and safety properties

- The caller is already running as the logged-in user. The helper does not
  attempt to distinguish processes owned by that user.
- Keychain remains the encrypted-at-rest authority. The helper never stores,
  caches, transforms, or logs secret values.
- Requests contain one configured alias, never a service or account selector.
- The allowlist file is fixed at
  `~/.config/puddles-keychain-helper/allowlist.tsv`, must be a regular
  non-symlink file owned by the current user, and must have no group or other
  permission bits or extended ACL entries.
- The parser rejects unknown fields, duplicate aliases, malformed values,
  oversized files, and unsupported schema versions.
- Keychain queries use `kSecMatchLimitOne` and request only secret data. There is
  no list, search, wildcard, attribute-return, write, update, or delete path.
- Errors go to stderr and include no secret, service, account, or Keychain
  response data. Secret bytes go only to stdout on success.
- The child wrapper exports one non-empty UTF-8, NUL-free secret to one child
  process without placing the value in command arguments.
- Production binaries are signed by a persistent code-signing identity and use
  an explicit requirement that pins the helper identifier and signing
  certificate hash. Empirical validation on macOS 26.4 showed that the
  interactive CLI Keychain grant still prompted after a rebuild even though the
  new binary satisfied the old designated requirement. The installer therefore
  treats the approved helper binary as immutable. Updating the helper itself
  requires explicit per-item reapproval; Node/Python upgrades do not.
- A copied signing private key can impersonate the helper. Do not export that key,
  and grant signing access only to `/usr/bin/codesign`.

## API

### Helper

```text
puddles-keychain-helper <alias>
```

- Exactly one alias is accepted.
- Success: raw secret bytes on stdout, no newline, exit `0`.
- Usage/config/allowlist error: no stdout, stable nonzero exit.
- Missing, locked, denied, or unavailable Keychain item: no stdout, stable
  nonzero exit.
- No `list`, arbitrary service/account, or write command exists.

### One-secret child environment wrapper

```text
puddles-with-keychain-secret ENV_NAME ALIAS -- COMMAND [ARG ...]
```

The wrapper retrieves `ALIAS`, exports it as `ENV_NAME`, clears its temporary
shell variable, and replaces itself with `COMMAND`. It does not invoke a shell
for the child command.

### Allowlist format

```text
puddles-keychain-helper-v1
example-token	example-service	example-account
```

Each subsequent line is `alias<TAB>service<TAB>account`. Production installation
adds the Todoist alias with the locally resolved user account. Repository
fixtures use synthetic values only.

## Implementation order

1. Add the native Swift helper and strict allowlist/file validation.
2. Add signed build and atomic per-user install scripts.
3. Add the one-secret child environment wrapper.
4. Add focused unit-style checks and a synthetic temporary-Keychain lifecycle.
5. Document setup, exact interactive approval prompts, migration, and rollback.
6. Run the complete isolated validation and independent full-diff review.
7. Stop before production installation or secret access and hand the exact
   interactive commands to Cole.
8. After approval, migrate Todoist with a read-only production check and
   rollback proof. Defer Gmail to its existing issue #15 repair.

## Testing approach

Automated tests compile a test-only secret backend; they never access any
Keychain and cannot trigger authorization UI. They must cover:

- expected alias success without printing the value in test logs;
- unknown alias, malformed arguments, malformed/oversized/insecure/symlinked
  allowlists, missing item, locked Keychain, and denied UI interaction;
- no enumeration or arbitrary selector surface;
- concurrent reads and repeated direct invocations;
- wrapper success/failure and Node/Python child smoke tests;
- different synthetic helper `cdhash` values across rebuilds with one unchanged
  designated requirement; the production identity's retained Keychain grant is
  verified only during the explicit interactive gate;
- atomic install/promotion and fixture rollback;
- shell syntax, Swift build, repository lint/typecheck/build/test, and the
  applicable isolated E2E lifecycle;
- independent full-diff security review.

The production `SecItemCopyMatching` path is compile-checked and reviewed, then
exercised only at the explicit interactive gate. Automated work must not read,
migrate, copy, print, or modify production credentials or production
configuration.

## Rollout

1. Create a persistent self-signed **Code Signing** identity in the login
   Keychain and set Code Signing trust to **Always Trust**.
2. Create the production allowlist with mode `0600`.
3. Build, sign, inspect, and atomically install the helper at its stable path.
4. Invoke each selected alias with stdout redirected to `/dev/null`; approve the
   Keychain prompt with **Always Allow**.
5. Preserve the exact approved helper binary; production replacement is
   fail-closed and requires a deliberate new approval cycle.
6. Migrate Todoist and validate. Do not modify Gmail while issue #15 repairs its
   already-truncated credential and stable backend.

## Rollback

Before changing each consumer, save its current configuration with mode `0600`.
To roll back:

1. Restore that consumer's prior direct-Keychain configuration.
2. Restart only the affected process and verify its previous behavior.
3. Remove the wrapper configuration.
4. After all consumers are restored, remove the helper binary and allowlist.
5. Remove the helper from each Keychain item's trusted applications in Keychain
   Access. Delete the signing identity only after no item depends on it.
6. Rotate a credential only if validation indicates exposure; routine rollback
   does not copy or re-seed secret values.

---

## Checklist

### Research and design
- [x] Read repository instructions and relevant architecture/auth/setup docs
- [x] Inventory direct Keychain consumers without reading secret values
- [x] Confirm Homebrew interpreter designated requirements are build-specific
- [x] Confirm approved non-root, no-network, allowlisted helper design
- [x] Define production signing, rollout, and rollback model

### Implementation
- [x] Implement native helper and strict fixed-path allowlist
- [x] Implement signed build and atomic per-user installation
- [x] Implement one-secret child environment wrapper
- [x] Document consumer wiring and interactive approval commands

### Testing
- [x] Focused helper and wrapper tests written
- [x] Focused tests passing
- [x] Prompt-proof synthetic secret-backend lifecycle passing
- [x] Rebuild identity simulation completed; immutable-helper requirement recorded
- [x] Promotion and rollback fixtures passing
- [x] Applicable repository unit tests passing
- [x] Interactive production signing and initial Keychain access validation passing

### Cleanup
- [x] Repository lint/typecheck/build passes
- [x] Shell syntax and Swift warnings checks pass
- [x] No unused code, secret output, or temporary state remains
- [x] Independent full-diff review is clean

### Documentation and tracking
- [x] README and setup/auth documentation updated
- [x] Issue #23 contains pre-production validation and review evidence
- [x] Interactive production approval completed
- [x] Todoist consumer migrated and live read passes
- [x] Todoist rollback proven; Gmail explicitly deferred to issue #15
- [x] Rollback proof and residual risks recorded
- [x] Plan marked complete with date
- [x] Change set ready to commit, push, and link to a pull request
