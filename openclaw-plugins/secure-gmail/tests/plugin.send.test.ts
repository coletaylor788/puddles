import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const scratch = mkdtempSync(join(tmpdir(), "gmail-send-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
import plugin from "../src/plugin.js";

function register(config: Record<string, unknown> = {}) {
  const factories: any[] = [], hooks = new Map<string, any>();
  plugin.register({ pluginConfig: { gmailMcpCommand: "/unused", llmProvider: "/unused", auditLogPath: join(scratch, "audit.jsonl"), ...config },
    logger: { info() {}, warn() {}, error() {} },
    registerTool(factory: any) { factories.push(factory); },
    on(name: string, hook: any) { hooks.set(name, hook); },
  } as never);
  return { factories, hook: hooks.get("before_tool_call") };
}
const email = { to: ["a@example.com"], subject: "Hello", body_text: "Hi" };
describe("native send approval registration", () => {
  it("is disabled by default", () => {
    const { factories, hook } = register();
    expect(hook).toBeUndefined();
    expect(factories.map(f => f({ agentId: "main" }).name)).not.toContain("send_email");
  });
  it("exposes an optional send tool only to main and requests allow-once with no classifiers", () => {
    const { factories, hook } = register({ sendEnabled: true, sendMailbox: "owner@example.org" });
    const factory = factories.at(-1);
    expect(factory({ agentId: "reader" })).toBeNull();
    expect(factory({ agentId: "main" }).name).toBe("send_email");
    const result = hook({ toolName: "send_email", params: email }, { agentId: "main", requester: { senderIsOwner: true } });
    expect(result.requireApproval).toMatchObject({ timeoutMs: 600000, allowedDecisions: ["allow-once", "deny"] });
    expect(result.requireApproval.description).toContain("a@example.com");
  });
  it.each([{ agentId: "reader", requester: { senderIsOwner: true } }, { agentId: "main" }, { agentId: "main", requester: { senderIsOwner: false } }])("blocks callers without main and owner provenance", ctx => {
    const { hook } = register({ sendEnabled: true, sendMailbox: "owner@example.org" });
    expect(hook({ toolName: "send_email", params: email }, ctx).block).toBe(true);
    expect(hook({ toolName: "get_email", params: {} }, ctx)).toBeUndefined();
  });
});
