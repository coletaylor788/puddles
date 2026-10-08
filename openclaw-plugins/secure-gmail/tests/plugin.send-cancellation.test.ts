import { afterAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../src/mcp-bridge.js", () => ({ connectMcpBridge: mocks.connect }));
vi.mock("mcp-hooks", async (original) => ({
  ...await original<object>(),
  loadLLMProvider: async () => ({ classify: async () => '{"detected":false}' }),
}));
import plugin from "../src/plugin.js";

const root = mkdtempSync(join(tmpdir(), "gmail-startup-cancel-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

it("does not dispatch if the run is cancelled while the first bridge connection is pending", async () => {
  let connected!: (bridge: unknown) => void;
  mocks.connect.mockReturnValue(new Promise(resolve => { connected = resolve; }));
  const bridge = { callTool: vi.fn(), close: vi.fn() };
  let send: any;
  plugin.register({
    pluginConfig: { gmailMcpCommand: "/unused", llmProvider: "/unused", sendEnabled: true,
      sendMailbox: "owner@example.org", auditLogPath: join(root, "audit.jsonl") },
    logger: { info() {}, warn() {}, error() {} },
    registerTool(factory: any) {
      const tool = factory({ agentId: "main" });
      if (tool?.name === "send_email") send = tool;
    },
    on() {},
  } as never);
  const abort = new AbortController();
  const result = send.execute("call", { to: ["new@example.net"], subject: "Hello", body_text: "Hi" }, abort.signal);
  await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalledOnce());
  abort.abort();
  connected(bridge);
  expect((await result).details.status).not.toBe("sent");
  expect(bridge.callTool).not.toHaveBeenCalled();
});
