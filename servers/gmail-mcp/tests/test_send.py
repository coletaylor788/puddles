"""All sends use a recording provider. No credentials or network access."""

import asyncio
import base64
import json
import threading
from email import policy
from email.parser import BytesParser
from unittest.mock import AsyncMock, Mock

import pytest

from gmail_mcp.send import SEND_SCHEMA, send_email
from gmail_mcp.server import call_tool, list_tools

EMAIL = {
    "to": ["new@example.net"],
    "cc": ["copy@example.net"],
    "bcc": ["hidden@example.net"],
    "subject": "Café",
    "body_text": "Hello 世界",
}


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setenv("GMAIL_MCP_ENABLE_SEND", "1")
    monkeypatch.delenv("GMAIL_MCP_SEND_MAILBOX", raising=False)
    service = Mock()
    users = service.users.return_value
    users.getProfile.return_value.execute.return_value = {"emailAddress": "owner@example.org"}
    send_once = Mock(return_value={
        "id": "abc",
        "threadId": "def",
        "unexpected": "PRIVATE_ECHO",
    })
    monkeypatch.setattr("gmail_mcp.send._send_once", send_once)
    service.send_once = send_once
    return service, AsyncMock(return_value=service)


async def test_send_mime_and_no_retries(provider, capsys):
    service, get_service = provider
    result = await send_email(EMAIL, get_service)
    assert result == {"status": "sent", "id": "abc", "threadId": "def"}
    send = service.users().messages().send
    send.assert_called_once()
    kwargs = send.call_args.kwargs
    assert kwargs["userId"] == "me"
    message = BytesParser(policy=policy.default).parsebytes(
        base64.urlsafe_b64decode(kwargs["body"]["raw"])
    )
    assert str(message["From"]) == "owner@example.org"
    for key in ("to", "cc", "bcc"):
        assert str(message[key]) == ", ".join(EMAIL[key])
    assert str(message["Subject"]) == EMAIL["subject"]
    assert message.get_content().rstrip("\r\n") == EMAIL["body_text"]
    service.send_once.assert_called_once_with(send.return_value)
    logs = capsys.readouterr().err
    for text in ("PRIVATE_ECHO", EMAIL["body_text"], EMAIL["subject"], EMAIL["to"][0]):
        assert text not in logs


@pytest.mark.parametrize(
    "change",
    [
        {"to": []},
        {"to": ["name <a@example.org>"]},
        {"bcc": "a@example.org"},
        {"subject": "x\r\nBcc: a@example.org"},
        {"raw": "arbitrary"},
        {"approved": True},
        {"from": "alias@example.net"},
        {"body_text": "界" * 40000},
        {"body_text": "\ud800"},
        {"subject": "\ud800"},
    ],
)
async def test_invalid_input_cannot_reach_provider(provider, change):
    service, get_service = provider
    assert await send_email({**EMAIL, **change}, get_service) == {"status": "failed_before_send"}
    get_service.assert_not_called()
    service.users.assert_not_called()


@pytest.mark.parametrize(
    "address", [None, "", "bad\r\nBcc: x@example.net", "alias <x@example.net>"]
)
async def test_invalid_authenticated_mailbox_cannot_send(provider, address):
    service, get_service = provider
    service.users().getProfile.return_value.execute.return_value = {
        "emailAddress": address
    }
    assert await send_email(EMAIL, get_service) == {"status": "failed_before_send"}
    service.users().messages.assert_not_called()


async def test_sender_comes_from_existing_authenticated_profile(provider):
    service, get_service = provider
    service.users().getProfile.return_value.execute.return_value = {
        "emailAddress": "connected@example.net"
    }
    assert (await send_email(EMAIL, get_service))["status"] == "sent"
    raw = service.users().messages().send.call_args.kwargs["body"]["raw"]
    message = BytesParser(policy=policy.default).parsebytes(base64.urlsafe_b64decode(raw))
    assert str(message["From"]) == "connected@example.net"


async def test_lost_response_is_unknown_not_retryable(provider, capsys):
    service, get_service = provider
    execute = service.send_once
    execute.side_effect = RuntimeError("PRIVATE_ECHO " + json.dumps(EMAIL))
    assert await send_email(EMAIL, get_service) == {"status": "unknown"}
    execute.assert_called_once_with(service.users().messages().send.return_value)
    assert "PRIVATE_ECHO" not in capsys.readouterr().err


async def test_timeout_during_profile_does_not_dispatch_later(provider, monkeypatch):
    from gmail_mcp import send as module
    from gmail_mcp._async import run_blocking

    service, get_service = provider
    started, release = threading.Event(), threading.Event()

    def profile(**_kwargs):
        started.set()
        release.wait(2)
        return {"emailAddress": "owner@example.org"}

    service.users().getProfile.return_value.execute.side_effect = profile

    async def short_wait(call, **kwargs):
        return await run_blocking(call, **kwargs, timeout=0.01)

    monkeypatch.setattr(module, "run_blocking", short_wait)
    task = asyncio.create_task(send_email(EMAIL, get_service))
    await asyncio.to_thread(started.wait, 1)
    await asyncio.sleep(0.03)
    release.set()
    assert await task == {"status": "failed_before_send"}
    service.send_once.assert_not_called()


async def test_disabled_raw_server_refuses_and_hides_send(monkeypatch):
    monkeypatch.delenv("GMAIL_MCP_ENABLE_SEND", raising=False)
    assert "send_email" not in [tool.name for tool in await list_tools()]
    result = await call_tool("send_email", EMAIL)
    assert json.loads(result[0].text) == {"status": "failed_before_send"}


async def test_tool_schema_is_closed(provider):
    tool = next(tool for tool in await list_tools() if tool.name == "send_email")
    assert tool.inputSchema == SEND_SCHEMA
    assert tool.inputSchema["additionalProperties"] is False


@pytest.mark.parametrize("outcome", ["lost_response", "unauthorized", "redirect", "accepted"])
async def test_real_transport_never_repeats_post(monkeypatch, capsys, outcome):
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from google.auth.credentials import AnonymousCredentials
    from google_auth_httplib2 import AuthorizedHttp
    from googleapiclient.http import HttpRequest

    received = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            received.append(self.rfile.read(int(self.headers["Content-Length"])))
            if outcome == "lost_response":
                self.close_connection = True
                return
            self.send_response({"unauthorized": 401, "redirect": 307, "accepted": 200}[outcome])
            self.send_header("Location", "/repeat")
            self.end_headers()
            self.wfile.write(b'{"id":"abc","threadId":"def","echo":"PRIVATE_ECHO"}')

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    monkeypatch.setenv("GMAIL_MCP_ENABLE_SEND", "1")
    monkeypatch.delenv("GMAIL_MCP_SEND_MAILBOX", raising=False)
    service = Mock()
    service.users().getProfile.return_value.execute.return_value = {
        "emailAddress": "owner@example.org"
    }
    service.users().messages().send.return_value = HttpRequest(
        AuthorizedHttp(AnonymousCredentials()),
        lambda _response, content: json.loads(content),
        f"http://127.0.0.1:{server.server_port}/send",
        method="POST",
        body='{"raw":"synthetic"}',
        headers={"content-type": "application/json"},
    )
    try:
        result = await send_email(EMAIL, AsyncMock(return_value=service))
        expected = {"status": "sent", "id": "abc", "threadId": "def"}
        assert result == (expected if outcome == "accepted" else {"status": "unknown"})
        assert received == [b'{"raw":"synthetic"}']
        logs = capsys.readouterr().err
        assert "PRIVATE_ECHO" not in logs
        assert "synthetic" not in logs
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
