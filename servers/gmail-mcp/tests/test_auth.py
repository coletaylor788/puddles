"""Unit tests for auth module."""

import json
import subprocess
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

from gmail_mcp.auth import (
    _use_env_backend,
    get_gmail_service,
    get_token,
    is_authenticated,
    run_oauth_flow,
    store_token,
)
from gmail_mcp.config import GOOGLE_TOKEN_ENV
from gmail_mcp.keychain import KeychainAccessError


# Ensure env backend is not active during Keychain tests
@pytest.fixture(autouse=True)
def _clear_env_token(monkeypatch):
    """Remove GOOGLE_MCP_TOKEN and reset credential caches for each test."""
    monkeypatch.delenv(GOOGLE_TOKEN_ENV, raising=False)
    import gmail_mcp.auth

    gmail_mcp.auth._cached_creds = None
    gmail_mcp.auth._cached_keychain_creds = None
    gmail_mcp.auth._cached_keychain_loaded_at = None


class TestBackendSelection:
    """Tests for backend selection logic."""

    def test_uses_env_backend_when_env_set(self, monkeypatch):
        """Returns True when GOOGLE_MCP_TOKEN is set."""
        monkeypatch.setenv(GOOGLE_TOKEN_ENV, '{"token": "x"}')
        assert _use_env_backend() is True

    def test_uses_keychain_backend_when_env_not_set(self):
        """Returns False when GOOGLE_MCP_TOKEN is not set."""
        assert _use_env_backend() is False


class TestEnvBackend:
    """Tests for environment variable backend."""

    def test_is_authenticated_with_valid_token(self, monkeypatch):
        """Returns True when env var contains valid token JSON."""
        token_data = json.dumps({
            "token": "access_token",
            "refresh_token": "refresh_token",
            "token_uri": "https://oauth2.googleapis.com/token",
            "client_id": "client_id",
            "client_secret": "client_secret",
        })
        monkeypatch.setenv(GOOGLE_TOKEN_ENV, token_data)
        assert is_authenticated() is True

    def test_is_authenticated_with_invalid_json(self, monkeypatch):
        """Returns False when env var contains invalid JSON."""
        monkeypatch.setenv(GOOGLE_TOKEN_ENV, "not json")
        assert is_authenticated() is False

    def test_get_token_returns_credentials(self, monkeypatch):
        """Returns Credentials object from env var."""
        import gmail_mcp.auth

        token_data = json.dumps({
            "token": "access_token",
            "refresh_token": "refresh_token",
            "token_uri": "https://oauth2.googleapis.com/token",
            "client_id": "client_id",
            "client_secret": "client_secret",
        })
        monkeypatch.setenv(GOOGLE_TOKEN_ENV, token_data)

        # Pre-load to avoid refresh attempt on real Credentials
        gmail_mcp.auth._env_load_credentials()
        creds = gmail_mcp.auth._cached_creds
        assert creds is not None
        assert creds.token == "access_token"

    def test_get_token_refreshes_expired(self, monkeypatch):
        """Refreshes expired credentials from env var."""
        import gmail_mcp.auth

        mock_creds = MagicMock()
        mock_creds.expired = True
        mock_creds.refresh_token = "refresh"
        gmail_mcp.auth._cached_creds = mock_creds
        monkeypatch.setenv(GOOGLE_TOKEN_ENV, "{}")

        get_token()
        mock_creds.refresh.assert_called_once()

    def test_store_token_is_noop(self, monkeypatch):
        """store_token does nothing when env backend is active."""
        monkeypatch.setenv(GOOGLE_TOKEN_ENV, '{"token": "x"}')
        mock_creds = MagicMock()
        # Should not raise or call keyring
        store_token(mock_creds)
        mock_creds.to_json.assert_not_called()

    def test_caches_credentials(self, monkeypatch):
        """Credentials are parsed once and cached."""
        import gmail_mcp.auth

        token_data = json.dumps({
            "token": "access_token",
            "refresh_token": "refresh_token",
            "token_uri": "https://oauth2.googleapis.com/token",
            "client_id": "client_id",
            "client_secret": "client_secret",
        })
        monkeypatch.setenv(GOOGLE_TOKEN_ENV, token_data)

        gmail_mcp.auth._env_load_credentials()
        creds1 = gmail_mcp.auth._cached_creds
        gmail_mcp.auth._env_load_credentials()
        # _env_load_credentials overwrites, but the object is equivalent
        creds2 = gmail_mcp.auth._cached_creds
        # Both should be valid Credentials
        assert creds1 is not None
        assert creds2 is not None
        assert creds1.token == creds2.token


