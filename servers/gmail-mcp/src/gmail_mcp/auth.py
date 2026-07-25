"""Authentication module for Gmail MCP server.

Supports two storage backends, selected automatically:
- Environment variable (GOOGLE_MCP_TOKEN): for Azure/Linux deployments
  where secrets are injected by Key Vault
- macOS Keychain (/usr/bin/security): for local macOS development
"""

import json
import os
import subprocess
import time

import httplib2
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_httplib2 import AuthorizedHttp
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from .config import GOOGLE_TOKEN_ENV, KEYCHAIN_SERVICE, get_credentials_path
from .logging_setup import log

# Socket-level timeout (seconds) for every Gmail API HTTP request. This is
# the underlying httplib2 transport timeout — defense in depth below the
# asyncio per-call timeout in `_async.run_blocking`. Without it, httplib2
# defaults to no timeout and a stalled Google response will hang the worker
# thread forever.
HTTP_SOCKET_TIMEOUT_S = 30
KEYCHAIN_ACCESS_TIMEOUT_S = 5
KEYCHAIN_CACHE_TTL_S = 60
KEYCHAIN_ACCOUNT = "token"
SECURITY_COMMAND = "/usr/bin/security"
KEYCHAIN_DUPLICATE_ITEM_STATUS = 45


class KeychainAccessError(RuntimeError):
    """Raised when macOS Keychain access fails or times out."""


def _build_service(creds: Credentials):
    """Build a Gmail API service with a socket-level timeout on the transport.

    The default `build("gmail", "v1", credentials=creds)` constructs an
    httplib2 client with **no** timeout. We replace it with an
    `AuthorizedHttp` that wraps `httplib2.Http(timeout=...)` so a single
    hung Google API call cannot block forever.

    `cache_discovery=False` avoids googleapiclient writing a discovery cache
    to disk (it warns otherwise on systems without `oauth2client`).
    """
    http = AuthorizedHttp(creds, http=httplib2.Http(timeout=HTTP_SOCKET_TIMEOUT_S))
    return build("gmail", "v1", http=http, cache_discovery=False)

# Gmail API scopes
# - gmail.modify: read, write, and modify emails (includes archive)
# - gmail.send: send emails (used for integration tests)
SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
]


# --- Backend selection ---


def _use_env_backend() -> bool:
    """Check if the env var backend should be used."""
    return os.environ.get(GOOGLE_TOKEN_ENV) is not None


# --- Environment variable backend ---

_cached_creds: Credentials | None = None
_cached_keychain_creds: Credentials | None = None
_cached_keychain_loaded_at: float | None = None


def _env_is_authenticated() -> bool:
    global _cached_creds
    if _cached_creds is not None:
        return True
    try:
        _env_load_credentials()
    except Exception:
        return False
    return _cached_creds is not None


def _env_get_token() -> Credentials | None:
    global _cached_creds
    if _cached_creds is None:
        _env_load_credentials()
    if _cached_creds and _cached_creds.expired and _cached_creds.refresh_token:
        _refresh_credentials(_cached_creds, source="env")
    return _cached_creds


def _env_load_credentials() -> None:
    """Parse credentials from env var into memory."""
    global _cached_creds
    token_json = os.environ.get(GOOGLE_TOKEN_ENV)
    if not token_json:
        return
    token_info = json.loads(token_json)
    _cached_creds = Credentials.from_authorized_user_info(token_info, SCOPES)


# --- Keychain backend ---


