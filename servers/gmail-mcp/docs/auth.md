# Authentication

Gmail MCP uses OAuth 2.0 with two storage backends:

- **macOS Keychain** (default) — accessed through the stable
  `/usr/bin/security` executable
- **Environment variable** (`GOOGLE_MCP_TOKEN`) — for Azure/Linux deployments where Key Vault injects secrets

The backend is selected automatically: if `GOOGLE_MCP_TOKEN` is set, the env var backend is used. Otherwise, Keychain.

---

## Overview

### macOS (Keychain backend)

```
┌──────────────┐    1. OAuth flow     ┌──────────────┐
│    User      │◄────────────────────►│   Google     │
│  (Browser)   │                      │   OAuth      │
└──────────────┘                      └──────────────┘
                                             │
                                             │ 2. Auth code
                                             ▼
┌──────────────┐    3. Refresh token  ┌──────────────┐
│   macOS      │◄─────────────────────│  Gmail MCP   │
│  Keychain    │                      │   Server     │
└──────────────┘                      └──────────────┘
```

### Azure / Linux (env var backend)

```
┌──────────────┐    Key Vault injects   ┌──────────────┐
│  Azure       │───env var──────────────│  Gmail MCP   │──▶ Gmail API
│  Key Vault   │  GOOGLE_MCP_TOKEN      │   Server     │
└──────────────┘                        └──────────────┘
```

---

## Storage Strategy

### macOS (Keychain)

| Data | Location | Why |
|------|----------|-----|
| OAuth client credentials | `~/.config/gmail-mcp/credentials.json` | App identity (not truly secret for desktop apps) |
| Refresh token | macOS Keychain | Sensitive - encrypted at rest |
| Access token | Memory only | Short-lived, never persisted |

### Azure / Linux (env var)

| Data | Location | Why |
|------|----------|-----|
| Refresh token + client identity | `GOOGLE_MCP_TOKEN` env var | Injected by Key Vault, read once into memory |
| Access token | Memory only | Short-lived, auto-refreshed |

---

## OAuth 2.0 Flow

We use Google's "Desktop App" OAuth flow:

1. **User calls `authenticate` tool** - Claude triggers the MCP tool
2. **Browser opens** - User sees Google consent screen
3. **User grants access** - Authorizes the requested scopes
4. **Localhost callback** - Auth code sent to `http://localhost`
5. **Token exchange** - Code exchanged for refresh + access tokens
6. **Token stored** - Refresh token saved to Keychain
7. **Ready** - Server can now make Gmail API calls

### Scopes Requested

```python
SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
]
```

- `gmail.modify` - Read, write, and modify emails (includes archive, labels)
- `gmail.send` - Send emails (used for integration tests)

---

## Keychain Storage

Tokens are stored in macOS Keychain using `/usr/bin/security`.

**Service name:** `gmail-mcp`
**Account name:** `token`
**Password:** JSON containing refresh token

Keychain calls have a five-second timeout. This matters for background
LaunchAgents: macOS approval prompts are not visible there, so an untrusted
executable would otherwise block forever. New token entries explicitly trust
`/usr/bin/security`, whose path is stable across Homebrew Python upgrades.
Parsed credentials are cached for at most 60 seconds to avoid duplicate
Keychain reads while still observing sign-out or token replacement promptly.
Refresh-and-write transactions use an owner-only lock file at
`~/.config/gmail-mcp/credential.lock`, then compare the Keychain value again
before persistence. This prevents concurrent server processes and a stale
refresh from overwriting a newer browser authorization.

OAuth browser waiting, token exchange, refresh retries, Keychain commands, and
Gmail HTTP calls each have an inner deadline below the MCP worker deadline.
Browser launch uses the non-blocking system `/usr/bin/open` path, so a stalled
AppleScript browser controller cannot freeze the server.

### Viewing in Keychain Access

1. Open **Keychain Access.app**
2. Search for `gmail-mcp`
3. Double-click to view details
4. Click "Show password" to see token (requires macOS password)

### Deleting Credentials

To sign out or switch accounts:
1. Open **Keychain Access.app**
2. Search for `gmail-mcp`
3. Delete the entry
4. Re-authenticate via Claude

Or via command line:
```bash
security delete-generic-password -s "gmail-mcp"
```

### Migrating an existing token

Tokens created by older releases may trust a specific Homebrew Python binary.
After Python upgrades, macOS can request approval from the background server
and leave the request waiting behind an invisible prompt.

