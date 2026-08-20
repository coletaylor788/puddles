"""Tests for legacy Gmail Keychain migration."""

import json
import subprocess
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from gmail_mcp.scripts.migrate_legacy_keychain import MigrationError, migrate


def token_json() -> str:
    return json.dumps({
        "refresh_token": "refresh",
        "client_id": "client",
        "client_secret": "secret",
    })


def test_creates_and_verifies_stable_item(tmp_path):
    token = token_json()
    get_password = MagicMock(return_value=token)
    missing = subprocess.CompletedProcess([], 44, b"", b"")
    created = subprocess.CompletedProcess([], 0, b"", b"")
    verified = subprocess.CompletedProcess([], 0, token.encode(), b"")

    with (
        patch.dict("sys.modules", {"keyring": SimpleNamespace(get_password=get_password)}),
        patch(
            "gmail_mcp.scripts.migrate_legacy_keychain.run_security",
            side_effect=[missing, created, verified],
        ) as security,
    ):
        outcome = migrate(
            security_command="/fake/security",
            trusted_command="/usr/bin/security",
            keychain=tmp_path / "login.keychain-db",
            source_service="legacy",
            target_service="stable",
        )

    assert outcome == "created"
    create_command = security.call_args_list[1].args[0]
    assert create_command[create_command.index("-T") + 1] == "/usr/bin/security"
    assert bytes.fromhex(create_command[create_command.index("-X") + 1]).decode() == token


def test_keeps_matching_stable_item(tmp_path):
    token = token_json()
    get_password = MagicMock(return_value=token)
    existing = subprocess.CompletedProcess([], 0, token.encode(), b"")

    with (
        patch.dict("sys.modules", {"keyring": SimpleNamespace(get_password=get_password)}),
        patch(
            "gmail_mcp.scripts.migrate_legacy_keychain.run_security",
            return_value=existing,
        ) as security,
    ):
        outcome = migrate(
            security_command="/fake/security",
            trusted_command="/usr/bin/security",
            keychain=tmp_path / "login.keychain-db",
            source_service="legacy",
            target_service="stable",
        )

    assert outcome == "already-present"
    security.assert_called_once()


def test_refuses_existing_different_item(tmp_path):
    get_password = MagicMock(return_value=token_json())
    with (
        patch.dict("sys.modules", {"keyring": SimpleNamespace(get_password=get_password)}),
        patch(
            "gmail_mcp.scripts.migrate_legacy_keychain.run_security",
            return_value=subprocess.CompletedProcess([], 0, b"different", b""),
        ),
        pytest.raises(MigrationError, match="different data"),
    ):
        migrate(
            security_command="/fake/security",
            trusted_command="/usr/bin/security",
            keychain=tmp_path / "login.keychain-db",
            source_service="legacy",
            target_service="stable",
        )


def test_rejects_invalid_legacy_token_before_keychain_write(tmp_path):
    get_password = MagicMock(return_value="{}")
    with (
        patch.dict("sys.modules", {"keyring": SimpleNamespace(get_password=get_password)}),
        patch(
            "gmail_mcp.scripts.migrate_legacy_keychain.run_security",
        ) as security,
        pytest.raises(MigrationError, match="refresh_token"),
    ):
        migrate(
            security_command="/fake/security",
            trusted_command="/usr/bin/security",
            keychain=tmp_path / "login.keychain-db",
            source_service="legacy",
            target_service="stable",
        )

    security.assert_not_called()
