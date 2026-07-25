import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { parseJsonLoose } from "../src/util.js";

describe("parseJsonLoose", () => {
  it("parses unlabelled and JSON code fences", () => {
    expect(parseJsonLoose('```\n{"ok":true}\n```')).toEqual({ ok: true });
    expect(parseJsonLoose('```json\n{"ok":true}\n```')).toEqual({ ok: true });
  });

  it("ignores non-JSON fence languages and finds the first balanced value", () => {
    expect(parseJsonLoose('```text\nignore\n```\nresult: {"ok":true}')).toEqual({
      ok: true,
    });
  });

  it("handles an unmatched fence with a large whitespace prefix", () => {
    const startedAt = performance.now();
    expect(parseJsonLoose(`\`\`\`json${" ".repeat(100_000)}{"ok":true}`)).toEqual({
      ok: true,
    });
    expect(performance.now() - startedAt).toBeLessThan(100);
  });
});
