"""One-shot, credential-free worker. Never include input in diagnostics."""

import ctypes
import json
import resource
import sys

# -I -S excludes user/site startup code. Paths come only from the trusted launcher.
sys.path[:0] = json.loads(sys.argv[1])
import webencodings  # noqa: E402
from html_text import extract_html_text  # noqa: E402


def restrict() -> None:
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    if sys.platform == "darwin":
        # Imports finish before external input is read. No filesystem access,
        # networking, child processes, or Mach services are allowed afterwards.
        sandbox = ctypes.CDLL("/usr/lib/libsandbox.1.dylib")
        sandbox.sandbox_init.argtypes = [
            ctypes.c_char_p,
            ctypes.c_uint64,
            ctypes.POINTER(ctypes.c_char_p),
        ]
        sandbox.sandbox_init.restype = ctypes.c_int
        error = ctypes.c_char_p()
        if sandbox.sandbox_init(b"(version 1)(deny default)", 0, ctypes.byref(error)):
            raise RuntimeError("Sandbox unavailable")
    elif sys.platform == "linux":
        # The launcher requires bubblewrap's filesystem/network namespaces.
        resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024,) * 2)
    else:
        raise RuntimeError("Sandbox unavailable")


if __name__ == "__main__":
    try:
        extract_html_text("")  # Load the fixed tree builder before sealing filesystem access.
        # Python loads codecs lazily. Load the fixed HTML encoding set before
        # sealing filesystem access, never based on source-controlled paths.
        for label in webencodings.LABELS:
            webencodings.lookup(label)
        restrict()
        transport_encoding = json.loads(sys.stdin.buffer.readline())
        value = sys.stdin.buffer.read()
        sys.stdout.buffer.write(extract_html_text(value, transport_encoding).encode("utf-8"))
    except BaseException:
        # Parser exceptions can quote source. The parent gets only an exit code.
        raise SystemExit(1) from None
