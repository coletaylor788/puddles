import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["legacy/*.test.ts"], maxWorkers: 2 } });
