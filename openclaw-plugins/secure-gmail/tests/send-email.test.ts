import { afterEach, describe, expect, it, vi } from "vitest";
import { approvalSummary, createSendTool, validateEmail } from "../src/send-email.js";
import { ContentEgressGuard } from "mcp-hooks";
import { wrapMcpTool } from "../src/wrap-tool.js";

const email = { to: ["new@example.net"], cc: ["copy@example.net"], bcc: ["hidden@example.net"], subject: "Café", body_text: "Hello 世界" };
const receipt = { content: [{ type: "text", text: '{"status":"sent","id":"abc","threadId":"def"}' }] };
const setup = (guard = { check: vi.fn(async () => ({ action: "allow" as const })) }) => {
  const bridge = { callTool: vi.fn(async () => receipt) };
  const tool = createSendTool({ mailbox: "owner@example.org", guard, bridge });
  return { tool, bridge, guard };
};
afterEach(() => vi.restoreAllMocks());

describe("approved Gmail execution", () => {
  it("checks all fields then sends the exact arguments once without contact lookup", async () => {
    const { tool, bridge, guard } = setup();
    const output = await tool.execute("call", email);
    expect(output.details).toMatchObject({ status: "sent", id: "abc" });
    expect(guard.check).toHaveBeenCalledWith("send_email", JSON.stringify(email), email);
    expect(bridge.callTool).toHaveBeenCalledExactlyOnceWith("send_email", email, undefined);
  });
  it.each([
    { ...email, to: [] }, { ...email, to: ["Name <a@example.com>"] },
    { ...email, to: ["a@example.com\r\nBcc: x@example.com"] },
    { ...email, subject: "hello\r\nBcc: x@example.com" },
    { ...email, raw: "MIME" }, { ...email, approved: true },
    { ...email, body_text: "界".repeat(40000) }, { ...email, bcc: "x@example.com" },
  ])("rejects invalid input before classification or sending", async (args) => {
    const { tool, bridge, guard } = setup();
    expect((await tool.execute("call", args)).details).toMatchObject({ status: "blocked" });
    expect(guard.check).not.toHaveBeenCalled();
    expect(bridge.callTool).not.toHaveBeenCalled();
  });
  it.each(["secret", "sensitive", "outage", "malformed"])("blocks %s after approval without exposing evidence", async (mode) => {
    const guard = new ContentEgressGuard({ classify: async (_content, _prompt, opts) => {
      if (mode === "outage") throw new Error("PRIVATE_EMAIL_ECHO");
      if (mode === "malformed") return '{}';
      return JSON.stringify({ detected: opts?.label?.endsWith(mode === "secret" ? ".secrets" : ".sensitive"), evidence: "PRIVATE_EMAIL_ECHO" });
    } });
    const bridge = { callTool: vi.fn(async () => receipt) };
    const output = await createSendTool({ mailbox: "owner@example.org", guard, bridge }).execute("call", email);
    expect(output.details).toMatchObject({ status: "blocked" });
    expect(JSON.stringify(output)).not.toContain("PRIVATE_EMAIL_ECHO");
    expect(bridge.callTool).not.toHaveBeenCalled();
  });
  it("does not send if cancelled during the content check", async () => {
    const abort = new AbortController();
    const { tool, bridge } = setup({ check: vi.fn(async () => { abort.abort(); return { action: "allow" as const }; }) });
    expect((await tool.execute("call", email, abort.signal)).details).toMatchObject({ status: "cancelled" });
    expect(bridge.callTool).not.toHaveBeenCalled();
  });
  it("returns unknown without retries or raw provider data after an ambiguous call", async () => {
    const { tool, bridge } = setup();
    bridge.callTool.mockRejectedValue(new Error("PRIVATE_EMAIL_ECHO"));
    const output = await tool.execute("call", email);
    expect(output.details).toMatchObject({ status: "unknown" });
    expect(bridge.callTool).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(output)).not.toContain("PRIVATE_EMAIL_ECHO");
  });
  it("does not retain the original when ingress modifies a result", async () => {
    const tool = wrapMcpTool({ name: "read", inputSchema: { type: "object" } },
      { callTool: async () => ({ content: [{ type: "text", text: "PRIVATE_RAW" }] }) },
      { ingress: [{ name: "redactor", check: async () => ({ action: "modify", content: "safe" }) }] });
    expect(JSON.stringify(await tool.execute("call", {}))).not.toContain("PRIVATE_RAW");
  });
});

describe("approval summary", () => {
  it("shows all destinations and bounds the body preview", () => {
    const summary = approvalSummary("owner@example.org", { ...email, body_text: "x".repeat(1000) });
    for (const address of [...email.to, ...email.cc, ...email.bcc]) expect(summary).toContain(address);
    expect(summary.length).toBeLessThanOrEqual(512);
    expect(summary.endsWith("…")).toBe(true);
  });
  it("rejects a summary that would hide destinations", () => {
    expect(() => approvalSummary("owner@example.org", { ...email, to: Array(20).fill("long-mailbox@example.net") })).toThrow();
  });
  it("does not classify or reject content as part of review", () => {
    expect(approvalSummary("owner@example.org", { ...email, body_text: "A secret for review" })).toContain("A secret for review");
  });
  it("validates ordinary unicode mail", () => expect(validateEmail(email)).toEqual(email));
});
