"""A fixed curl executable with native HTTP arguments and a closed option policy."""

import ipaddress
import os
from pathlib import Path
import selectors
import socket
import subprocess
import tempfile
import time
from urllib.parse import urlsplit

from .errors import GatewayError

HOSTS = {"wttr.in", "wttr.is"}
FLAGS = {
    "--fail",
    "--fail-with-body",
    "--silent",
    "--show-error",
    "--get",
    "--head",
    "--include",
    "--compressed",
    "--globoff",
}
VALUES = {
    "--request",
    "--header",
    "--data",
    "--data-raw",
    "--data-binary",
    "--data-urlencode",
    "--url-query",
    "--user-agent",
    "--max-time",
    "--connect-timeout",
    "--url",
}
SHORT = {
    "f": "--fail",
    "s": "--silent",
    "S": "--show-error",
    "G": "--get",
    "I": "--head",
    "i": "--include",
    "g": "--globoff",
    "X": "--request",
    "H": "--header",
    "d": "--data",
    "A": "--user-agent",
    "m": "--max-time",
}


def prepare(argv, resolver=socket.getaddrinfo):
    if (
        not isinstance(argv, list)
        or not argv
        or len(argv) > 100
        or any(not isinstance(x, str) or len(x) > 65536 or "\x00" in x for x in argv)
    ):
        raise GatewayError("INVALID_REQUEST")
    normalized = []
    urls = []
    index = 0
    while index < len(argv):
        token = argv[index]
        index += 1
        if token == "--":
            urls.extend(argv[index:])
            break
        if not token.startswith("-"):
            urls.append(token)
            continue
        inline = None
        if token.startswith("--"):
            option, sep, inline = token.partition("=")
            if not sep:
                inline = None
        else:
            tail = token[1:]
            if not tail:
                raise GatewayError("POLICY_DENIED")
            while tail:
                option = SHORT.get(tail[0])
                tail = tail[1:]
                if option in FLAGS:
                    normalized.append(option)
                elif option in VALUES:
                    inline = tail or None
                    break
                else:
                    raise GatewayError("POLICY_DENIED")
            else:
                continue
        if option in FLAGS:
            if inline is not None:
                raise GatewayError("INVALID_REQUEST")
            normalized.append(option)
            continue
        if option not in VALUES:
            raise GatewayError("POLICY_DENIED")
        if inline is None:
            if index >= len(argv):
                raise GatewayError("INVALID_REQUEST")
            inline = argv[index]
            index += 1
        value = inline
        if option == "--url":
            urls.append(value)
            continue
        if option in ("--max-time", "--connect-timeout"):
            try:
                limit = float(value)
                if not 0 < limit <= (30 if option == "--max-time" else 10):
                    raise ValueError()
            except ValueError:
                raise GatewayError("POLICY_DENIED") from None
        if option == "--request" and (not value.isascii() or not value.isalpha() or len(value) > 16):
            raise GatewayError("POLICY_DENIED")
        if option in ("--header", "--user-agent"):
            if (
                value.startswith(("@", ":"))
                or any(c in value for c in "\r\n")
                or value.split(":", 1)[0].split(";", 1)[0].strip().lower() in ("host", ":authority")
            ):
                raise GatewayError("POLICY_DENIED")
        if option in ("--data", "--data-binary") and value.startswith("@") and value != "@-":
            raise GatewayError("POLICY_DENIED")
        if (
            option in ("--data-urlencode", "--url-query")
            and "@" in value
            and "=" not in value.split("@", 1)[0]
        ):
            # curl's name@filename and @filename forms read local files.
            raise GatewayError("POLICY_DENIED")
        normalized.extend([option, value])
    if len(urls) != 1:
        raise GatewayError("POLICY_DENIED")
    url = urls[0]
    try:
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or parsed.hostname not in HOSTS
            or parsed.port not in (None, 443)
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
            or any(ord(c) < 33 or ord(c) == 127 for c in url)
            or "\\" in url
        ):
            raise ValueError()
        addresses = {row[4][0] for row in resolver(parsed.hostname, 443, type=socket.SOCK_STREAM)}
        if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
            raise ValueError()
    except (ValueError, OSError):
        raise GatewayError("DESTINATION_DENIED") from None
    address = sorted(addresses)[0]
    if ":" in address:
        address = f"[{address}]"
    return [
        "-q",
        "--proto",
        "=https",
        "--proto-redir",
        "=https",
        "--noproxy",
        "*",
        "--globoff",
        "--max-time",
        "30",
        "--connect-timeout",
        "10",
        "--resolve",
        f"{parsed.hostname}:443:{address}",
        *normalized,
        "--url",
        url,
    ]


def execute(curl: Path, argv, body="", resolver=socket.getaddrinfo):
    if not isinstance(body, str) or len(body.encode()) > 1024 * 1024:
        raise GatewayError("LIMIT_EXCEEDED")
    args = prepare(argv, resolver)
    # Executable is operator-selected, never selected by request arguments.
    if not curl.is_absolute() or not curl.is_file() or not os.access(curl, os.X_OK):
        raise GatewayError("UNAVAILABLE")
    with tempfile.TemporaryDirectory(prefix="puddles-weather-") as directory:
        with tempfile.TemporaryFile() as input_file:
            input_file.write(body.encode())
            input_file.seek(0)
            process = subprocess.Popen(
                [str(curl), *args],
                stdin=input_file,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=directory,
                env={"PATH": "/usr/bin:/bin", "HOME": directory, "LANG": "en_US.UTF-8"},
            )
            selector = selectors.DefaultSelector()
            selector.register(process.stdout, selectors.EVENT_READ, "body")
            selector.register(process.stderr, selectors.EVENT_READ, "error")
            output = bytearray()
            err_size = 0
            deadline = time.monotonic() + 35
            try:
                while selector.get_map():
                    if time.monotonic() > deadline:
                        raise GatewayError("LIMIT_EXCEEDED")
                    for key, _ in selector.select(0.1):
                        block = os.read(key.fileobj.fileno(), 65536)
                        if not block:
                            selector.unregister(key.fileobj)
                            continue
                        if key.data == "body":
                            output.extend(block)
                        else:
                            err_size += len(block)
                        if len(output) > 32 * 1024 * 1024 or err_size > 65536:
                            raise GatewayError("LIMIT_EXCEEDED")
                code = process.wait(timeout=1)
                return bytes(output), code
            finally:
                selector.close()
                if process.poll() is None:
                    process.kill()
                process.wait()
                process.stdout.close()
                process.stderr.close()
