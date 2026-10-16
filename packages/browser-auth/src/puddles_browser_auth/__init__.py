"""Shared browser auth. Callers must be trusted host code, never agent sandboxes."""

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from .errors import AuthError
from .state import account_lock, atomic_json, private_directory, read_private


def now():
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True)
class Site:
    home: str
    api: str
    renew: str
    login_origins: tuple[str, ...]


class BrowserAuth:
    def __init__(self, directory: Path, site: Site, executable: str | None = None):
        self.directory = private_directory(directory)
        self.site = site
        for url in (site.home, site.api, site.renew):
            if urlsplit(url).scheme != "https":
                raise AuthError("INVALID_AUTH_CONFIG")
        self.executable = executable
        self.context = None
        self.driver = None
        self.lock = None

    def status(self):
        state = read_private(self.directory / "status.json", {})
        return {
            "status": "ok",
            "authentication": state.get("authentication", "unknown"),
            "observedAt": state.get("observedAt"),
            "guidance": "Open Rocket Money Login on the host desktop."
            if state.get("authentication") != "ready"
            else None,
        }

    def mark(self, state):
        atomic_json(
            self.directory / "status.json",
            {"authentication": state, "observedAt": now()},
        )

    def start(self):
        if self.context:
            return self.context
        lock = account_lock(self.directory, timeout=2)
        lock.__enter__()
        self.lock = lock
        try:
            from playwright.sync_api import sync_playwright

            self.driver = sync_playwright().start()
            # Keep Chrome's real credential store and password manager. Playwright's
            # default basic/mock credential stores are inappropriate for this profile.
            self.context = self.driver.chromium.launch_persistent_context(
                str(private_directory(self.directory / "chrome")),
                channel="chrome" if not self.executable else None,
                executable_path=self.executable,
                headless=False,
                accept_downloads=False,
                timeout=30000,
                ignore_default_args=[
                    "--password-store=basic",
                    "--use-mock-keychain",
                    "--enable-automation",
                ],
                args=["--no-first-run", "--no-default-browser-check"],
            )
            state = read_private(self.directory / "session.json")
            if state:
                # APIRequestContext shares the browser cookie jar, so there is one
                # owner for browser and HTTP updates. Restore session-only cookies too.
                self.context.add_cookies(state.get("cookies", []))
            return self.context
        except Exception:  # noqa: BLE001 - sanitize host/provider failures
            self.close()
            self.mark("unavailable")
            raise AuthError("AUTH_UNAVAILABLE") from None

    def post(self, body):
        context = self.start()
        try:
            response = context.request.post(
                self.site.api, data=body, timeout=30000, max_redirects=0, max_retries=0
            )
            try:
                if response.status in (401, 403):
                    self.mark("expired")
                    raise AuthError("NEEDS_USER_LOGIN")
                if response.status < 200 or response.status >= 300:
                    raise AuthError("PROVIDER_ERROR")
                raw = response.body()
                if len(raw) > 16 * 1024 * 1024:
                    raise AuthError("LIMIT_EXCEEDED")
                import json

                value = json.loads(raw)
                if not isinstance(value, dict):
                    raise AuthError("PROVIDER_ERROR")
                self.persist()
                return value
            finally:
                response.dispose()
        except AuthError:
            raise
        except Exception:  # noqa: BLE001 - sanitize host/provider failures
            # A user may close the private browser window. Retire dead handles so
            # the next call can reopen the saved session instead of staying stuck.
            self.close()
            self.mark("unavailable")
            raise AuthError("PROVIDER_ERROR") from None

    def persist(self):
        if self.context:
            # Deliberately host-private; never returned through MCP or logs.
            atomic_json(self.directory / "session.json", self.context.storage_state())

    def open_login(self, interactive=False, *, verify: Callable[[], None] | None = None):
        if not interactive and verify is None:
            raise AuthError("INVALID_AUTH_CONFIG")
        self.mark("renewing")
        ctx = self.start()
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        deadline = time.monotonic() + 60
        submitted = False
        next_check = 0.0
        try:
            page.goto(
                self.site.home if interactive else self.site.renew,
                wait_until="domcontentloaded",
                timeout=45000,
            )
            if interactive:
                return
            allowed = {*self.site.login_origins}
            for url in (self.site.home, self.site.renew):
                parts = urlsplit(url)
                allowed.add(f"{parts.scheme}://{parts.netloc}")
            while time.monotonic() < deadline:
                parts = urlsplit(page.url)
                origin = f"{parts.scheme}://{parts.netloc}"
                if origin not in allowed:
                    raise AuthError("NEEDS_USER_LOGIN")
                if time.monotonic() >= next_check:
                    try:
                        verify()
                        return
                    except AuthError as exc:
                        if exc.code != "NEEDS_USER_LOGIN":
                            raise
                    next_check = time.monotonic() + 1
                # SPA redirects, Chrome autofill and the session callback can finish
                # after DOMContentLoaded. Wait for verified identity, not a fixed sleep.
                if not submitted and origin in self.site.login_origins:
                    filled = page.locator('input[type="password"]')
                    submit = page.locator('button[type="submit"]')
                    if (filled.count() == 1 and filled.is_visible()
                            and filled.evaluate("el => el.value.length > 0")
                            and submit.count() == 1 and submit.is_visible()
                            and submit.is_enabled()):
                        # Use only Chrome's already-filled credential, at most once.
                        # Never extract values, select accounts or dismiss OS/MFA prompts.
                        submitted = True
                        remaining = int((deadline - time.monotonic()) * 1000)
                        if remaining <= 0:
                            break
                        submit.click(timeout=min(10000, remaining))
                page.wait_for_timeout(250)
            raise AuthError("NEEDS_USER_LOGIN")
        except AuthError:
            self.mark("needs_user_login")
            raise
        except Exception:  # noqa: BLE001 - sanitize host/provider failures
            self.mark("needs_user_login")
            raise AuthError("NEEDS_USER_LOGIN") from None

    def close(self):
        try:
            if self.context:
                try:
                    self.persist()
                finally:
                    self.context.close()
        except Exception:  # noqa: BLE001, S110 - closed handles need cleanup, not sensitive diagnostics
            pass
        finally:
            self.context = None
            try:
                if self.driver:
                    self.driver.stop()
            except Exception:  # noqa: BLE001, S110 - release the profile without logging driver diagnostics
                pass
            finally:
                self.driver = None
                if self.lock:
                    self.lock.__exit__(None, None, None)
                    self.lock = None
