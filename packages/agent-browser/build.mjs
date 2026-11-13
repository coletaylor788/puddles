import { cpSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeRuntimeForDev } from '../e2e/src/native-package.mjs';

export const version = '0.43.0';

// Package the upstream CLI and its platform binary without changing either.
// The application builder owns destination and its reusable component cache.
export async function prepareAgentBrowser(destination) {
  const source = realpathSync(dirname(createRequire(import.meta.url).resolve('agent-browser/package.json')));
  if (JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')).version !== version) {
    throw new Error('agent-browser version differs from the reviewed pin');
  }
  destination = resolve(destination);
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  await materializeRuntimeForDev(source, join(destination, 'upstream'));
  cpSync(fileURLToPath(new URL('./launch.mjs', import.meta.url)), join(destination, 'launch.mjs'));
  return resolve(destination);
}
