"""Tests for the read-only production Gmail smoke check."""

from unittest.mock import MagicMock, patch

import pytest

from gmail_mcp.scripts.production_smoke import main


def test_reads_profile_without_mailbox_mutation(monkeypatch, capsys):
    service = MagicMock()
    monkeypatch.setattr(
        "sys.argv",
        ["production_smoke", "--deadline-seconds", "5"],
    )

    with patch(
        "gmail_mcp.scripts.production_smoke.get_gmail_service",
        return_value=service,
    ):
        main()

    service.users.return_value.getProfile.assert_called_once_with(userId="me")
    service.users.return_value.getProfile.return_value.execute.assert_called_once()
    service.users.return_value.messages.assert_not_called()
    assert '"ok": true' in capsys.readouterr().out


def test_fails_when_credentials_are_unavailable(monkeypatch):
    monkeypatch.setattr("sys.argv", ["production_smoke"])

    with (
        patch(
            "gmail_mcp.scripts.production_smoke.get_gmail_service",
            return_value=None,
        ),
        pytest.raises(RuntimeError, match="credentials are unavailable"),
    ):
        main()
