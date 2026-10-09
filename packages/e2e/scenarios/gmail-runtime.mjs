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
try {
  for (const enabled of [false, true]) {
    const input = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fixture", version: "1" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ].map(request => JSON.stringify(request) + "\n").join("");
    const child = spawnSync(process.env.GMAIL_MCP_PYTHON ?? "python3.11", ["-I", "-c", bootstrap, join(runtime, "run.py")], {
      cwd: root, input, encoding: "utf8", timeout: 20000,
      env: { PATH: process.env.PATH, HOME: root, GMAIL_MCP_CONFIG_DIR: root, GMAIL_MCP_ENABLE_SEND: enabled ? "1" : "0" },
    });
    assert.equal(child.status, 0, child.error?.message ?? child.stderr);
    const responses = child.stdout.trim().split("\n").map(line => JSON.parse(line));
    const tools = responses.find(response => response.id === 2)?.result?.tools;
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
