import { describe, it, expect } from "vitest";
import { stripCodeFences, parseJsonLoose } from "../src/llm-client.js";

describe("stripCodeFences", () => {
  it("returns plain text unchanged", () => {
    expect(stripCodeFences('{"detected":true}')).toBe('{"detected":true}');
  });

  it("unwraps ```json fenced JSON", () => {
    const raw = '```json\n{"detected":true,"evidence":"x"}\n```';
    expect(stripCodeFences(raw)).toBe('{"detected":true,"evidence":"x"}');
  });

  it("unwraps plain ``` fenced content", () => {
    const raw = '```\n{"detected":false}\n```';
    expect(stripCodeFences(raw)).toBe('{"detected":false}');
  });

  it("tolerates uppercase JSON tag", () => {
    const raw = '```JSON\n{"x":1}\n```';
    expect(stripCodeFences(raw)).toBe('{"x":1}');
  });

  it("unwraps fenced block surrounded by prose", () => {
    const raw = "Here's the JSON:\n```json\n{\"detected\":true}\n```\nThanks!";
    expect(stripCodeFences(raw)).toBe('{"detected":true}');
  });

  it("trims surrounding whitespace", () => {
    expect(stripCodeFences("   {\"a\":1}   ")).toBe('{"a":1}');
  });

  it("is idempotent", () => {
    const plain = '{"detected":true}';
    expect(stripCodeFences(stripCodeFences(plain))).toBe(plain);
  });
});

describe("parseJsonLoose", () => {
  it("parses plain JSON object", () => {
    expect(parseJsonLoose('{"detected":true,"evidence":"x"}')).toEqual({
      detected: true,
      evidence: "x",
    });
  });

  it("parses JSON inside ```json fences", () => {
    const raw = '```json\n{"detected":true,"evidence":"x"}\n```';
    expect(parseJsonLoose(raw)).toEqual({ detected: true, evidence: "x" });
  });

  it("parses JSON inside plain ``` fences", () => {
    const raw = '```\n{"findings":[{"secret":"sk-abc","type":"api_key"}]}\n```';
    expect(parseJsonLoose(raw)).toEqual({
      findings: [{ secret: "sk-abc", type: "api_key" }],
    });
  });

  it("parses fenced JSON with leading prose", () => {
    const raw =
      "Here's the result:\n```json\n{\"detected\":true,\"evidence\":\"y\"}\n```";
    expect(parseJsonLoose(raw)).toEqual({ detected: true, evidence: "y" });
  });

  it("parses JSON object surrounded by prose without fences", () => {
    const raw = 'Sure! {"detected":false,"evidence":""} done.';
    expect(parseJsonLoose(raw)).toEqual({ detected: false, evidence: "" });
  });

  it("parses JSON array", () => {
    expect(parseJsonLoose("[1,2,3]")).toEqual([1, 2, 3]);
  });

  it("throws on completely non-JSON response", () => {
    expect(() => parseJsonLoose("Sorry, I couldn't parse the input.")).toThrow(
      /could not extract JSON/i,
    );
  });
});
