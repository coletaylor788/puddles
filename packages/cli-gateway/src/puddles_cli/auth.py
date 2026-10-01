"""Host-only credentials. Nothing in this module is returned to an agent."""

import asyncio
from pathlib import Path
import sys
import time

import httpx

from .errors import GatewayError
from .state import atomic_json, private_directory, read_private

API = "https://client-api.rocketmoney.com/graphql"
SILENT = "https://client-api.rocketmoney.com/auth0/auth/oidc/login?silentOnly=true&returnTo=https%3A%2F%2Fapp.rocketmoney.com%2F"
IDENTITY_QUERY = {
    "query": "query PuddlesIdentity { viewer { id } }",
    "operationName": "PuddlesIdentity",
    "variables": {},
}


class Keychain:
    def __init__(self):
        if sys.platform != "darwin":
            raise GatewayError("KEYCHAIN_UNAVAILABLE")
        from keyring.backends.macOS import Keyring

        self.backend = Keyring()

    def get(self, account):
        from .config import strict_json

        try:
            value = self.backend.get_password("PuddlesCLI", account)
            return strict_json(value) if value else None
        except Exception:
            raise GatewayError("KEYCHAIN_UNAVAILABLE") from None

    def put(self, account, value):
        import json

        try:
            self.backend.set_password("PuddlesCLI", account, json.dumps(value))
        except Exception:
            raise GatewayError("KEYCHAIN_UNAVAILABLE") from None


class OAuthTokens:
    """Reusable standard OAuth driver; callers hold their account lock."""

    def __init__(self, keychain, account, client_id, token_url):
        if not token_url.startswith("https://"):
            raise GatewayError("INVALID_AUTH_CONFIG")
        self.store, self.account, self.client_id, self.token_url = keychain, account, client_id, token_url

    async def access_token(self):
        from authlib.integrations.httpx_client import AsyncOAuth2Client

        token = self.store.get(self.account)
        if not token:
            raise GatewayError("AUTH_REQUIRED")
        if token.get("expires_at", 0) > time.time() + 60:
            return token["access_token"]
        if not token.get("refresh_token"):
            raise GatewayError("AUTH_REQUIRED")
        async with AsyncOAuth2Client(self.client_id, token=token, trust_env=False, timeout=30) as client:
            try:
                new = await client.refresh_token(self.token_url, refresh_token=token["refresh_token"])
                new["refresh_token"] = new.get("refresh_token") or token["refresh_token"]
                self.store.put(self.account, new)
                return new["access_token"]
            except Exception:
                raise GatewayError("AUTH_REQUIRED") from None


def identity(body):
    try:
        value = body["data"]["viewer"]["id"]
        return value if isinstance(value, str) and value else None
    except (KeyError, TypeError):
        return None


def auth_failed(status, body):
    if status in (401, 403):
        return True
    return any(
        e.get("extensions", {}).get("code") in ("GRAPHQL_REQUIRES_AUTHENTICATION", "UNAUTHENTICATED")
        for e in body.get("errors", [])
        if isinstance(e, dict)
    )


class BrowserSession:
    def __init__(self, directory: Path):
        self.directory = private_directory(directory)
        self.file = directory / "browser-state.json"
        self.identity_file = directory / "identity.json"

    def status(self):
        if not self.file.exists() or not self.identity_file.exists():
            return {"auth": "interaction_required"}
        info = read_private(self.directory / "auth-status.json", {})
        return {"auth": info.get("auth", "ready"), "verifiedAt": info.get("verifiedAt")}

    def state(self):
        return read_private(self.file, {"cookies": [], "origins": []})

    def bind_identity(self, user_id, initial=False):
        if not user_id:
            raise GatewayError("AUTH_REQUIRED")
        old = read_private(self.identity_file)
        if old and old.get("viewerId") != user_id:
            raise GatewayError("ACCOUNT_MISMATCH")
        if not old:
            if not initial:
                raise GatewayError("AUTH_REQUIRED")
            atomic_json(self.identity_file, {"viewerId": user_id})

    def cookies(self):
        import http.cookiejar

        result = httpx.Cookies()
        for c in self.state()["cookies"]:
            domain = c["domain"]
            # Identity-provider cookies must never enter the API client.
            if domain.lstrip(".") not in ("rocketmoney.com", "client-api.rocketmoney.com"):
                continue
            expires = c.get("expires", -1)
            result.jar.set_cookie(
                http.cookiejar.Cookie(
                    0,
                    c["name"],
                    c["value"],
                    None,
                    False,
                    domain,
                    domain.startswith("."),
                    domain.startswith("."),
                    c.get("path", "/"),
                    True,
                    c.get("secure", True),
                    None if expires <= 0 else int(expires),
                    expires <= 0,
                    None,
                    None,
                    {"HttpOnly": c.get("httpOnly", False), "SameSite": c.get("sameSite", "Lax")},
                    False,
                )
            )
        return result

    def save_cookies(self, cookies):
        state = self.state()
        outside = [
            c
            for c in state["cookies"]
            if c["domain"].lstrip(".") not in ("rocketmoney.com", "client-api.rocketmoney.com")
        ]
        now = time.time()
        state["cookies"] = outside + [
            dict(
                name=c.name,
                value=c.value,
                domain=c.domain,
                path=c.path,
                expires=c.expires or -1,
                secure=c.secure,
                httpOnly=("HttpOnly" in c._rest and c._rest["HttpOnly"] is not False),
                sameSite=c._rest.get("SameSite", "Lax"),
            )
            for c in cookies.jar
            if not c.expires or c.expires > now
        ]
        atomic_json(self.file, state)

    def renew(self, initial=False):
        """Must be called with the cross-process account lock held."""
        from playwright.sync_api import sync_playwright

        atomic_json(self.directory / "auth-status.json", {"auth": "renewing"})
        try:
            with sync_playwright() as pw:
                profile = private_directory(self.directory / "chromium")
                context = pw.chromium.launch_persistent_context(
                    str(profile), headless=not initial, accept_downloads=False, timeout=30000
                )
                try:
                    if self.file.exists():
                        # Saved HTTP cookie rotations take precedence over stale profile cookies.
                        context.clear_cookies()
                        context.add_cookies(self.state()["cookies"])
                    page = context.pages[0] if context.pages else context.new_page()
                    page.goto(
                        "https://app.rocketmoney.com/" if initial else SILENT,
                        wait_until="domcontentloaded",
                        timeout=45000,
                    )
                    until = time.monotonic() + (300 if initial else 45)
                    while time.monotonic() < until:
                        response = context.request.post(API, data=IDENTITY_QUERY, timeout=10000)
                        body = response.json() if len(response.body()) < 65536 else {}
                        user_id = identity(body)
                        if user_id:
                            self.bind_identity(user_id, initial=initial)
                            atomic_json(self.file, context.storage_state())
                            atomic_json(
                                self.directory / "auth-status.json",
                                {"auth": "ready", "verifiedAt": int(time.time())},
                            )
                            return
                        page.wait_for_timeout(1500)
                    raise GatewayError("AUTH_REQUIRED")
                finally:
                    context.close()
        except GatewayError:
            atomic_json(self.directory / "auth-status.json", {"auth": "interaction_required"})
            raise
        except Exception:
            atomic_json(self.directory / "auth-status.json", {"auth": "unavailable"})
            raise GatewayError("AUTH_UNAVAILABLE") from None


def run_oauth(driver):
    return asyncio.run(driver.access_token())
