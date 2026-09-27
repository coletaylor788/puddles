#!/usr/bin/env python3
"""Prepare an explicit config copy and seed selected skills. Never restart OpenClaw."""

import argparse
import json
import os
import uuid
from pathlib import Path
import shutil
import sys

REPO = Path(__file__).resolve().parents[3]
NAMES = ["rocket_money_read", "rocket_money_write", "weather_curl"]


def validate_boundary(config, protected):
    protected = [
        *protected,
        Path("/var/run"),
        Path("/run"),
        Path.home() / ".docker",
        Path.home() / ".orbstack",
        Path.home() / ".colima",
        Path.home() / ".rd",
        Path.home() / "Library/Keychains",
        Path.home() / "Library/Caches/ms-playwright",
        Path.home() / ".cache/ms-playwright",
        *config.get("plugins", {}).get("load", {}).get("paths", []),
    ]
    defaults = config.get("agents", {}).get("defaults", {})
    global_tools = config.get("tools", {})
    for agent in config.get("agents", {}).get("list", []):
        sandbox = {**defaults.get("sandbox", {}), **agent.get("sandbox", {})}
        docker = {
            **defaults.get("sandbox", {}).get("docker", {}),
            **agent.get("sandbox", {}).get("docker", {}),
        }
        tools = agent.get("tools", {})
        elevated = {**global_tools.get("elevated", {}), **tools.get("elevated", {})}
        execution = {**global_tools.get("exec", {}), **tools.get("exec", {})}
        if (
            sandbox.get("mode") != "all"
            or docker.get("network", "none") != "none"
            or elevated.get("enabled") is not False
        ):
            raise ValueError(
                "Every agent must use an offline sandbox with elevated execution disabled"
            )
        if execution.get("host", "sandbox") != "sandbox":
            raise ValueError("Host execution must not be available to agents")
        if any(
            value for key, value in docker.items() if key.startswith("dangerously")
        ) or docker.get("privileged"):
            raise ValueError("Dangerous Docker overrides require removal")
        mounts = docker.get("binds", [])
        if not isinstance(mounts, list) or any(not isinstance(m, str) for m in mounts):
            raise ValueError("Docker binds must be explicit host paths")
        exposed = [m.split(":", 1)[0] for m in mounts]
        workspace = agent.get("workspace", defaults.get("workspace"))
        if workspace:
            exposed.append(workspace)
        for raw in exposed:
            source = Path(raw).expanduser()
            if not source.is_absolute():
                raise ValueError("Cannot verify a relative or named-volume mount")
            source = source.resolve()
            if source.name in ("docker.sock", "podman.sock") or source in (
                Path("/run"),
                Path("/var/run").resolve(),
            ):
                raise ValueError("Container control sockets must not be exposed")
            for item in protected:
                target = Path(item).resolve()
                if (
                    source == target
                    or source in target.parents
                    or target in source.parents
                ):
                    raise ValueError(
                        "Agent filesystem overlaps private CLI installation or state"
                    )


def configure(source, cli_path, policy_path, invocation_dir):
    config = json.loads(json.dumps(source))
    validate_boundary(config, [cli_path, policy_path.parent, invocation_dir])
    agents = config.get("agents", {}).get("list", [])
    selected = {a.get("id"): a for a in agents if a.get("id") in ("main", "household")}
    if set(selected) != {"main", "household"}:
        raise ValueError("main and household must already exist")
    default_sandbox = config.get("agents", {}).get("defaults", {}).get("sandbox", {})
    for agent_id, agent in selected.items():
        sandbox = {**default_sandbox, **agent.get("sandbox", {})}
        docker = {
            **default_sandbox.get("docker", {}),
            **agent.get("sandbox", {}).get("docker", {}),
        }
        if sandbox.get("mode") != "all" or docker.get("network", "none") != "none":
            raise ValueError(
                f"{agent_id} requires sandbox mode=all and network=none; fix explicitly before installation"
            )
        if (
            config.get("tools", {}).get("elevated", {}).get("enabled") is not False
            and agent.get("tools", {}).get("elevated", {}).get("enabled") is not False
        ):
            raise ValueError(f"{agent_id} requires elevated execution disabled")
        allowed = NAMES if agent_id == "main" else ["weather_curl"]
        tools = agent.setdefault("tools", {})
        # Require an explicit existing allowlist; never replace a profile with inferred broad access.
        if not isinstance(tools.get("allow"), list):
            raise ValueError(f"{agent_id} needs an explicit reviewed tool allowlist")
        tools["allow"] = list(
            dict.fromkeys([n for n in tools["allow"] if n not in NAMES] + allowed)
        )
        tools["deny"] = list(
            dict.fromkeys(
                [n for n in tools.get("deny", []) if n not in allowed]
                + [n for n in NAMES if n not in allowed]
            )
        )
        proxy = tools.setdefault("sandbox", {}).setdefault("tools", {})
        proxy["alsoAllow"] = list(
            dict.fromkeys(
                [n for n in proxy.get("alsoAllow", []) if n not in NAMES] + allowed
            )
        )
        skills = agent.get("skills")
        if not isinstance(skills, list):
            raise ValueError(
                f"{agent_id} needs an explicit skill list to preserve visibility"
            )
        agent["skills"] = list(
            dict.fromkeys(
                [
                    s
                    for s in skills
                    if s not in ("rocket-money", "weather-gateway", "weather")
                ]
                + (
                    ["rocket-money", "weather-gateway"]
                    if agent_id == "main"
                    else ["weather-gateway"]
                )
            )
        )
    for agent in agents:
        if agent.get("id") in selected:
            continue
        tools = agent.setdefault("tools", {})
        tools["deny"] = list(dict.fromkeys(tools.get("deny", []) + NAMES))
        if isinstance(tools.get("allow"), list):
            tools["allow"] = [n for n in tools["allow"] if n not in NAMES]
    plugins = config.setdefault("plugins", {})
    plugins.setdefault("entries", {})["cli-gateway"] = {
        "enabled": True,
        "config": {
            "cliPath": str(cli_path),
            "configPath": str(policy_path),
            "invocationStateDir": str(invocation_dir),
        },
    }
    return config


