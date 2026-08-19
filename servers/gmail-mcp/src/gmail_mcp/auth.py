"""Authentication module for Gmail MCP server.

Supports two storage backends, selected automatically:
- Environment variable (GOOGLE_MCP_TOKEN): for Azure/Linux deployments
  where secrets are injected by Key Vault
- macOS Keychain (/usr/bin/security): for local macOS development
"""

import fcntl
import json
import os
import pwd
import threading
import time
import webbrowser
from contextlib import contextmanager, nullcontext
from pathlib import Path
from typing import Any

import httplib2
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_httplib2 import AuthorizedHttp
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from requests.exceptions import Timeout as RequestsTimeout

from .config import GOOGLE_TOKEN_ENV, get_credentials_path
from .keychain import CredentialFormatError, KeychainAccessError, read_token, write_token
from .logging_setup import log

# Socket-level timeout (seconds) for every Gmail API HTTP request. This is
# the underlying httplib2 transport timeout — defense in depth below the
# asyncio per-call timeout in `_async.run_blocking`. Without it, httplib2
# defaults to no timeout and a stalled Google response will hang the worker
# thread forever.
HTTP_SOCKET_TIMEOUT_S = 30
OAUTH_BROWSER_TIMEOUT_S = 600
OAUTH_OPERATION_TIMEOUT_S = 900
REFRESH_DEADLINE_S = 45
CREDENTIAL_LOCK_TIMEOUT_S = 90
KEYCHAIN_CACHE_TTL_S = 60
CREDENTIAL_LOCK_FILE = "credential.lock"
OAUTH_BROWSER_NAME = "gmail-mcp-background"


def _canonical_credential_lock_path() -> Path:
    account_home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    return account_home / ".config" / "gmail-mcp" / CREDENTIAL_LOCK_FILE


CREDENTIAL_LOCK_PATH: Path | None = None


def _credential_lock_path() -> Path:
    return CREDENTIAL_LOCK_PATH or _canonical_credential_lock_path()


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


class _DeadlineRequest:
    """Apply one deadline across all retries in a credential refresh."""

    def __init__(self, timeout: float, *, deadline: float | None = None) -> None:
        self._deadline = time.monotonic() + timeout
        if deadline is not None:
            self._deadline = min(self._deadline, deadline)
        self._request = Request()

    def __call__(self, *args: Any, **kwargs: Any):
        remaining = self._deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("credential refresh deadline exceeded")
        requested_timeout = kwargs.pop("timeout", HTTP_SOCKET_TIMEOUT_S)
        kwargs["timeout"] = min(requested_timeout, HTTP_SOCKET_TIMEOUT_S, remaining)
        response = self._request(*args, **kwargs)
        self.ensure_within_deadline()
        return response

    def ensure_within_deadline(self) -> None:
        if time.monotonic() > self._deadline:
            raise TimeoutError("credential refresh deadline exceeded")


class OAuthFlowError(RuntimeError):
    """Raised when browser OAuth cannot produce usable credentials."""


class OAuthFlowTimeoutError(OAuthFlowError, TimeoutError):
    """Raised when browser OAuth exceeds a configured network or user deadline."""


class AuthenticationCancelledError(RuntimeError):
    """Raised when the async caller no longer wants authentication side effects."""


class _BoundedInstalledAppFlow(InstalledAppFlow):
    """Ensure the authorization-code exchange has a cumulative deadline."""

    _puddles_deadline: float | None = None

    def fetch_token(self, **kwargs: Any):
        timeout = HTTP_SOCKET_TIMEOUT_S
        if self._puddles_deadline is not None:
            timeout = min(timeout, self._puddles_deadline - time.monotonic())
            if timeout <= 0:
                raise OAuthFlowTimeoutError("Gmail OAuth flow timed out")
        kwargs["timeout"] = min(kwargs.get("timeout", timeout), timeout)
        result = super().fetch_token(**kwargs)
        if (
            self._puddles_deadline is not None
            and time.monotonic() > self._puddles_deadline
        ):
            raise OAuthFlowTimeoutError("Gmail OAuth flow timed out")
        return result


webbrowser.register(
    OAUTH_BROWSER_NAME,
    None,
    webbrowser.BackgroundBrowser("/usr/bin/open"),
    preferred=True,
)

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
_credential_lock = threading.RLock()


def _check_cancellation(cancellation: threading.Event | None) -> None:
    if cancellation is not None and cancellation.is_set():
        raise AuthenticationCancelledError("Gmail authentication was cancelled")


