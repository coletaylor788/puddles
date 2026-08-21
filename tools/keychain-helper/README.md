# Stable per-user Keychain helper

`puddles-keychain-helper` is a native macOS command-line helper for processes
whose interpreter path or code hash changes during package upgrades. A user
approves the helper once for each selected Keychain item; Node and Python invoke
the stable helper instead of receiving their own Keychain grants.

The helper is intentionally not a daemon. It opens no TCP, HTTP, Unix socket, or
Mach service. It accepts one local alias, maps that alias through an owner-only
allowlist, reads exactly one generic-password item, and writes only its secret
data to stdout. Normal reads fail instead of opening Keychain authorization UI.

See the
[stable Keychain plan](../../docs/plans/todoist-23-stable-keychain-helper.md)
for the threat model, current consumer inventory, rollout, and rollback design.

## Requirements

- macOS with the Command Line Tools (`swiftc`, `codesign`, and `security`)
- A persistent Code Signing identity in the login Keychain
- An unlocked GUI login session for the initial per-item approval

Create the production identity interactively in Keychain Access:

1. **Keychain Access → Certificate Assistant → Create a Certificate**
2. Name: `Puddles Keychain Helper Signing`
3. Identity Type: **Self Signed Root**
4. Certificate Type: **Code Signing**
5. Open the created certificate, expand **Trust**, and set **Code Signing** to
   **Always Trust**.
6. Do not export the private key. Its access list should allow only
   `/usr/bin/codesign`.

List the identity hash without exposing private key material:

```bash
security find-identity -v -p codesigning
```

## Allowlist

The fixed production path is:

```text
~/.config/puddles-keychain-helper/allowlist.tsv
```

Format:

```text
puddles-keychain-helper-v1
example-token	example-service	example-account
```

Each entry is `alias<TAB>service<TAB>account`. Aliases must match
`[a-z][a-z0-9-]{0,63}`. The file must be owned by the current user, be a regular
non-symlink file, and have mode `0600` or stricter.
It must not have extended ACL entries.

There is no command to list aliases or to supply a service/account at runtime.

## Build and install

Pass the 40-character hash printed by `security find-identity`:

```bash
tools/keychain-helper/scripts/install.sh \
  --signing-identity-sha1 "$SIGNING_IDENTITY_SHA1"
```

The installer validates that its user-owned directories are not symlinked,
group/other-writable, or ACL-accessible. It atomically replaces each file and
records a pending transaction before promotion, so an interrupted install is
rolled back on the next run:

```text
~/.local/libexec/puddles-keychain-helper/puddles-keychain-helper
~/.local/bin/puddles-with-keychain-secret
```

It prints a rollback snapshot path. Keep that path until post-install validation
is complete.

The production installer refuses to replace an existing helper. On current
macOS versions, an interactive command-line Keychain grant may remain tied to
the approved binary even when a rebuilt binary has the same certificate-pinned
designated requirement. Node and Python upgrades do not change this helper, so
their access remains stable. Updating the helper itself is a deliberate
reapproval event: restore/remove it intentionally, install the new binary, and
approve each allowlisted item again.

Inspect the installed identity:

```bash
codesign --verify --strict \
  ~/.local/libexec/puddles-keychain-helper/puddles-keychain-helper
codesign -d -r- \
  ~/.local/libexec/puddles-keychain-helper/puddles-keychain-helper
```

## Initial Keychain approval

After creating and trusting the signing certificate, run the guided setup from
the repository root with the local Todoist Keychain account:

```bash
tools/keychain-helper/scripts/interactive-setup.sh user-TODOIST_USER_ID
```

The script creates the Todoist allowlist entry, installs the signed helper, and
discards secret output while triggering one prompt for `todoist-cli`. Verify the
helper and item names, enter the login password, and choose **Always Allow** only
for that prompt. Setup then repeats the read with UI disabled; a one-time
**Allow** response fails verification and rolls the installation back.

Setup records a durable pending transaction before replacing the allowlist. If
the process is killed or the machine loses power, rerunning the same command
restores the previous allowlist and installation before starting over.

The setup-only command is:

```text
puddles-keychain-helper --approve <alias>
```

Do not use `--approve` in background consumers. Normal
`puddles-keychain-helper <alias>` calls are deliberately noninteractive.

## Child process wrapper

```bash
puddles-with-keychain-secret \
  EXAMPLE_TOKEN example-token -- \
  /path/to/program
```

The wrapper does not use `eval` or a child shell. It exports the selected value
only to the final child process and never places it in command arguments.
Environment injection accepts non-empty UTF-8 text without NUL bytes and fails
closed for arbitrary binary Keychain data.

### Todoist CLI

The repository includes `consumers/td`, a drop-in launcher for the standard
per-user Todoist CLI installation. It reads `todoist-api-token` through the
helper and sets `TODOIST_API_TOKEN` only for the Node child. Install it over the
global package's generated `td` symlink only after preserving that symlink for
rollback:

```bash
test -L ~/.npm-global/bin/td
test ! -e ~/.npm-global/bin/td.pre-keychain-helper
ln -s "$(readlink ~/.npm-global/bin/td)" \
  ~/.npm-global/bin/td.pre-keychain-helper
install -m 0500 tools/keychain-helper/consumers/td ~/.npm-global/bin/td.new
mv -f ~/.npm-global/bin/td.new ~/.npm-global/bin/td
td auth status --json
```

Restore the package-generated command with:

```bash
rm -f ~/.npm-global/bin/td
mv ~/.npm-global/bin/td.pre-keychain-helper ~/.npm-global/bin/td
```

## Rollback

Restore the previous helper installation:

```bash
tools/keychain-helper/scripts/rollback-install.sh \
  --snapshot "$ROLLBACK_SNAPSHOT"
```

Consumer configuration must be restored separately before removing the helper.
After no consumer depends on it, remove the helper from each item's trusted
applications in Keychain Access. Delete the signing identity only after all
grants are removed.

## Isolated tests

The test build replaces the Keychain call with a compile-time test backend that
returns synthetic data and synthetic error statuses:

```bash
tools/keychain-helper/tests/run.sh
```

It does not create, open, lock, unlock, or query any Keychain and cannot trigger
a macOS authorization prompt. Production `SecItemCopyMatching` behavior and
retained access across a certificate-signed rebuild are verified only during the
documented interactive approval step.
