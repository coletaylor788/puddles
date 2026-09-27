import argparse
import base64
import json
import os
from pathlib import Path
import sys
from importlib.resources import files

from .config import Config, exact_keys, strict_json
from .errors import GatewayError
from .policy import validate
from .rocket_money import RocketMoney
from .state import account_lock
from . import weather

MAX_INPUT = 1024 * 1024


def help_for(tool):
    result = {
        "tool": tool,
        "transport": "Authorized OpenClaw tool invokes a fixed host CLI; never use agent exec.",
        "modes": ["help"],
    }
    if tool == "weather_curl":
        result.update(
            modes=["help", "curl"],
            hosts=sorted(weather.HOSTS),
            flags=sorted(weather.FLAGS),
            valueOptions=sorted(weather.VALUES),
            example={"mode": "curl", "argv": ["-fsS", "https://wttr.in/London?format=3"]},
            restrictions="One HTTPS URL; no redirects, file/config/output paths, proxy/routing overrides, or insecure TLS. Binary bodies are base64 tool artifacts.",
        )
    else:
        modes = ["help", "graphql", "batch"]
        if tool == "rocket_money_read":
            modes += ["catalog", "status", "operation_status", "paginate"]
        result.update(
            modes=modes,
            graphql={"query": "Native GraphQL document", "variables": {}, "operationName": "optional"},
            mutations=["setTransactionCategory", "changeTransactionDate"] if tool.endswith("write") else [],
            writeControls="requestId UUID and expected current date or transactionCategoryNodeId are required. One mutation per envelope; use batch for multiple.",
            example={
                "mode": "graphql",
                "request": {"query": "query { viewer { transactionCategories { id label } } }"},
            },
        )
    return result


def paginate(client, request, caller):
    exact_keys(
        request,
        ["mode", "request", "path", "cursorVariable", "maxPages"],
        ["request", "path", "cursorVariable", "maxPages"],
    )
    path = request["path"]
    variable = request["cursorVariable"]
    budget = request["maxPages"]
    if (
        not isinstance(path, list)
        or not path
        or any(not isinstance(p, str) or not p for p in path)
        or not isinstance(variable, str)
        or not variable
        or type(budget) is not int
        or not 1 <= budget <= 20
    ):
        raise GatewayError("INVALID_REQUEST")
    envelope = dict(request["request"])
    envelope["variables"] = dict(envelope.get("variables") or {})
    pages = []
    seen = set()
    for _ in range(budget):
        page = client.execute(validate(envelope, "rocket_money_read"), caller)
        pages.append(page)
        if page.get("errors"):
            return {"pages": pages, "coverage": {"complete": False, "reason": "provider_errors"}}
        try:
            connection = page["data"]
            for key in path:
                connection = connection[key]
            info = connection["pageInfo"]
            if info["hasNextPage"] is False:
                return {"pages": pages, "coverage": {"complete": True}}
            cursor = info["endCursor"]
            if info["hasNextPage"] is not True or not isinstance(cursor, str) or not cursor or cursor in seen:
                raise ValueError()
        except (KeyError, TypeError, ValueError):
            return {"pages": pages, "coverage": {"complete": False, "reason": "invalid_page_info"}}
        seen.add(cursor)
        envelope["variables"][variable] = cursor
    return {"pages": pages, "coverage": {"complete": False, "reason": "page_limit", "nextCursor": cursor}}


def dispatch(config, agent, tool, payload, request_id=None, client_factory=RocketMoney):
    from .registry import HANDLERS

    config.authorize(agent, tool)
    if tool in HANDLERS:
        return HANDLERS[tool](config, agent, payload, request_id)
    return dispatch_builtin(config, agent, tool, payload, request_id, client_factory)


