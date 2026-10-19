import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ spawn: vi.fn(), execFileSync: vi.fn() }));
vi.mock("node:child_process", () => mocked);
import { runCommand } from "../src/process-runner.mjs";

afterEach(() => vi.restoreAllMocks());

for (const target of ["group", "detached child"]) for (const disappeared of [true, false]) {
  it(`handles EPERM for a ${disappeared ? "vanished" : "live"} ${target} without waiting for an unavailable close event`, async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 424242, exitCode: null as number | null, signalCode: null,
      stdout: new PassThrough(), stderr: new PassThrough(),
    });
    const group = "424242 1 424242 S Mon Oct 19 00:00:00 2026";
    const detached = "424243 424242 424243 S Mon Oct 19 00:00:01 2026";
    let rows = [group, ...(target === "detached child" ? [detached] : [])];
    mocked.execFileSync.mockImplementation(() => rows.join("\n"));
    mocked.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.emit("data", "too much output");
        if (disappeared) { child.exitCode = 0; child.emit("close", 0, null); }
      });
      return child;
    });
    const permission = Object.assign(new Error("synthetic kill EPERM"), { code: "EPERM" });
    const kill = vi.spyOn(process, "kill").mockImplementation(pid => {
      if (target === "detached child" && pid === -child.pid) { rows = rows.filter(row => row !== group); return true; }
      if (disappeared) rows = [];
      throw permission;
    });
    const error = await runCommand("synthetic", [], { capture: true, quiet: true, maxOutputBytes: 1 })
      .catch(error => error);
    if (disappeared) expect(error.message).toBe("Command output exceeded its capture bound");
    else expect(error).toMatchObject({ name: "AggregateError", errors: expect.arrayContaining([permission]) });
    expect(kill).toHaveBeenCalledWith(target === "group" ? -424242 : 424243, "SIGKILL");
  }, 1000);
}
