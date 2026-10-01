import importlib.util
import json
import multiprocessing
from pathlib import Path
import time

import pytest

from puddles_cli.config import Config
from puddles_cli.cli import dispatch
from puddles_cli.errors import GatewayError
from puddles_cli.registry import HANDLERS, register
from puddles_cli.state import account_lock, atomic_json, read_private


def config(tmp_path):
    path = tmp_path / "policy.json"
    data = {
        "version": 1,
        "stateDir": str(tmp_path / "state"),
        "curlPath": "/usr/bin/curl",
        "agents": {
            "main": {
                "tools": ["rocket_money_read", "rocket_money_write", "weather_curl"],
                "rocketMoneyAccount": "personal",
            },
            "household": {"tools": ["weather_curl"]},
        },
    }
    path.write_text(json.dumps(data))
    path.chmod(0o600)
    return Config(path)


def test_grants_offline_help_and_unknown_inputs(tmp_path):
    cfg = config(tmp_path)
    assert dispatch(cfg, "main", "rocket_money_read", {"mode": "help"})["tool"] == "rocket_money_read"
    assert not (tmp_path / "state").exists()
    for agent, tool in [("household", "rocket_money_read"), ("reader", "weather_curl"), ("", "weather_curl")]:
        with pytest.raises(GatewayError, match="POLICY_DENIED"):
            dispatch(cfg, agent, tool, {"mode": "help"})
    with pytest.raises(GatewayError):
        dispatch(cfg, "main", "rocket_money_read", {"mode": "help", "agent": "other"})


def test_extension_uses_existing_dispatch_and_grants(tmp_path):
    cfg = config(tmp_path)
    register("sample_read", lambda cfg, agent, body, rid: {"native": body["value"]})
    try:
        with pytest.raises(GatewayError):
            dispatch(cfg, "main", "sample_read", {"value": 4})
        cfg.data["agents"]["main"]["tools"].append("sample_read")
        assert dispatch(cfg, "main", "sample_read", {"value": 4}) == {"native": 4}
    finally:
        HANDLERS.pop("sample_read")


def test_private_state_symlink_and_permissions(tmp_path):
    path = tmp_path / "private" / "state.json"
    atomic_json(path, {"secret": "synthetic"})
    assert path.stat().st_mode & 0o777 == 0o600
    assert read_private(path) == {"secret": "synthetic"}
    link = tmp_path / "private" / "alias.json"
    link.symlink_to(path)
    with pytest.raises(OSError):
        read_private(link)
    path.chmod(0o644)
    with pytest.raises(GatewayError):
        read_private(path)


def hold_lock(path, ready):
    with account_lock(Path(path)):
        ready.set()
        time.sleep(0.4)


def test_account_lock_coordinates_real_processes(tmp_path):
    ready = multiprocessing.Event()
    child = multiprocessing.Process(target=hold_lock, args=(str(tmp_path), ready))
    child.start()
    try:
        assert ready.wait(3)
        with pytest.raises(GatewayError, match="BUSY"):
            with account_lock(tmp_path, timeout=0.1):
                pass
    finally:
        child.join(3)
    with account_lock(tmp_path, timeout=0.2):
        pass