class TestKeychainIsAuthenticated:
    """Tests for is_authenticated() with Keychain backend."""

    def test_returns_false_when_no_token(self):
        """Returns False when no token in Keychain."""
        with patch("gmail_mcp.auth.read_token", return_value=None):
            assert is_authenticated() is False

    def test_returns_true_when_token_exists(self):
        """Returns True when token exists in Keychain."""
        token_data = json.dumps({
            "token": "access_token",
            "refresh_token": "refresh_token",
            "token_uri": "https://oauth2.googleapis.com/token",
            "client_id": "client_id",
            "client_secret": "client_secret",
        })
        with patch("gmail_mcp.auth.read_token", return_value=token_data):
            assert is_authenticated() is True


class TestKeychainGetToken:
    """Tests for get_token() with Keychain backend."""

    def test_returns_none_when_no_token(self):
        """Returns None when no token in Keychain."""
        with patch("gmail_mcp.auth.read_token", return_value=None):
            assert get_token() is None

    def test_returns_none_on_invalid_json(self):
        """Returns None when token data is not valid JSON."""
        with patch("gmail_mcp.auth.read_token", return_value="not json"):
            assert get_token() is None

    @pytest.mark.parametrize("token_data", ["null", "[]", '"text"', "42"])
    def test_returns_none_on_non_object_json(self, token_data):
        """Valid JSON with the wrong shape is unauthenticated."""
        with patch("gmail_mcp.auth.read_token", return_value=token_data):
            assert get_token() is None

    def test_returns_credentials_when_valid_token(self):
        """Returns Credentials object when valid token exists."""
        token_data = {
            "token": "access_token",
            "refresh_token": "refresh_token",
            "token_uri": "https://oauth2.googleapis.com/token",
            "client_id": "client_id",
            "client_secret": "client_secret",
        }
        with patch(
            "gmail_mcp.auth.read_token",
            return_value=json.dumps(token_data),
        ):
            creds = get_token()
            assert creds is not None
            assert creds.token == "access_token"
            assert creds.refresh_token == "refresh_token"

    def test_caches_credentials_after_first_read(self):
        """Reads Keychain only once within the short cache window."""
        token_data = json.dumps({
            "token": "access_token",
            "refresh_token": "refresh_token",
            "token_uri": "https://oauth2.googleapis.com/token",
            "client_id": "client_id",
            "client_secret": "client_secret",
        })
        with patch(
            "gmail_mcp.auth.read_token",
            return_value=token_data,
        ) as mock_read:
            assert is_authenticated() is True
            assert get_token() is not None
            mock_read.assert_called_once()

    def test_reloads_credentials_after_cache_ttl(self):
        """Observes external Keychain changes after the cache expires."""
        first = json.dumps({
            "token": "first",
            "refresh_token": "refresh",
            "token_uri": "https://oauth2.googleapis.com/token",
            "client_id": "client_id",
            "client_secret": "client_secret",
        })
        second = json.dumps({
            "token": "second",
            "refresh_token": "refresh",
            "token_uri": "https://oauth2.googleapis.com/token",
            "client_id": "client_id",
            "client_secret": "client_secret",
        })
        with (
            patch(
                "gmail_mcp.auth.read_token",
                side_effect=[first, second],
            ) as mock_read,
            patch(
                "gmail_mcp.auth.time.monotonic",
                side_effect=[100.0, 161.0],
            ),
        ):
            assert get_token().token == "first"
            assert get_token().token == "second"
            assert mock_read.call_count == 2


