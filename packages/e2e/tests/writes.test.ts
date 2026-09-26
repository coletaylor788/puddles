import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// OFFLINE (no gateway / no model): proves the mock write-sinks capture writes and
// NEVER touch a real system. The wrapped write-tool logic (calendar_write,
// gmail label/archive, hooks) is covered by the plugin suites, which mock their
// bridges.
const here = dirname(fileURLToPath(import.meta.url));
const mocks = join(here, "..", "mocks");
const IMSG = join(mocks, "imsg-mock.mjs");
const PIM = join(mocks, "apple-pim-mock.mjs");

describe("writes: mock write-sinks capture writes, no real side effects", () => {
  let state: string;

  function run(bin: string, args: string[]): any {
    const out = execFileSync("node", [bin, ...args], {
      env: { ...process.env, E2E_MOCK_STATE: state },
      encoding: "utf8",
    });
    return JSON.parse(out.trim().split("\n").pop() as string);
  }
  function lines(file: string): any[] {
    const p = join(state, file);
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  beforeAll(() => {
    state = mkdtempSync(join(tmpdir(), "e2e-writes-"));
  });
  afterAll(() => {
    rmSync(state, { recursive: true, force: true });
  });

  it("records an outbound message instead of sending it (no real text)", () => {
    const r = run(IMSG, ["send", "--to", "+15555550123", "--text", "hello from a test"]);
    expect(r.ok).toBe(true);
    expect(r.mock).toBe(true);
    const sends = lines("imsg-sends.jsonl");
    expect(sends.length).toBe(1);
    expect(sends[0].argv).toContain("+15555550123");
  });

  it("records reminder/calendar/contact WRITES instead of performing them", () => {
    expect(run(PIM, ["create", "--title", "E2E buy milk"]).recorded).toBe(true);
    expect(run(PIM, ["add", "--calendar", "Home", "--title", "E2E lunch"]).recorded).toBe(true);
    expect(run(PIM, ["delete", "--id", "mock-1"]).recorded).toBe(true);
    const writes = lines("apple-pim-writes.jsonl");
    expect(writes.length).toBe(3);
    expect(writes.map((w) => w.sub)).toEqual(["create", "add", "delete"]);
  });

  it("does NOT record read operations", () => {
    const before = lines("apple-pim-writes.jsonl").length;
    const r = run(PIM, ["list"]);
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.items)).toBe(true);
    expect(lines("apple-pim-writes.jsonl").length).toBe(before);
  });

  it.each([
    ["imsg", IMSG],
    ["apple-pim", PIM],
  ])("requires isolated state for the %s mock", (_name, bin) => {
    const env = { ...process.env };
    delete env.E2E_MOCK_STATE;
    const result = spawnSync("node", [bin, "status"], { env, encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("E2E_MOCK_STATE is required");
  });

  it.each([
    ["imsg", IMSG],
    ["apple-pim", PIM],
  ])("rejects unknown %s operations", (_name, bin) => {
    const result = spawnSync("node", [bin, "definitely-unknown"], {
      env: { ...process.env, E2E_MOCK_STATE: state },
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Unsupported mock");
  });
});
