import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLLMProvider } from "../src/load-llm-provider.js";

async function makeAdapterModule(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-hooks-loader-"));
  const file = join(dir, "adapter.mjs");
  await writeFile(file, body, "utf8");
  return file;
}

describe("loadLLMProvider", () => {
  it("instantiates the module's default export with the options", async () => {
    const file = await makeAdapterModule(`
      export default class Adapter {
        constructor(opts) { this.opts = opts; }
        async classify() { return JSON.stringify({ detected: false, evidence: "" }); }
      }
    `);
    const llm = await loadLLMProvider(file, { model: "fake-model", flag: true });
    expect((llm as unknown as { opts: Record<string, unknown> }).opts).toEqual({
      model: "fake-model",
      flag: true,
    });
    // Smoke-test the classify contract round-trips.
    await expect(llm.classify("hi", "system")).resolves.toContain("detected");
  });

  it("defaults options to an empty object when omitted", async () => {
    const file = await makeAdapterModule(`
      export default class Adapter {
        constructor(opts) { this.opts = opts; }
        async classify() { return ""; }
      }
    `);
    const llm = await loadLLMProvider(file);
    expect((llm as unknown as { opts: unknown }).opts).toEqual({});
  });

  it("throws on empty specifier", async () => {
    await expect(loadLLMProvider("")).rejects.toThrow(/empty module specifier/i);
  });

  it("throws when the module cannot be imported", async () => {
    await expect(
      loadLLMProvider("/definitely/does/not/exist-mcp-hooks-test.mjs"),
    ).rejects.toThrow(/failed to import/i);
  });

  it("throws when the module has no default export", async () => {
    const file = await makeAdapterModule(`
      export class Adapter {
        async classify() { return ""; }
      }
    `);
    await expect(loadLLMProvider(file)).rejects.toThrow(/no default export/i);
  });
});
