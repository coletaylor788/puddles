import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("installed local service stop entrypoint", () => {
  function fixture({ identityHelper = true, joinHelper = true } = {}) {
    const runtime = mkdtempSync(join(tmpdir(), "installed-service-stop-"));
    roots.push(runtime);
    writeFileSync(join(runtime, "package.json"), JSON.stringify({
      name: "openclaw", type: "module", exports: { "./plugin-sdk/process-runtime": "./api.mjs" },
    }));
    const output = join(runtime, "joined.json");
    writeFileSync(join(runtime, "api.mjs"), `
      import fs from "node:fs/promises";
      ${identityHelper ? "export const requireServiceProcessIdentity = pid => ({pid,startTime:100});" : ""}
      ${joinHelper ? `export async function stopGatewayAndJoinLocalServices(stateDir,owner,timeoutMs) {
        await new Promise(resolve=>setTimeout(resolve,10));
        await fs.writeFile(${JSON.stringify(output)},JSON.stringify({stateDir,owner,timeoutMs}));
      }` : ""}
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

  it.runIf(process.platform === "darwin" || process.platform === "linux")(
    "captures and joins the predecessor gateway process group without SDK lifecycle helpers",
    async () => {
      const f = fixture({ identityHelper: false, joinHelper: false });
      const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], {
        detached: true, stdio: "ignore",
      });
      try {
        expect(child.pid).toBeTypeOf("number");
        const captured = f.run("capture", f.runtime, String(child.pid));
        expect(captured.status, captured.stderr).toBe(0);
        const owner = JSON.parse(captured.stdout);
        expect(owner.pid).toBe(child.pid);
        expect(owner.schema).toBe("puddles.openclaw-predecessor-process-groups/v1");
        expect(owner.processGroups).toHaveLength(1);
        expect(owner.processGroups[0].pid).toBe(child.pid);
        if (process.platform === "darwin") {
          const startedAt = execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(child.pid)], {
            encoding: "utf8", env: { LC_ALL: "C", TZ: "UTC" },
          }).trim();
          expect(owner.startTime).toBe(Math.floor(Date.parse(`${startedAt} UTC`) / 1000));
        } else {
          const stat = readFileSync(`/proc/${child.pid}/stat`, "utf8");
          expect(owner.startTime).toBe(Number(stat.slice(stat.lastIndexOf(")") + 1).trimStart().split(/\s+/)[19]));
        }
        child.kill("SIGTERM");
        await once(child, "exit");
        const joined = f.run("join", f.runtime, f.runtime, captured.stdout);
        expect(joined.status, joined.stderr).toBe(0);
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    },
  );

  it("refuses an incomplete installed lifecycle API before shutdown", () => {
    const f = fixture({ identityHelper: true, joinHelper: false });
    const result = f.run("capture", f.runtime, String(process.pid));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Installed runtime has an incomplete stopped service API");
  });

  it("rejects malformed predecessor group ownership", () => {
    const f = fixture({ identityHelper: false, joinHelper: false });
    const result = f.run("join", f.runtime, f.runtime, JSON.stringify({
      schema: "puddles.openclaw-predecessor-process-groups/v1",
      pid: process.pid,
      startTime: 1,
      processGroups: [],
    }));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid predecessor gateway process identity");
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
