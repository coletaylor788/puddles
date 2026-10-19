import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { lock } from '../src/files.mjs';
import { command } from '../src/commands.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(t) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'release-process-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
test('only one process owns a lock and SIGKILL releases it without deleting the lock file', async t => {
  const root = fixture(t); const path = join(root, 'lock');
  // Real owners retain the unlock callback. Discarding it lets GC close the
  // SQLite connection, so retain it and collect before announcing ownership.
  const child = spawn(process.execPath, ['--expose-gc', '--input-type=module', '-e', `import {lock} from ${JSON.stringify(new URL('../src/files.mjs', import.meta.url).href)}; const release=lock(${JSON.stringify(path)}); process.once('SIGTERM',release); globalThis.gc(); console.log('locked'); setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'inherit'] });
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

for (const reason of ['timeout', 'growth abort']) test(`${reason} joins detached fixture writers after the phase leader exits`, async t => {
  const root = fixture(t), writes = join(root, 'writes'), pidFile = join(root, 'writer.pid'), runnerPidFile = join(root, 'runner.pid');
  const writer = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>fs.appendFileSync(${JSON.stringify(writes)},'x'),10);`;
  // Match a phase launcher waiting synchronously on a wrapper whose test runner
  // starts another process group. The intermediate parents exit on SIGTERM.
  const runner = `require('node:fs').writeFileSync(${JSON.stringify(runnerPidFile)},String(process.pid));require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(writer)}],{detached:true,stdio:'ignore'});setInterval(()=>{},1000);`;
  const wrapper = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(runner)}],{detached:true,stdio:'ignore'});setInterval(()=>{},1000);`;
  const feature = `require('node:child_process').execFileSync(process.execPath,['-e',${JSON.stringify(wrapper)}],{stdio:'inherit'});`;
  const phase = `require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(feature)}],{stdio:'inherit'});`;
  const driver = join(root, 'driver.mjs');
  writeFileSync(driver, `import {command} from ${JSON.stringify(new URL('../src/commands.mjs', import.meta.url).href)};try {await command(${JSON.stringify({ command: process.execPath, args: ['-e', phase], cwd: root, timeoutMs: reason === 'timeout' ? 800 : 10000 })});process.exitCode=2;}catch {process.exitCode=1;}`);
  const child = spawn(process.execPath, [driver], { stdio: 'ignore' });
  let writerPid, runnerPid;
  try {
    for (let i = 0; i < 100 && !existsSync(writes); i++) await pause(20);
    assert.ok(existsSync(writes), 'synthetic writer started');
    writerPid = Number(readFileSync(pidFile, 'utf8'));
    runnerPid = Number(readFileSync(runnerPidFile, 'utf8'));
    const exited = once(child, 'exit');
    if (reason === 'growth abort') child.kill('SIGTERM');
    const [code] = await exited;
    assert.equal(code, 1);
    const stopped = readFileSync(writes, 'utf8');
    await pause(100);
    assert.equal(readFileSync(writes, 'utf8'), stopped, 'fixture growth stopped before command returned');
    assert.throws(() => process.kill(writerPid, 0), { code: 'ESRCH' });
    assert.throws(() => process.kill(runnerPid, 0), { code: 'ESRCH' });
  } finally {
    child.kill('SIGKILL');
    if (writerPid) try { process.kill(-writerPid, 'SIGKILL'); } catch {}
    if (runnerPid) try { process.kill(-runnerPid, 'SIGKILL'); } catch {}
  }
});
