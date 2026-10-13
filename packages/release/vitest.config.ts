import { defineConfig } from 'vitest/config';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({ test: {
  include: ['tests/**/*.test.ts'], environment: 'node', maxWorkers: 2,
  env: { PUDDLES_DEPLOY_COORDINATION: join(tmpdir(), `release-unit-${randomUUID()}.json`), PUDDLES_DEPLOY_REQUEST_ID: '', PUDDLES_DEPLOY_TOKEN: '' },
} });
