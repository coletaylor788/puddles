import base64
import json
from unittest.mock import MagicMock, patch

import pytest

from gmail_mcp.server import _get_email


def part(kind, text, charset="utf-8", **extra):
    return {
        "mimeType": kind,
        "headers": [{"name": "Content-Type", "value": f'{kind}; charset="{charset}"'}],
        "body": {"data": base64.urlsafe_b64encode(text.encode(charset)).decode().rstrip("=")},
        **extra,
    }


async def read(payload, **args):
    service = MagicMock()
    service.users.return_value.messages.return_value.get.return_value.execute.return_value = {
        "payload": {"headers": [], **payload}
    }
    with (
        patch("gmail_mcp.server.is_authenticated", return_value=True),
        patch("gmail_mcp.server.get_gmail_service", return_value=service),
    ):
        return await _get_email({"email_id": "synthetic", **args})


@pytest.mark.parametrize("plain", ["", " \n\t", None])
@pytest.mark.parametrize("format", ["readable", "text_only"])
async def test_html_fallback_is_the_only_returned_body(plain, format):
    parts = [part("text/html", "<p>Due €42<script>DROP_SCRIPT</script></p>")]
    if plain is not None:
        parts.insert(0, part("text/plain", plain))
    # Unit tests isolate MIME selection. OS containment is exercised separately.
    with patch("gmail_mcp.server.html_to_text", return_value="Due €42") as convert:
        result = await read({"mimeType": "multipart/alternative", "parts": parts}, format=format)
    convert.assert_called_once()
    payload = json.loads(result[0].text)
    assert payload["body_text"] == "Due €42"
    assert payload["format"] == "readable"
    assert "DROP" not in str(result)
    assert "body_html" not in result[0].text


async def test_prefers_plain_text_and_ignores_html_attachment():
    with patch("gmail_mcp.server.html_to_text", side_effect=AssertionError("must not parse")):
        result = await read(
            {
                "mimeType": "multipart/mixed",
                "parts": [
                    part("text/html", "ATTACHED_SOURCE", filename="example.html"),
                    {
                        "mimeType": "multipart/alternative",
                        "parts": [
                            part("text/plain", "Facts €42"),
                            part("text/html", "UNUSED_HTML"),
                        ],
                    },
                ],
            }
        )
    data = json.loads(result[0].text)
    assert data["body_text"] == "Facts €42"
    assert data["attachments"][0]["filename"] == "example.html"
    assert "ATTACHED_SOURCE" not in str(result) and "UNUSED_HTML" not in str(result)


async def test_declared_charset_and_missing_base64_padding():
    result = await read(part("text/plain", "Café €12.50", charset="windows-1252"))
    assert json.loads(result[0].text)["body_text"] == "Café €12.50"


@pytest.mark.parametrize("format", ["html_only", "full", "unknown"])
async def test_raw_formats_rejected_before_fetch(format):
    result = await read(part("text/html", "DROP_RAW"), format=format)
    assert json.loads(result[0].text) == {"error": "Only readable text is available"}


async def test_conversion_failure_drops_all_source_and_metadata():
    with patch("gmail_mcp.server.html_to_text", side_effect=RuntimeError("DROP_RAW")):
        result = await read(part("text/html", "DROP_RAW"))
    assert json.loads(result[0].text) == {"error": "Email read failed"}
    assert "DROP" not in str(result)


async def test_decode_failure_cannot_echo_body():
    result = await read({"mimeType": "text/html", "body": {"data": "_w"}})
    assert json.loads(result[0].text) == {"error": "Email read failed"}


async def test_empty_mail_remains_empty_without_raw_retry():
    result = await read({"mimeType": "multipart/alternative", "parts": []})
    assert json.loads(result[0].text)["body_text"] == ""
