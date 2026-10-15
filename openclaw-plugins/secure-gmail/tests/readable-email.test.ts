import { describe, expect, it, vi } from "vitest";
import { wrapReadableEmailCaller } from "../src/readable-email.js";
import { wrapMcpTool } from "../src/wrap-tool.js";

const mail = { format: "readable", from: "sender@example.test", to: "reader@example.test",
  subject: "Synthetic", date: "2026-10-14", body_text: "Due €42 on 2026-11-01" };
const response = (value: unknown = mail) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const descriptor = { name: "get_email", inputSchema: { type: "object" as const } };

describe("readable email boundary", () => {
  it.each([undefined, "readable", "text_only"])("forces normalized server route for %s", async format => {
    const callTool = vi.fn().mockResolvedValue(response());
    const result = await wrapReadableEmailCaller({ callTool }).callTool("get_email", { email_id: "x", format, extra: "DROP_ARG" });
    expect(callTool).toHaveBeenCalledWith("get_email", { email_id: "x", format: "readable" }, undefined);
    expect(JSON.parse((result.content[0] as any).text)).toEqual(mail);
  });

  it.each(["full", "html_only", "other", null])("rejects raw/unknown format %s without fetching", async format => {
    const callTool = vi.fn();
    const result = await wrapReadableEmailCaller({ callTool }).callTool("get_email", { email_id: "x", format });
    expect(result.isError).toBe(true);
    expect(callTool).not.toHaveBeenCalled();
  });

  it.each([
    response({ ...mail, body_html: "DROP_HTML" }),
    response({ ...mail, attachments: [{ filename: "x", mime_type: "text/html", size_bytes: 1, raw: "DROP_HTML" }] }),
    response({ ...mail, body_text: { raw: "DROP_HTML" } }),
    response({ ...mail, format: "full" }),
    response({ error: "DROP_HTML" }),
    { content: [{ type: "text", text: "DROP_HTML" }] },
    { content: [{ type: "resource", resource: { text: "DROP_HTML" } }] },
    { ...response(), content: [...response().content, { type: "text", text: "DROP_HTML" }] },
    { ...response(), isError: true },
  ])("replaces unsafe or incomplete results before guards", async raw => {
    const check = vi.fn(async () => ({ action: "allow" as const }));
    const tool = wrapMcpTool(descriptor, wrapReadableEmailCaller({ callTool: vi.fn().mockResolvedValue(raw) }),
      { ingress: [{ name: "InjectionGuard", check }, { name: "SecretRedactor", check }] });
    const result = await tool.execute("id", { email_id: "x" });
    expect(JSON.stringify(result)).not.toContain("DROP_HTML");
    expect(JSON.stringify(check.mock.calls)).not.toContain("DROP_HTML");
    expect(JSON.stringify(result)).toContain("Email read failed");
  });

  it("drops raw metadata and runs both guards concurrently on identical complete text", async () => {
    const raw = { ...response(), _meta: { source: "DROP_HTML" }, structuredContent: { raw: "DROP_HTML" } };
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const input: string[] = [];
    const hooks = ["InjectionGuard", "SecretRedactor"].map(name => ({ name, check: vi.fn(async (_name: string, text: string) => {
      started.push(name); input.push(text); await gate;
      return name === "SecretRedactor" ? { action: "modify" as const, content: "Redacted facts" } : { action: "allow" as const };
    }) }));
    const tool = wrapMcpTool(descriptor, wrapReadableEmailCaller({ callTool: vi.fn().mockResolvedValue(raw) }), { ingress: hooks });
    let finished = false;
    const result = tool.execute("id", { email_id: "x" }).then(r => { finished = true; return r; });
    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(finished).toBe(false);
    expect(input[0]).toEqual(input[1]);
    expect(JSON.parse(input[0])).toEqual(mail);
    release();
    const out = await result;
    expect(JSON.stringify(out)).toContain("Redacted facts");
    expect(JSON.stringify(out)).not.toContain("DROP_HTML");
    expect(JSON.stringify(out)).not.toContain("€42");
  });

  it("preserves the full large result without new paging or truncation", async () => {
    const large = { ...mail, body_text: "Facts €42\n".repeat(40000) + "END" };
    const check = vi.fn(async () => ({ action: "allow" as const }));
    const callTool = vi.fn().mockResolvedValue(response(large));
    const tool = wrapMcpTool(descriptor, wrapReadableEmailCaller({ callTool }), { ingress: [{ name: "guard", check }] });
    const out = await tool.execute("id", { email_id: "x" });
    expect(JSON.parse((out.content[0] as any).text)).toEqual(large);
    expect(check).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("does not retry or release content when guard provider exceeds its limit", async () => {
    const callTool = vi.fn().mockResolvedValue(response());
    const tool = wrapMcpTool(descriptor, wrapReadableEmailCaller({ callTool }), {
      ingress: [{ name: "guard", check: vi.fn().mockRejectedValue(new Error("context limit")) }],
    });
    await expect(tool.execute("id", { email_id: "x" })).rejects.toThrow("context limit");
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("does not expose thrown transport diagnostics", async () => {
    const result = await wrapReadableEmailCaller({ callTool: vi.fn().mockRejectedValue(new Error("DROP_HTML")) })
      .callTool("get_email", { email_id: "x" });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).not.toContain("DROP_HTML");
  });
});
