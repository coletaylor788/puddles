import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../src/process-runner.mjs";

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

  it.runIf(process.platform === "darwin")("records RSS for a command and its detached child group", async () => {
    const state = mkdtempSync(join(tmpdir(), "e2e-resources-"));
    const receipt = join(state, "resources.json");
    try {
      await runCommand(process.execPath, ["-e", `
        const { spawn } = require("node:child_process");
        const child = spawn(process.execPath, ["-e", "const bytes = Buffer.alloc(8 * 1024 * 1024); setTimeout(() => console.log(bytes.length), 1200)"], { stdio: "ignore" });
        child.on("exit", () => process.exit(0));
      `], {
        quiet: true,
        timeoutMs: 5_000,
        resourcePath: receipt,
        resourceDiskPath: state,
        resourceProfile: {
          name: "hosted-arm",
          platform: "darwin",
          arch: "arm64",
          totalMemoryBytes: 7_000_000_000,
          logicalCpuCount: 3,
          testWorkers: 1,
        },
        resourceLabel: "node fixture",
      });
      const evidence = JSON.parse(readFileSync(receipt, "utf8"));
      expect(evidence.schema).toBe("puddles.native-command-resources/v1");
      expect(evidence.sampleCount).toBeGreaterThan(1);
      expect(evidence.peakProcessGroupRssBytes).toBeGreaterThan(8 * 1024 * 1024);
      expect(evidence.minimumFreeMemoryPercent).toBeTypeOf("number");
      expect(evidence.peakSwapUsedBytes).toBeTypeOf("number");
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  }, 10_000);

  it("preserves command and measurement failures while releasing runner state", async () => {
    const state = mkdtempSync(join(tmpdir(), "e2e-resource-failure-"));
    const blocked = join(state, "blocked");
    writeFileSync(blocked, "not a directory");
    try {
      await expect(runCommand(process.execPath, ["-e", "process.exit(7)"], {
        quiet: true,
        resourcePath: join(blocked, "resources.json"),
        resourceDiskPath: state,
        resourceProfile: {
          name: "default",
          platform: process.platform,
          arch: process.arch,
          totalMemoryBytes: 8 * 1024 ** 3,
          logicalCpuCount: 2,
        },
      })).rejects.toMatchObject({
        name: "AggregateError",
        errors: [expect.any(Error), expect.any(Error)],
      });
      await expect(runCommand(process.execPath, ["-e", "process.exit(0)"], {
        quiet: true,
      })).resolves.toBe("");
    } finally {
      rmSync(state, { recursive: true, force: true });
    }
  });
});
