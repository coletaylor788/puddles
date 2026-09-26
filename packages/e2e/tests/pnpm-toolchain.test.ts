import { describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error Native toolchain helpers are also executable without TypeScript.
import { configuredPnpmStore, inspectPnpmContext, PNPM_STORE_ENV, PNPM_VERSION, requireSharedPnpmStore } from "../src/pnpm-toolchain.mjs";

describe("unified pnpm toolchain", () => {
  const configured = join(process.cwd(), ".test-pnpm-store");
  const resolved = join(configured, "v11");
  const project = () => {
    const directory = mkdtempSync(join(tmpdir(), "pnpm-toolchain-test-"));
    writeFileSync(join(directory, "package.json"), JSON.stringify({
      packageManager:
        "pnpm@12.3.4+sha512.961aa41fb077da3a04a441d9f8e15ebc0c96da8ef710b2eb67bf9ee7cb0610eabd48f1fd85f51cffe73846785fa0f87c56a3a872a1d893f8446741b5cce45457",
    }));
    writeFileSync(join(directory, "pnpm-lock.yaml"), "authoritative lock bytes\n");
    return directory;
  };

  it("requires one absolute configured store root", () => {
    expect(() => configuredPnpmStore({})).toThrow(PNPM_STORE_ENV);
    expect(() => configuredPnpmStore({ [PNPM_STORE_ENV]: "relative" })).toThrow("absolute");
    expect(configuredPnpmStore({ [PNPM_STORE_ENV]: configured })).toBe(configured);
  });

  it("accepts the exact manager and store beneath the configured root", async () => {
    const directory = project();
    const calls: Array<{ command: string; args: string[]; cwd: string; env: Record<string, string> }> = [];
    const execute = async (
      command: string,
      args: string[],
      options: { cwd: string; env: Record<string, string> },
    ) => {
      calls.push({ command, args, cwd: options.cwd, env: options.env });
      return args.includes("--version") ? PNPM_VERSION : resolved;
    };
    try {
      const manifestBefore = readFileSync(join(directory, "package.json"));
      const lockBefore = readFileSync(join(directory, "pnpm-lock.yaml"));
      const result = await inspectPnpmContext(
        directory,
        execute,
        { [PNPM_STORE_ENV]: configured },
      );
      expect(result).toEqual({
        version: PNPM_VERSION,
        configuredStoreDir: configured,
        storeDir: resolved,
      });
      expect(calls).toHaveLength(2);
      expect(calls.every((call) =>
        call.args[0] === `pnpm@${PNPM_VERSION}` &&
        call.cwd === tmpdir() &&
        call.env[PNPM_STORE_ENV] === configured &&
        call.env !== process.env)).toBe(true);
      expect(readFileSync(join(directory, "package.json"))).toEqual(manifestBefore);
      expect(readFileSync(join(directory, "pnpm-lock.yaml"))).toEqual(lockBefore);
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("leaves project manifests and locks unchanged through the real process runner", async () => {
    const directory = project();
    const bin = mkdtempSync(join(tmpdir(), "pnpm-toolchain-bin-"));
    const record = join(directory, "corepack-cwds");
    const executable = join(bin, "corepack");
    writeFileSync(executable, `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.PNPM_TEST_CWDS, process.cwd() + "\\n");
process.stdout.write(process.argv[3] === "--version" ? "${PNPM_VERSION}\\n" : process.env.PNPM_TEST_STORE + "\\n");
`);
    chmodSync(executable, 0o755);
    try {
      const manifestBefore = readFileSync(join(directory, "package.json"));
      const lockBefore = readFileSync(join(directory, "pnpm-lock.yaml"));
      await inspectPnpmContext(directory, undefined, {
        ...process.env,
        [PNPM_STORE_ENV]: configured,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        PNPM_TEST_CWDS: record,
        PNPM_TEST_STORE: resolved,
      });
      expect(readFileSync(record, "utf8").trim().split("\n")).toEqual([
        realpathSync(tmpdir()),
        realpathSync(tmpdir()),
      ]);
      expect(readFileSync(join(directory, "package.json"))).toEqual(manifestBefore);
      expect(readFileSync(join(directory, "pnpm-lock.yaml"))).toEqual(lockBefore);
    } finally {
      rmSync(directory, { recursive: true });
      rmSync(bin, { recursive: true });
    }
  });

  it("rejects version, escaped-store, and cross-context drift", async () => {
    const wrongVersion = async () => "10.31.0";
    const directory = project();
    try {
      await expect(inspectPnpmContext(
        directory,
        wrongVersion,
        { [PNPM_STORE_ENV]: configured },
      )).rejects.toThrow(PNPM_VERSION);

      let call = 0;
      const escaped = async () => ++call === 1 ? PNPM_VERSION : join(process.cwd(), "other-store");
      await expect(inspectPnpmContext(
        directory,
        escaped,
        { [PNPM_STORE_ENV]: configured },
      )).rejects.toThrow("outside");
    } finally {
      rmSync(directory, { recursive: true });
    }

    expect(() => requireSharedPnpmStore(
      { version: PNPM_VERSION, configuredStoreDir: configured, storeDir: resolved },
      { version: PNPM_VERSION, configuredStoreDir: configured, storeDir: `${resolved}-other` },
    )).toThrow("one pnpm version");
  });

  it("rejects a context without the integrity-bound package manager pin", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pnpm-toolchain-test-"));
    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "package.json"), JSON.stringify({
        packageManager: "pnpm@12.3.4",
      }));
      await expect(inspectPnpmContext(
        directory,
        async () => PNPM_VERSION,
        { [PNPM_STORE_ENV]: configured },
      )).rejects.toThrow("integrity");
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
