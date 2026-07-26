import { defineConfig } from "vitest/config";

// Candidate-source tests run only after patches are applied by the managed
// lifecycle. Every other package test is isolated and part of the root suite.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/candidate.*.test.ts", "node_modules/**"],
    environment: "node",
  },
});
