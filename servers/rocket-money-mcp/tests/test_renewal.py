"""Bounded saved-login recovery without credentials or live service access."""

import puddles_browser_auth as browser_auth
import pytest
from puddles_browser_auth import BrowserAuth, Site
from puddles_browser_auth.errors import AuthError


class Page:
    def __init__(self):
        self.elapsed = 0.0
        self.submissions = 0
        self.ready_at = None
        self.autofill_at = 5.0
        self.redirect_at = 3.0
        self.login_origin = "https://login.example.invalid"
        self.password_count = 1

    @property
    def url(self):
        return self.login_origin if self.elapsed >= self.redirect_at else "https://app.example.invalid/"

    def goto(self, _url, **_kwargs):
        pass

    def locator(self, selector):
        assert selector in ('input[type="password"]', 'button[type="submit"]')
        return Element(self, selector)

    def wait_for_timeout(self, milliseconds):
        self.elapsed += milliseconds / 1000


class Element:
    def __init__(self, page, selector):
        self.page, self.selector = page, selector

    def count(self):
        return self.page.password_count if self.selector.startswith("input") else 1

    def is_visible(self):
        return self.page.elapsed >= self.page.redirect_at

    def is_enabled(self):
        return True

    def evaluate(self, expression):
        # The only permitted observation is filled/not-filled, never a value.
        assert expression == "el => el.value.length > 0"
        return self.page.elapsed >= self.page.autofill_at

    def click(self, *, timeout):
        assert 0 < timeout <= 10000
        self.page.submissions += 1
        self.page.ready_at = self.page.elapsed + 4


@pytest.fixture
def renewal(tmp_path, monkeypatch):
    page = Page()
    auth = BrowserAuth(tmp_path / "auth", Site(
        "https://app.example.invalid/", "https://api.example.invalid/graphql",
        "https://app.example.invalid/renew", ("https://login.example.invalid",),
    ))
    monkeypatch.setattr(auth, "start", lambda: type("Context", (), {"pages": [page]})())
    monkeypatch.setattr(browser_auth.time, "monotonic", lambda: page.elapsed)
    return auth, page


def test_late_redirect_autofill_and_callback_are_verified(renewal):
    auth, page = renewal

    def verify():
        if page.ready_at is None or page.elapsed < page.ready_at:
            raise AuthError("NEEDS_USER_LOGIN")

    auth.open_login(verify=verify)
    assert page.submissions == 1
    assert page.elapsed >= 9


def test_silent_renewal_needs_no_form_submission(renewal):
    auth, page = renewal

    def verify():
        if page.elapsed < 2:
            raise AuthError("NEEDS_USER_LOGIN")

    auth.open_login(verify=verify)
    assert page.submissions == 0
    assert page.elapsed == 2


@pytest.mark.parametrize("case", ["empty", "mfa", "ambiguous"])
def test_unresolved_login_is_bounded_and_never_resubmitted(renewal, case):
    auth, page = renewal
    if case == "empty":
        page.autofill_at = 1000
    if case == "ambiguous":
        page.password_count = 2

    def verify():
        raise AuthError("NEEDS_USER_LOGIN")

    with pytest.raises(AuthError, match="NEEDS_USER_LOGIN"):
        auth.open_login(verify=verify)
    assert page.elapsed == 60
    assert page.submissions == (1 if case == "mfa" else 0)
    assert auth.status()["authentication"] == "needs_user_login"


@pytest.mark.parametrize("code", ["ACCOUNT_MISMATCH", "PROVIDER_ERROR"])
def test_non_authentication_failure_does_not_submit_or_retry(renewal, code):
    auth, page = renewal

    def verify():
        raise AuthError(code)

    with pytest.raises(AuthError, match=code):
        auth.open_login(verify=verify)
    assert page.submissions == 0
    assert page.elapsed == 0


def test_unknown_origin_never_receives_saved_login_submission(renewal):
    auth, page = renewal
    page.login_origin = "https://unexpected.example.invalid"

    def verify():
        raise AuthError("NEEDS_USER_LOGIN")

    with pytest.raises(AuthError, match="NEEDS_USER_LOGIN"):
        auth.open_login(verify=verify)
    assert page.submissions == 0
    assert page.elapsed == 3


def test_operator_login_returns_control_without_submitting(renewal):
    auth, page = renewal
    auth.open_login(interactive=True)
    assert page.elapsed == 0
    assert page.submissions == 0
