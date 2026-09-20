import { describe, expect, it } from "vitest";
import { join } from "node:path";
// @ts-expect-error Native toolchain helpers are also executable without TypeScript.
import { configuredPnpmStore, inspectPnpmContext, PNPM_STORE_ENV, PNPM_VERSION, requireSharedPnpmStore } from "../src/pnpm-toolchain.mjs";

describe("unified pnpm toolchain", () => {
  const configured = join(process.cwd(), ".test-pnpm-store");
  const resolved = join(configured, "v11");

  it("requires one absolute configured store root", () => {
    expect(() => configuredPnpmStore({})).toThrow(PNPM_STORE_ENV);
    expect(() => configuredPnpmStore({ [PNPM_STORE_ENV]: "relative" })).toThrow("absolute");
    expect(configuredPnpmStore({ [PNPM_STORE_ENV]: configured })).toBe(configured);
  });

  it("accepts the exact manager and store beneath the configured root", async () => {
    const calls: Array<{ command: string; args: string[]; env: Record<string, string> }> = [];
    const execute = async (
      command: string,
      args: string[],
      options: { env: Record<string, string> },
    ) => {
      calls.push({ command, args, env: options.env });
      return args.includes("--version") ? PNPM_VERSION : resolved;
    };
    const result = await inspectPnpmContext(
      process.cwd(),
      execute,
      { [PNPM_STORE_ENV]: configured },
    );
    expect(result).toEqual({
      version: PNPM_VERSION,
      configuredStoreDir: configured,
      storeDir: resolved,
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.env[PNPM_STORE_ENV] === configured)).toBe(true);
  });

  it("rejects version, escaped-store, and cross-context drift", async () => {
    const wrongVersion = async () => "10.31.0";
    await expect(inspectPnpmContext(
      process.cwd(),
      wrongVersion,
      { [PNPM_STORE_ENV]: configured },
    )).rejects.toThrow(PNPM_VERSION);

    let call = 0;
    const escaped = async () => ++call === 1 ? PNPM_VERSION : join(process.cwd(), "other-store");
    await expect(inspectPnpmContext(
      process.cwd(),
      escaped,
      { [PNPM_STORE_ENV]: configured },
    )).rejects.toThrow("outside");

    expect(() => requireSharedPnpmStore(
      { version: PNPM_VERSION, configuredStoreDir: configured, storeDir: resolved },
      { version: PNPM_VERSION, configuredStoreDir: configured, storeDir: `${resolved}-other` },
    )).toThrow("one pnpm version");
  });
});
