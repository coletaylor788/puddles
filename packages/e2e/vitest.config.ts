import { defineConfig } from "vitest/config";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Candidate-source tests run only after patches are applied by the managed
// lifecycle. Every other package test is isolated and part of the root suite.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/candidate.*.test.ts", "node_modules/**"],
    environment: "node",
    // Synthetic targets can share the host and port of a real deployment.
    // Unit tests and their subprocesses must not inherit that host's slots or
    // lease. Ownership tests select their own explicit fixture record instead.
    env: {
      PUDDLES_DEPLOY_COORDINATION: join(tmpdir(), `puddles-unit-coordination-${randomUUID()}.json`),
      PUDDLES_DEPLOY_REQUEST_ID: "",
      PUDDLES_DEPLOY_TOKEN: "",
    },
    maxWorkers: 2,
  },
});