@contextmanager
def _credential_transaction(*, deadline: float | None = None):
    """Serialize Keychain writes across Gmail MCP processes."""
    lock_deadline = time.monotonic() + CREDENTIAL_LOCK_TIMEOUT_S
    if deadline is not None:
        lock_deadline = min(lock_deadline, deadline)
    remaining = max(0.0, lock_deadline - time.monotonic())
    local_acquired = _credential_lock.acquire(timeout=remaining)
    if not local_acquired:
        raise KeychainAccessError("Gmail credential update is busy in this process")

    descriptor = None
    acquired = False
    try:
        lock_path = _credential_lock_path()
        try:
            lock_path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        except OSError as exc:
            raise KeychainAccessError(
                f"Gmail credential lock directory is unavailable: {exc}"
            ) from exc
        flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(lock_path, flags, 0o600)
            os.fchmod(descriptor, 0o600)
        except OSError as exc:
            raise KeychainAccessError(
                f"Gmail credential lock is unavailable: {exc}"
            ) from exc

        while True:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except BlockingIOError:
                remaining = lock_deadline - time.monotonic()
                if remaining <= 0:
                    raise KeychainAccessError(
                        "Gmail credential update is busy in another process"
                    ) from None
                time.sleep(min(0.05, remaining))
        yield
    finally:
        if descriptor is not None:
            if acquired:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            os.close(descriptor)
        _credential_lock.release()


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


def _credentials_from_token_data(token_data: str | None) -> Credentials | None:
    if token_data is None:
        return None
    try:
        token_info = json.loads(token_data)
    except (json.JSONDecodeError, TypeError):
        raise CredentialFormatError(
            "Stored Gmail credential is malformed. "
            "Delete the gmail-mcp Keychain item and authenticate again."
        ) from None
    if not isinstance(token_info, dict):
        raise CredentialFormatError(
            "Stored Gmail credential is malformed. "
            "Delete the gmail-mcp Keychain item and authenticate again."
        )
    required_fields = ("refresh_token", "client_id", "client_secret")
    if any(
        not isinstance(token_info.get(field), str)
        or not token_info[field].strip()
        for field in required_fields
    ):
        raise CredentialFormatError(
            "Stored Gmail credential is missing required fields. "
            "Delete the gmail-mcp Keychain item and authenticate again."
        )
    if "token" in token_info and (
        not isinstance(token_info["token"], str) or not token_info["token"].strip()
    ):
        raise CredentialFormatError(
            "Stored Gmail credential has an invalid access token. "
            "Delete the gmail-mcp Keychain item and authenticate again."
        )
    stored_scopes = token_info.get("scopes")
    if isinstance(stored_scopes, str):
        token_info["scopes"] = stored_scopes.split()
    elif stored_scopes is not None:
        if not isinstance(stored_scopes, list) or any(
            not isinstance(scope, str) or not scope.strip()
            for scope in stored_scopes
        ):
            raise CredentialFormatError(
                "Stored Gmail credential has invalid scopes. "
                "Delete the gmail-mcp Keychain item and authenticate again."
            )
        token_info["scopes"] = [scope.strip() for scope in stored_scopes]
    try:
        return Credentials.from_authorized_user_info(token_info)
    except (AttributeError, TypeError, ValueError):
        raise CredentialFormatError(
            "Stored Gmail credential is malformed. "
            "Delete the gmail-mcp Keychain item and authenticate again."
        ) from None


def _cache_keychain_credentials(creds: Credentials | None) -> None:
    global _cached_keychain_creds, _cached_keychain_loaded_at
    _cached_keychain_creds = creds
    _cached_keychain_loaded_at = time.monotonic() if creds is not None else None


def _keychain_load_credentials(
    *,
    cancellation: threading.Event | None = None,
) -> Credentials | None:
    global _cached_keychain_creds, _cached_keychain_loaded_at
    with _credential_lock:
        now = time.monotonic()
        if (
            _cached_keychain_creds is not None
            and _cached_keychain_loaded_at is not None
            and now - _cached_keychain_loaded_at < KEYCHAIN_CACHE_TTL_S
        ):
            return _cached_keychain_creds

        _check_cancellation(cancellation)
        loaded_creds = _credentials_from_token_data(read_token())
        _check_cancellation(cancellation)
        _cached_keychain_creds = loaded_creds
        _cached_keychain_loaded_at = (
            now if _cached_keychain_creds is not None else None
        )
        return _cached_keychain_creds


def _keychain_is_authenticated() -> bool:
    return _keychain_load_credentials() is not None


def _keychain_get_token(
    *,
    cancellation: threading.Event | None = None,
) -> Credentials | None:
    return _keychain_load_credentials(cancellation=cancellation)


