"""Migrate a legacy keyring token to the stable gmail-mcp Keychain item."""

from __future__ import annotations

import argparse
import json
import os
import pwd
import subprocess
import sys
from pathlib import Path

from gmail_mcp.config import KEYCHAIN_SERVICE, LEGACY_KEYCHAIN_SERVICE

ACCOUNT = "token"
DEFAULT_SECURITY_COMMAND = "/usr/bin/security"
SECURITY_TIMEOUT_SECONDS = 5


class MigrationError(RuntimeError):
    """Raised when the credential cannot be migrated safely."""


def canonical_login_keychain() -> Path:
    account_home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    return account_home / "Library" / "Keychains" / "login.keychain-db"


def validate_token(token_data: str) -> None:
    try:
        payload = json.loads(token_data)
    except json.JSONDecodeError as exc:
        raise MigrationError("legacy Gmail credential is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise MigrationError("legacy Gmail credential must be a JSON object")
    for field in ("refresh_token", "client_id", "client_secret"):
        value = payload.get(field)
        if not isinstance(value, str) or not value.strip():
            raise MigrationError(
                f"legacy Gmail credential is missing required field {field}"
            )


def run_security(
    command: list[str],
    *,
    sensitive: bool = False,
) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(
            command,
            capture_output=True,
            check=False,
            timeout=SECURITY_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        raise MigrationError("macOS Keychain command timed out") from (
            None if sensitive else exc
        )
    except OSError as exc:
        raise MigrationError(f"macOS Keychain command could not start: {exc}") from exc


def read_target(
    *,
    security_command: str,
    keychain: Path,
    target_service: str,
) -> bytes | None:
    result = run_security(
        [
            security_command,
            "find-generic-password",
            "-s",
            target_service,
            "-a",
            ACCOUNT,
            "-w",
            str(keychain),
        ],
    )
    if result.returncode == 44:
        return None
    if result.returncode != 0:
        raise MigrationError(
            f"stable Keychain read failed with status {result.returncode}"
        )
    return result.stdout.rstrip(b"\n")


def migrate(
    *,
    security_command: str,
    trusted_command: str,
    keychain: Path,
    source_service: str,
    target_service: str,
) -> str:
    try:
        import keyring
    except ModuleNotFoundError as exc:
        raise MigrationError(
            "legacy Python environment does not provide keyring"
        ) from exc

    token_data = keyring.get_password(source_service, ACCOUNT)
    if not token_data:
        raise MigrationError("legacy Gmail credential is unavailable")
    validate_token(token_data)
    encoded = token_data.encode("utf-8").hex()

    existing = read_target(
        security_command=security_command,
        keychain=keychain,
        target_service=target_service,
    )
    if existing is not None:
        if existing != token_data.encode("utf-8"):
            raise MigrationError(
                "stable Gmail Keychain item already exists with different data"
            )
        return "already-present"

    result = run_security(
        [
            security_command,
            "add-generic-password",
            "-s",
            target_service,
            "-a",
            ACCOUNT,
            "-T",
            trusted_command,
            "-X",
            encoded,
            str(keychain),
        ],
        sensitive=True,
    )
    if result.returncode != 0:
        raise MigrationError(
            f"stable Keychain create failed with status {result.returncode}"
        )

    migrated = read_target(
        security_command=security_command,
        keychain=keychain,
        target_service=target_service,
    )
    if migrated != token_data.encode("utf-8"):
        raise MigrationError("stable Gmail credential verification failed")
    return "created"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Copy a legacy keyring Gmail token into a stable Keychain item",
    )
    parser.add_argument("--security-command", default=DEFAULT_SECURITY_COMMAND)
    parser.add_argument("--trusted-command", default=DEFAULT_SECURITY_COMMAND)
    parser.add_argument("--keychain", type=Path, default=canonical_login_keychain())
    parser.add_argument("--source-service", default=LEGACY_KEYCHAIN_SERVICE)
    parser.add_argument("--target-service", default=KEYCHAIN_SERVICE)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        outcome = migrate(
            security_command=args.security_command,
            trusted_command=args.trusted_command,
            keychain=args.keychain,
            source_service=args.source_service,
            target_service=args.target_service,
        )
    except MigrationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(
        f"Stable Gmail Keychain migration {outcome}: "
        f"{args.source_service} -> {args.target_service}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
