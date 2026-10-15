"""Launch HTML conversion outside the credential-bearing email process."""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def html_to_text(html: str | bytes, transport_encoding: str | None = None) -> str:
    """Fail closed if parsing, containment, or the worker deadline fails."""
    try:
        source = Path(__file__).resolve().parent
        libraries = {str(source)}
        for name in ("html5lib", "six", "webencodings"):
            spec = importlib.util.find_spec(name)
            if spec is None or spec.origin is None:
                raise RuntimeError("Missing parser dependency")
            path = Path(spec.origin).resolve()
            libraries.add(
                str(path.parent.parent if spec.submodule_search_locations else path.parent)
            )
        command = [
            str(Path(sys.executable).resolve()),
            "-I",
            "-S",
            str(source / "html_worker.py"),
            json.dumps(sorted(libraries)),
        ]
        if sys.platform == "linux":
            bwrap = shutil.which("bwrap", path=os.defpath)
            if not bwrap:
                raise RuntimeError("Sandbox unavailable")
            roots = {
                Path(sys.base_prefix).resolve(),
                Path(sys.executable).resolve().parent,
                *(Path(p) for p in libraries),
            }
            roots.update(Path(p) for p in ("/usr", "/lib", "/lib64") if Path(p).exists())
            mounts = []
            for root in sorted(roots):
                if not any(other != root and other in root.parents for other in roots):
                    mounts.extend(["--ro-bind", str(root), str(root)])
            command = [
                bwrap,
                "--unshare-all",
                "--die-with-parent",
                "--new-session",
                *mounts,
                "--proc",
                "/proc",
                "--dev",
                "/dev",
                "--chdir",
                "/",
                "--",
                *command,
            ]
        elif sys.platform != "darwin":
            raise RuntimeError("Sandbox unavailable")
        if isinstance(html, str):
            html = html.encode("utf-8")
            transport_encoding = "utf-8"
        # Encoding metadata travels over the same private pipe as the source.
        worker_input = json.dumps(transport_encoding).encode("utf-8") + b"\n" + html
        completed = subprocess.run(
            command,
            input=worker_input,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env={"LANG": "C.UTF-8"},
            cwd="/",
            close_fds=True,
            timeout=10,
            check=True,
        )
        return completed.stdout.decode("utf-8")
    except Exception:
        raise RuntimeError("Email text conversion failed") from None
