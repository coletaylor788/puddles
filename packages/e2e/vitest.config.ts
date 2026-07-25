import { defineConfig } from "vitest/config";

// Default config: EXCLUDES the live integration suite so `pnpm test` (and the
// root `pnpm -r test`) stays fast and offline. The real suite runs via
// `pnpm test:e2e` (see vitest.e2e.config.ts). Every live spec is named
// `tests/integration.*.test.ts`, so this default run collects nothing here.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration.*.test.ts", "node_modules/**"],
    environment: "node",
  },
});
