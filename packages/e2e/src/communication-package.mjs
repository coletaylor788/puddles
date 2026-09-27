import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileDigest, jsonDigest, stage, treeDigest } from './native-state.mjs';
import { packRuntime } from './native-package.mjs';

/** Seal the public plugin separately from OpenClaw, using the existing additional-artifact contract. */
export async function packageCommunication(repo, runDir, tools, dependencies, env, run) {
  const plugin = join(repo, 'openclaw-plugins/communication-watcher');
  const sourceSha256 = jsonDigest({
    plugin: treeDigest(plugin, { exclude: ['node_modules', 'dist', 'tests'] }),
    hooks: treeDigest(join(repo, 'packages/mcp-hooks'), { exclude: ['node_modules', 'dist', 'tests'] }),
    manifests: ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.base.json'].map(p => fileDigest(join(repo, p))),
  });
  const inputs = { implementation: fileDigest(new URL(import.meta.url)), sourceSha256, dependencies, tools, environment: jsonDigest(env), packer: fileDigest(new URL('./native-package.mjs', import.meta.url)) };
  return stage(runDir, 'communication-package', inputs, async () => {
    // Native/build runs do not execute repositoryGates. Never package an old dist.
    rmSync(join(plugin, 'dist'), { recursive: true, force: true });
    await run('corepack', ['pnpm', '--filter', 'communication-watcher...', 'build'], { cwd: repo, env });
    const directory = join(runDir, 'artifacts/communication-watcher'); mkdirSync(directory, { recursive: true, mode: 0o700 });
    const artifact = await packRuntime(join(plugin, 'dist'), directory, run);
    return { id: 'communication-watcher', artifact, attestation: {
      schema: 'puddles.openclaw-extension-artifact/v1', sourceSha256,
      packageInputsSha256: jsonDigest(inputs), toolchainSha256: jsonDigest(tools),
      artifactSha256: artifact.sha256, runtimeSha256: artifact.runtimeSha256,
    } };
  }, value => ({ [value.artifact.path]: value.artifact.sha256 }));
}
