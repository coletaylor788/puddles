import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const runtime = resolve(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), "gmail-runtime-fixture-"));
// Tool discovery must not authenticate, start an OAuth flow, or make requests.
const bootstrap = `import runpy, socket, subprocess, sys
sys.dont_write_bytecode = True
def deny(*args, **kwargs):
    raise RuntimeError("External activity forbidden during tool discovery")
socket.socket.connect = socket.socket.connect_ex = socket.create_connection = deny
subprocess.Popen.__init__ = deny
runpy.run_path(sys.argv[1], run_name="__main__")
`;
// Keep stdin open until discovery has answered. Feeding requests to spawnSync
// closes stdin immediately, which can cancel the server's pending handlers.
// Use the MCP client shipped with the packaged server for the real handshake.
const discovery = `import json, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(sys.argv[1], "lib"))
import anyio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
async def main():
    with anyio.fail_after(15):
        params = StdioServerParameters(command=sys.executable,
            args=["-I", "-c", ${JSON.stringify(bootstrap)}, os.path.join(sys.argv[1], "run.py")],
            env=dict(os.environ), cwd=os.getcwd())
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.list_tools()
                print(result.model_dump_json(by_alias=True))
anyio.run(main)
`;
try {
  for (const enabled of [false, true]) {
    const child = spawnSync(process.env.GMAIL_MCP_PYTHON ?? "python3.11", ["-I", "-c", discovery, runtime], {
      cwd: root, encoding: "utf8", timeout: 20000,
      env: { PATH: process.env.PATH, HOME: root, GMAIL_MCP_CONFIG_DIR: root, GMAIL_MCP_ENABLE_SEND: enabled ? "1" : "0" },
    });
    assert.equal(child.status, 0, child.error?.message ?? child.stderr);
    const tools = JSON.parse(child.stdout).tools;
    assert.ok(Array.isArray(tools), "packaged MCP did not answer tool discovery");
    assert.ok(tools.some(tool => tool.name === "list_emails"));
    const send = tools.find(tool => tool.name === "send_email");
    assert.equal(Boolean(send), enabled);
    if (send) {
      assert.deepEqual(send.inputSchema.required, ["to", "subject", "body_text"]);
      assert.equal(send.inputSchema.additionalProperties, false);
      assert.equal(send.inputSchema.properties.from, undefined);
    }
  }
  console.log(JSON.stringify({ status: "passed", externalWrites: 0, checks: ["packaged-stdio", "opt-in-send", "existing-read-tools", "no-sender-override"] }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
