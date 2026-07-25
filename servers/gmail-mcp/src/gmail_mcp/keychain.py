"""Bounded macOS Keychain access for Gmail OAuth credentials."""

import subprocess

from .config import KEYCHAIN_SERVICE

KEYCHAIN_ACCESS_TIMEOUT_S = 5
KEYCHAIN_ACCOUNT = "token"
SECURITY_COMMAND = "/usr/bin/security"
KEYCHAIN_DUPLICATE_ITEM_STATUS = 45


class KeychainAccessError(RuntimeError):
    """Raised when macOS Keychain access fails or times out."""


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


def read_token() -> str | None:
    """Read the exact Gmail OAuth token item."""
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


def _item_exists() -> bool:
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


def write_token(token_data: str) -> None:
    """Create or update the exact Gmail OAuth token item."""
    exists = _item_exists()
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
    encoded = token_data.encode().hex()
    args.extend(["-X", encoded])
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
                encoded,
            ],
            sensitive_args=True,
        )