class TestKeychainStoreToken:
    """Tests for store_token() with Keychain backend."""

    def test_new_token_trusts_security_and_preserves_full_data(self):
        """New tokens trust /usr/bin/security and use untruncated hex data."""
        mock_creds = MagicMock()
        mock_creds.to_json.return_value = '{"token": "test"}'

        with patch("gmail_mcp.keychain.subprocess.run") as mock_run:
            mock_run.side_effect = [
                subprocess.CompletedProcess([], 44, "", "not found"),
                subprocess.CompletedProcess([], 0, "", ""),
            ]
            store_token(mock_creds)

            command = mock_run.call_args_list[1].args[0]
            assert "-U" not in command
            assert command.count("/usr/bin/security") == 2
            assert command[-2:] == ["-X", '{"token": "test"}'.encode().hex()]

    def test_existing_token_update_does_not_modify_acl(self):
        """Refreshes update only the secret to avoid an interactive ACL prompt."""
        mock_creds = MagicMock()
        mock_creds.to_json.return_value = '{"token": "refreshed"}'

        with patch("gmail_mcp.keychain.subprocess.run") as mock_run:
            mock_run.side_effect = [
                subprocess.CompletedProcess([], 0, "metadata", ""),
                subprocess.CompletedProcess([], 0, "", ""),
            ]
            store_token(mock_creds)

            command = mock_run.call_args_list[1].args[0]
            assert "-U" in command
            assert "-T" not in command
            assert command[-2:] == ["-X", '{"token": "refreshed"}'.encode().hex()]

    def test_create_race_retries_as_content_only_update(self):
        """A concurrent create does not discard a completed OAuth flow."""
        mock_creds = MagicMock()
        mock_creds.to_json.return_value = '{"token": "test"}'

        with patch("gmail_mcp.keychain.subprocess.run") as mock_run:
            mock_run.side_effect = [
                subprocess.CompletedProcess([], 44, "", "not found"),
                subprocess.CompletedProcess([], 45, "", "already exists"),
                subprocess.CompletedProcess([], 0, "", ""),
            ]
            store_token(mock_creds)

            create_command = mock_run.call_args_list[1].args[0]
            retry_command = mock_run.call_args_list[2].args[0]
            assert "-T" in create_command
            assert "-U" not in create_command
            assert "-U" in retry_command
            assert "-T" not in retry_command

    def test_oauth_store_wins_over_inflight_stale_refresh(self):
        """A refresh started first cannot overwrite a newer OAuth credential."""
        import gmail_mcp.auth

        refresh_entered = threading.Event()
        release_refresh = threading.Event()
        oauth_stored = threading.Event()
        writes = []

        old_creds = MagicMock()
        old_creds.expired = True
        old_creds.refresh_token = "old-refresh"
        old_creds.valid = True
        old_creds.to_json.return_value = "old"

        new_creds = MagicMock()
        new_creds.to_json.return_value = "new"

        gmail_mcp.auth._cached_keychain_creds = old_creds
        gmail_mcp.auth._cached_keychain_loaded_at = time.monotonic()

        def slow_refresh(*_args, **_kwargs):
            refresh_entered.set()
            release_refresh.wait(timeout=1)
            return True

        def store_oauth_result():
            store_token(new_creds)
            oauth_stored.set()

        with (
            patch("gmail_mcp.auth._refresh_credentials", side_effect=slow_refresh),
            patch("gmail_mcp.auth.read_token", return_value="old"),
            patch(
                "gmail_mcp.auth._credentials_from_token_data",
                return_value=old_creds,
            ),
            patch("gmail_mcp.auth.write_token", side_effect=writes.append),
            patch("gmail_mcp.auth._build_service", return_value=MagicMock()),
        ):
            refresh_thread = threading.Thread(target=get_gmail_service)
            refresh_thread.start()
            assert refresh_entered.wait(timeout=0.5)

            oauth_thread = threading.Thread(target=store_oauth_result)
            oauth_thread.start()
            assert not oauth_stored.wait(timeout=0.05)

            release_refresh.set()
            refresh_thread.join(timeout=1)
            oauth_thread.join(timeout=1)

        assert not refresh_thread.is_alive()
        assert not oauth_thread.is_alive()
        assert writes == ["old", "new"]
        assert gmail_mcp.auth._cached_keychain_creds is new_creds

    def test_external_replacement_discards_stale_refresh(self):
        """A cross-process replacement wins over an in-flight refresh."""
        import gmail_mcp.auth

        old_creds = MagicMock()
        old_creds.expired = True
        old_creds.refresh_token = "old-refresh"
        old_creds.valid = True

        new_creds = MagicMock()
        new_creds.valid = True

        with (
            patch("gmail_mcp.auth.read_token", side_effect=["old", "new"]),
            patch(
                "gmail_mcp.auth._credentials_from_token_data",
                side_effect=[old_creds, new_creds],
            ),
            patch("gmail_mcp.auth._refresh_credentials", return_value=True),
            patch("gmail_mcp.auth.write_token") as mock_write,
            patch("gmail_mcp.auth._build_service", return_value=MagicMock()),
        ):
            assert get_gmail_service() is not None

        mock_write.assert_not_called()
        assert gmail_mcp.auth._cached_keychain_creds is new_creds


