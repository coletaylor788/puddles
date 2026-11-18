import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const scenario = resolve(import.meta.dirname, "../scenarios/gmail-runtime.mjs");
function runtime() {
  const candidate = process.env.OPENCLAW_CANDIDATE_DIR ?? process.env.OPENCLAW_CANDIDATE;
  if (!candidate) throw new Error("An installed candidate is required");
  return join(candidate, "plugins/secure-gmail/python");
}
function discover(path: string) {
  return spawnSync(process.execPath, [scenario, path], { encoding: "utf8", timeout: 45000 });
}

it("discovers packaged Gmail tools without external activity", () => {
  const result = discover(runtime());
  expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "passed", externalWrites: 0 });
}, 50000);

for (const reject of [false, true]) it(`keeps discovery open through delayed replies and ${reject ? "surfaces errors" : "completes the handshake"}`, () => {
  const root = mkdtempSync(join(tmpdir(), "gmail-discovery-protocol-"));
  try {
    symlinkSync(join(runtime(), "lib"), join(root, "lib"));
    writeFileSync(join(root, "run.py"), `import json, os, select, sys, time
def read():
    return json.loads(sys.stdin.readline())
def reply(request, result):
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
request = read()
assert request["method"] == "initialize"
# Pipelined requests or EOF before initialization is answered are invalid.
assert not select.select([sys.stdin], [], [], 0.1)[0], "client closed or sent requests before initialization"
reply(request, {"protocolVersion": request["params"]["protocolVersion"], "capabilities": {"tools": {}}, "serverInfo": {"name": "fixture", "version": "1"}})
assert read()["method"] == "notifications/initialized"
request = read()
assert request["method"] == "tools/list"
assert not select.select([sys.stdin], [], [], 0.1)[0], "client closed before discovery answered"
if ${reject ? "True" : "False"}:
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "error": {"code": -32603, "message": "fixture discovery rejected"}}), flush=True)
else:
    tools = [{"name": "list_emails", "inputSchema": {"type": "object"}}]
    if os.environ["GMAIL_MCP_ENABLE_SEND"] == "1":
        tools.append({"name": "send_email", "inputSchema": {"type": "object", "required": ["to", "subject", "body_text"], "additionalProperties": False, "properties": {}}})
    reply(request, {"tools": tools})
sys.stdin.read()
`);
    const result = discover(root);
    if (reject) {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("fixture discovery rejected");
    } else expect(result.status, result.error?.message ?? result.stderr).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 50000);
