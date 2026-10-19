import { expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Failure injection and recovery belong only to scopes created by this test.
// Keep the real supervising suite's ancestor tracking intact.
const inheritedScopes: string[] = JSON.parse(process.env.PUDDLES_PROCESS_SCOPES ?? '[]');

it('interruption joins parallel test workers and detached fixtures before deleting test state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'application-interrupt-')), state = join(root, 'state');
  mkdirSync(state); const pidFile = join(root, 'fixture.pid'), stopped = join(root, 'fixture.stopped');
  const moduleUrl = (file: string) => pathToFileURL(resolve(import.meta.dirname, '../src', file)).href;
  const worker = join(root, 'worker.test.mjs'), wrapper = join(root, 'wrapper.mjs');
  writeFileSync(worker, `
import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; import test from 'node:test';
import {registerNativeFixture} from ${JSON.stringify(moduleUrl('native-fixture.mjs'))};
import {spawnFixtureProcess,trackFixtureProcess,stopFixtureProcess} from ${JSON.stringify(moduleUrl('native-fixture-process.mjs'))};
test('pending fixture', async () => {
 const fixture="const fs=require('node:fs');process.on('SIGTERM',()=>{fs.writeFileSync("+JSON.stringify(${JSON.stringify(stopped)}+process.env.FIXTURE_ID)+",fs.existsSync("+JSON.stringify(${JSON.stringify(state)})+")?'state-present':'state-deleted');process.exit(0);});console.log('ready');setInterval(()=>{},1000);";
 const child=spawnFixtureProcess(process.execPath,['-e',fixture],{detached:true,stdio:['ignore','pipe','ignore']});
 await new Promise(r=>child.stdout.once('data',r));
 const tracked=trackFixtureProcess(child);
 registerNativeFixture(()=>stopFixtureProcess(tracked));
 writeFileSync(${JSON.stringify(pidFile)}+process.env.FIXTURE_ID,String(child.pid)); await new Promise(()=>{});
});`);
  writeFileSync(wrapper, `
import {withApplicationCheckCleanup} from ${JSON.stringify(moduleUrl('application-check-cleanup.mjs'))};
import {runCommand} from ${JSON.stringify(moduleUrl('process-runner.mjs'))};
await withApplicationCheckCleanup(${JSON.stringify(state)},()=>Promise.all([0,1].map(index=>runCommand(process.execPath,['--import',${JSON.stringify(moduleUrl('application-test-lifecycle.mjs'))},'--test',${JSON.stringify(worker)}],{cwd:${JSON.stringify(state)},env:{...process.env,FIXTURE_ID:String(index)}}))));`);
  const child = spawn(process.execPath, [wrapper], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const fixturePids: number[] = [];
  try {
    for (let i=0; i<100 && ![0,1].every(index=>existsSync(pidFile+index)); i++) await new Promise(r=>setTimeout(r,50));
    for(const index of [0,1]) {expect(existsSync(pidFile+index)).toBe(true);fixturePids.push(Number(readFileSync(pidFile+index,'utf8')));}
    const exit = new Promise(r=>child.once('exit',r)); child.kill('SIGTERM'); await exit;
    for(const index of [0,1]) {
      expect(existsSync(stopped+index), output).toBe(true);
      expect(readFileSync(stopped+index, 'utf8')).toBe('state-present');
    }
    expect(existsSync(state)).toBe(false);
    for(const pid of fixturePids) expect(()=>process.kill(pid,0)).toThrow();
  } finally {
    child.kill('SIGKILL'); for(const pid of fixturePids) try {process.kill(pid,'SIGKILL');} catch {}
    rmSync(root,{recursive:true,force:true});
  }
},20000);

it('test-runner timeout joins a detached fixture even when its worker exits before cleanup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'application-timeout-')), state = join(root, 'state');
  mkdirSync(state);
  const pidFile = join(root, 'fixture.pid'), writes = join(root, 'writes');
  const moduleUrl = (file: string) => pathToFileURL(resolve(import.meta.dirname, '../src', file)).href;
  const worker = join(root, 'worker.test.mjs'), wrapper = join(root, 'wrapper.mjs');
  const fixture = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>fs.appendFileSync(${JSON.stringify(writes)},'x'),10);`;
  writeFileSync(worker, `
import {spawn} from 'node:child_process'; import test from 'node:test';
import {registerNativeFixture} from ${JSON.stringify(moduleUrl('native-fixture.mjs'))};
import {spawnFixtureProcess,trackFixtureProcess,stopFixtureProcess} from ${JSON.stringify(moduleUrl('native-fixture-process.mjs'))};
test('writing fixture',async()=>{
 const child=spawnFixtureProcess(process.execPath,['-e',${JSON.stringify(fixture)}],{detached:true,stdio:'ignore'});
 const tracked=trackFixtureProcess(child);registerNativeFixture(()=>stopFixtureProcess(tracked));
 await new Promise(()=>setInterval(()=>{},1000));
});`);
  writeFileSync(wrapper, `
import {withApplicationCheckCleanup} from ${JSON.stringify(moduleUrl('application-check-cleanup.mjs'))};
import {runCommand} from ${JSON.stringify(moduleUrl('process-runner.mjs'))};
await withApplicationCheckCleanup(${JSON.stringify(state)},()=>runCommand(process.execPath,['--import',${JSON.stringify(moduleUrl('application-test-lifecycle.mjs'))},'--test',${JSON.stringify(worker)}],{cwd:${JSON.stringify(state)},timeoutMs:1500,killGraceMs:100}));`);
  const child = spawn(process.execPath, [wrapper], { stdio: 'ignore' });
  try {
    const code = await new Promise(resolve => child.once('exit', resolve));
    expect(code).toBe(1);
    const pid = Number(readFileSync(pidFile, 'utf8')), stopped = readFileSync(writes, 'utf8');
    expect(() => process.kill(pid, 0)).toThrow();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(readFileSync(writes, 'utf8')).toBe(stopped);
    expect(existsSync(state)).toBe(true);
  } finally {
    child.kill('SIGKILL');
    if (existsSync(pidFile)) try { process.kill(-Number(readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
},10000);

for (const fails of [false, true]) it(`ordinary ${fails ? 'failed checks retain diagnostics' : 'successful checks remove state'} after joining fixtures`, () => {
  const root = mkdtempSync(join(tmpdir(), 'application-result-')), state = join(root, 'state');
  mkdirSync(state);
  const diagnostic = join(state, 'failure.log'), stopped = join(root, 'fixture.stopped');
  const moduleUrl = (file: string) => pathToFileURL(resolve(import.meta.dirname, '../src', file)).href;
  const wrapper = join(root, 'wrapper.mjs');
  writeFileSync(wrapper, `
import {writeFileSync} from 'node:fs';
import {registerNativeFixture} from ${JSON.stringify(moduleUrl('native-fixture.mjs'))};
import {withApplicationCheckCleanup} from ${JSON.stringify(moduleUrl('application-check-cleanup.mjs'))};
registerNativeFixture(async()=>{writeFileSync(${JSON.stringify(stopped)},'joined');});
await withApplicationCheckCleanup(${JSON.stringify(state)},async()=>{
  writeFileSync(${JSON.stringify(diagnostic)},'synthetic protected diagnostic');
  if(${fails})throw new AggregateError([new Error('synthetic check failed')],'Installed application checks failed');
});`);
  try {
    const result=spawnSync(process.execPath,[wrapper],{encoding:'utf8',timeout:10_000});
    expect(result.error).toBeUndefined();expect(result.status).toBe(fails?1:0);
    expect(readFileSync(stopped,'utf8')).toBe('joined');
    expect(existsSync(state)).toBe(fails);
    if(fails){
      expect(readFileSync(diagnostic,'utf8')).toBe('synthetic protected diagnostic');
      expect(result.stderr).toContain('Installed application checks failed');
      expect(result.stderr).toContain('synthetic check failed');
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});

for (const registration of ['complete', 'pending', 'stale-first', 'stale-last']) it(`unexpected worker exit joins its detached fixture with ${registration} ownership records`, async () => {
  const root = mkdtempSync(join(tmpdir(), 'application-worker-exit-'));
  const pidFile = join(root, 'pid'), writes = join(root, 'writes'), scopesFile = join(root, 'scopes');
  const fixtureModule = pathToFileURL(resolve(import.meta.dirname, '../src/native-fixture-process.mjs')).href;
  const writer = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>fs.appendFileSync(${JSON.stringify(writes)},'x'),10);`;
  const worker = `import {spawnFixtureProcess,trackFixtureProcess} from ${JSON.stringify(fixtureModule)};import {existsSync,writeFileSync} from 'node:fs';import {join} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';const child=spawnFixtureProcess(process.execPath,['-e',${JSON.stringify(writer)}],{stdio:'ignore'});const tracked=trackFixtureProcess(child);const inherited=${JSON.stringify(inheritedScopes)};const scopes=JSON.parse(process.env.PUDDLES_PROCESS_SCOPES).filter(scope=>!inherited.includes(scope));writeFileSync(${JSON.stringify(scopesFile)},JSON.stringify(scopes));for(const scope of scopes){if(${JSON.stringify(registration)}==='pending')writeFileSync(join(scope,'launches','000-pending.json'),JSON.stringify({status:'pending'}));if(${JSON.stringify(registration)}.startsWith('stale-'))writeFileSync(join(scope,'launches',${JSON.stringify(registration === 'stale-first' ? '000-stale.json' : 'zzz-stale.json')}),JSON.stringify({status:'registered',pid:child.pid,start:'earlier process start'}));}while(!existsSync(${JSON.stringify(writes)}))await delay(10);process.exit(17);`;
  const { runCommand } = await import('../src/process-runner.mjs');
  try {
    const failure = await runCommand(process.execPath, ['--input-type=module', '-e', worker], { quiet: true, timeoutMs: 5000, killGraceMs: 100 }).catch(error => error);
    if (registration === 'pending') expect(failure.errors.map((error: Error) => error.message)).toEqual(expect.arrayContaining([expect.stringMatching(/incomplete/)]));
    else expect(failure.message).toMatch(/17/);
    const pid = Number(readFileSync(pidFile, 'utf8')), stopped = readFileSync(writes, 'utf8');
    expect(() => process.kill(pid, 0)).toThrow();
    await new Promise(resolve => setTimeout(resolve, 100)); expect(readFileSync(writes, 'utf8')).toBe(stopped);
  } finally {
    if (existsSync(scopesFile)) {
      // @ts-expect-error Maintained executable release helper is tested at runtime.
      const { processScopeRecords } = await import('../../release/src/owned-process.mjs');
      // @ts-expect-error Maintained executable release helper is tested at runtime.
      const { stopInterruptedChild } = await import('../../release/src/commands.mjs');
      for (const scope of JSON.parse(readFileSync(scopesFile, 'utf8'))) if (existsSync(scope)) {
        rmSync(join(scope, 'launches', '000-pending.json'), { force: true });
        const [record] = processScopeRecords(scope);
        await stopInterruptedChild({ ...record, scope });
      }
    }
    if (existsSync(pidFile)) try { process.kill(-Number(readFileSync(pidFile, 'utf8')), 'SIGKILL'); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);

it('failed joining preserves qualification state while native cleanup still runs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'application-failed-join-')), state = join(root, 'state');
  mkdirSync(state);
  const pidFile = join(root, 'pid'), scopesFile = join(root, 'scopes'), writes = join(root, 'writes'), attempted = join(root, 'cleanup-attempted');
  const moduleUrl = (file: string) => pathToFileURL(resolve(import.meta.dirname, '../src', file)).href;
  const writer = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));fs.writeFileSync(${JSON.stringify(scopesFile)},JSON.stringify(JSON.parse(process.env.PUDDLES_PROCESS_SCOPES).filter(scope=>!${JSON.stringify(inheritedScopes)}.includes(scope))));setInterval(()=>fs.appendFileSync(${JSON.stringify(writes)},fs.existsSync(${JSON.stringify(state)})?'present':'deleted'),10);`;
  const wrapper = join(root, 'wrapper.mjs');
  writeFileSync(wrapper, `import {writeFileSync} from 'node:fs';import {withApplicationCheckCleanup} from ${JSON.stringify(moduleUrl('application-check-cleanup.mjs'))};import {registerNativeFixture} from ${JSON.stringify(moduleUrl('native-fixture.mjs'))};import {runCommand} from ${JSON.stringify(moduleUrl('process-runner.mjs'))};const kill=process.kill.bind(process);process.kill=(pid,signal)=>{if(pid<0&&signal!==0)throw Object.assign(new Error('synthetic EPERM'),{code:'EPERM'});return kill(pid,signal);};registerNativeFixture(async()=>writeFileSync(${JSON.stringify(attempted)},'attempted'));await withApplicationCheckCleanup(${JSON.stringify(state)},()=>runCommand(process.execPath,['-e',${JSON.stringify(writer)}],{cwd:${JSON.stringify(state)},timeoutMs:5000,killGraceMs:100}));`);
  const child = spawn(process.execPath, [wrapper], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 100 && !existsSync(writes); i++) await new Promise(resolve => setTimeout(resolve, 20));
    expect(existsSync(writes)).toBe(true);
    const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM');
    expect(await done).toBe(143);
    expect(existsSync(state)).toBe(true); expect(existsSync(attempted)).toBe(true);
    const pid = Number(readFileSync(pidFile, 'utf8')); expect(() => process.kill(pid, 0)).not.toThrow();
    await new Promise(resolve => setTimeout(resolve, 60)); expect(readFileSync(writes, 'utf8')).not.toContain('deleted');
  } finally {
    child.kill('SIGKILL');
    if (existsSync(scopesFile)) {
      // Recovery uses the retained controller seam after the injected failure.
      // @ts-expect-error Maintained executable release helper is tested at runtime.
      const { stopInterruptedChild } = await import('../../release/src/commands.mjs');
      // @ts-expect-error Maintained executable release helper is tested at runtime.
      const { processScopeRecords } = await import('../../release/src/owned-process.mjs');
      for (const scope of JSON.parse(readFileSync(scopesFile, 'utf8'))) {
        const [record] = processScopeRecords(scope);
        await stopInterruptedChild({ ...record, scope });
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);


it('failure fixtures preserve their supervising command and retire only their own scopes', async () => {
  // @ts-expect-error Maintained executable release helper is tested at runtime.
  const { command } = await import('../../release/src/commands.mjs');
  // @ts-expect-error Maintained executable release helper is tested at runtime.
  const { inspectProcessScope } = await import('../../release/src/owned-process.mjs');
  let receipt: { pid: number; scope: string } | undefined;
  let cleared = false;
  await command({
    command: process.execPath,
    args: [resolve(import.meta.dirname, '../node_modules/vitest/vitest.mjs'), 'run',
      'tests/application-check-cleanup.test.ts', '--maxWorkers', '1',
      '-t', 'unexpected worker exit|failed joining preserves qualification state'],
    cwd: resolve(import.meta.dirname, '..'), timeoutMs: 30_000,
  }, {}, (child: { pid: number; scope: string } | null) => {
    if (child) receipt = child; else cleared = true;
  });
  expect(receipt).toBeDefined();
  expect(cleared).toBe(true);
  expect(existsSync(receipt!.scope)).toBe(false);
  expect(() => process.kill(receipt!.pid, 0)).toThrow();
  for (const scope of inheritedScopes) {
    expect(existsSync(join(scope, 'closing'))).toBe(false);
    expect(inspectProcessScope(scope).incomplete).toBe(false);
  }
}, 40_000);
