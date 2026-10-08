"""Install a desktop login launcher for an already installed, reviewed artifact."""

import argparse
import os
import shlex
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--runtime", type=Path, required=True)
parser.add_argument("--python", type=Path, required=True)
parser.add_argument("--state-dir", type=Path, required=True)
parser.add_argument("--chrome", type=Path, required=True)
parser.add_argument("--desktop", type=Path, default=Path.home() / "Desktop")
a = parser.parse_args()
for path in (a.runtime, a.python, a.state_dir, a.chrome, a.desktop):
    if not path.is_absolute():
        parser.error("paths must be absolute")
entry = a.runtime / "python/run.py"
if not entry.is_file() or not a.python.is_file() or not a.chrome.is_file():
    parser.error("the reviewed runtime, Python and Chrome must already be installed")
a.desktop.mkdir(exist_ok=True)
launcher = a.desktop / "Rocket Money Login.command"
body = (
    "#!/bin/sh\n"
    + shlex.join(
        [
            str(a.python),
            "-I",
            str(entry),
            "--state-dir",
            str(a.state_dir),
            "--chrome-executable",
            str(a.chrome),
            "login",
        ]
    )
    + "\nprintf '\nPress Return to close.'\nread answer\n"
)
if launcher.is_symlink():
    parser.error("refusing a linked desktop launcher")
fd = os.open(launcher, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o700)
with os.fdopen(fd, "w") as stream:
    stream.write(body)
launcher.chmod(0o700)
print(launcher)
