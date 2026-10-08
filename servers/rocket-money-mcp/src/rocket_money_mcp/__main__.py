"""Stdio MCP entry point and operator-only login. Never expose login as an MCP tool."""

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from importlib.resources import files
from pathlib import Path

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import CallToolResult, Resource, TextContent, Tool

from .errors import GatewayError
from .service import TOOLS, RocketMoney, error


async def serve(directory, executable):
    server = Server("rocket-money-mcp")
    pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="rocket-money")
    service = None
    loop = asyncio.get_running_loop()

    def dispatch(name, params):
        nonlocal service
        if service is None:
            service = RocketMoney(directory, executable=executable)
        return service.call(name, params)

    @server.list_tools()
    async def list_tools():
        return [Tool(**t) for t in TOOLS]

    @server.list_resources()
    async def list_resources():
        return [
            Resource(
                uri="rocket-money://read-catalog",
                name="Rocket Money reviewed read catalog",
                mimeType="application/json",
            )
        ]

    @server.read_resource()
    async def read_resource(uri):
        if str(uri) != "rocket-money://read-catalog":
            raise ValueError("Unknown resource")
        return files("rocket_money_mcp").joinpath("resources/read-catalog.json").read_text()

    @server.call_tool(validate_input=False)
    async def call_tool(name, arguments):
        try:
            value = await loop.run_in_executor(pool, dispatch, name, arguments)
        except Exception:  # noqa: BLE001 - sanitize host/provider failures
            value = error("SERVICE_UNAVAILABLE")
        return CallToolResult(
            content=[TextContent(type="text", text=json.dumps(value))],
            structuredContent=value,
            isError=value.get("status") == "error",
        )

    try:
        async with stdio_server() as (reader, writer):
            await server.run(reader, writer, server.create_initialization_options())
    finally:
        if service:
            await loop.run_in_executor(pool, service.close)
        pool.shutdown(wait=True)


def login(directory, executable):
    service = RocketMoney(directory, executable=executable)
    try:
        service.auth.open_login(interactive=True)
        print("Sign in inside the private Chrome window. Complete any MFA there.", flush=True)
        print("Save the login in Chrome if you want Chrome to offer it on future sign-ins.", flush=True)
        until = time.monotonic() + 900
        while time.monotonic() < until:
            try:
                service.verify_identity(initial=True)
                print("Rocket Money login verified. You can close this terminal.")
                return 0
            except GatewayError as exc:
                if exc.code == "ACCOUNT_MISMATCH":
                    print("This browser is signed into a different account. No account binding was changed.")
                    return 1
                time.sleep(2)
        service.auth.mark("needs_user_login")
        print("Login was not completed. Open the shortcut again when ready.")
        return 1
    except GatewayError as exc:
        if exc.code == "BUSY":
            # Chrome's native single-instance routing focuses the already owned
            # profile. It does not open a debugging port or transfer its secrets.
            chrome = executable or "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            try:
                subprocess.run(
                    [
                        chrome,
                        "--user-data-dir=" + str(directory / "auth/chrome"),
                        "--new-window",
                        service.auth.site.home,
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=15,
                    check=True,
                )
                print("The existing private Chrome session is open. Sign in there if needed.")
                print("Your next Rocket Money request will verify the login.")
                return 0
            except (OSError, subprocess.SubprocessError):
                print("The private browser is already in use. Select its Chrome window on this desktop.")
                return 1
        print("Login unavailable: " + exc.code)
        return 1
    finally:
        service.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--chrome-executable")
    parser.add_argument("action", nargs="?", choices=["serve", "login"], default="serve")
    args = parser.parse_args()
    if not args.state_dir.is_absolute():
        parser.error("state directory must be absolute")
    os.umask(0o077)
    if args.action == "login":
        return login(args.state_dir, args.chrome_executable)
    asyncio.run(serve(args.state_dir, args.chrome_executable))
    return 0


if __name__ == "__main__":
    sys.exit(main())