Run these once from an interactive Terminal, enter the login-keychain password,
and click **Always Allow** on the access prompt:

```bash
security set-generic-password-partition-list \
  -S apple-tool: -s gmail-mcp -a token
security find-generic-password \
  -s gmail-mcp -a token -w >/dev/null
```

The first command updates the item's access-control partition list. Older items
can also retain an explicit trusted-application list containing only the Python
executable, so the second command records **Always Allow** for
`/usr/bin/security`. Redirecting stdout prevents the token from being printed;
neither command replaces it. New tokens are written with `/usr/bin/security`
trusted from the start.

### Local security boundary

Trusting `/usr/bin/security` avoids authorization breakage when Homebrew Python
is replaced, but it broadens the local trust boundary: any process already
running as the same macOS user can invoke that system executable with the known
service and account names. The Keychain still encrypts the token at rest and
protects it from other users, but this setup does not protect against untrusted
code executing as your logged-in account. Do not run untrusted scripts,
installers, or package hooks as that user.

OAuth credential JSON is longer than the 128-byte limit of `security`'s
interactive password prompt. Writes therefore use its hexadecimal data option,
which briefly makes the encoded value visible to same-user process inspection.
That does not extend the boundary above because same-user code can already ask
the trusted executable to read the item. Token values are never logged or
written to files.

---

## Why Client Credentials Aren't Secret

Google has two OAuth client types:

| Type | Secret Protection | Use Case |
|------|------------------|----------|
| **Web app** | Secret on server, never exposed | Server-side apps |
| **Desktop app** | Secret in binary, extractable | Desktop/mobile apps |

For desktop apps, Google doesn't rely on the secret. Security comes from:

- **Localhost redirect** - Auth code sent to `http://localhost`, can't be intercepted remotely
- **User consent screen** - User sees exactly what app/scopes are requested
- **PKCE** - Cryptographic proof that the app starting auth is the same one finishing it

The `credentials.json` is really just "app identity" - your Google Cloud project ID.

---

## Token Refresh

- **Access tokens** expire after 1 hour
- **Refresh tokens** don't expire (unless revoked)
- The Google SDK automatically refreshes access tokens using the stored refresh token
- Users don't need to re-authenticate unless they revoke access

---

## Threat Model

| Threat | Mitigation |
|--------|------------|
| Token stolen from disk | Keychain: encrypted at rest. Env var: not on disk, in memory only |
| Token intercepted in transit | All Google API calls use HTTPS |
| Malicious app impersonation | User verifies app in Google consent screen |
| Malicious app reads Keychain | macOS prompts user for permission |
| Env var leaked via subprocess | Use Azure sandbox isolation; secrets only on trusted box |
| Scope creep | Request minimal scopes; user can revoke in Google Account |

---

## Azure Key Vault Setup

### One-time seed (from a machine with a browser)

```bash
python -m gmail_mcp.scripts.seed_keyvault \
  --vault-name my-vault \
  --credentials ~/path/to/credentials.json
```

### Container App configuration

```json
"secrets": [
  {
    "name": "google-mcp-token",
    "keyVaultUrl": "https://<vault>.vault.azure.net/secrets/google-mcp-token",
    "identity": "system"
  }
],
"env": [
  {
    "name": "GOOGLE_MCP_TOKEN",
    "secretRef": "google-mcp-token"
  }
]
```

**When to re-seed:** Google password change, app access revoked, scopes changed, or token unused for 6+ months.

---

## Code Reference

### Key Functions

```python
# Check if authenticated
from gmail_mcp.auth import is_authenticated
if is_authenticated():
    # Token exists in Keychain
    pass

# Run OAuth flow (opens browser)
from gmail_mcp.auth import run_oauth_flow
email = run_oauth_flow()  # Returns authenticated email address

# Get authenticated Gmail service
from gmail_mcp.auth import get_gmail_service
service = get_gmail_service()
if service:
    # Make Gmail API calls
    results = service.users().messages().list(userId="me").execute()
```

### Token Storage

```python
# Keychain backend (macOS) - internal
# Uses bounded /usr/bin/security subprocesses. Reads use stdout; writes use
# a hexadecimal argv value under the documented same-user trust boundary.

# Env var backend (Azure/Linux) - read-only, set externally
# GOOGLE_MCP_TOKEN env var contains the same JSON
```
