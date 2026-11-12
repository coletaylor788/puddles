"""Real Chromium tests. Every page request is fulfilled locally or blocked."""

import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

from playwright.sync_api import Locator, sync_playwright
from playwright.sync_api import TimeoutError as BrowserTimeout
from puddles_browser_auth import BrowserAuth

from rocket_money_mcp.errors import GatewayError
from rocket_money_mcp.login import LoginVerification
from rocket_money_mcp.service import SITE


class CheckboxTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.driver = sync_playwright().start()
        user_chrome = Path.home() / "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        cls.browser = cls.driver.chromium.launch(
            executable_path=str(user_chrome) if user_chrome.is_file() else None,
            channel=None if user_chrome.is_file() else "chrome", headless=True,
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.driver.stop()

    def fixture(
        self,
        *,
        controls=1,
        completes=True,
        ready=False,
        frame_origin="https://challenges.cloudflare.com",
        field=True,
    ):
        context = self.browser.new_context(service_workers="block")
        self.addCleanup(context.close)
        field_html = (
            (
                '<input type="hidden" name="cf-turnstile-response" value="%s">'
                % ("synthetic-success" if ready else "")
            )
            if field
            else ""
        )
        main = (
            (
                '<form onsubmit="event.preventDefault(); window.loginSubmissions++; '
                "window.identityReady = !!document.querySelector('input[name=cf-turnstile-response]').value\">"
                '<input type="password" value="synthetic-password"><button type="submit">Sign in</button>'
                "</form>"
            )
            + field_html
            + f'''<script>
          window.checkboxClicks = 0; window.loginSubmissions = 0; window.identityReady = false;
          addEventListener('message', event => {{
            window.checkboxClicks += 1;
            if (event.data === 'synthetic-success') setTimeout(() => {{
              document.querySelector('input[name=cf-turnstile-response]').value = 'synthetic-success';
            }}, 100);
          }});
          </script><iframe src="{frame_origin}/cdn-cgi/challenge-platform/fixture"></iframe>'''
        )
        message = "synthetic-success" if completes else "synthetic-incomplete"
        widget = "".join(
            f"<label><input type=\"checkbox\" onclick=\"parent.postMessage('{message}', '*')\">"
            "Verify you are human</label>"
            for _ in range(controls)
        )

        def route(request):
            url = urlsplit(request.request.url)
            if url.netloc in ("auth.rocketaccount.com", "client-api.rocketmoney.com") and url.path in (
                "/fixture",
                "/auth0/auth/oidc/login",
            ):
                request.fulfill(status=200, content_type="text/html", body=main)
            elif url.path == "/cdn-cgi/challenge-platform/fixture":
                request.fulfill(status=200, content_type="text/html", body=widget)
            else:
                request.abort()

        context.route("**/*", route)
        page = context.new_page()
        page.goto("https://auth.rocketaccount.com/fixture", wait_until="load")
        return page

    def complete(self, page, timeout=5):
        handler = LoginVerification()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if handler(page, deadline):
                return True
            page.wait_for_timeout(25)
        return False

    def test_one_click_waits_for_verification(self):
        page = self.fixture()
        self.assertTrue(self.complete(page))
        self.assertEqual(page.evaluate("checkboxClicks"), 1)

    def test_expired_deadline_does_not_click(self):
        page = self.fixture()
        self.assertFalse(LoginVerification()(page, time.monotonic() - 1))
        self.assertEqual(page.evaluate("checkboxClicks"), 0)

    def test_existing_verification_does_not_click(self):
        page = self.fixture(ready=True)
        self.assertTrue(self.complete(page))
        self.assertEqual(page.evaluate("checkboxClicks"), 0)

    def test_incomplete_verification_never_repeats_click(self):
        page = self.fixture(completes=False)
        handler = LoginVerification()
        deadline = time.monotonic() + 5
        self.assertFalse(handler(page, deadline))
        page.wait_for_function("checkboxClicks === 1", timeout=5000)
        for _ in range(3):
            self.assertFalse(handler(page, deadline))
        self.assertEqual(page.evaluate("checkboxClicks"), 1)

    def test_ambiguous_checkboxes_are_not_clicked(self):
        page = self.fixture(controls=2)
        with self.assertRaisesRegex(GatewayError, "NEEDS_USER_LOGIN"):
            LoginVerification()(page, time.monotonic() + 5)
        self.assertEqual(page.evaluate("checkboxClicks"), 0)

    def test_unknown_frame_is_not_clicked(self):
        page = self.fixture(frame_origin="https://other.example.invalid")
        self.assertFalse(LoginVerification()(page, time.monotonic() + 5))
        self.assertEqual(page.evaluate("checkboxClicks"), 0)

    def test_missing_checkbox_is_not_success(self):
        page = self.fixture(controls=0)
        self.assertFalse(LoginVerification()(page, time.monotonic() + 5))

    def test_missing_response_field_is_not_success(self):
        page = self.fixture(field=False, controls=0)
        self.assertFalse(LoginVerification()(page, time.monotonic() + 5))

    def test_unexpected_login_origin_is_rejected(self):
        page = self.fixture()
        page.goto("about:blank")
        with self.assertRaisesRegex(GatewayError, "NEEDS_USER_LOGIN"):
            LoginVerification()(page, time.monotonic() + 5)

    def test_checked_box_is_not_unchecked(self):
        page = self.fixture(completes=False)
        frame = page.frames[1]
        frame.get_by_role("checkbox").check()
        page.wait_for_function("checkboxClicks === 1", timeout=5000)
        self.assertFalse(LoginVerification()(page, time.monotonic() + 2))
        self.assertTrue(frame.get_by_role("checkbox").is_checked())
        self.assertEqual(page.evaluate("checkboxClicks"), 1)

    def test_disappearing_checkbox_keeps_remaining_timeout(self):
        page = self.fixture()
        control = page.frames[1].get_by_role("checkbox")
        visible = Locator.is_visible

        def disappears(locator, **kwargs):
            result = visible(locator, **kwargs)
            control.evaluate("el => el.remove()")
            return result

        start = time.monotonic()
        with patch.object(Locator, "is_visible", disappears), self.assertRaises(BrowserTimeout):
            LoginVerification()(page, start + 0.2)
        self.assertLess(time.monotonic() - start, 2)
        self.assertEqual(page.evaluate("checkboxClicks"), 0)

    def test_renewal_waits_for_checkbox_then_verifies_identity(self):
        page = self.fixture()
        with tempfile.TemporaryDirectory() as root:
            # All browser traffic is intercepted above. Identity checks are a
            # local callback; no APIRequestContext request reaches the provider.
            auth = BrowserAuth(Path(root).resolve() / "auth", SITE)
            auth.start = lambda: page.context
            original_goto = page.goto
            page.goto = lambda *_args, **_kwargs: original_goto(
                "https://auth.rocketaccount.com/fixture", wait_until="load"
            )
            observations = []

            def verify():
                ready = page.evaluate("window.identityReady === true")
                observations.append(ready)
                if not ready:
                    raise GatewayError("NEEDS_USER_LOGIN")

            auth.open_login(verify=verify, before_submit=LoginVerification())
            self.assertEqual(page.evaluate("checkboxClicks"), 1)
            self.assertEqual(page.evaluate("loginSubmissions"), 1)
            self.assertTrue(observations[-1])
            self.assertIn(False, observations)
