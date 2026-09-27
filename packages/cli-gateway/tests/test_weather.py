import json
import sys
import pytest
from puddles_cli.errors import GatewayError
from puddles_cli.weather import execute, prepare

URL = "https://wttr.in/London?format=j1"


def public(*_, **__):
    return [(None, None, None, None, ("1.1.1.1", 443))]


def test_native_options_and_pinned_destination():
    result = prepare(["-fsS", "-XGET", "-H", "Accept: application/json", URL], public)
    assert result[0] == "-q"
    assert "wttr.in:443:1.1.1.1" in result
    assert result[-1] == URL
    assert "--request" in result


@pytest.mark.parametrize(
    "args",
    [
        ["-K", "/etc/passwd", URL],
        ["--config=/etc/passwd", URL],
        ["-o", "/tmp/out", URL],
        ["-d@/etc/passwd", URL],
        ["--data-binary", "@/etc/passwd", URL],
        ["--data-urlencode", "x@/etc/passwd", URL],
        ["-H@/etc/passwd", URL],
        ["-H", "Host: evil.example", URL],
        ["-H", "x: hi\r\nHost: evil", URL],
        ["--proxy", "http://localhost:9", URL],
        ["--resolve", "wttr.in:443:127.0.0.1", URL],
        ["--connect-to", "::127.0.0.1:80", URL],
        ["-L", URL],
        ["--next", URL],
        ["-k", URL],
        [URL, "https://evil.example"],
        ["--max-time", "nan", URL],
        ["--max-time", "3000", URL],
        ["--trace", "/tmp/secret", URL],
        ["--url", "file:///etc/passwd"],
        ["https://wttr.in@evil.example"],
        ["https://evil@wttr.in"],
        ["https://wttr.in:444/"],
        ["http://wttr.in"],
        ["https://127.0.0.1/"],
        ["https://wttr.in\\@evil.example/"],
    ],
)
def test_escape_attempts(args):
    with pytest.raises(GatewayError):
        prepare(args, public)


@pytest.mark.parametrize("address", ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "192.168.0.1"])
def test_nonpublic_dns_denied(address):
    with pytest.raises(GatewayError):
        prepare([URL], lambda *a, **k: [(None, None, None, None, (address, 443))])


def test_inline_and_stdin_data():
    assert "@-" in prepare(["--data-binary", "@-", URL], public)
    assert "@literal" in prepare(["--data-raw", "@literal", URL], public)


def test_real_subprocess_body_and_clean_environment(tmp_path):
    fake = tmp_path / "curl"
    fake.write_text(
        f'#!{sys.executable}\nimport json,os,sys\nprint(json.dumps(dict(args=sys.argv[1:],input=sys.stdin.read(),secret=os.environ.get("PUDDLES_TEST_SECRET"))))\n'
    )
    fake.chmod(0o700)
    result, code = execute(fake, ["--data-binary", "@-", URL], "hello", public)
    assert code == 0
    body = json.loads(result)
    assert body["input"] == "hello"
    assert body["secret"] is None
    assert body["args"][0] == "-q"
