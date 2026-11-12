"""Rocket Money's single-checkbox login verification, inside the host browser."""

import time
from urllib.parse import urlsplit

from .errors import GatewayError


def login_origin(url):
    parts = urlsplit(url)
    return (parts.scheme, parts.netloc) == ("https", "auth.rocketaccount.com")


def challenge_frame(frame, page):
    parts = urlsplit(frame.url)
    return (
        (parts.scheme, parts.netloc) == ("https", "challenges.cloudflare.com")
        and parts.path.startswith("/cdn-cgi/challenge-platform/")
        and frame.parent_frame == page.main_frame
    )


class LoginVerification:
    """One instance per renewal. Success still requires pinned account verification."""

    def __init__(self):
        self.clicked = False

    def __call__(self, page, deadline):
        if not login_origin(page.url):
            raise GatewayError("NEEDS_USER_LOGIN")
        remaining = int((deadline - time.monotonic()) * 1000)
        if remaining <= 0:
            return False
        response = page.locator('input[name="cf-turnstile-response"]')
        if response.count() > 1:
            raise GatewayError("NEEDS_USER_LOGIN")
        if response.count() == 1 and response.evaluate(
            "el => el.value.length > 0", timeout=min(1000, remaining)
        ):
            # Observe only completion, never extract or synthesize a token.
            return True
        if self.clicked:
            return False

        candidates = []
        for frame in page.frames:
            if not challenge_frame(frame, page):
                continue
            checkbox = frame.get_by_role("checkbox", name="Verify you are human", exact=True)
            if checkbox.count() > 1:
                raise GatewayError("NEEDS_USER_LOGIN")
            if checkbox.count() == 1 and checkbox.is_visible():
                remaining = int((deadline - time.monotonic()) * 1000)
                if remaining <= 0:
                    return False
                if checkbox.is_enabled(timeout=min(1000, remaining)):
                    candidates.append((frame, checkbox))
        if len(candidates) > 1:
            raise GatewayError("NEEDS_USER_LOGIN")
        if candidates:
            frame, checkbox = candidates[0]
            remaining = int((deadline - time.monotonic()) * 1000)
            if remaining <= 0:
                return False
            if not login_origin(page.url) or not challenge_frame(frame, page):
                raise GatewayError("NEEDS_USER_LOGIN")
            if checkbox.is_checked(timeout=min(1000, remaining)):
                return False
            self.clicked = True
            # Native control interaction only. No puzzle solving, frame rewriting,
            # fingerprint changes, credential selection, or repeated clicks.
            remaining = int((deadline - time.monotonic()) * 1000)
            if remaining <= 0:
                return False
            checkbox.click(timeout=min(3000, remaining))
        return False