def _effective_scopes(creds: Credentials):
    granted_scopes = getattr(creds, "granted_scopes", None)
    return granted_scopes if granted_scopes is not None else creds.scopes


def _credentials_json(creds: Credentials) -> str:
    token_info = json.loads(creds.to_json())
    effective_scopes = _effective_scopes(creds)
    if effective_scopes is not None:
        token_info["scopes"] = list(effective_scopes)
    return json.dumps(token_info)


def _keychain_store_token_unlocked(
    creds: Credentials,
    *,
    deadline: float | None = None,
    cancellation: threading.Event | None = None,
) -> None:
    _check_cancellation(cancellation)
    write_token(_credentials_json(creds), deadline=deadline)
    _check_cancellation(cancellation)
    _cache_keychain_credentials(creds)


def _keychain_store_token(
    creds: Credentials,
    *,
    deadline: float | None = None,
    cancellation: threading.Event | None = None,
) -> None:
    _check_cancellation(cancellation)
    with _credential_transaction(deadline=deadline):
        _keychain_store_token_unlocked(
            creds,
            deadline=deadline,
            cancellation=cancellation,
        )


# --- Public API ---


def is_authenticated() -> bool:
    """Check if valid credentials are available.

    Returns:
        True if authenticated, False otherwise
    """
    if _use_env_backend():
        return _env_is_authenticated()
    return _keychain_is_authenticated()


def get_token(
    *,
    cancellation: threading.Event | None = None,
) -> Credentials | None:
    """Retrieve Google OAuth credentials.

    Returns:
        Credentials object if found and valid, None otherwise
    """
    if _use_env_backend():
        _check_cancellation(cancellation)
        return _env_get_token()
    return _keychain_get_token(cancellation=cancellation)


def store_token(
    creds: Credentials,
    *,
    deadline: float | None = None,
    cancellation: threading.Event | None = None,
) -> None:
    """Save credentials to the active backend.

    Args:
        creds: Google OAuth credentials to store
    """
    if _use_env_backend():
        return  # env var is read-only; token seeded externally
    _keychain_store_token(
        creds,
        deadline=deadline,
        cancellation=cancellation,
    )


def _has_required_scopes(creds: Credentials) -> bool:
    """Check if credentials have all required scopes.

    Args:
        creds: Google OAuth credentials

    Returns:
        True if all required scopes are present, False otherwise
    """
    scopes = _effective_scopes(creds)
    if not scopes:
        return False
    return all(scope in scopes for scope in SCOPES)


def _refresh_credentials(
    creds: Credentials,
    *,
    source: str,
    deadline: float | None = None,
    cancellation: threading.Event | None = None,
) -> bool:
    """Refresh OAuth credentials in place, logging timing and outcome.

    Returns True on success, False on any exception. The caller decides
    whether a failure should fall back to re-auth or surface as an error.
    """
    import time

    start = time.monotonic()
    try:
        _check_cancellation(cancellation)
        request = _DeadlineRequest(REFRESH_DEADLINE_S, deadline=deadline)
        creds.refresh(request)
        request.ensure_within_deadline()
        _check_cancellation(cancellation)
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