class TestKeychainCommand:
    """Tests for bounded macOS Keychain command execution."""

    def test_missing_item_is_unauthenticated(self):
        with patch("gmail_mcp.keychain.subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess([], 44, "", "not found")
            assert is_authenticated() is False

    def test_permission_failure_is_not_silently_treated_as_missing(self):
        with patch("gmail_mcp.keychain.subprocess.run") as mock_run:
            mock_run.return_value = subprocess.CompletedProcess([], 1, "", "denied")
            with pytest.raises(KeychainAccessError, match="denied"):
                is_authenticated()

    def test_timeout_surfaces_actionable_error(self):
        with patch(
            "gmail_mcp.keychain.subprocess.run",
            side_effect=subprocess.TimeoutExpired(["security"], 5),
        ):
            with pytest.raises(KeychainAccessError, match="timed out"):
                is_authenticated()

    def test_missing_security_command_surfaces_actionable_error(self):
        with patch(
            "gmail_mcp.keychain.subprocess.run",
            side_effect=FileNotFoundError("/usr/bin/security"),
        ):
            with pytest.raises(KeychainAccessError, match="could not start"):
                is_authenticated()


class TestAuthenticationBounds:
    """Tests for operation-wide OAuth and refresh deadlines."""

    def test_refresh_request_caps_each_attempt_to_remaining_deadline(self):
        import gmail_mcp.auth

        transport = MagicMock(return_value=MagicMock())
        with (
            patch("gmail_mcp.auth.Request", return_value=transport),
            patch("gmail_mcp.auth.time.monotonic", side_effect=[100.0, 110.0]),
        ):
            request = gmail_mcp.auth._DeadlineRequest(45)
            request("https://oauth.example/token", timeout=120)

        transport.assert_called_once_with(
            "https://oauth.example/token",
            timeout=30,
        )

    def test_refresh_request_rejects_attempt_after_deadline(self):
        import gmail_mcp.auth

        transport = MagicMock()
        with (
            patch("gmail_mcp.auth.Request", return_value=transport),
            patch("gmail_mcp.auth.time.monotonic", side_effect=[100.0, 146.0]),
        ):
            request = gmail_mcp.auth._DeadlineRequest(45)
            with pytest.raises(TimeoutError, match="deadline exceeded"):
                request("https://oauth.example/token")

        transport.assert_not_called()

    def test_oauth_token_exchange_has_http_timeout(self):
        import gmail_mcp.auth

        flow = object.__new__(gmail_mcp.auth._BoundedInstalledAppFlow)
        with patch.object(
            gmail_mcp.auth.InstalledAppFlow,
            "fetch_token",
            return_value="token",
        ) as parent_fetch:
            assert flow.fetch_token(code="authorization-code") == "token"

        parent_fetch.assert_called_once_with(
            code="authorization-code",
            timeout=30,
        )


class TestRunOauthFlow:
    """Tests for run_oauth_flow()."""

    def test_raises_when_credentials_missing(self, tmp_path):
        """Raises FileNotFoundError when credentials.json doesn't exist and no token."""
        with (
            patch("gmail_mcp.auth._use_env_backend", return_value=True),
            patch("gmail_mcp.auth.get_token", return_value=None),
            patch("gmail_mcp.auth.get_credentials_path", return_value=tmp_path / "missing.json"),
        ):
            with pytest.raises(FileNotFoundError) as exc_info:
                run_oauth_flow()

            assert "credentials.json not found" in str(exc_info.value)

    def test_runs_oauth_and_stores_token(self, tmp_path):
        """Runs OAuth flow, stores token, returns email when no existing token."""
        # Create fake credentials file
        creds_file = tmp_path / "credentials.json"
        creds_file.write_text('{"installed": {"client_id": "x", "client_secret": "y"}}')

        mock_creds = MagicMock()
        mock_creds.to_json.return_value = '{"token": "test"}'

        mock_flow = MagicMock()
        mock_flow.run_local_server.return_value = mock_creds

        mock_service = MagicMock()
        mock_service.users.return_value.getProfile.return_value.execute.return_value = {
            "emailAddress": "test@gmail.com"
        }

        with (
            patch("gmail_mcp.auth._use_env_backend", return_value=True),
            patch("gmail_mcp.auth.get_token", return_value=None),
            patch("gmail_mcp.auth.get_credentials_path", return_value=creds_file),
            patch(
                "gmail_mcp.auth._BoundedInstalledAppFlow.from_client_secrets_file",
                return_value=mock_flow,
            ),
            patch("gmail_mcp.auth.store_token") as mock_store,
            patch("gmail_mcp.auth.build", return_value=mock_service),
        ):
            email = run_oauth_flow()

            assert email == "test@gmail.com"
            mock_store.assert_called_once_with(mock_creds)
            mock_flow.run_local_server.assert_called_once_with(
                port=0,
                authorization_prompt_message=None,
                timeout_seconds=600,
                browser="gmail-mcp-background",
            )

    def test_returns_email_when_already_authenticated(self):
        """Returns email without browser flow when already authenticated."""
        mock_creds = MagicMock()
        mock_creds.valid = True
        mock_creds.scopes = [
            "https://www.googleapis.com/auth/gmail.modify",
            "https://www.googleapis.com/auth/gmail.send",
        ]

        mock_service = MagicMock()
        mock_service.users.return_value.getProfile.return_value.execute.return_value = {
            "emailAddress": "existing@gmail.com"
        }

        with (
            patch("gmail_mcp.auth._use_env_backend", return_value=True),
            patch("gmail_mcp.auth.get_token", return_value=mock_creds),
            patch("gmail_mcp.auth.build", return_value=mock_service),
        ):
            email = run_oauth_flow()

            assert email == "existing@gmail.com"

    def test_refreshes_expired_token_without_browser(self):
        """Refreshes expired token without opening browser."""
        mock_creds = MagicMock()
        mock_creds.valid = False
        mock_creds.expired = True
        mock_creds.refresh_token = "refresh"
        mock_creds.scopes = [
            "https://www.googleapis.com/auth/gmail.modify",
            "https://www.googleapis.com/auth/gmail.send",
        ]

        mock_service = MagicMock()
        mock_service.users.return_value.getProfile.return_value.execute.return_value = {
            "emailAddress": "refreshed@gmail.com"
        }

        with (
            patch("gmail_mcp.auth._use_env_backend", return_value=True),
            patch("gmail_mcp.auth.get_token", return_value=mock_creds),
            patch("gmail_mcp.auth.store_token") as mock_store,
            patch("gmail_mcp.auth.build", return_value=mock_service),
        ):
            email = run_oauth_flow()

            assert email == "refreshed@gmail.com"
            mock_creds.refresh.assert_called_once()
            mock_store.assert_called_once_with(mock_creds)

    def test_reauths_when_scopes_missing(self):
        """Forces re-authentication when token is missing required scopes."""
        # Token with old/wrong scopes
        mock_old_creds = MagicMock()
        mock_old_creds.valid = True
        mock_old_creds.scopes = ["https://www.googleapis.com/auth/gmail.readonly"]

        # New creds from OAuth flow
        mock_new_creds = MagicMock()
        mock_flow = MagicMock()
        mock_flow.run_local_server.return_value = mock_new_creds

        mock_service = MagicMock()
        mock_service.users.return_value.getProfile.return_value.execute.return_value = {
            "emailAddress": "reauthed@gmail.com"
        }

        with (
            patch("gmail_mcp.auth._use_env_backend", return_value=True),
            patch("gmail_mcp.auth.get_token", return_value=mock_old_creds),
            patch("gmail_mcp.auth.get_credentials_path") as mock_path,
            patch(
                "gmail_mcp.auth._BoundedInstalledAppFlow.from_client_secrets_file",
                return_value=mock_flow,
            ),
            patch("gmail_mcp.auth.store_token") as mock_store,
            patch("gmail_mcp.auth.build", return_value=mock_service),
        ):
            mock_path.return_value.exists.return_value = True

            email = run_oauth_flow()

            assert email == "reauthed@gmail.com"
            # Should have run the OAuth flow, not just returned existing token
            mock_flow.run_local_server.assert_called_once()
            mock_store.assert_called_once_with(mock_new_creds)


class TestGetGmailService:
    """Tests for get_gmail_service()."""

    def test_returns_none_when_not_authenticated(self):
        """Returns None when no token exists."""
        with (
            patch("gmail_mcp.auth._use_env_backend", return_value=True),
            patch("gmail_mcp.auth.get_token", return_value=None),
        ):
            assert get_gmail_service() is None

    def test_returns_service_when_authenticated(self):
        """Returns Gmail service when valid token exists."""
        mock_creds = MagicMock()
        mock_creds.expired = False
        mock_creds.valid = True

        mock_service = MagicMock()

        with (
            patch("gmail_mcp.auth._use_env_backend", return_value=True),
            patch("gmail_mcp.auth.get_token", return_value=mock_creds),
            patch("gmail_mcp.auth.build", return_value=mock_service),
        ):
            result = get_gmail_service()
            assert result == mock_service

    def test_refreshes_expired_token(self):
        """Refreshes token when expired and has refresh_token."""
        mock_creds = MagicMock()
        mock_creds.expired = True
        mock_creds.refresh_token = "refresh"
        mock_creds.valid = True

        mock_service = MagicMock()

        with (
            patch("gmail_mcp.auth._use_env_backend", return_value=True),
            patch("gmail_mcp.auth.get_token", return_value=mock_creds),
            patch("gmail_mcp.auth.store_token") as mock_store,
            patch("gmail_mcp.auth.build", return_value=mock_service),
        ):
            result = get_gmail_service()

            mock_creds.refresh.assert_called_once()
            mock_store.assert_called_once_with(mock_creds)
            assert result == mock_service

    def test_returns_none_when_refresh_fails(self):
        """Returns None when token refresh fails."""
        mock_creds = MagicMock()
        mock_creds.expired = True
        mock_creds.refresh_token = "refresh"
        mock_creds.refresh.side_effect = Exception("Refresh failed")

        with (
            patch("gmail_mcp.auth._use_env_backend", return_value=True),
            patch("gmail_mcp.auth.get_token", return_value=mock_creds),
        ):
            assert get_gmail_service() is None
