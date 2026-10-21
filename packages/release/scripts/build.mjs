import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('..', import.meta.url));
for (const dir of ['src', 'bin']) {
  for (const file of readdirSync(join(root, dir)).filter(name => name.endsWith('.mjs'))) {
    execFileSync(process.execPath, ['--check', join(root, dir, file)], { stdio: 'inherit' });
  }
}
if (!process.argv.includes('--check')) {
  rmSync(join(root, 'dist'), { recursive: true, force: true });
  mkdirSync(join(root, 'dist'));
  mkdirSync(join(root, 'dist/src'));
  mkdirSync(join(root, 'dist/bin'));
  for (const file of JSON.parse(readFileSync(join(root, 'runtime-files.json'), 'utf8'))) cpSync(join(root, 'src', file), join(root, 'dist/src', file));
  cpSync(join(root, 'bin/puddles-release.mjs'), join(root, 'dist/bin/puddles-release.mjs'));
  cpSync(join(root, 'bin/puddles-ci.mjs'), join(root, 'dist/bin/puddles-ci.mjs'));
  console.log('Release tool built; no application build or dependencies required.');
}