def dispatch_builtin(config, agent, tool, payload, request_id=None, client_factory=RocketMoney):
    account = config.authorize(agent, tool)
    if not isinstance(payload, dict):
        raise GatewayError("INVALID_REQUEST")
    mode = payload.get("mode", "graphql" if tool.startswith("rocket_money") else "curl")
    if mode not in help_for(tool)["modes"]:
        raise GatewayError("POLICY_DENIED")
    if mode in ("help", "catalog"):
        exact_keys(payload, ["mode"])
        return (
            help_for(tool)
            if mode == "help"
            else {
                "evidence": json.loads(
                    files("puddles_cli").joinpath("resources/read-catalog.json").read_text()
                ),
                "policy": json.loads(files("puddles_cli").joinpath("resources/read-policy.json").read_text()),
                "note": "Reduced source evidence, not full introspection or verified free-account entitlements.",
            }
        )
    if tool == "weather_curl":
        exact_keys(payload, ["mode", "argv", "stdin"], ["argv"])
        body, code = weather.execute(config.curl, payload["argv"], payload.get("stdin", ""))
        try:
            return {"body": body.decode("utf-8"), "exitCode": code}
        except UnicodeDecodeError:
            return {"bodyBase64": base64.b64encode(body).decode(), "encoding": "base64", "exitCode": code}
    if mode == "graphql":
        exact_keys(payload, ["mode", "request", "expected"], ["request"])
        allowed = validate(payload["request"], tool)
    elif mode == "batch":
        exact_keys(payload, ["mode", "requests", "expected"], ["requests"])
    elif mode == "status":
        exact_keys(payload, ["mode"])
    elif mode == "operation_status":
        exact_keys(payload, ["mode", "requestId"], ["requestId"])
    directory = config.state / "rocket-money" / account
    with account_lock(directory):
        # Recheck the on-disk grant after waiting for the account lock.
        if getattr(config, "path", None):
            config = Config(config.path)
            if (
                config.authorize(agent, tool) != account
                or config.state / "rocket-money" / account != directory
            ):
                raise GatewayError("POLICY_DENIED")
        client = client_factory(directory)
        if mode == "status":
            return client.session.status()
        if mode == "operation_status":
            return client.status(payload["requestId"], agent)
        if mode == "graphql":
            return client.execute(allowed, agent, request_id, payload.get("expected"))
        if mode == "batch":
            return client.batch(payload["requests"], tool, agent, request_id, payload.get("expected"))
        return paginate(client, payload, agent)


def main(argv=None):
    from .registry import HANDLERS, load_extensions

    load_extensions()
    parser = argparse.ArgumentParser(
        description="Puddles host integrations. Agent access is through named tools only."
    )
    parser.add_argument("--config", type=Path, required=True, help="Operator-owned policy path")
    parser.add_argument(
        "--agent", required=True, help="Trusted runtime identity, supplied by the host wrapper"
    )
    parser.add_argument(
        "--tool",
        choices=sorted({"rocket_money_read", "rocket_money_write", "weather_curl"} | HANDLERS.keys()),
        required=True,
    )
    parser.add_argument("--request-id", help="Stable write UUID recorded before invocation")
    parser.add_argument(
        "--setup", action="store_true", help="Operator-only initial browser sign-in; never exposed by tools"
    )
    args = parser.parse_args(argv)
    os.umask(0o077)
    try:
        config = Config(args.config)
        account = config.authorize(args.agent, args.tool)
        if args.setup:
            if args.tool != "rocket_money_read" or not sys.stdin.isatty():
                raise GatewayError("POLICY_DENIED")
            from .auth import BrowserSession

            directory = config.state / "rocket-money" / account
            with account_lock(directory):
                BrowserSession(directory).renew(initial=True)
            result = {"auth": "ready"}
        else:
            raw = sys.stdin.buffer.read(MAX_INPUT + 1)
            if len(raw) > MAX_INPUT:
                raise GatewayError("LIMIT_EXCEEDED")
            payload = strict_json(raw)
            result = dispatch(config, args.agent, args.tool, payload, args.request_id)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 0
    except GatewayError as error:
        print(
            json.dumps(
                {
                    "gateway_error": {
                        "code": error.code,
                        "outcome": error.outcome,
                        "requestId": args.request_id,
                    }
                }
            ),
            file=sys.stderr,
        )
        return 2
    except Exception:
        print('{"gateway_error":{"code":"INTERNAL_ERROR"}}', file=sys.stderr)
        return 3


def rmoney_main():
    return main()


def weather_main():
    return main()


if __name__ == "__main__":
    raise SystemExit(main())
