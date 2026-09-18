import { expect, it } from "vitest";
// @ts-expect-error The lifecycle modules run directly in Node.
import { parseMacMemoryPressure, parseMacSwapUsage, parseProcessGroupRss, resolveResourceProfile, summarizeResourceSamples } from "../src/native-resources.mjs";

it("admits a standard 7 GB macOS ARM host without weakening the default profile", () => {
  expect(resolveResourceProfile({}, {
    platform: "darwin", arch: "x64", totalMemoryBytes: 8 * 1024 ** 3, logicalCpuCount: 4,
  })).toMatchObject({ name: "default", minimumMemoryBytes: 8 * 1024 ** 3 });
  expect(resolveResourceProfile({ E2E_RESOURCE_PROFILE: "hosted-arm" }, {
    platform: "darwin", arch: "arm64", totalMemoryBytes: 7_000_000_000, logicalCpuCount: 3,
  })).toMatchObject({
    name: "hosted-arm",
    testWorkers: 1,
    buildEnvironment: { OPENCLAW_NODE_TEST_PLAN_CONCURRENCY: "1" },
  });
  expect(() => resolveResourceProfile({ E2E_RESOURCE_PROFILE: "hosted-arm" }, {
    platform: "darwin", arch: "x64", totalMemoryBytes: 14_000_000_000,
  })).toThrow("macOS arm64");
  expect(() => resolveResourceProfile({ E2E_RESOURCE_PROFILE: "hosted-arm" }, {
    platform: "darwin", arch: "arm64", totalMemoryBytes: 5 * 1024 ** 3,
  })).toThrow("at least");
});

it("measures the complete detached process group and host pressure", () => {
  expect(parseProcessGroupRss(" 42 100\n 42 250\n 99 900\n", 42)).toBe(350 * 1024);
  expect(parseMacMemoryPressure("System-wide memory free percentage: 17%\n")).toBe(17);
  expect(parseMacSwapUsage("total = 2048.00M  used = 12.50M  free = 2035.50M")).toBe(12.5 * 1024 ** 2);
  expect(summarizeResourceSamples([
    { rssBytes: 10, freeMemoryPercent: 40, swapUsedBytes: 0, freeDiskBytes: 100 },
    { rssBytes: 30, freeMemoryPercent: 12, swapUsedBytes: 8, freeDiskBytes: 70 },
  ])).toEqual({
    sampleCount: 2,
    peakProcessGroupRssBytes: 30,
    minimumFreeMemoryPercent: 12,
    peakSwapUsedBytes: 8,
    minimumFreeDiskBytes: 70,
    initialFreeDiskBytes: 100,
    finalFreeDiskBytes: 70,
  });
});
