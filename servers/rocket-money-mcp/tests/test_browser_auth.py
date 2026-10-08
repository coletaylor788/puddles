"""Real browser + HTTP cookie behavior using only a local synthetic HTTPS service."""

import ipaddress
import json
import ssl
import threading
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from playwright.sync_api import BrowserType
from puddles_browser_auth import BrowserAuth, Site
from puddles_browser_auth.state import read_private


def test_browser_http_cookie_rotation_and_restart(tmp_path, monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "fixture.local")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.now(UTC) - timedelta(minutes=1))
        .not_valid_after(datetime.now(UTC) + timedelta(hours=1))
        .add_extension(
            x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), False
        )
        .sign(key, hashes.SHA256())
    )
    certfile, keyfile = tmp_path / "cert.pem", tmp_path / "key.pem"
    certfile.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    keyfile.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
        )
    )
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            if self.path != "/":
                self.send_response(204)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Set-Cookie", "session=fixture-initial; HttpOnly; Secure; Path=/")
            self.end_headers()
            self.wfile.write(b"<html><body>Synthetic login</body></html>")

        def do_POST(self):
            requests.append(self.headers.get("Cookie", ""))
            self.rfile.read(int(self.headers["Content-Length"]))
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Set-Cookie", "session=fixture-rotated; HttpOnly; Secure; Path=/")
            self.end_headers()
            self.wfile.write(json.dumps({"data": {"ok": True}}).encode())

    http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    tls.load_cert_chain(certfile, keyfile)
    http.socket = tls.wrap_socket(http.socket, server_side=True)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    base = f"https://127.0.0.1:{http.server_port}"
    site = Site(base, base + "/api", base, (base,))
    original = BrowserType.launch_persistent_context
    launches = []

    def fixture_launch(self, path, **kwargs):
        launches.append(kwargs.copy())
        assert "--password-store=basic" in kwargs["ignore_default_args"]
        assert "--use-mock-keychain" in kwargs["ignore_default_args"]
        assert not any("remote-debugging-port" in x for x in kwargs["args"])
        # Only this synthetic self-signed fixture opts out of certificate checking.
        return original(self, path, **{**kwargs, "headless": True, "ignore_https_errors": True})

    monkeypatch.setattr(BrowserType, "launch_persistent_context", fixture_launch)
    user_chrome = Path.home() / "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    executable = str(user_chrome) if user_chrome.is_file() else None
    auth = BrowserAuth(tmp_path / "auth", site, executable=executable)
    try:
        ctx = auth.start()
        ctx.pages[0].goto(base)
        assert auth.post({"query": "fixture"}) == {"data": {"ok": True}}
        assert requests[-1] == "session=fixture-initial"
        assert ctx.cookies(base)[0]["value"] == "fixture-rotated"
        assert ctx.cookies(base)[0]["httpOnly"] is True
        auth.close()
        stored = read_private(tmp_path / "auth/session.json")
        assert stored["cookies"][0]["value"] == "fixture-rotated"
        assert (tmp_path / "auth/session.json").stat().st_mode & 0o077 == 0
        auth = BrowserAuth(tmp_path / "auth", site, executable=executable)
        auth.post({"query": "fixture"})
        assert requests[-1] == "session=fixture-rotated"
        assert len(launches) == 2
    finally:
        auth.close()
        http.shutdown()
        http.server_close()
        thread.join(timeout=5)


def test_dead_browser_releases_profile_for_next_owner(tmp_path):
    from puddles_browser_auth.state import account_lock

    class DeadContext:
        def storage_state(self):
            raise RuntimeError("dead browser")

        def close(self):
            raise RuntimeError("dead browser")

    class DeadDriver:
        def stop(self):
            raise RuntimeError("dead driver")

    site = Site("https://example.invalid", "https://example.invalid/api", "https://example.invalid", ())
    auth = BrowserAuth(tmp_path / "auth", site)
    auth.context, auth.driver = DeadContext(), DeadDriver()
    auth.lock = account_lock(auth.directory, timeout=0)
    auth.lock.__enter__()
    auth.close()
    assert auth.context is auth.driver is auth.lock is None
    with account_lock(auth.directory, timeout=0):
        pass
