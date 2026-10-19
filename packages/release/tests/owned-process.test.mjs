import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { command, stopInterruptedChild } from '../src/commands.mjs';
import { closeProcessScope, createProcessScope, prepareOwnedProcess, processScopeRecords, retireProcessScope } from '../src/owned-process.mjs';
const helper = new URL('../src/owned-process.mjs', import.meta.url).href;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code !== 'ESRCH') throw error; return false; } };
async function joined(pid) { for (let i = 0; i < 100 && alive(pid); i++) await pause(20); assert.equal(alive(pid), false); }
function fixture(t) { const root = realpathSync(mkdtempSync(join(tmpdir(), 'owned-launch-test-'))); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }


function ownedScope(t) {
  const scope = createProcessScope();
  t.after(async () => {
    if (!existsSync(scope)) return;
    const records = processScopeRecords(scope);
    if (records.length) await stopInterruptedChild({ ...records[0], scope });
    else { closeProcessScope(scope); retireProcessScope(scope); }
  });
  return scope;
}

test('unexpected phase exit joins its registered detached writer before returning', async t => {
  const root = fixture(t), pidFile = join(root, 'pid'), writes = join(root, 'writes');
  const writer = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(${JSON.stringify(writes)},'x'),10);`;
  const worker = `import {spawnOwnedProcess} from ${JSON.stringify(helper)};import {existsSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';spawnOwnedProcess(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:'ignore'});while(!existsSync(${JSON.stringify(writes)}))await delay(10);process.exit(17);`;
  let pid;
  try {
    await assert.rejects(command({ command: process.execPath, args: ['--input-type=module', '-e', worker], cwd: root, timeoutMs: 5000 }), /17/);
    pid = Number(readFileSync(pidFile, 'utf8')); await joined(pid);
    const stopped = readFileSync(writes, 'utf8'); await pause(80); assert.equal(readFileSync(writes, 'utf8'), stopped);
  } finally { if (pid && alive(pid)) { process.kill(-pid, 'SIGKILL'); await joined(pid); } }
});

test('gate preserves PID, cwd, environment, PATH lookup and literal arguments', async t => {
  const root = fixture(t), scope = ownedScope(t), output = join(root, 'result.json');
  const args = ['literal $(must-not-run)', 'x'.repeat(100000)];
  const script = `require('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({pid:process.pid,cwd:process.cwd(),value:process.env.SYNTHETIC_VALUE,args:process.argv.slice(1)}));`;
  const prepared = prepareOwnedProcess('node', ['-e', script, ...args], { cwd: root, env: { PATH: process.execPath.slice(0, process.execPath.lastIndexOf('/')), SYNTHETIC_VALUE: 'preserved' }, stdio: 'ignore' }, [scope]);
  const done = once(prepared.child, 'exit'); prepared.release(); await done;
  const result = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(result.pid, prepared.child.pid); assert.equal(result.cwd, root); assert.equal(result.value, 'preserved'); assert.deepEqual(result.args, args);
  await stopInterruptedChild({ pid: prepared.child.pid, start: prepared.start, scope });
  assert.equal(existsSync(scope), false);
});

for (const payload of ['', '{"command":']) test(`gate rejects ${payload ? 'partial payload' : 'EOF'} without starting work`, async t => {
  const root = fixture(t), marker = join(root, 'started');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/owned-process-gate.mjs', import.meta.url))], { stdio: ['ignore', 'ignore', 'ignore', 'pipe'], env: { ...process.env, SYNTHETIC_MARKER: marker } });
  const done = once(child, 'exit'); child.stdio[3].end(payload);
  assert.equal((await done)[0], 125); assert.equal(existsSync(marker), false);
});

