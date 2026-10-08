import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";

it("joins interrupted native preparation before exiting and removes only its owned output", { timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "facetime-native-signal-"));
  const output = join(root, "source");
  const ready = join(root, "ready");
  const commands = join(root, "commands");
  mkdirSync(commands);
  // A process fixture blocks git init until the CLI forwards its termination signal.
  writeFileSync(join(commands, "git"), `#!${process.execPath}
require("node:fs").writeFileSync(${JSON.stringify(ready)}, "ready"); setInterval(() => {}, 1000);
`, { mode: 0o700 });
  const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../bin/facetime-native-patches.mjs");
  const child = spawn(process.execPath, [cli, output], {
    env: { ...process.env, PATH: `${commands}:${process.env.PATH}` },
    stdio: "ignore",
  });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(ready) && Date.now() < deadline) await delay(20);
    expect(existsSync(ready)).toBe(true);
    expect(existsSync(output)).toBe(true);
    child.kill("SIGTERM");
    expect(await closed).toEqual({ code: 143, signal: null });
    expect(existsSync(output)).toBe(false);
    expect(existsSync(ready)).toBe(true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await closed;
    rmSync(root, { recursive: true, force: true });
  }
});
