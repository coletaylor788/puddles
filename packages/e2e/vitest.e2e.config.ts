import { defineConfig } from "vitest/config";

// Live E2E suite: drives the REAL OpenClaw gateway (a real agent turn per case:
// LLM + tools + hooks + memory). Runs serially in a single fork because every
// case shares the one live gateway + session store, and long timeouts because a
// tool-using agent turn can take a while. `retry: 1` absorbs LLM nondeterminism.
export default defineConfig({
  test: {
    include: ["tests/integration.*.test.ts"],
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 120_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    sequence: { concurrent: false },
    retry: 1,
  },
});