def _run_security(
    args: list[str],
    *,
    missing_ok: bool = False,
    allowed_returncodes: tuple[int, ...] = (),
    sensitive_args: bool = False,
) -> subprocess.CompletedProcess[str]:
    """Run a bounded macOS Keychain command and sanitize failures."""
    try:
        result = subprocess.run(
            [SECURITY_COMMAND, *args],
            capture_output=True,
            text=True,
            timeout=KEYCHAIN_ACCESS_TIMEOUT_S,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise KeychainAccessError(
            "macOS Keychain access timed out. Unlock the login keychain and "
            "verify that /usr/bin/security is trusted for the gmail-mcp token."
        ) from (None if sensitive_args else exc)
    except OSError as exc:
        raise KeychainAccessError(
            f"macOS Keychain command could not start: {exc}"
        ) from exc

    if result.returncode == 44 and missing_ok:
        return result
    if result.returncode in allowed_returncodes:
        return result
    if result.returncode != 0:
        detail = result.stderr.strip() or f"security exited with status {result.returncode}"
        raise KeychainAccessError(f"macOS Keychain access failed: {detail}")
    return result


def _keychain_read_token() -> str | None:
    result = _run_security(
        [
            "find-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            KEYCHAIN_ACCOUNT,
            "-w",
        ],
        missing_ok=True,
    )
    if result.returncode == 44:
        return None
    token_data = result.stdout.rstrip("\n")
    return token_data or None


def _keychain_item_exists() -> bool:
    result = _run_security(
        [
            "find-generic-password",
            "-s",
            KEYCHAIN_SERVICE,
            "-a",
            KEYCHAIN_ACCOUNT,
        ],
        missing_ok=True,
    )
    return result.returncode == 0


def _keychain_write_token(token_data: str) -> None:
    exists = _keychain_item_exists()
    args = [
        "add-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        KEYCHAIN_ACCOUNT,
    ]
    if exists:
        # Updating the ACL with `-T` requires interactive authorization even
        # when this executable is already trusted. Refresh only the secret.
        args.append("-U")
    else:
        args.extend(["-T", SECURITY_COMMAND])
    # Prompted `-w` input is limited to 128 bytes and silently truncates OAuth
    # JSON. `-X` preserves arbitrary-length data. This briefly exposes the
    # hexadecimal value to same-user process inspection, which does not widen
    # the documented trust boundary: same-user code can already invoke the
    # trusted /usr/bin/security executable to read this item.
    args.extend(["-X", token_data.encode().hex()])
    result = _run_security(
        args,
        allowed_returncodes=(KEYCHAIN_DUPLICATE_ITEM_STATUS,) if not exists else (),
        sensitive_args=True,
    )
    if not exists and result.returncode == KEYCHAIN_DUPLICATE_ITEM_STATUS:
        # Another process created the item after the metadata check. Retry as
        # a content-only update rather than failing a completed OAuth flow.
        _run_security(
            [
                "add-generic-password",
                "-U",
                "-s",
                KEYCHAIN_SERVICE,
                "-a",
                KEYCHAIN_ACCOUNT,
                "-X",
                token_data.encode().hex(),
            ],
            sensitive_args=True,
        )


def _keychain_load_credentials() -> Credentials | None:
    global _cached_keychain_creds, _cached_keychain_loaded_at
    now = time.monotonic()
    if (
        _cached_keychain_creds is not None
        and _cached_keychain_loaded_at is not None
        and now - _cached_keychain_loaded_at < KEYCHAIN_CACHE_TTL_S
    ):
        return _cached_keychain_creds

    _cached_keychain_creds = None
    _cached_keychain_loaded_at = None
    token_data = _keychain_read_token()
    if not token_data:
        return None

    try:
        _cached_keychain_creds = Credentials.from_authorized_user_info(
            json.loads(token_data),
            SCOPES,
        )
    except (json.JSONDecodeError, ValueError):
        return None
    _cached_keychain_loaded_at = now
    return _cached_keychain_creds


def _keychain_is_authenticated() -> bool:
    return _keychain_load_credentials() is not None


def _keychain_get_token() -> Credentials | None:
    return _keychain_load_credentials()


def _keychain_store_token(creds: Credentials) -> None:
    global _cached_keychain_creds, _cached_keychain_loaded_at

    token_data = creds.to_json()
    _keychain_write_token(token_data)
    _cached_keychain_creds = creds
    _cached_keychain_loaded_at = time.monotonic()


# --- Public API ---


def is_authenticated() -> bool:
    """Check if valid credentials are available.

    Returns:
        True if authenticated, False otherwise
    """
    if _use_env_backend():
        return _env_is_authenticated()
    return _keychain_is_authenticated()


def get_token() -> Credentials | None:
    """Retrieve Google OAuth credentials.

    Returns:
        Credentials object if found and valid, None otherwise
    """
    if _use_env_backend():
        return _env_get_token()
    return _keychain_get_token()


def store_token(creds: Credentials) -> None:
    """Save credentials to the active backend.

    Args:
        creds: Google OAuth credentials to store
    """
    if _use_env_backend():
        return  # env var is read-only; token seeded externally
    _keychain_store_token(creds)


def _has_required_scopes(creds: Credentials) -> bool:
    """Check if credentials have all required scopes.

    Args:
        creds: Google OAuth credentials

    Returns:
        True if all required scopes are present, False otherwise
    """
    if not creds.scopes:
        return False
    return all(scope in creds.scopes for scope in SCOPES)


def _refresh_credentials(creds: Credentials, *, source: str) -> bool:
    """Refresh OAuth credentials in place, logging timing and outcome.

    Returns True on success, False on any exception. The caller decides
    whether a failure should fall back to re-auth or surface as an error.
    """
    import time

    start = time.monotonic()
    try:
        creds.refresh(Request())
    except Exception as exc:
        log(
            "error",
            "auth_refresh",
            source=source,
            ok=False,
            elapsed_ms=int((time.monotonic() - start) * 1000),
            exc_type=type(exc).__name__,
            msg=str(exc),
        )
        return False
    log(
        "info",
        "auth_refresh",
        source=source,
        ok=True,
        elapsed_ms=int((time.monotonic() - start) * 1000),
    )
    return True


def run_oauth_flow() -> str:
    """Run OAuth flow to authenticate with Gmail.

    If already authenticated with a valid token and correct scopes, returns
    the email without opening browser. If scopes are missing, forces
    re-authentication. Otherwise, opens browser for user to grant access.

    Returns:
        The authenticated user's email address

    Raises:
        FileNotFoundError: If credentials.json is missing
    """
    # Check if we already have valid credentials with correct scopes
    creds = get_token()
    if creds and creds.valid and _has_required_scopes(creds):
        # Already authenticated with correct scopes - just get the email
        service = _build_service(creds)
        profile = service.users().getProfile(userId="me").execute()
        return profile.get("emailAddress", "unknown")

    # Try to refresh expired token (only if scopes are correct)
    if creds and creds.expired and creds.refresh_token and _has_required_scopes(creds):
        if _refresh_credentials(creds, source="oauth_flow"):
            store_token(creds)
            service = _build_service(creds)
            profile = service.users().getProfile(userId="me").execute()
            return profile.get("emailAddress", "unknown")
        # Refresh failed, fall through to re-authenticate

    # Need to run OAuth flow (either no token, invalid, or missing scopes)
    credentials_path = get_credentials_path()

    if not credentials_path.exists():
        raise FileNotFoundError(
            f"credentials.json not found at {credentials_path}\n"
            "Please download OAuth credentials from Google Cloud Console and save them there."
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SCOPES)
    creds = flow.run_local_server(port=0)

    # Store token in Keychain
    store_token(creds)

    # Get user's email address
    service = _build_service(creds)
    profile = service.users().getProfile(userId="me").execute()
    email = profile.get("emailAddress", "unknown")

    return email


def get_gmail_service():
    """Get authenticated Gmail API service.

    Returns:
        Gmail API service object, or None if not authenticated
    """
    creds = get_token()

    if not creds:
        return None

    # Refresh token if expired
    if creds.expired and creds.refresh_token:
        if not _refresh_credentials(creds, source="get_service"):
            return None
        store_token(creds)

    if not creds.valid:
        return None

    return _build_service(creds)