test('closing a scope refuses a registered gate before workload release', async t => {
  const root = fixture(t), scope = ownedScope(t), marker = join(root, 'started');
  const prepared = prepareOwnedProcess(process.execPath, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`], { stdio: 'ignore' }, [scope]);
  closeProcessScope(scope);
  assert.throws(() => prepared.release(), /closed/);
  const done = once(prepared.child, 'exit'); prepared.abort(); await done;
  assert.equal(existsSync(marker), false);
  await stopInterruptedChild({ pid: prepared.child.pid, start: prepared.start, scope });
  assert.throws(() => prepareOwnedProcess(process.execPath, [], { stdio: 'ignore' }, [scope]), /closed/);
  assert.equal(existsSync(scope), false, 'late launch must not recreate retired scope');
});

test('an ancestor registration failure prevents launch and retains incomplete intent', async t => {
  const root = fixture(t), scope = ownedScope(t), broken = join(root, 'broken'); mkdirSync(broken); mkdirSync(join(broken, 'launches'));
  chmodSync(join(broken, 'launches'), 0o500);
  try {
    assert.throws(() => prepareOwnedProcess(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }, [scope, broken]), /EACCES/);
    closeProcessScope(scope);
    assert.throws(() => processScopeRecords(scope), /incomplete/);
    assert.throws(() => retireProcessScope(scope), /incomplete/);
    assert.equal(existsSync(scope), true);
  } finally { chmodSync(join(broken, 'launches'), 0o700); rmSync(scope, { recursive: true }); }
});

test('launcher death after registration leaves a discoverable gate without starting workload', async t => {
  const root = fixture(t), scope = ownedScope(t), marker = join(root, 'started');
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {prepareOwnedProcess} from ${JSON.stringify(helper)};prepareOwnedProcess(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`)}],{stdio:'ignore'},[${JSON.stringify(scope)}]);process.exit(17);`], { stdio: 'ignore' });
  await once(child, 'exit');
  const [record] = processScopeRecords(scope); await joined(record.pid);
  assert.equal(existsSync(marker), false);
  // Recovery still consumes the scope when the recorded original PID is gone.
  await stopInterruptedChild({ pid: record.pid, start: record.start, scope });
  assert.equal(existsSync(scope), false);
});

test('launcher death before PID commit leaves no runnable workload and retains intent', async t => {
  const root = fixture(t), scope = ownedScope(t), pidFile = join(root, 'gate.pid'), marker = join(root, 'started');
  const shim = join(root, 'ps');
  writeFileSync(shim, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)},process.argv[3]);if(process.ppid!==Number(process.env.SYNTHETIC_LAUNCHER_PID))process.exit(2);process.kill(process.ppid,'SIGKILL');`, { mode: 0o700 });
  const driver = `import {prepareOwnedProcess} from ${JSON.stringify(helper)};process.env.SYNTHETIC_LAUNCHER_PID=String(process.pid);prepareOwnedProcess(process.execPath,['-e',${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`)}],{stdio:'ignore'},[${JSON.stringify(scope)}]);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { env: { ...process.env, PATH: root + ':' + process.env.PATH }, stdio: 'ignore' });
  await once(child, 'exit'); const pid = Number(readFileSync(pidFile, 'utf8')); await joined(pid);
  assert.equal(existsSync(marker), false); closeProcessScope(scope);
  assert.throws(() => processScopeRecords(scope), /incomplete/); assert.equal(existsSync(scope), true);
  rmSync(scope, { recursive: true });
});

test('restart joins registered fixtures after original phase PID is gone and clears receipt before retirement', async t => {
  const root = fixture(t), scope = ownedScope(t), writes = join(root, 'writes'), pidFile = join(root, 'writer.pid');
  const writer = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>fs.appendFileSync(${JSON.stringify(writes)},'x'),10);`;
  const phase = `import {spawnOwnedProcess} from ${JSON.stringify(helper)};import {existsSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';spawnOwnedProcess(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:'ignore'});while(!existsSync(${JSON.stringify(writes)}))await delay(10);process.exit(17);`;
  const driver = `import {prepareOwnedProcess} from ${JSON.stringify(helper)};const prepared=prepareOwnedProcess(process.execPath,['--input-type=module','-e',${JSON.stringify(phase)}],{stdio:'ignore'},[${JSON.stringify(scope)}]);prepared.child.once('exit',()=>process.exit(19));prepared.release();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', driver], { stdio: 'ignore' });
  assert.equal((await once(child, 'exit'))[0], 19);
  const records = processScopeRecords(scope), writerPid = Number(readFileSync(pidFile, 'utf8'));
  const phaseRecord = records.find(record => record.pid !== writerPid);
  assert.ok(phaseRecord); assert.equal(alive(phaseRecord.pid), false); assert.equal(alive(writerPid), true);
  let acknowledged = false;
  await stopInterruptedChild({ ...phaseRecord, scope }, () => { assert.equal(existsSync(scope), true); acknowledged = true; });
  assert.equal(acknowledged, true); await joined(writerPid); assert.equal(existsSync(scope), false);
});

test('a changed original PID identity prevents signaling and retains recovery records', async t => {
  const scope = ownedScope(t);
  const prepared = prepareOwnedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }, [scope]);
  prepared.release();
  let acknowledged = false;
  await assert.rejects(stopInterruptedChild({ pid: prepared.child.pid, start: 'another process start', scope }, () => { acknowledged = true; }), /identity changed/);
  assert.equal(acknowledged, false); assert.equal(alive(prepared.child.pid), true); assert.equal(existsSync(scope), true);
  await stopInterruptedChild({ pid: prepared.child.pid, start: prepared.start, scope });
});

test('failed observer receipt prevents workload and failed recovery acknowledgement retains the scope', async t => {
  const root = fixture(t), marker = join(root, 'started'); let receipt;
  await assert.rejects(command({ command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`], cwd: root, timeoutMs: 2000 }, {}, child => { receipt = child; throw new Error('synthetic journal failure'); }), /journal failure/);
  assert.equal(existsSync(marker), false); assert.ok(receipt.scope); assert.equal(existsSync(receipt.scope), true);
  await assert.rejects(stopInterruptedChild(receipt, () => { throw new Error('synthetic clear failure'); }), /clear failure/);
  assert.equal(existsSync(receipt.scope), true);
  await stopInterruptedChild(receipt); assert.equal(existsSync(receipt.scope), false);
});

