import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock connectMcpBridge before importing the cache so the cache picks up the mock.
const spawnLog: Array<{ env?: Record<string, string>; cwd?: string }> = [];
let nextSpawnImpl: (() => Promise<{
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
  __triggerClose?: () => void;
}>) | null = null;

vi.mock("../src/mcp-bridge.js", () => ({
  connectMcpBridge: vi.fn(async (opts: {
    cwd?: string;
    env?: Record<string, string>;
    onClose?: () => void;
  }) => {
    spawnLog.push({ env: opts.env, cwd: opts.cwd });
    if (!nextSpawnImpl) {
      const closers: Array<() => void> = [];
      if (opts.onClose) closers.push(opts.onClose);
      const bridge = {
        callTool: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
        close: vi.fn(async () => {}),
        __triggerClose: () => closers.forEach((c) => c()),
      };
      return bridge;
    }
    const impl = nextSpawnImpl;
    nextSpawnImpl = null;
    return impl();
  }),
  McpBridge: class {},
}));

const {
  getBridge,
  shutdownAll,
  __resetCacheForTests,
  __cacheKeysForTests,
} = await import("../src/bridge-cache.js");

const baseSpec = {
  command: "node",
  args: ["/dev/null"],
};

beforeEach(() => {
  __resetCacheForTests();
  spawnLog.length = 0;
  nextSpawnImpl = null;
});

describe("bridge-cache.getBridge", () => {
  it("returns the same bridge for repeat calls with the same configDir", async () => {
    const a = await getBridge({ ...baseSpec, configDir: "/a" });
    const b = await getBridge({ ...baseSpec, configDir: "/a" });
    expect(a).toBe(b);
    expect(spawnLog).toHaveLength(1);
  });

  it("spawns separate bridges for different configDirs", async () => {
    const a = await getBridge({ ...baseSpec, configDir: "/a" });
    const b = await getBridge({ ...baseSpec, configDir: "/b" });
    expect(a).not.toBe(b);
    expect(spawnLog).toHaveLength(2);
    expect(__cacheKeysForTests().sort()).toEqual(["/a", "/b"]);
  });

  it("treats undefined configDir as the shared <default> slot", async () => {
    const a = await getBridge({ ...baseSpec });
    const b = await getBridge({ ...baseSpec });
    expect(a).toBe(b);
    expect(__cacheKeysForTests()).toEqual(["<default>"]);
  });

  it("sets APPLE_PIM_CONFIG_DIR in the spawn env when configDir is provided", async () => {
    await getBridge({ ...baseSpec, configDir: "/foo/bar" });
    expect(spawnLog[0].env?.APPLE_PIM_CONFIG_DIR).toBe("/foo/bar");
  });

  it("does NOT set APPLE_PIM_CONFIG_DIR when configDir is undefined", async () => {
    const prior = process.env.APPLE_PIM_CONFIG_DIR;
    delete process.env.APPLE_PIM_CONFIG_DIR;
    try {
      await getBridge({ ...baseSpec });
      expect(spawnLog[0].env?.APPLE_PIM_CONFIG_DIR).toBeUndefined();
    } finally {
      if (prior !== undefined) process.env.APPLE_PIM_CONFIG_DIR = prior;
    }
  });

  it("merges baseEnv into the spawn env", async () => {
    await getBridge({
      ...baseSpec,
      configDir: "/x",
      baseEnv: { FOO: "bar", APPLE_PIM_CONFIG_DIR: "/should-be-overridden" },
    });
    expect(spawnLog[0].env?.FOO).toBe("bar");
    // configDir takes precedence over baseEnv's APPLE_PIM_CONFIG_DIR.
    expect(spawnLog[0].env?.APPLE_PIM_CONFIG_DIR).toBe("/x");
  });

  it("shares one spawn between concurrent first-callers (no race)", async () => {
    const [a, b] = await Promise.all([
      getBridge({ ...baseSpec, configDir: "/race" }),
      getBridge({ ...baseSpec, configDir: "/race" }),
    ]);
    expect(a).toBe(b);
    expect(spawnLog).toHaveLength(1);
  });

  it("evicts the entry on transport close so the next call respawns", async () => {
    const bridge1 = (await getBridge({ ...baseSpec, configDir: "/c" })) as unknown as {
      __triggerClose?: () => void;
    };
    expect(__cacheKeysForTests()).toEqual(["/c"]);

    bridge1.__triggerClose?.();
    expect(__cacheKeysForTests()).toEqual([]);

    const bridge2 = await getBridge({ ...baseSpec, configDir: "/c" });
    expect(bridge2).not.toBe(bridge1);
    expect(spawnLog).toHaveLength(2);
  });

  it("evicts and rethrows on first-spawn failure (next call retries)", async () => {
    nextSpawnImpl = async () => {
      throw new Error("spawn failed");
    };

    await expect(getBridge({ ...baseSpec, configDir: "/d" })).rejects.toThrow(
      "spawn failed",
    );
    expect(__cacheKeysForTests()).toEqual([]);

    // Next call gets a fresh bridge from the default mock.
    const ok = await getBridge({ ...baseSpec, configDir: "/d" });
    expect(ok).toBeDefined();
    expect(spawnLog).toHaveLength(2);
  });
});

describe("bridge-cache.shutdownAll", () => {
  it("closes every cached bridge and clears the cache", async () => {
    const a = await getBridge({ ...baseSpec, configDir: "/a" });
    const b = await getBridge({ ...baseSpec, configDir: "/b" });
    await shutdownAll();
    expect(__cacheKeysForTests()).toEqual([]);
    expect((a as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledTimes(1);
    expect((b as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalledTimes(1);
  });

  it("doesn't blow up if a cached bridge rejected", async () => {
    nextSpawnImpl = async () => {
      throw new Error("nope");
    };
    await expect(getBridge({ ...baseSpec, configDir: "/x" })).rejects.toThrow();
    // After failure, cache is empty, so shutdownAll has nothing to do.
    await expect(shutdownAll()).resolves.toBeUndefined();
  });
});
