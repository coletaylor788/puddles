import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("installed local service stop entrypoint", () => {
  function fixture() {
    const runtime = mkdtempSync(join(tmpdir(), "installed-service-stop-"));
    roots.push(runtime);
    writeFileSync(join(runtime, "package.json"), JSON.stringify({
      name: "openclaw", type: "module", exports: { "./plugin-sdk/process-runtime": "./api.mjs" },
    }));
    const output = join(runtime, "joined.json");
    writeFileSync(join(runtime, "api.mjs"), `
      import fs from "node:fs/promises";
      export const requireServiceProcessIdentity = pid => ({pid,startTime:100});
      export async function stopGatewayAndJoinLocalServices(stateDir,owner,timeoutMs) {
        await new Promise(resolve=>setTimeout(resolve,10));
        await fs.writeFile(${JSON.stringify(output)},JSON.stringify({stateDir,owner,timeoutMs}));
      }
    `);
    const run = (...args: string[]) => spawnSync(process.execPath,
      [resolve(import.meta.dirname, "../bin/openclaw-service-stop.mjs"), ...args],
      { encoding: "utf8" });
    return { runtime, output, run };
  }

  it("captures a generation and awaits the installed SDK join", () => {
    const f = fixture();
    const captured = f.run("capture", f.runtime, "42");
    expect(captured.status, captured.stderr).toBe(0);
    expect(JSON.parse(captured.stdout)).toEqual({ pid: 42, startTime: 100 });
    const joined = f.run("join", f.runtime, f.runtime, captured.stdout);
    expect(joined.status, joined.stderr).toBe(0);
    expect(JSON.parse(readFileSync(f.output, "utf8"))).toEqual({
      stateDir: f.runtime, owner: { pid: 42, startTime: 100 }, timeoutMs: 30_000,
    });
  });

  it.each(["0", "-1", "NaN", "1.5"])("rejects invalid PID %s", (pid) => {
    const f = fixture();
    const result = f.run("capture", f.runtime, pid);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid gateway PID");
  });

  it("rejects malformed generation input instead of sending an unsafe signal", () => {
    const f = fixture();
    const result = f.run("join", f.runtime, f.runtime, '{"pid":0,"startTime":100}');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid gateway process identity");
  });
});
