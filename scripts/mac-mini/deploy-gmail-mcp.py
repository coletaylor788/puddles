#!/usr/bin/env python3
"""Deploy gmail-mcp as an immutable, rollback-capable local release."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import Any

EXPECTED_ARGS = ["-m", "gmail_mcp"]
GMAIL_CONFIG_KEYS = ("gmailMcpCommand", "gmailMcpArgs", "gmailMcpCwd")
MANIFEST_NAME = ".puddles-runtime-manifest.json"
PROMOTED_CONFIG_NAME = "promoted-openclaw.json"
STATE_NAME = "deployment-state.json"
REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")


def absolute_path(path: Path) -> Path:
    return Path(os.path.abspath(path.expanduser()))


class DeploymentError(RuntimeError):
    """Raised when deployment or rollback cannot complete safely."""


class DeploymentInterrupted(DeploymentError):
    """Raised when a signal interrupts deployment."""


def run(
    command: list[str],
    *,
    cwd: Path | None = None,
    capture: bool = False,
    timeout: float | None = None,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            command,
            cwd=cwd,
            check=True,
            text=True,
            capture_output=capture,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise DeploymentError(f"command timed out: {command[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or "").strip() if capture else ""
        suffix = f": {detail}" if detail else ""
        raise DeploymentError(
            f"command failed with status {exc.returncode}: {command[0]}{suffix}"
        ) from exc
    except OSError as exc:
        raise DeploymentError(f"command could not start: {command[0]}: {exc}") from exc


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def durable_mkdir(path: Path, mode: int = 0o700) -> None:
    missing: list[Path] = []
    cursor = path
    while not cursor.exists():
        if cursor.is_symlink():
            raise DeploymentError(f"directory ancestor is a broken symlink: {cursor}")
        missing.append(cursor)
        if cursor.parent == cursor:
            raise DeploymentError(f"could not find existing parent for {path}")
        cursor = cursor.parent
    if cursor.is_symlink() or not cursor.is_dir():
        raise DeploymentError(f"directory ancestor is invalid: {cursor}")
    for directory in reversed(missing):
        directory.mkdir(mode=mode)
        os.chmod(directory, mode)
        fsync_directory(directory)
        fsync_directory(directory.parent)
    if not missing:
        os.chmod(path, mode)
        fsync_directory(path)


def atomic_write(
    path: Path,
    content: bytes,
    mode: int,
    *,
    on_replaced: Callable[[], None] | None = None,
) -> None:
    descriptor, temporary = tempfile.mkstemp(
        prefix=f".{path.name}.",
        dir=path.parent,
    )
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_path, mode)
        os.replace(temporary_path, path)
        if on_replaced is not None:
            on_replaced()
        fsync_directory(path.parent)
    finally:
        temporary_path.unlink(missing_ok=True)


def parse_config(content: bytes) -> dict[str, Any]:
    try:
        config = json.loads(content)
    except json.JSONDecodeError as exc:
        raise DeploymentError("OpenClaw config is not valid JSON") from exc
    if not isinstance(config, dict):
        raise DeploymentError("OpenClaw config must contain a JSON object")
    return config


def load_config(path: Path) -> tuple[dict[str, Any], bytes, int]:
    if path.is_symlink() or not path.is_file():
        raise DeploymentError(f"config must be a regular file: {path}")
    original = path.read_bytes()
    config = parse_config(original)
    mode = stat.S_IMODE(path.stat().st_mode)
    return config, original, mode


def serialize_config(config: dict[str, Any]) -> bytes:
    return f"{json.dumps(config, indent=2)}\n".encode()


def conditional_atomic_write(
    path: Path,
    *,
    expected: bytes,
    replacement: bytes,
    mode: int,
    on_replaced: Callable[[], None] | None = None,
) -> None:
    if path.read_bytes() != expected:
        raise DeploymentError(
            "OpenClaw config changed concurrently; refusing to overwrite it"
        )
    atomic_write(path, replacement, mode, on_replaced=on_replaced)


def gmail_config(config: dict[str, Any]) -> dict[str, Any]:
    try:
        plugin = config["plugins"]["entries"]["secure-gmail"]
        gmail = plugin["config"]
    except (KeyError, TypeError) as exc:
        raise DeploymentError("secure-gmail plugin config is missing") from exc
    if not isinstance(gmail, dict):
        raise DeploymentError("secure-gmail plugin config must be an object")
    return gmail


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def runtime_manifest(root: Path) -> dict[str, str]:
    entries: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if relative.name == MANIFEST_NAME:
            continue
        if "__pycache__" in relative.parts or relative.suffix == ".pyc":
            continue
        key = relative.as_posix()
        if path.is_symlink():
            entries[key] = f"symlink:{os.readlink(path)}"
        elif path.is_file():
            entries[key] = f"sha256:{file_digest(path)}"
        elif not path.is_dir():
            raise DeploymentError(f"release contains unsupported file type: {path}")
    return entries


def fsync_file(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def fsync_tree(root: Path) -> None:
    directories = [root]
    for path in sorted(root.rglob("*")):
        if path.is_symlink():
            continue
        if path.is_file():
            fsync_file(path)
        elif path.is_dir():
            directories.append(path)
        else:
            raise DeploymentError(f"release contains unsupported file type: {path}")
    for directory in sorted(
        directories,
        key=lambda path: len(path.relative_to(root).parts),
        reverse=True,
    ):
        fsync_directory(directory)


class GmailDeployment:
    def __init__(self, args: argparse.Namespace) -> None:
        self.source = args.source.resolve()
        self.revision = args.revision
        self.config_path = absolute_path(args.config)
        self.release_root = absolute_path(args.release_root)
        self.backup_root = absolute_path(args.backup_root)
        self.lock_dir = absolute_path(args.lock_dir)
        self.python = args.python
        self.openclaw = args.openclaw
        self.gateway_port = args.gateway_port
        self.health_attempts = args.health_attempts
        self.health_interval = args.health_interval
        self.smoke_timeout = args.smoke_timeout
        self.config_lock_timeout = args.config_lock_timeout
        self.releases = self.release_root / "releases"
        self.release = self.releases / self.revision
        self.staging: Path | None = None
        self.recovery: Path | None = None
        self.config_snapshot: Path | None = None
        self.config_mode = 0o600
        self.config_mutated = False
        self.lock_acquired = False
        self.deployment_lock_nonce: str | None = None
        self.original_config: bytes | None = None
        self.promoted_config: bytes | None = None
        self.previous_gmail: dict[str, tuple[bool, Any]] = {}

    @staticmethod
    def process_is_running(pid: int) -> bool:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True

    def reclaim_dead_deployment_lock(self) -> bool:
        try:
            original = self.lock_dir.read_bytes()
            original_stat = self.lock_dir.stat()
            payload = json.loads(original)
            pid = int(payload.get("pid"))
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            return False
        if pid <= 0 or self.process_is_running(pid):
            return False
        try:
            current_stat = self.lock_dir.stat()
            if (
                current_stat.st_dev != original_stat.st_dev
                or current_stat.st_ino != original_stat.st_ino
                or self.lock_dir.read_bytes() != original
            ):
                return False
            self.lock_dir.unlink()
            fsync_directory(self.lock_dir.parent)
        except OSError:
            return False
        return True

    def reclaim_dead_config_lock(self, lock_path: Path) -> bool:
        try:
            original = lock_path.read_bytes()
            original_stat = lock_path.stat()
            payload = json.loads(original)
            pid = int(payload.get("pid"))
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            return False
        if pid <= 0 or self.process_is_running(pid):
            return False
        try:
            current_stat = lock_path.stat()
            if (
                current_stat.st_dev != original_stat.st_dev
                or current_stat.st_ino != original_stat.st_ino
                or lock_path.read_bytes() != original
            ):
                return False
            lock_path.unlink()
            fsync_directory(lock_path.parent)
        except OSError:
            return False
        return True

    @contextmanager
    def config_lock(self) -> Iterator[None]:
        lock_path = Path(f"{self.config_path}.lock")
        deadline = time.monotonic() + self.config_lock_timeout
        nonce = secrets.token_hex(16)
        payload = {
            "pid": os.getpid(),
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "nonce": nonce,
        }
        while True:
            try:
                descriptor = os.open(
                    lock_path,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o600,
                )
                break
            except FileExistsError as exc:
                if self.reclaim_dead_config_lock(lock_path):
                    continue
                if time.monotonic() >= deadline:
                    raise DeploymentError(
                        f"OpenClaw config lock is busy: {lock_path}"
                    ) from exc
                time.sleep(min(0.05, max(0.0, deadline - time.monotonic())))
        try:
            with os.fdopen(descriptor, "w") as handle:
                json.dump(payload, handle)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            fsync_directory(lock_path.parent)
            yield
        finally:
            try:
                current = json.loads(lock_path.read_text())
            except (OSError, json.JSONDecodeError) as exc:
                raise DeploymentError(
                    f"OpenClaw config lock ownership became unreadable: {lock_path}"
                ) from exc
            if current.get("pid") != os.getpid() or current.get("nonce") != nonce:
                raise DeploymentError(
                    f"OpenClaw config lock ownership changed: {lock_path}"
                )
            lock_path.unlink()
            fsync_directory(lock_path.parent)

    def acquire_lock(self) -> None:
        self.lock_dir.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        nonce = secrets.token_hex(16)
        payload = {
            "pid": os.getpid(),
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "nonce": nonce,
        }
        descriptor, temporary = tempfile.mkstemp(
            prefix=f".{self.lock_dir.name}.",
            dir=self.lock_dir.parent,
        )
        temporary_path = Path(temporary)
        try:
            with os.fdopen(descriptor, "w") as handle:
                json.dump(payload, handle)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temporary_path, 0o600)
            for attempt in range(2):
                try:
                    os.link(temporary_path, self.lock_dir)
                    break
                except FileExistsError as exc:
                    if attempt == 0 and self.reclaim_dead_deployment_lock():
                        continue
                    raise DeploymentError(
                        f"another Gmail deployment holds {self.lock_dir}"
                    ) from exc
        finally:
            temporary_path.unlink(missing_ok=True)
        self.deployment_lock_nonce = nonce
        self.lock_acquired = True
        fsync_directory(self.lock_dir.parent)

    def release_lock(self) -> None:
        if not self.lock_acquired:
            return
        try:
            payload = json.loads(self.lock_dir.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            raise DeploymentError("Gmail deployment lock became unreadable") from exc
        if (
            payload.get("pid") != os.getpid()
            or payload.get("nonce") != self.deployment_lock_nonce
        ):
            raise DeploymentError("Gmail deployment lock ownership changed")
        self.lock_dir.unlink()
        fsync_directory(self.lock_dir.parent)
        self.deployment_lock_nonce = None
        self.lock_acquired = False

    def validate_source(self) -> None:
        if not REVISION_PATTERN.fullmatch(self.revision):
            raise DeploymentError("revision must be a full lowercase commit SHA")
        server = self.source / "servers" / "gmail-mcp"
        if not server.is_dir() or server.is_symlink():
            raise DeploymentError(f"Gmail source directory is invalid: {server}")
        actual = run(
            ["git", "-C", str(self.source), "rev-parse", "HEAD"],
            capture=True,
        ).stdout.strip()
        if actual != self.revision:
            raise DeploymentError(
                f"source is at {actual}, expected reviewed revision {self.revision}"
            )
        status = run(
            ["git", "-C", str(self.source), "status", "--porcelain"],
            capture=True,
        ).stdout
        if status:
            raise DeploymentError("source worktree must be clean before deployment")

    def ensure_roots(self) -> None:
        for path in (self.release_root, self.backup_root):
            if path.exists() and path.is_symlink():
                raise DeploymentError(f"deployment root must not be a symlink: {path}")
            durable_mkdir(path)
        if self.releases.exists() and self.releases.is_symlink():
            raise DeploymentError(
                f"release directory must not be a symlink: {self.releases}"
            )
        durable_mkdir(self.releases)

    def candidate_python(self) -> Path:
        return self.release / ".venv" / "bin" / "python"

    @staticmethod
    def verify_release(release: Path, revision: str) -> None:
        metadata_path = release / ".puddles-release.json"
        manifest_path = release / MANIFEST_NAME
        if (
            release.is_symlink()
            or not metadata_path.is_file()
            or not manifest_path.is_file()
        ):
            raise DeploymentError(f"existing release is invalid: {release}")
        try:
            metadata = json.loads(metadata_path.read_text())
            recorded_manifest = json.loads(manifest_path.read_text())
        except json.JSONDecodeError as exc:
            raise DeploymentError(f"release metadata is invalid: {release}") from exc
        candidate_python = release / ".venv" / "bin" / "python"
        if metadata.get("revision") != revision or not candidate_python.is_file():
            raise DeploymentError(f"existing release does not match {revision}")
        if (
            not isinstance(recorded_manifest, dict)
            or recorded_manifest.get("revision") != revision
            or recorded_manifest.get("entries") != runtime_manifest(release)
        ):
            raise DeploymentError(f"existing release content changed: {release}")

    def release_is_ready(self) -> bool:
        if not self.release.exists():
            return False
        self.verify_release(self.release, self.revision)
        return True

    def extract_reviewed_source(self, destination: Path) -> None:
        archive_descriptor, archive_name = tempfile.mkstemp(
            prefix=f".gmail-source-{self.revision}-",
            suffix=".tar",
            dir=self.releases,
        )
        os.close(archive_descriptor)
        archive_path = Path(archive_name)
        try:
            run(
                [
                    "git",
                    "-C",
                    str(self.source),
                    "archive",
                    "--format=tar",
                    f"--output={archive_path}",
                    self.revision,
                    "servers/gmail-mcp",
                ]
            )
            with tarfile.open(archive_path, "r") as archive:
                for member in archive.getmembers():
                    parts = PurePosixPath(member.name).parts
                    if parts in (("servers",), ("servers", "gmail-mcp")):
                        continue
                    if parts[:2] != ("servers", "gmail-mcp"):
                        raise DeploymentError(
                            f"reviewed archive contains an unexpected path: {member.name}"
                        )
                    relative_parts = parts[2:]
                    if not relative_parts:
                        continue
                    if any(part in ("", ".", "..") for part in relative_parts):
                        raise DeploymentError(
                            f"reviewed archive contains an unsafe path: {member.name}"
                        )
                    target = destination.joinpath(*relative_parts)
                    if member.isdir():
                        target.mkdir(parents=True, exist_ok=True)
                        os.chmod(target, member.mode & 0o777)
                    elif member.isfile():
                        target.parent.mkdir(parents=True, exist_ok=True)
                        source_file = archive.extractfile(member)
                        if source_file is None:
                            raise DeploymentError(
                                f"could not read reviewed file: {member.name}"
                            )
                        with source_file, target.open("xb") as destination_file:
                            shutil.copyfileobj(source_file, destination_file)
                        os.chmod(target, member.mode & 0o777)
                    else:
                        raise DeploymentError(
                            f"reviewed archive contains unsupported entry: {member.name}"
                        )
        finally:
            archive_path.unlink(missing_ok=True)

    def prepare_release(self) -> None:
        if self.release_is_ready():
            print(f"Reusing prepared Gmail release {self.revision}")
            return
        self.staging = Path(
            tempfile.mkdtemp(
                prefix=f".staging-{self.revision}-",
                dir=self.releases,
            )
        )
        self.extract_reviewed_source(self.staging)
        run([self.python, "-m", "venv", str(self.staging / ".venv")])
        staging_python = self.staging / ".venv" / "bin" / "python"
        if not staging_python.is_file():
            raise DeploymentError("candidate virtual environment was not created")
        run(
            [
                str(staging_python),
                "-m",
                "pip",
                "install",
                "--disable-pip-version-check",
                "--no-input",
                str(self.staging),
            ]
        )
        run(
            [
                str(staging_python),
                "-c",
                (
                    "import asyncio; "
                    "from gmail_mcp.server import list_tools; "
                    "names={tool.name for tool in asyncio.run(list_tools())}; "
                    "assert {'authenticate','list_emails','get_email'} <= names"
                ),
            ]
        )
        freeze = run(
            [str(staging_python), "-m", "pip", "freeze"],
            capture=True,
        ).stdout.splitlines()
        metadata = {
            "revision": self.revision,
            "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "packages": freeze,
        }
        atomic_write(
            self.staging / ".puddles-release.json",
            f"{json.dumps(metadata, indent=2)}\n".encode(),
            0o600,
        )
        fsync_tree(self.staging)
        manifest = {
            "revision": self.revision,
            "entries": runtime_manifest(self.staging),
        }
        atomic_write(
            self.staging / MANIFEST_NAME,
            f"{json.dumps(manifest, indent=2, sort_keys=True)}\n".encode(),
            0o600,
        )
        os.replace(self.staging, self.release)
        fsync_directory(self.releases)
        self.staging = None
        print(f"Prepared Gmail release {self.release}")

    def wait_for_gateway(self) -> None:
        for attempt in range(1, self.health_attempts + 1):
            result = subprocess.run(
                [
                    self.openclaw,
                    "gateway",
                    "health",
                    "--port",
                    str(self.gateway_port),
                ],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if result.returncode == 0:
                return
            if attempt < self.health_attempts:
                time.sleep(self.health_interval)
        raise DeploymentError(
            f"gateway did not become healthy on port {self.gateway_port}"
        )

    def restart_gateway(self) -> None:
        run([self.openclaw, "gateway", "restart"])
        self.wait_for_gateway()

    def write_recovery_state(self, phase: str) -> None:
        if self.recovery is None:
            raise DeploymentError("recovery directory is unavailable")
        state = {
            "revision": self.revision,
            "phase": phase,
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        atomic_write(
            self.recovery / STATE_NAME,
            f"{json.dumps(state, indent=2)}\n".encode(),
            0o600,
        )

    def snapshot_config(self, original: bytes, gmail: dict[str, Any]) -> None:
        timestamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        self.recovery = self.backup_root / f"{timestamp}-{os.getpid()}"
        durable_mkdir(self.recovery)
        self.config_snapshot = self.recovery / "openclaw.json"
        atomic_write(self.config_snapshot, original, 0o600)
        self.original_config = original
        self.previous_gmail = {
            key: (key in gmail, gmail.get(key)) for key in GMAIL_CONFIG_KEYS
        }
        recovery_record = {
            "revision": self.revision,
            "config": str(self.config_path),
            "previousGmail": {
                key: {"present": present, "value": value}
                for key, (present, value) in self.previous_gmail.items()
            },
            "candidateRelease": str(self.release),
        }
        atomic_write(
            self.recovery / "recovery.json",
            f"{json.dumps(recovery_record, indent=2)}\n".encode(),
            0o600,
        )
        self.write_recovery_state("snapshot")
        print(f"Recovery state: {self.recovery}")

    def write_candidate_config(
        self,
        config: dict[str, Any],
        *,
        expected: bytes,
    ) -> None:
        gmail = gmail_config(config)
        gmail["gmailMcpCommand"] = str(self.candidate_python())
        gmail["gmailMcpArgs"] = EXPECTED_ARGS
        gmail["gmailMcpCwd"] = str(self.release)
        candidate = serialize_config(config)
        if self.recovery is None:
            raise DeploymentError("recovery directory is unavailable")
        self.promoted_config = candidate
        atomic_write(
            self.recovery / PROMOTED_CONFIG_NAME,
            candidate,
            0o600,
        )
        self.write_recovery_state("prepared")
        previous_mask = signal.pthread_sigmask(
            signal.SIG_BLOCK,
            {signal.SIGINT, signal.SIGTERM, signal.SIGHUP},
        )

        def record_replacement() -> None:
            self.config_mutated = True

        try:
            try:
                conditional_atomic_write(
                    self.config_path,
                    expected=expected,
                    replacement=candidate,
                    mode=self.config_mode,
                    on_replaced=record_replacement,
                )
            except DeploymentError:
                if not self.config_mutated:
                    self.write_recovery_state("aborted")
                raise
            self.write_recovery_state("promoted")
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)

    def smoke_candidate(self) -> None:
        run(
            [
                str(self.candidate_python()),
                "-m",
                "gmail_mcp.scripts.production_smoke",
                "--deadline-seconds",
                str(self.smoke_timeout),
            ],
            timeout=self.smoke_timeout,
        )

    @staticmethod
    def gmail_values_match(
        gmail: dict[str, Any],
        recorded: dict[str, Any],
    ) -> bool:
        for key in GMAIL_CONFIG_KEYS:
            entry = recorded.get(key)
            if not isinstance(entry, dict) or not isinstance(entry.get("present"), bool):
                raise DeploymentError("recovery Gmail config record is invalid")
            if entry["present"]:
                if gmail.get(key) != entry.get("value"):
                    return False
            elif key in gmail:
                return False
        return True

    @staticmethod
    def restore_gmail_values(
        gmail: dict[str, Any],
        recorded: dict[str, Any],
    ) -> None:
        for key in GMAIL_CONFIG_KEYS:
            entry = recorded[key]
            if entry["present"]:
                gmail[key] = entry.get("value")
            else:
                gmail.pop(key, None)

    def find_recovery_needing_action(
        self,
    ) -> tuple[Path, dict[str, Any], Path | None] | None:
        incomplete: list[tuple[Path, dict[str, Any]]] = []
        recoveries = sorted(self.backup_root.iterdir())
        for recovery in recoveries:
            if not recovery.is_dir() or recovery.is_symlink():
                continue
            state_path = recovery / STATE_NAME
            if not state_path.is_file():
                continue
            try:
                state = json.loads(state_path.read_text())
            except json.JSONDecodeError as exc:
                raise DeploymentError(
                    f"deployment recovery state is invalid: {state_path}"
                ) from exc
            if state.get("phase") in {
                "prepared",
                "promoted",
                "restoring",
                "restoring-damaged",
            }:
                incomplete.append((recovery, state))
        if len(incomplete) > 1:
            raise DeploymentError("multiple incomplete Gmail deployments need recovery")
        if incomplete:
            recovery, state = incomplete[0]
            damaged_release = None
            if state.get("phase") == "restoring-damaged":
                try:
                    record = json.loads((recovery / "recovery.json").read_text())
                    candidate_release_value = record.get("candidateRelease")
                except (OSError, json.JSONDecodeError) as exc:
                    raise DeploymentError(
                        f"incomplete recovery record is unreadable: {recovery}"
                    ) from exc
                if not isinstance(candidate_release_value, str):
                    raise DeploymentError(
                        f"incomplete recovery metadata is invalid: {recovery}"
                    )
                damaged_release = Path(candidate_release_value)
            return recovery, state, damaged_release

        current_config = parse_config(self.config_path.read_bytes())
        current_gmail = gmail_config(current_config)
        for recovery in reversed(recoveries):
            state_path = recovery / STATE_NAME
            if not recovery.is_dir() or recovery.is_symlink() or not state_path.is_file():
                continue
            try:
                state = json.loads(state_path.read_text())
                record = json.loads((recovery / "recovery.json").read_text())
            except (OSError, json.JSONDecodeError):
                continue
            if state.get("phase") != "complete":
                continue
            candidate_release_value = record.get("candidateRelease")
            record_config = record.get("config")
            revision = state.get("revision")
            if (
                not isinstance(candidate_release_value, str)
                or not isinstance(record_config, str)
                or not isinstance(revision, str)
                or absolute_path(Path(record_config)) != self.config_path
            ):
                continue
            candidate_release = Path(candidate_release_value)
            candidate_values = {
                "gmailMcpCommand": str(
                    candidate_release / ".venv" / "bin" / "python"
                ),
                "gmailMcpArgs": EXPECTED_ARGS,
                "gmailMcpCwd": str(candidate_release),
            }
            if not all(
                current_gmail.get(key) == value
                for key, value in candidate_values.items()
            ):
                continue
            try:
                self.verify_release(candidate_release, revision)
            except DeploymentError:
                return recovery, state, candidate_release
            return None
        return None

    def mark_existing_recovery(
        self,
        recovery: Path,
        state: dict[str, Any],
        phase: str,
    ) -> None:
        updated = {
            "revision": state.get("revision"),
            "phase": phase,
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        atomic_write(
            recovery / STATE_NAME,
            f"{json.dumps(updated, indent=2)}\n".encode(),
            0o600,
        )

    def recover_incomplete_deployment(self) -> None:
        recovery_action = self.find_recovery_needing_action()
        if recovery_action is None:
            return
        recovery, state, damaged_release = recovery_action
        try:
            record = json.loads((recovery / "recovery.json").read_text())
        except (OSError, json.JSONDecodeError) as exc:
            raise DeploymentError(
                f"incomplete recovery record is unreadable: {recovery}"
            ) from exc
        record_config = record.get("config")
        candidate_release_value = record.get("candidateRelease")
        if not isinstance(record_config, str) or not isinstance(
            candidate_release_value,
            str,
        ):
            raise DeploymentError(f"incomplete recovery metadata is invalid: {recovery}")
        if absolute_path(Path(record_config)) != self.config_path:
            raise DeploymentError(
                f"incomplete recovery targets another config: {recovery}"
            )
        original_path = recovery / "openclaw.json"
        promoted_path = recovery / PROMOTED_CONFIG_NAME
        if not original_path.is_file() or not promoted_path.is_file():
            raise DeploymentError(
                f"incomplete recovery snapshots are missing: {recovery}"
            )
        original = original_path.read_bytes()
        promoted = promoted_path.read_bytes()
        previous_gmail = record.get("previousGmail")
        if not isinstance(previous_gmail, dict):
            raise DeploymentError(f"incomplete recovery metadata is invalid: {recovery}")
        candidate_release = Path(candidate_release_value)
        candidate_values = {
            "gmailMcpCommand": str(candidate_release / ".venv" / "bin" / "python"),
            "gmailMcpArgs": EXPECTED_ARGS,
            "gmailMcpCwd": str(candidate_release),
        }
        restart_needed = True
        with self.config_lock():
            current = self.config_path.read_bytes()
            replacement: bytes | None = None
            if current == promoted:
                replacement = original
                restart_needed = True
            elif current != original:
                current_config = parse_config(current)
                current_gmail = gmail_config(current_config)
                if all(
                    current_gmail.get(key) == value
                    for key, value in candidate_values.items()
                ):
                    self.restore_gmail_values(current_gmail, previous_gmail)
                    replacement = serialize_config(current_config)
                    restart_needed = True
                elif not self.gmail_values_match(current_gmail, previous_gmail):
                    raise DeploymentError(
                        "secure-gmail config changed after process death; "
                        "refusing recovery overwrite"
                    )
            if replacement is not None:
                self.mark_existing_recovery(
                    recovery,
                    state,
                    "restoring-damaged" if damaged_release is not None else "restoring",
                )
                conditional_atomic_write(
                    self.config_path,
                    expected=current,
                    replacement=replacement,
                    mode=stat.S_IMODE(self.config_path.stat().st_mode),
                )
        if restart_needed:
            self.restart_gateway()
        if damaged_release is not None and damaged_release.exists():
            quarantine = damaged_release.with_name(
                f"{damaged_release.name}.damaged-"
                f"{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{os.getpid()}"
            )
            os.replace(damaged_release, quarantine)
            fsync_directory(damaged_release.parent)
            print(f"Quarantined damaged Gmail release at {quarantine}")
        self.mark_existing_recovery(recovery, state, "recovered")
        print(f"Recovered incomplete Gmail deployment from {recovery}")

    def rollback(self) -> None:
        if (
            self.config_snapshot is None
            or self.original_config is None
            or self.promoted_config is None
        ):
            raise DeploymentError("rollback config snapshot is missing")
        with self.config_lock():
            current = self.config_path.read_bytes()
            if current == self.promoted_config:
                replacement = self.original_config
            else:
                current_config = parse_config(current)
                current_gmail = gmail_config(current_config)
                expected_candidate = {
                    "gmailMcpCommand": str(self.candidate_python()),
                    "gmailMcpArgs": EXPECTED_ARGS,
                    "gmailMcpCwd": str(self.release),
                }
                if any(
                    current_gmail.get(key) != value
                    for key, value in expected_candidate.items()
                ):
                    raise DeploymentError(
                        "secure-gmail config changed concurrently; "
                        "refusing rollback overwrite"
                    )
                for key, (present, value) in self.previous_gmail.items():
                    if present:
                        current_gmail[key] = value
                    else:
                        current_gmail.pop(key, None)
                replacement = serialize_config(current_config)
            conditional_atomic_write(
                self.config_path,
                expected=current,
                replacement=replacement,
                mode=self.config_mode,
            )
        self.restart_gateway()
        self.write_recovery_state("rolled-back")
        self.config_mutated = False

    @contextmanager
    def rollback_on_failure(self, previous_handlers: dict[int, Any]) -> Iterator[None]:
        try:
            yield
        finally:
            deployment_error = sys.exc_info()[1]
            if deployment_error is not None and self.config_mutated:
                deferred_signals: list[int] = []

                def defer_signal(signum: int, _frame: Any) -> None:
                    deferred_signals.append(signum)

                for signum in previous_handlers:
                    signal.signal(signum, defer_signal)
                try:
                    self.rollback()
                except (DeploymentError, OSError, KeyboardInterrupt) as rollback_error:
                    raise DeploymentError(
                        f"{deployment_error}; rollback also failed: {rollback_error}"
                    ) from deployment_error
                if deferred_signals:
                    print(
                        "Rollback reached a safe state after deferred signal(s): "
                        + ", ".join(map(str, deferred_signals)),
                        file=sys.stderr,
                    )

    def deploy(self) -> None:
        self.acquire_lock()
        previous_handlers: dict[int, Any] = {}

        def interrupt(signum: int, _frame: Any) -> None:
            raise DeploymentInterrupted(f"deployment interrupted by signal {signum}")

        try:
            for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
                previous_handlers[signum] = signal.signal(signum, interrupt)
            self.ensure_roots()
            self.recover_incomplete_deployment()
            self.validate_source()
            self.prepare_release()
            self.wait_for_gateway()
            with self.rollback_on_failure(previous_handlers):
                already_active = False
                with self.config_lock():
                    config, original, self.config_mode = load_config(self.config_path)
                    gmail = gmail_config(config)
                    candidate_command = str(self.candidate_python())
                    already_active = (
                        gmail.get("gmailMcpCommand") == candidate_command
                        and gmail.get("gmailMcpArgs") == EXPECTED_ARGS
                        and gmail.get("gmailMcpCwd") == str(self.release)
                    )
                    if not already_active:
                        self.snapshot_config(original, gmail)
                        self.write_candidate_config(config, expected=original)
                if already_active:
                    self.smoke_candidate()
                    print(
                        f"Gmail release {self.revision} is already active and healthy"
                    )
                    return
                self.restart_gateway()
                self.smoke_candidate()
                self.write_recovery_state("complete")
                self.config_mutated = False
            print(f"Deployed Gmail release {self.revision}; read-only smoke passed")
        finally:
            for signum, handler in previous_handlers.items():
                signal.signal(signum, handler)
            if self.staging is not None:
                shutil.rmtree(self.staging, ignore_errors=True)
            self.release_lock()


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


def positive_float(value: str) -> float:
    parsed = float(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Deploy a reviewed gmail-mcp revision with automatic rollback",
    )
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument(
        "--config",
        type=Path,
        default=Path.home() / ".openclaw" / "openclaw.json",
    )
    parser.add_argument(
        "--release-root",
        type=Path,
        default=Path.home() / ".local" / "share" / "puddles" / "gmail-mcp",
    )
    parser.add_argument(
        "--backup-root",
        type=Path,
        default=Path.home() / ".openclaw-deploy-backups" / "gmail-mcp",
    )
    parser.add_argument(
        "--lock-dir",
        type=Path,
        default=Path.home() / ".gmail-mcp-deploy.lock",
    )
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--openclaw", default=shutil.which("openclaw") or "openclaw")
    parser.add_argument("--gateway-port", type=positive_int, default=18789)
    parser.add_argument("--health-attempts", type=positive_int, default=30)
    parser.add_argument("--health-interval", type=positive_float, default=1.0)
    parser.add_argument("--smoke-timeout", type=positive_float, default=60.0)
    parser.add_argument("--config-lock-timeout", type=positive_float, default=30.0)
    return parser.parse_args()


def main() -> int:
    try:
        GmailDeployment(parse_args()).deploy()
    except DeploymentError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
