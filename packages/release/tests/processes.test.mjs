import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { lock } from '../src/files.mjs';
import { command } from '../src/commands.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(t) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'release-process-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
test('only one process owns a lock and SIGKILL releases it without deleting the lock file', async t => {
  const root = fixture(t); const path = join(root, 'lock');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {lock} from ${JSON.stringify(new URL('../src/files.mjs', import.meta.url).href)}; lock(${JSON.stringify(path)}); console.log('locked'); setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => child.kill('SIGKILL'));
  await once(child.stdout, 'data');
  assert.throws(() => lock(path), /already running/);
  child.kill('SIGKILL'); await once(child, 'exit');
  const release = lock(path); assert.throws(() => lock(path), /already running/); release();
  lock(path)();
});
test('a timed-out command and its nested writer stop before recovery can start', async t => {
  const root = fixture(t); const path = join(root, 'writes');
  const writer = `const fs=require('node:fs');process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(${JSON.stringify(path)},'x'),10);`;
  const script = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:'ignore'});process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);`;
  await assert.rejects(command({ command: process.execPath, args: ['-e', script], cwd: root, timeoutMs: 600 }), /timeout/);
  const stopped = readFileSync(path, 'utf8'); await pause(80);
  assert.equal(readFileSync(path, 'utf8'), stopped);
});
test('a successful command cannot leave a writer running in its process group', async t => {
  const root = fixture(t); const path = join(root, 'writes');
  const writer = `const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(path)},'x'),10);`;
  await command({ command: process.execPath, args: ['-e', `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:'ignore'}).unref();setTimeout(()=>process.exit(0),200);`], cwd: root, timeoutMs: 2000 });
  const stopped = readFileSync(path, 'utf8'); await pause(80); assert.equal(readFileSync(path, 'utf8'), stopped);
});
