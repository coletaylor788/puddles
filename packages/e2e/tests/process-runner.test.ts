import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("managed runner signals", () => {
  it("forwards SIGTERM to the active child before cleanup and exit", async () => {
    const state = mkdtempSync(join(tmpdir(), "e2e-signal-"));
    const marker = join(state, "cleaned");
    const child = spawn(process.execPath, ["tests/fixtures/signal-runner.mjs"], {
      cwd: join(import.meta.dirname, ".."),
      env: { ...process.env, E2E_SIGNAL_MARKER: marker },
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      await new Promise<void>((resolve, reject) => {
        let output = "";
        const timeout = setTimeout(
          () => reject(new Error("signal fixture did not start")),
          5_000,
        );
        const stdout = child.stdout;
        if (!stdout) {
          clearTimeout(timeout);
          reject(new Error("signal fixture stdout is unavailable"));
          return;
        }
        stdout.setEncoding("utf8");
        stdout.on("data", (chunk) => {
          output += chunk;
          if (output.includes("child-ready")) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.once("error", reject);
      });

      child.kill("SIGTERM");
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        child.once("exit", resolve);
        child.once("error", reject);
      });

      expect(exitCode).toBe(143);
      expect(existsSync(marker)).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
      rmSync(state, { recursive: true, force: true });
    }
  }, 10_000);
});