def installer():
    path = Path(__file__).resolve().parents[3] / "scripts/mac-mini/cli-gateway/configure.py"
    spec = importlib.util.spec_from_file_location("install_cli_gateway", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_config_preserves_other_tools_and_seeds_rules_once(tmp_path):
    script = installer()
    config = {
        "agents": {
            "defaults": {"sandbox": {"mode": "all", "docker": {"network": "none"}}},
            "list": [
                {"id": "main", "tools": {"allow": ["read", "exec"]}, "skills": ["existing"]},
                {"id": "household", "tools": {"allow": ["read"]}, "skills": ["weather"]},
                {"id": "reader", "tools": {"allow": ["read"]}},
            ],
        },
        "tools": {"elevated": {"enabled": False}},
    }
    result = script.configure(config, Path("/opt/cli"), Path("/opt/policy"), Path("/opt/state"))
    agents = {x["id"]: x for x in result["agents"]["list"]}
    assert agents["main"]["tools"]["allow"] == [
        "read",
        "exec",
        "rocket_money_read",
        "rocket_money_write",
        "weather_curl",
    ]
    assert agents["household"]["tools"]["allow"] == ["read", "weather_curl"]
    assert "rocket_money_write" in agents["reader"]["tools"]["deny"]
    assert "rocket-money" not in agents["household"]["skills"]
    rules = tmp_path / "memory/finance/rocket-money-rules.md"
    assert script.seed_file(rules, "initial")
    rules.write_text("Cole changed this")
    assert not script.seed_file(rules, "reset")
    assert rules.read_text() == "Cole changed this"
    config["agents"]["defaults"]["sandbox"]["mode"] = "off"
    with pytest.raises(ValueError):
        script.configure(config, Path("/opt/cli"), Path("/opt/policy"), Path("/opt/state"))


@pytest.mark.parametrize("exposure", ["mount", "workspace", "docker", "host", "plugin"])
def test_installer_refuses_credential_and_host_execution_bypasses(tmp_path, exposure):
    script = installer()
    root = tmp_path / "host"
    config = {
        "agents": {
            "defaults": {"sandbox": {"mode": "all", "docker": {"network": "none"}}},
            "list": [{"id": "main"}, {"id": "household"}],
        },
        "tools": {"elevated": {"enabled": False}},
    }
    agent = config["agents"]["list"][0]
    if exposure in ("mount", "plugin"):
        agent["sandbox"] = {"docker": {"binds": [str(root) + ":/mounted:ro"]}}
    elif exposure == "workspace":
        agent["workspace"] = str(tmp_path)
    elif exposure == "docker":
        agent["sandbox"] = {"docker": {"binds": ["/var/run/docker.sock:/var/run/docker.sock"]}}
    else:
        agent["tools"] = {"exec": {"host": "gateway"}}
    with pytest.raises(ValueError):
        script.validate_boundary(config, [root / ("plugin" if exposure == "plugin" else "state")])


def test_skill_install_rejects_nested_link_and_preserves_external_file(tmp_path):
    script = installer()
    source = tmp_path / "source"
    source.mkdir()
    (source / "SKILL.md").write_text("trusted")
    target = tmp_path / "target"
    target.mkdir()
    (target / ".puddles-cli-owned").touch()
    sentinel = tmp_path / "sentinel"
    sentinel.write_text("unchanged")
    (target / "SKILL.md").symlink_to(sentinel)
    with pytest.raises(ValueError):
        script.install_skill(source, target)
    assert sentinel.read_text() == "unchanged"


def test_extension_registration_reaches_real_cli_process(tmp_path):
    import os
    import subprocess
    import sys

    cfg = config(tmp_path)
    cfg.data["agents"]["main"]["tools"].append("sample_read")
    cfg.path.write_text(json.dumps(cfg.data))
    # Synthetic installed distribution exposes a trusted entry point, not a request path.
    dist = tmp_path / "sample_provider-1.0.dist-info"
    dist.mkdir()
    (dist / "METADATA").write_text("Name: sample-provider\nVersion: 1.0\n")
    (dist / "entry_points.txt").write_text("[puddles_cli.providers]\nsample = sample_provider:install\n")
    (tmp_path / "sample_provider.py").write_text(
        "from puddles_cli.registry import register\n"
        "def install():\n    register('sample_read', lambda cfg, agent, body, rid: {'native': body['value']})\n"
    )
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "puddles_cli.cli",
            "--config",
            str(cfg.path),
            "--agent",
            "main",
            "--tool",
            "sample_read",
        ],
        input='{"value":42}',
        text=True,
        capture_output=True,
        env={**os.environ, "PYTHONPATH": str(tmp_path)},
        check=True,
    )
    assert json.loads(result.stdout) == {"native": 42}


def test_installer_stages_replacement_without_following_racing_link(tmp_path, monkeypatch):
    script = installer()
    source, target = tmp_path / "source", tmp_path / "target"
    source.mkdir()
    (source / "SKILL.md").write_text("trusted")
    script.install_skill(source, target)
    sentinel = tmp_path / "sentinel"
    sentinel.write_text("unchanged")
    original = script.directory_fd

    def swap_after_scan(path):
        (target / "SKILL.md").unlink()
        (target / "SKILL.md").symlink_to(sentinel)
        return original(path)

    monkeypatch.setattr(script, "directory_fd", swap_after_scan)
    script.install_skill(source, target)
    assert sentinel.read_text() == "unchanged"
    assert (target / "SKILL.md").read_text() == "trusted"


@pytest.mark.parametrize(
    "source", [str(Path.home() / ".docker"), "/private/var", str(Path.home() / ".orbstack")]
)
def test_mount_ancestors_cannot_expose_control_sockets(source):
    script = installer()
    config = {
        "agents": {
            "list": [
                {
                    "id": "main",
                    "sandbox": {
                        "mode": "all",
                        "docker": {"network": "none", "binds": [source + ":/mount:ro"]},
                    },
                }
            ]
        },
        "tools": {"elevated": {"enabled": False}},
    }
    with pytest.raises(ValueError):
        script.validate_boundary(config, [Path("/opt/protected-runtime")])
