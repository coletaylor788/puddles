#!/usr/bin/env node
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../src/process-runner.mjs';
import { ownApplicationOutput } from '../src/application-output.mjs';
import { buildApplicationCore } from '../src/application-build-cache.mjs';
import { fileDigest, treeDigest } from '../src/native-state.mjs';
import { materializeRuntimeForDev } from '../src/native-package.mjs';

// SOURCE is the feature-owned checkout with its public and optional companion patches applied.
// OUTPUT is disposable application output, never a deployment or writable service state.
const [sourceArg, outputArg, pluginFile] = process.argv.slice(2);
if (!sourceArg || !outputArg) throw new Error('Usage: build-application.mjs SOURCE WORKSPACE_OUTPUT [PLUGINS_JSON]');
const { source, output, owner, save } = ownApplicationOutput(sourceArg, outputArg);
const run = (command, args, cwd = source) => runCommand(command, args, { cwd, timeoutMs: 30 * 60_000 });
console.log('Application core: ' + await buildApplicationCore(source, owner, save, () =>
  run('corepack', ['pnpm', 'exec', 'node', '--import', './scripts/tsx.mjs', 'scripts/build-all.mts', 'qaRuntime'])));
const uiInputs = JSON.stringify([treeDigest(join(source, 'ui'), { excludeNames: ['node_modules', 'dist', '.vite'] }), fileDigest(join(source, 'pnpm-lock.yaml')), process.version]);
const uiOutput = join(source, 'dist/control-ui');
if (owner.uiInputs !== uiInputs || !existsSync(join(uiOutput, 'index.html')) || owner.uiOutput !== treeDigest(uiOutput)) {
  await run('corepack', ['pnpm', 'ui:build']);
  save({ uiInputs, uiOutput: treeDigest(uiOutput) });
}
rmSync(output, { recursive: true, force: true });
await materializeRuntimeForDev(source, output);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
await materializeRuntimeForDev(join(repository, 'openclaw-plugins/communication-watcher/dist'), join(output, 'plugins/communication-watcher'));
for (const plugin of pluginFile ? JSON.parse(readFileSync(pluginFile, 'utf8')) : []) {
  if (!/^[a-z][a-z0-9-]*$/.test(plugin.id)) throw new Error('Invalid application plugin id');
  const destination = join(output, 'dist/extensions', plugin.id);
  if (existsSync(destination)) throw new Error('Application plugin duplicates a bundled plugin');
  await materializeRuntimeForDev(resolve(plugin.source), destination);
}
console.log(`Complete application output: ${output}`);
