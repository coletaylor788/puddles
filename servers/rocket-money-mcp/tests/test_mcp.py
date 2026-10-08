import os
import sys

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


@pytest.mark.asyncio
async def test_real_stdio_mcp_schema_and_no_secret_status(tmp_path):
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "rocket_money_mcp", "--state-dir", str(tmp_path)],
        env={"PATH": os.environ["PATH"], "HOME": str(tmp_path)},
    )
    async with stdio_client(params) as (reader, writer), ClientSession(reader, writer) as client:
        await client.initialize()
        tools = (await client.list_tools()).tools
        assert len(tools) == 5
        assert all(t.inputSchema["additionalProperties"] is False for t in tools)
        result = await client.call_tool("rocket_money_status", {})
        assert result.structuredContent["authentication"] == "unknown"
        result = await client.call_tool(
            "rocket_money_read", {"query": "{viewer{id}}", "headers": {"x": "canary"}}
        )
        assert result.structuredContent["error"]["code"] == "INVALID_INPUT"
        result = await client.call_tool("rocket_money_read", {"query": "{viewer{id}}"})
        assert result.structuredContent["error"]["code"] == "NEEDS_USER_LOGIN"
        catalog = await client.read_resource("rocket-money://read-catalog")
        assert catalog.contents