def run_oauth_flow(
    *,
    deadline: float | None = None,
    cancellation: threading.Event | None = None,
) -> str:
    """Run OAuth flow to authenticate with Gmail.

    If already authenticated with a valid token and correct scopes, returns
    the email without opening browser. If scopes are missing, forces
    re-authentication. Otherwise, opens browser for user to grant access.

    Returns:
        The authenticated user's email address

    Raises:
        FileNotFoundError: If credentials.json is missing
    """
    oauth_deadline = deadline or time.monotonic() + OAUTH_OPERATION_TIMEOUT_S
    _check_cancellation(cancellation)
    if time.monotonic() >= oauth_deadline:
        raise OAuthFlowTimeoutError("Gmail OAuth flow timed out")
    ready_creds = None
    use_env_backend = _use_env_backend()
    credential_context = (
        nullcontext()
        if use_env_backend
        else _credential_transaction(deadline=oauth_deadline)
    )
    with credential_context:
        _check_cancellation(cancellation)
        token_before = None if use_env_backend else read_token()
        creds = (
            get_token(cancellation=cancellation)
            if use_env_backend
            else _credentials_from_token_data(token_before)
        )
        if not use_env_backend:
            _check_cancellation(cancellation)
            _cache_keychain_credentials(creds)
        if creds and creds.valid and _has_required_scopes(creds):
            ready_creds = creds
        elif (
            creds
            and creds.expired
            and creds.refresh_token
            and _has_required_scopes(creds)
            and _refresh_credentials(
                creds,
                source="oauth_flow",
                deadline=oauth_deadline,
                cancellation=cancellation,
            )
        ):
            token_current = token_before if use_env_backend else read_token()
            if token_current == token_before:
                if creds.valid and _has_required_scopes(creds):
                    if use_env_backend:
                        store_token(creds)
                    else:
                        _keychain_store_token_unlocked(
                            creds,
                            deadline=oauth_deadline,
                            cancellation=cancellation,
                        )
                    ready_creds = creds
            else:
                replacement_creds = _credentials_from_token_data(token_current)
                _check_cancellation(cancellation)
                _cache_keychain_credentials(replacement_creds)
                if (
                    replacement_creds
                    and replacement_creds.valid
                    and _has_required_scopes(replacement_creds)
                ):
                    ready_creds = replacement_creds

    if ready_creds is not None:
        service = _build_service(ready_creds)
        profile = service.users().getProfile(userId="me").execute()
        return profile.get("emailAddress", "unknown")

    # Need to run OAuth flow (either no token, invalid, or missing scopes)
    credentials_path = get_credentials_path()

    if not credentials_path.exists():
        raise FileNotFoundError(
            f"credentials.json not found at {credentials_path}\n"
            "Please download OAuth credentials from Google Cloud Console and save them there."
        )

    flow = _BoundedInstalledAppFlow.from_client_secrets_file(
        str(credentials_path),
        SCOPES,
    )
    flow._puddles_deadline = oauth_deadline
    remaining_browser_time = min(
        OAUTH_BROWSER_TIMEOUT_S,
        oauth_deadline - time.monotonic(),
    )
    if remaining_browser_time <= 0:
        raise OAuthFlowTimeoutError("Gmail OAuth flow timed out")
    _check_cancellation(cancellation)
    try:
        creds = flow.run_local_server(
            port=0,
            authorization_prompt_message=None,
            timeout_seconds=remaining_browser_time,
            access_type="offline",
            prompt="consent",
        )
    except (AttributeError, RequestsTimeout) as exc:
        raise OAuthFlowTimeoutError("Gmail OAuth flow timed out") from exc

    if time.monotonic() > oauth_deadline:
        raise OAuthFlowTimeoutError("Gmail OAuth flow timed out")
    _check_cancellation(cancellation)
    if (
        not isinstance(creds.refresh_token, str)
        or not creds.refresh_token.strip()
    ):
        raise OAuthFlowError("Google OAuth did not return a refresh token")
    if not _has_required_scopes(creds):
        raise OAuthFlowError("Google OAuth did not grant the required Gmail scopes")

    store_token(
        creds,
        deadline=oauth_deadline,
        cancellation=cancellation,
    )

    # Get user's email address
    service = _build_service(creds)
    profile = service.users().getProfile(userId="me").execute()
    email = profile.get("emailAddress", "unknown")

    return email


def get_gmail_service(
    *,
    deadline: float | None = None,
    cancellation: threading.Event | None = None,
):
    """Get authenticated Gmail API service.

    Returns:
        Gmail API service object, or None if not authenticated
    """
    if deadline is not None and time.monotonic() >= deadline:
        raise TimeoutError("Gmail service deadline exceeded")
    _check_cancellation(cancellation)

    if _use_env_backend():
        creds = get_token(cancellation=cancellation)
        if not creds:
            return None
        if creds.expired and creds.refresh_token:
            if not _refresh_credentials(
                creds,
                source="get_service",
                deadline=deadline,
                cancellation=cancellation,
            ):
                return None
            store_token(creds)
    else:
        creds = get_token(cancellation=cancellation)
        if not creds:
            return None
        if creds.expired and creds.refresh_token:
            with _credential_transaction(deadline=deadline):
                _check_cancellation(cancellation)
                token_before = read_token()
                creds = _credentials_from_token_data(token_before)
                _check_cancellation(cancellation)
                _cache_keychain_credentials(creds)
                if not creds:
                    return None
                if creds.expired and creds.refresh_token:
                    if not _refresh_credentials(
                        creds,
                        source="get_service",
                        deadline=deadline,
                        cancellation=cancellation,
                    ):
                        return None
                    token_current = read_token()
                    if token_current != token_before:
                        creds = _credentials_from_token_data(token_current)
                        _check_cancellation(cancellation)
                        _cache_keychain_credentials(creds)
                    else:
                        if creds.valid and _has_required_scopes(creds):
                            _keychain_store_token_unlocked(
                                creds,
                                deadline=deadline,
                                cancellation=cancellation,
                            )

    if not creds or not creds.valid or not _has_required_scopes(creds):
        return None

    return _build_service(creds)
