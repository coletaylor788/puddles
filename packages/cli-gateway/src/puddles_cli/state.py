"""Private durable state and process-wide account serialization."""

import fcntl
import json
import os
from pathlib import Path
import stat
import tempfile
import time
from contextlib import contextmanager

from .errors import GatewayError


def private_directory(path: Path) -> Path:
    path = path.absolute()
    # Existing parents must not redirect into another tree.
    for parent in [*reversed(path.parents), path]:
        if parent.is_symlink():
            raise GatewayError("UNSAFE_STATE")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise GatewayError("UNSAFE_STATE")
    return path


def read_private(path: Path, default=None):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return default
    with os.fdopen(fd, "r") as handle:
        info = os.fstat(handle.fileno())
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or info.st_nlink != 1
            or info.st_mode & 0o077
        ):
            raise GatewayError("UNSAFE_STATE")
        if info.st_size > 16 * 1024 * 1024:
            raise GatewayError("LIMIT_EXCEEDED")
        return json.load(handle)


def atomic_json(path: Path, value):
    private_directory(path.parent)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".update-")
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(value, handle, separators=(",", ":"), allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def account_lock(directory: Path, timeout: float = 15):
    private_directory(directory)
    fd = os.open(directory / "account.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077:
            raise GatewayError("UNSAFE_STATE")
        until = time.monotonic() + timeout
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= until:
                    raise GatewayError("BUSY") from None
                time.sleep(0.05)
        yield
    finally:
        os.close(fd)
