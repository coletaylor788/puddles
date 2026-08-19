#!/usr/bin/env python3
"""Deploy gmail-mcp as an immutable, rollback-capable local release."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

EXPECTED_ARGS = ["-m", "gmail_mcp"]
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


def atomic_write(path: Path, content: bytes, mode: int) -> None:
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
        fsync_directory(path.parent)
    finally:
        temporary_path.unlink(missing_ok=True)


def load_config(path: Path) -> tuple[dict[str, Any], bytes, int]:
    if path.is_symlink() or not path.is_file():
        raise DeploymentError(f"config must be a regular file: {path}")
    original = path.read_bytes()
    try:
        config = json.loads(original)
    except json.JSONDecodeError as exc:
        raise DeploymentError(f"config is not valid JSON: {path}") from exc
    if not isinstance(config, dict):
        raise DeploymentError("OpenClaw config must contain a JSON object")
    mode = stat.S_IMODE(path.stat().st_mode)
    return config, original, mode


def gmail_config(config: dict[str, Any]) -> dict[str, Any]:
    try:
        plugin = config["plugins"]["entries"]["secure-gmail"]
        gmail = plugin["config"]
    except (KeyError, TypeError) as exc:
        raise DeploymentError("secure-gmail plugin config is missing") from exc
    if not isinstance(gmail, dict):
        raise DeploymentError("secure-gmail plugin config must be an object")
    return gmail


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
        self.releases = self.release_root / "releases"
        self.release = self.releases / self.revision
        self.staging: Path | None = None
        self.recovery: Path | None = None
        self.config_snapshot: Path | None = None
        self.config_mode = 0o600
        self.config_mutated = False
        self.lock_acquired = False

    def acquire_lock(self) -> None:
        self.lock_dir.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        try:
            self.lock_dir.mkdir(mode=0o700)
        except FileExistsError as exc:
            raise DeploymentError(
                f"another Gmail deployment holds {self.lock_dir}"
            ) from exc
        self.lock_acquired = True
        (self.lock_dir / "pid").write_text(f"{os.getpid()}\n")

    def release_lock(self) -> None:
        if not self.lock_acquired:
            return
        (self.lock_dir / "pid").unlink(missing_ok=True)
        self.lock_dir.rmdir()
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
            path.mkdir(parents=True, mode=0o700, exist_ok=True)
            os.chmod(path, 0o700)
        if self.releases.exists() and self.releases.is_symlink():
            raise DeploymentError(
                f"release directory must not be a symlink: {self.releases}"
            )
        self.releases.mkdir(mode=0o700, exist_ok=True)

    def candidate_python(self) -> Path:
        return self.release / ".venv" / "bin" / "python"

    def release_is_ready(self) -> bool:
        metadata_path = self.release / ".puddles-release.json"
        if not self.release.exists():
            return False
        if self.release.is_symlink() or not metadata_path.is_file():
            raise DeploymentError(f"existing release is invalid: {self.release}")
        try:
            metadata = json.loads(metadata_path.read_text())
        except json.JSONDecodeError as exc:
            raise DeploymentError(f"release metadata is invalid: {metadata_path}") from exc
        if metadata.get("revision") != self.revision or not self.candidate_python().is_file():
            raise DeploymentError(f"existing release does not match {self.revision}")
        return True

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
        source_server = self.source / "servers" / "gmail-mcp"
        shutil.copytree(
            source_server,
            self.staging,
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns(
                ".venv",
                "__pycache__",
                ".pytest_cache",
                "*.pyc",
            ),
        )
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

    def snapshot_config(self, original: bytes, gmail: dict[str, Any]) -> None:
        timestamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        self.recovery = self.backup_root / f"{timestamp}-{os.getpid()}"
        self.recovery.mkdir(mode=0o700)
        self.config_snapshot = self.recovery / "openclaw.json"
        atomic_write(self.config_snapshot, original, 0o600)
        recovery_record = {
            "revision": self.revision,
            "config": str(self.config_path),
            "previousCommand": gmail.get("gmailMcpCommand"),
            "previousArgs": gmail.get("gmailMcpArgs"),
            "previousCwd": gmail.get("gmailMcpCwd"),
            "candidateRelease": str(self.release),
        }
        atomic_write(
            self.recovery / "recovery.json",
            f"{json.dumps(recovery_record, indent=2)}\n".encode(),
            0o600,
        )
        print(f"Recovery state: {self.recovery}")

    def write_candidate_config(self, config: dict[str, Any]) -> None:
        gmail = gmail_config(config)
        gmail["gmailMcpCommand"] = str(self.candidate_python())
        gmail["gmailMcpArgs"] = EXPECTED_ARGS
        gmail["gmailMcpCwd"] = str(self.release)
        atomic_write(
            self.config_path,
            f"{json.dumps(config, indent=2)}\n".encode(),
            self.config_mode,
        )

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

    def rollback(self) -> None:
        if self.config_snapshot is None:
            raise DeploymentError("rollback config snapshot is missing")
        original = self.config_snapshot.read_bytes()
        atomic_write(self.config_path, original, self.config_mode)
        self.restart_gateway()
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
            self.validate_source()
            self.ensure_roots()
            config, original, self.config_mode = load_config(self.config_path)
            gmail = gmail_config(config)
            self.prepare_release()
            candidate_command = str(self.candidate_python())
            if (
                gmail.get("gmailMcpCommand") == candidate_command
                and gmail.get("gmailMcpArgs") == EXPECTED_ARGS
                and gmail.get("gmailMcpCwd") == str(self.release)
            ):
                self.wait_for_gateway()
                self.smoke_candidate()
                print(f"Gmail release {self.revision} is already active and healthy")
                return
            self.wait_for_gateway()
            self.snapshot_config(original, gmail)
            with self.rollback_on_failure(previous_handlers):
                self.config_mutated = True
                self.write_candidate_config(config)
                self.restart_gateway()
                self.smoke_candidate()
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
