import time
from types import SimpleNamespace

import pytest

from puddles_cli.auth import BrowserSession, OAuthTokens
from puddles_cli.errors import GatewayError
from puddles_cli.state import atomic_json


class Browser:
    def __init__(self, user="same"):
        self.user = user
        self.closed = False
        self.pages = [self]
        self.request = self
        self.imported = []

    def launch_persistent_context(self, path, **options):
        self.options = options
        return self

    def __enter__(self):
        return SimpleNamespace(chromium=self)

    def __exit__(self, *args):
        pass

    def clear_cookies(self):
        self.imported = []

    def add_cookies(self, cookies):
        self.imported = cookies

    def goto(self, url, **options):
        self.url = url

    def post(self, url, **options):
        return SimpleNamespace(body=lambda: b"{}", json=lambda: {"data": {"viewer": {"id": self.user}}})

    def storage_state(self):
        return {"cookies": [], "origins": []}

    def close(self):
        self.closed = True


def test_managed_browser_renewal_is_headless_pins_identity_and_closes(tmp_path, monkeypatch):
    import playwright.sync_api

    session = BrowserSession(tmp_path)
    session.bind_identity("same", initial=True)
    atomic_json(session.file, {"cookies": [], "origins": []})
    browser = Browser()
    monkeypatch.setattr(playwright.sync_api, "sync_playwright", lambda: browser)
    session.renew()
    assert browser.options["headless"] is True
    assert "silentOnly=true" in browser.url
    assert browser.closed and session.status()["auth"] == "ready"
    browser.user = "different"
    with pytest.raises(GatewayError, match="ACCOUNT_MISMATCH"):
        session.renew()
    assert session.status()["auth"] == "interaction_required"
    assert browser.closed


def test_oauth_refresh_preserves_and_persists_refresh_token(monkeypatch):
    import asyncio
    import authlib.integrations.httpx_client

    stored = {"access_token": "old", "refresh_token": "synthetic-refresh", "expires_at": 1}
    writes = []
    store = SimpleNamespace(get=lambda account: stored, put=lambda account, value: writes.append(value))

    class Client:
        def __init__(self, *args, **kwargs):
            assert kwargs["trust_env"] is False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def refresh_token(self, url, **kwargs):
            assert url == "https://example.invalid/token"
            return {"access_token": "new", "expires_at": time.time() + 3600}

    monkeypatch.setattr(authlib.integrations.httpx_client, "AsyncOAuth2Client", Client)
    driver = OAuthTokens(store, "account", "client", "https://example.invalid/token")
    assert asyncio.run(driver.access_token()) == "new"
    assert writes[0]["refresh_token"] == "synthetic-refresh"
