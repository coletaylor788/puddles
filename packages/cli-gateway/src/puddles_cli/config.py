import json
import os
from pathlib import Path
import stat

from .errors import GatewayError
from .registry import HANDLERS

TOOLS = {"rocket_money_read", "rocket_money_write", "weather_curl"}


def exact_keys(value, allowed, required=()):
    if not isinstance(value, dict) or set(value) - set(allowed) or set(required) - set(value):
        raise GatewayError("INVALID_REQUEST")


def strict_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise GatewayError("INVALID_REQUEST")
            result[key] = value
        return result

    try:
        return json.loads(
            raw,
            object_pairs_hook=pairs,
            parse_constant=lambda _: (_ for _ in ()).throw(GatewayError("INVALID_REQUEST")),
        )
    except (ValueError, TypeError, RecursionError):
        raise GatewayError("INVALID_REQUEST") from None


class Config:
    def __init__(self, path: Path):
        self.path = path
        for item in [path, *path.parents]:
            if item.is_symlink():
                raise GatewayError("UNSAFE_CONFIG")
            mode = item.stat()
            if mode.st_mode & 0o022 and not (mode.st_mode & stat.S_ISVTX):
                raise GatewayError("UNSAFE_CONFIG")
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd) as f:
            info = os.fstat(f.fileno())
            if info.st_uid not in (0, os.getuid()) or info.st_nlink != 1 or info.st_size > 65536:
                raise GatewayError("UNSAFE_CONFIG")
            self.data = strict_json(f.read())
        exact_keys(
            self.data,
            ["version", "stateDir", "curlPath", "agents"],
            ["version", "stateDir", "curlPath", "agents"],
        )
        if self.data["version"] != 1 or not isinstance(self.data["agents"], dict):
            raise GatewayError("UNSAFE_CONFIG")
        self.state = Path(self.data["stateDir"])
        self.curl = Path(self.data["curlPath"])
        if not self.state.is_absolute() or not self.curl.is_absolute():
            raise GatewayError("UNSAFE_CONFIG")

    def authorize(self, agent, tool):
        if not isinstance(agent, str) or tool not in TOOLS | HANDLERS.keys():
            raise GatewayError("POLICY_DENIED")
        grant = self.data["agents"].get(agent)
        if not isinstance(grant, dict) or tool not in grant.get("tools", []):
            raise GatewayError("POLICY_DENIED")
        account = grant.get("rocketMoneyAccount")
        if tool.startswith("rocket_money") and (
            not isinstance(account, str)
            or not account
            or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789_-" for c in account)
        ):
            raise GatewayError("POLICY_DENIED")
        return account
