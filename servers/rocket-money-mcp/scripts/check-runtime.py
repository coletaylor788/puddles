"""Exercise an installed artifact over MCP using empty synthetic state only."""

import asyncio
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
artifact = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(artifact / "python/lib"))
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def check():
    with tempfile.TemporaryDirectory(prefix="rocket-money-installed-") as state:
        state = str(Path(state).resolve())
        params = StdioServerParameters(
            command=sys.executable,
            args=["-I", str(artifact / "python/run.py"), "--state-dir", state],
            env={"HOME": state, "PATH": "/usr/bin:/bin"},
        )
        async with stdio_client(params) as (reader, writer), ClientSession(reader, writer) as client:
            await client.initialize()
            assert len((await client.list_tools()).tools) == 5
            status = await client.call_tool("rocket_money_status", {})
            assert status.structuredContent["authentication"] == "unknown"
            read = await client.call_tool("rocket_money_read", {"query": "{viewer{id}}"})
            assert read.structuredContent["error"]["code"] == "NEEDS_USER_LOGIN"
            assert not (Path(state) / "auth/chrome").exists()
    print("Installed Rocket Money MCP: five tools, safe status, no browser or credential access")


asyncio.run(check())
