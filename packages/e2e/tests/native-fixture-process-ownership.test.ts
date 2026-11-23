import { EventEmitter } from "node:events";
import { execFileSync } from "node:child_process";
import { expect, it, vi } from "vitest";

vi.mock("node:child_process", async importOriginal => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  execFileSync: vi.fn(),
}));
// @ts-expect-error Executable JS lifecycle helpers are tested at runtime.
import { fixtureProcessGroup, stopFixtureProcess } from "../src/native-fixture-process.mjs";

it.each([
  { foreign: false, detached: false }, { foreign: true, detached: false },
  { foreign: false, detached: true }, { foreign: true, detached: true },
])("checks a setuid descendant by its real owner ($foreign, detached=$detached)", async ({ foreign, detached }) => {
  const uid = process.getuid!();
  const pid = 43210;
  const child = Object.assign(new EventEmitter(), { pid, exitCode: null as number | null, signalCode: null });
  let running = true;
  vi.mocked(execFileSync).mockImplementation((_command, args) => {
    if (!running) return "";
    // A native setuid utility can have effective UID 0 while its real owner
    // remains the user who launched it. Model both ps fields independently.
    const realOwner = (args as string[]).at(-1)!.split(",").includes("ruid=");
    return `${pid} 1 ${pid} ${uid} S original leader\n` +
      `${pid + 1} ${pid} ${pid + Number(detached)} ${realOwner ? uid + Number(foreign) : 0} S original utility\n`;
  });
  const identity = fixtureProcessGroup(pid).find((row: { pid: number }) => row.pid === pid);
  const signals: string[] = [];
  const stopping = stopFixtureProcess({ child, identity }, { signal: (_pid: number, kind: string) => {
    signals.push(kind); running = false; child.exitCode = 0; child.emit("close");
  } });
  if (foreign) {
    await expect(stopping).rejects.toThrow("another owner");
    expect(signals).toEqual([]);
  } else {
    await stopping;
    expect(signals).toEqual(["SIGTERM"]);
  }
});
