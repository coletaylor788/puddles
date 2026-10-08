"""Host-only Gmail sending. OpenClaw owns approval before this bridge is called."""

import base64
import os
import re
import threading
import uuid
from email.message import EmailMessage
from email.policy import SMTP
from typing import Any

from google.auth.transport.requests import AuthorizedSession

from ._async import run_blocking
from .auth import HTTP_SOCKET_TIMEOUT_S
from .logging_setup import log

SEND_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "to": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 20},
        "cc": {"type": "array", "items": {"type": "string"}, "maxItems": 20},
        "bcc": {"type": "array", "items": {"type": "string"}, "maxItems": 20},
        "subject": {"type": "string", "maxLength": 200},
        "body_text": {"type": "string", "maxLength": 100000},
    },
    "required": ["to", "subject", "body_text"],
}
ADDRESS = re.compile(
    r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*"
    r"@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?"
)
HEADER_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]")


def valid_mailbox(value: Any) -> bool:
    if not isinstance(value, str) or len(value) > 254 or not ADDRESS.fullmatch(value):
        return False
    local, domain = value.split("@")
    return len(local) <= 64 and all(len(label) <= 63 for label in domain.split("."))


def send_enabled() -> bool:
    return os.environ.get("GMAIL_MCP_ENABLE_SEND") == "1"


def validate_email(args: dict[str, Any]) -> None:
    if not isinstance(args, dict) or set(args) - SEND_SCHEMA["properties"].keys():
        raise ValueError("Invalid email input")
    for key in ("to", "cc", "bcc"):
        if key != "to" and key not in args:
            continue
        values = args.get(key)
        if (
            not isinstance(values, list)
            or len(values) > 20
            or (key == "to" and not values)
            or not all(map(valid_mailbox, values))
        ):
            raise ValueError("Invalid recipients")
    subject, body = args.get("subject"), args.get("body_text")
    if (
        not isinstance(subject, str)
        or HEADER_CONTROL.search(subject)
        or len(subject.encode("utf-16-le")) // 2 > 200
    ):
        raise ValueError("Invalid subject")
    if not isinstance(body, str) or "\0" in body or len(body.encode("utf-8")) > 100000:
        raise ValueError("Invalid body")


def _send_once(request):
    # httplib2 can repeat a POST after a lost response even with num_retries=0.
    # Requests' default adapter has no retries. Also disable credential-response
    # retries and redirects so this write has exactly one transport attempt.
    with AuthorizedSession(request.http.credentials, max_refresh_attempts=0) as session:
        response = session.post(
            request.uri,
            data=request.body,
            headers=request.headers,
            timeout=HTTP_SOCKET_TIMEOUT_S,
            allow_redirects=False,
        )
        if not 200 <= response.status_code < 300:
            raise RuntimeError("Gmail send was not accepted")
        return response.json()


async def send_email(args: dict[str, Any], get_service) -> dict[str, str]:
    mailbox = os.environ.get("GMAIL_MCP_SEND_MAILBOX", "")
    try:
        if not send_enabled() or not valid_mailbox(mailbox):
            raise ValueError("Sending disabled or invalid mailbox")
        validate_email(args)
        message = EmailMessage(policy=SMTP)
        message["From"] = mailbox
        for key, header in (("to", "To"), ("cc", "Cc"), ("bcc", "Bcc")):
            if args.get(key):
                message[header] = ", ".join(args[key])
        message["Subject"] = args["subject"]
        message.set_content(args["body_text"])
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii")
        service = await get_service()
    except Exception:
        return {"status": "failed_before_send"}

    cancellation = threading.Event()
    dispatched = threading.Event()
    request_id = uuid.uuid4().hex

    def dispatch():
        try:
            # Bind the configured sender to this credential, never an inferred alias.
            profile = service.users().getProfile(userId="me").execute(num_retries=0)
            if str(profile.get("emailAddress", "")).lower() != mailbox.lower():
                return {"status": "failed_before_send"}
            request = service.users().messages().send(userId="me", body={"raw": raw})
            if cancellation.is_set():
                return {"status": "failed_before_send"}
            log("info", "send_dispatch", request_id=request_id)
            dispatched.set()
            reply = _send_once(request)
            if not all(
                isinstance(reply.get(k), str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", reply[k])
                for k in ("id", "threadId")
            ):
                return {"status": "unknown"}
            return {"status": "sent", "id": reply["id"], "threadId": reply["threadId"]}
        except Exception:
            # Do not let run_blocking log a provider exception that echoes the MIME.
            return {"status": "unknown" if dispatched.is_set() else "failed_before_send"}

    try:
        result = await run_blocking(dispatch, op="messages.send", cancellation=cancellation)
    except Exception:
        result = {"status": "unknown" if dispatched.is_set() else "failed_before_send"}
    log("info", "send_result", request_id=request_id, **result)
    return result
