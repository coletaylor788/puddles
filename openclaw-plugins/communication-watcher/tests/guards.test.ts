import { describe, it, expect, vi } from "vitest";
import { guardedText } from "../src/guards.js";

describe("sequential reader guards", () => {
  it("redacts before injection classification and never returns originals", async () => {
    const secret = "ghp_" + "a".repeat(36);
    const classify = vi.fn(async (_content, _prompt, options) => options.label === "secret-redact" ? '{"findings":[]}' : '{"detected":false,"evidence":""}');
    const output = await guardedText({ classify })(`message ${secret}`);
    expect(output).not.toContain(secret);
    expect(classify).toHaveBeenCalledTimes(2);
    for (const call of classify.mock.calls) expect(call[0]).not.toContain(secret);
  });
  it.each(['{}', 'null', '{"findings":null}', '{"findings":[{"secret":"absent","type":"api_key"}]}', '{"findings":[{"secret":"message","type":"bad prompt here"}]}'])('fails closed for invalid secret verdict %s', async verdict => {
    await expect(guardedText({ classify: async () => verdict })("message")).rejects.toThrow("unavailable");
  });
  it.each(['{}', '{"detected":"false"}', '{"detected":false}', '{"detected":false,"evidence":"","extra":"value"}'])('fails closed for invalid injection verdict %s', async verdict => {
    await expect(guardedText({ classify: async (_c, _p, opts) => opts?.label === "secret-redact" ? '{"findings":[]}' : verdict })("message")).rejects.toThrow("unavailable");
  });
  it("withholds arbitrary probe evidence and provider errors", async () => {
    await expect(guardedText({ classify: async (_c, _p, opts) => opts?.label === "secret-redact" ? '{"findings":[]}' : '{"detected":true,"evidence":"secret-payload"}' })("message")).rejects.toThrow(/^blocked$/);
    await expect(guardedText({ classify: async () => { throw new Error("secret-payload"); } })("message")).rejects.toThrow(/^unavailable$/);
  });
});
