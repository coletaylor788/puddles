import { afterEach, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
vi.mock('../src/native-package.mjs', () => ({
  packRuntime: async (source: string, directory: string) => {
    const path = join(directory, 'artifact'); writeFileSync(path, readFileSync(join(source, 'plugin.js')));
    // @ts-expect-error JS runtime helper
    const { fileDigest } = await import('../src/native-state.mjs');
    return { path, sha256: fileDigest(path), runtimeSha256: fileDigest(path) };
  },
}));
// @ts-expect-error JS runtime helper
import { packageCommunication } from '../src/communication-package.mjs';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('builds clean, binds bundled sources and dependencies, and reuses only unchanged artifacts', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'communication-package-')); roots.push(repo);
  const plugin = join(repo, 'openclaw-plugins/communication-watcher');
  const hooks = join(repo, 'packages/mcp-hooks');
  mkdirSync(join(plugin, 'dist'), { recursive: true }); mkdirSync(hooks, { recursive: true });
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json']) writeFileSync(join(repo, file), '{}');
  writeFileSync(join(plugin, 'plugin.ts'), 'source'); writeFileSync(join(hooks, 'hooks.ts'), 'guards');
  writeFileSync(join(plugin, 'dist/stale.js'), 'old');
  const run = vi.fn(async (command: string, args: string[]) => {
    expect(command).toBe('corepack'); expect(args).toEqual(['pnpm', '--filter', 'communication-watcher...', 'build']);
    expect(existsSync(join(plugin, 'dist'))).toBe(false);
    mkdirSync(join(plugin, 'dist')); writeFileSync(join(plugin, 'dist/plugin.js'), readFileSync(join(hooks, 'hooks.ts')));
  });
  const build = (dependency = 'deps') => packageCommunication(repo, join(repo, 'run'), { node: 'fixture' }, dependency, {}, run);
  const first = await build(); expect(first.id).toBe('communication-watcher'); expect(first.attestation.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(await build()).toEqual(first); expect(run).toHaveBeenCalledTimes(1);
  writeFileSync(join(hooks, 'hooks.ts'), 'updated guards');
  const updated = await build(); expect(updated.artifact.sha256).not.toBe(first.artifact.sha256); expect(run).toHaveBeenCalledTimes(2);
  await build('changed dependencies'); expect(run).toHaveBeenCalledTimes(3);
  writeFileSync(updated.artifact.path, 'corrupted');
  await build('changed dependencies'); expect(run).toHaveBeenCalledTimes(4);
  writeFileSync(join(repo, 'tsconfig.base.json'), '{"compilerOptions":{"target":"ES2024"}}');
  await build('changed dependencies'); expect(run).toHaveBeenCalledTimes(5);
});
