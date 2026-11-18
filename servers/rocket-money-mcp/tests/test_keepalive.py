import asyncio
import threading
from contextlib import asynccontextmanager

import pytest
from puddles_browser_auth.state import atomic_json, read_private

from rocket_money_mcp import __main__ as entry
from rocket_money_mcp.errors import GatewayError
from rocket_money_mcp.service import IDENTITY, RocketMoney


class Auth:
    def __init__(self):
        self.state = "ready"
        self.requests = []
        self.closes = 0
        self.failure = None
        self.viewer = "fixture-owner"
        self.started = 0

    def status(self):
        return {"authentication": self.state}

    def start_http(self):
        self.started += 1

    def post(self, request):
        self.requests.append(request)
        if self.failure:
            raise self.failure
        return {"data": {"viewer": {"id": self.viewer}}}

    def mark(self, state):
        self.state = state

    def close(self):
        self.closes += 1

    def open_login(self, **kwargs):
        pytest.fail("background keepalive must never initiate login")


@pytest.fixture
def setup(tmp_path):
    auth = Auth()
    service = RocketMoney(tmp_path, auth=auth)
    atomic_json(service.identity_file, {"viewerId": auth.viewer})
    return service, auth


def test_ping_is_identity_only_and_reports_persisted_success(setup):
    service, auth = setup
    receipt = service.keep_alive()
    assert auth.requests == [IDENTITY]
    assert receipt["outcome"] == "passed"
    assert receipt["intervalSeconds"] == 1800
    assert receipt["lastSuccessAt"]
    assert auth.closes == 1
    assert service.call("rocket_money_status", {})["keepalive"] == receipt
    assert "fixture-owner" not in str(receipt)


@pytest.mark.parametrize("state", ["expired", "needs_user_login"])
def test_expired_session_waits_for_manual_login_then_resumes(setup, state):
    service, auth = setup
    auth.state = state
    assert service.keep_alive()["outcome"] == "needs_user_login"
    assert auth.requests == []
    assert auth.started == 0
    auth.state = "ready"
    assert service.keep_alive()["outcome"] == "passed"
    assert auth.requests == [IDENTITY]


def test_no_account_binding_never_starts_http_or_enrolls(setup):
    service, auth = setup
    service.identity_file.unlink()
    assert service.keep_alive()["outcome"] == "needs_user_login"
    assert not auth.started
    assert not service.identity_file.exists()


@pytest.mark.parametrize("failure", [GatewayError("NEEDS_USER_LOGIN"), GatewayError("ACCOUNT_MISMATCH")])
def test_auth_failure_stops_retries_until_manual_login(setup, failure):
    service, auth = setup
    auth.failure = failure
    assert service.keep_alive()["outcome"] == "needs_user_login"
    assert auth.state == "needs_user_login"
    service.keep_alive()
    assert len(auth.requests) == 1
    assert read_private(service.identity_file) == {"viewerId": "fixture-owner"}


def test_real_identity_mismatch_never_rebinds(setup):
    service, auth = setup
    auth.viewer = "fixture-other"
    assert service.keep_alive()["outcome"] == "needs_user_login"
    assert read_private(service.identity_file) == {"viewerId": "fixture-owner"}


def test_transient_failure_preserves_success_and_retries_without_sensitive_output(setup):
    service, auth = setup
    success = service.keep_alive()["lastSuccessAt"]
    auth.failure = RuntimeError("credential-canary")
    receipt = service.keep_alive()
    assert receipt["outcome"] == "unavailable"
    assert receipt["lastSuccessAt"] == success
    assert "credential-canary" not in str(receipt)
    auth.failure = None
    assert service.keep_alive()["outcome"] == "passed"


@pytest.mark.asyncio
async def test_timer_runs_without_tool_calls_and_recovers_after_failure():
    calls = []
    done = asyncio.Event()

    async def ping():
        calls.append(True)
        if len(calls) == 1:
            raise RuntimeError("private-canary")
        done.set()

    task = asyncio.create_task(entry.keep_alive(ping, interval=0.01))
    try:
        await asyncio.wait_for(done.wait(), timeout=1)
        assert len(calls) == 2
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


@pytest.mark.asyncio
async def test_shutdown_joins_first_ping_before_closing_service(monkeypatch, tmp_path):
    started, release = threading.Event(), threading.Event()
    closed = []

    class Service:
        def __init__(self, *args, **kwargs):
            started.set()
            assert release.wait(timeout=3)

        def keep_alive(self):
            pass

        def close(self):
            closed.append(True)

    class Server:
        def __init__(self, *args):
            pass

        def __getattr__(self, name):
            if name in {"list_tools", "list_resources", "read_resource", "call_tool"}:
                return lambda *args, **kwargs: lambda func: func
            raise AttributeError(name)

        def create_initialization_options(self):
            return {}

        async def run(self, *args):
            await asyncio.to_thread(started.wait, 1)
            # Return while the worker is still constructing the service.
            asyncio.get_running_loop().call_later(0.02, release.set)

    @asynccontextmanager
    async def stdio():
        yield None, None

    monkeypatch.setattr(entry, "RocketMoney", Service)
    monkeypatch.setattr(entry, "Server", Server)
    monkeypatch.setattr(entry, "stdio_server", stdio)
    await entry.serve(tmp_path, None)
    assert closed == [True]