async function completedPhase(scope) {
  const phase = prepareOwnedProcess(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' }, [scope]);
  const done = once(phase.child, 'exit'); phase.release(); await done;
  return { pid: phase.child.pid, start: phase.start, scope };
}

for (const staleFirst of [false, true]) test(`registered identity survives stale same-PID records (${staleFirst ? 'first' : 'last'})`, async t => {
  const scope = ownedScope(t), phase = await completedPhase(scope);
  const prepared = prepareOwnedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }, [scope]);
  writeFileSync(join(scope, 'launches', `${staleFirst ? '000' : 'zzz'}-stale.json`), JSON.stringify({ status: 'registered', pid: prepared.child.pid, start: 'earlier process start' }));
  prepared.release();
  await stopInterruptedChild(phase);
  await joined(prepared.child.pid); assert.equal(existsSync(scope), false);
});

test('incomplete intent retains recovery state after all registered writers are joined', async t => {
  const root = fixture(t), scope = ownedScope(t), writes = join(root, 'writes');
  const phase = await completedPhase(scope);
  const prepared = prepareOwnedProcess(process.execPath, ['-e', `setInterval(()=>require('node:fs').appendFileSync(${JSON.stringify(writes)},'x'),10)`], { stdio: 'ignore' }, [scope]);
  prepared.release();
  for (let i = 0; i < 100 && !existsSync(writes); i++) await pause(10);
  assert.equal(existsSync(writes), true);
  const pending = join(scope, 'launches', '000-pending.json'); writeFileSync(pending, JSON.stringify({ status: 'pending' }));
  let acknowledged = false;
  try {
    await assert.rejects(stopInterruptedChild(phase, () => { acknowledged = true; }), /incomplete/);
    await joined(prepared.child.pid); assert.equal(acknowledged, false); assert.equal(existsSync(scope), true);
    const stopped = readFileSync(writes, 'utf8'); await pause(60); assert.equal(readFileSync(writes, 'utf8'), stopped);
  } finally { rmSync(pending, { force: true }); }
});

test('target Node preloads run exactly once after release and never in an aborted gate', async t => {
  const root = fixture(t), marker = join(root, 'preload'), preload = join(root, 'preload.cjs');
  writeFileSync(preload, `require('node:fs').appendFileSync(${JSON.stringify(marker)},'x');`);
  for (const release of [false, true]) {
    const scope = ownedScope(t);
    const prepared = prepareOwnedProcess(process.execPath, ['-e', 'process.exit(0)'], { env: { ...process.env, NODE_OPTIONS: `--require=${preload}` }, stdio: 'ignore' }, [scope]);
    await pause(80); assert.equal(existsSync(marker), false);
    const done = once(prepared.child, 'exit');
    if (release) prepared.release(); else prepared.abort();
    assert.equal((await done)[0], release ? 0 : 125);
    if (release) assert.equal(readFileSync(marker, 'utf8'), 'x'); else assert.equal(existsSync(marker), false);
    await stopInterruptedChild({ pid: prepared.child.pid, start: prepared.start, scope });
  }
});


test('packaged controller launches and joins through its own gate without application files', async t => {
  const root = fixture(t), source = join(root, 'src'), marker = join(root, 'started');
  mkdirSync(source);
  const manifest = JSON.parse(readFileSync(new URL('../runtime-files.json', import.meta.url), 'utf8'));
  for (const file of manifest) cpSync(new URL('../src/' + file, import.meta.url), join(source, file));
  const { command: packagedCommand } = await import(new URL('file://' + join(source, 'commands.mjs')));
  await packagedCommand({ command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'started')`], cwd: root, timeoutMs: 5000 });
  assert.equal(readFileSync(marker, 'utf8'), 'started');
});