def no_symlinks(path):
    for item in (path, *path.parents):
        if item.is_symlink():
            raise ValueError("Installer destination must not contain symlinks")


def seed_file(path, contents):
    no_symlinks(path)
    parent = directory_fd(path.parent)
    try:
        try:
            fd = os.open(
                path.name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                0o600,
                dir_fd=parent,
            )
        except FileExistsError:
            return False
        with os.fdopen(fd, "w") as out:
            out.write(contents)
        return True
    finally:
        os.close(parent)


def directory_fd(path):
    """Anchor each traversal so agent renames cannot redirect host writes."""
    path = path.absolute()
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            try:
                os.mkdir(part, mode=0o700, dir_fd=fd)
            except FileExistsError:
                pass
            child = os.open(
                part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd
            )
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def install_skill(source, destination):
    no_symlinks(destination)
    if destination.exists():
        for item in destination.rglob("*"):
            no_symlinks(item)
        if not (destination / ".puddles-cli-owned").is_file():
            raise ValueError(f"Refusing to replace unmanaged skill at {destination}")
    parent = directory_fd(destination.parent)
    staging = ".cli-stage-" + uuid.uuid4().hex
    backup = ".cli-old-" + uuid.uuid4().hex

    def copy_contents(source, fd):
        for item in source.iterdir():
            if item.is_symlink():
                raise ValueError("Skill source must not contain symlinks")
            if item.is_dir():
                os.mkdir(item.name, mode=0o700, dir_fd=fd)
                child = os.open(
                    item.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd
                )
                try:
                    copy_contents(item, child)
                finally:
                    os.close(child)
            else:
                out = os.open(
                    item.name,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                    0o600,
                    dir_fd=fd,
                )
                with os.fdopen(out, "wb") as stream:
                    stream.write(item.read_bytes())

    try:
        os.mkdir(staging, mode=0o700, dir_fd=parent)
        stage = os.open(
            staging, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent
        )
        try:
            copy_contents(source, stage)
            marker = os.open(
                ".puddles-cli-owned",
                os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                0o600,
                dir_fd=stage,
            )
            os.close(marker)
        finally:
            os.close(stage)
        try:
            os.rename(destination.name, backup, src_dir_fd=parent, dst_dir_fd=parent)
        except FileNotFoundError:
            pass
        os.rename(staging, destination.name, src_dir_fd=parent, dst_dir_fd=parent)
    finally:
        # Python's dir_fd rmtree implementation does not follow substituted links.
        for name in (staging, backup):
            try:
                shutil.rmtree(name, dir_fd=parent)
            except FileNotFoundError:
                pass
            except OSError:
                try:
                    os.unlink(name, dir_fd=parent)
                except FileNotFoundError:
                    pass
        os.close(parent)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="A new config copy, never the live input",
    )
    parser.add_argument("--install-root", type=Path, required=True)
    parser.add_argument("--plugin-dist", type=Path, required=True)
    parser.add_argument("--main-workspace", type=Path)
    parser.add_argument("--household-workspace", type=Path)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve() or args.output.exists():
        parser.error("output must be a new path separate from the input")
    no_symlinks(args.install_root)
    no_symlinks(args.output)
    root = args.install_root.resolve()
    state = root / "state"
    invocations = state / "invocations"
    for directory in (root, state, invocations):
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    policy_path = root / "policy.json"
    if policy_path.exists():
        parser.error(
            "policy already exists; review and edit it explicitly instead of overwriting"
        )
    config = configure(
        json.loads(args.input.read_text()),
        root / ".venv/bin/puddles-cli",
        policy_path,
        invocations,
    )
    validate_boundary(config, [root, args.plugin_dist.resolve()])
    paths = (
        config.setdefault("plugins", {}).setdefault("load", {}).setdefault("paths", [])
    )
    if str(args.plugin_dist.resolve()) not in paths:
        paths.append(str(args.plugin_dist.resolve()))
    policy = {
        "version": 1,
        "stateDir": str(state),
        "curlPath": "/usr/bin/curl",
        "agents": {
            "main": {"tools": NAMES, "rocketMoneyAccount": "personal"},
            "household": {"tools": ["weather_curl"]},
        },
    }
    policy_path.write_text(json.dumps(policy, indent=2) + "\n")
    policy_path.chmod(0o600)
    args.output.write_text(json.dumps(config, indent=2) + "\n")
    args.output.chmod(0o600)
    for workspace, finance in (
        (args.main_workspace, True),
        (args.household_workspace, False),
    ):
        if workspace is None:
            continue
        install_skill(
            REPO / "clis/weather/skills/weather-gateway",
            workspace / "skills/weather-gateway",
        )
        if finance:
            install_skill(
                REPO / "clis/rocket-money/skills/rocket-money",
                workspace / "skills/rocket-money",
            )
            seed_file(
                workspace / "memory/finance/rocket-money-rules.md",
                (Path(__file__).parent / "templates/rocket-money-rules.md").read_text(),
            )
    print(
        "Prepared config and optional skills. No gateway restart or account login performed."
    )


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
