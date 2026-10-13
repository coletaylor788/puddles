import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { enqueue, readQueue } from '../src/queue.mjs';
const cli = fileURLToPath(new URL('../bin/puddles-release.mjs', import.meta.url));
const pause = ms => new Promise(r => setTimeout(r, ms));
function fixture(t, fail) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'release-supervisor-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, 'action.cjs');
  writeFileSync(script, `const fs=require('node:fs');const phase=process.env.PUDDLES_RELEASE_PHASE;const root=process.cwd();fs.appendFileSync(root+'/calls',phase+'\\n');
if(phase==='prod-start') fs.writeFileSync(root+'/state/history','candidate changed state');
if(phase===${JSON.stringify(fail)}) { if(phase==='prod-tests'||phase==='backup-stop') { process.kill(process.ppid,'SIGKILL'); setInterval(()=>fs.appendFileSync(root+'/writes','x'),10); } else if(phase==='applicationTests') setTimeout(()=>{},800); else process.exit(1); }
`);
  const cmd = { command: process.execPath, args: [script], cwd: root, timeoutMs: 4000 };
  const target = name => ({ runtime: join(root, name), stop: cmd, start: cmd, health: cmd, tests: cmd });
  const config = { version: 1, root: join(root, 'coordination'), test: target('test'), prod: { ...target('prod'), quiesce: cmd, resumeIntake: cmd },
    backup: { root: join(root, 'backup'), paths: [{ name: 'runtime', path: join(root, 'prod') }, { name: 'state', path: join(root, 'state') }] } };
  for (const dir of ['prod', 'state', 'workspace/artifact']) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'prod/version'), 'old'); writeFileSync(join(root, 'state/history'), 'original');
  writeFileSync(join(root, 'workspace/artifact/version'), 'new');
  const ticket = { id: 'feature', workspace: join(root, 'workspace'), artifact: join(root, 'workspace/artifact'), rebase: cmd, build: cmd, applicationTests: cmd, merge: cmd };
  enqueue(config.root, ticket);
  const path = join(root, 'config.json'); writeFileSync(path, JSON.stringify(config));
  const launch = (action='run') => {
    const child = spawn(process.execPath, [cli, action, path], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PUDDLES_RELEASE_WORKER: '', PUDDLES_RELEASE_RECOVER_OWNER: '' } });
    let output=''; child.stdout.on('data', x=>output+=x); child.stderr.on('data', x=>output+=x);
    t.after(()=> { try { child.kill('SIGKILL'); } catch {} });
    return { child, done: once(child, 'exit').then(([code])=>({code,output})) };
  };
  return { root, config, launch };
}
test('the CLI promotes one feature and clears the queue using real child commands', async t => {
  const f=fixture(t); const result=await f.launch().done;
  assert.equal(result.code,0,result.output);
  assert.equal(readQueue(f.config.root).active,null);
  assert.equal(readFileSync(join(f.root,'prod/version'),'utf8'),'new');
  assert.equal(readFileSync(join(f.root,'backup/runtime/version'),'utf8'),'old');
  const calls=readFileSync(join(f.root,'calls'),'utf8').trim().split('\n');
  assert.ok(calls.indexOf('applicationTests')<calls.indexOf('test-tests'));
  assert.ok(calls.indexOf('test-tests')<calls.indexOf('backup-stop'));
  assert.ok(calls.indexOf('prod-tests')<calls.indexOf('merge'));
});
test('a SIGKILLed deployment worker is recovered without an agent or next release', async t => {
  const f=fixture(t,'prod-tests'); const result=await f.launch().done;
  assert.equal(result.code,1,result.output);
  assert.equal(readQueue(f.config.root).active,null,result.output);
  assert.equal(readFileSync(join(f.root,'prod/version'),'utf8'),'old');
  assert.equal(readFileSync(join(f.root,'state/history'),'utf8'),'original');
  const calls=readFileSync(join(f.root,'calls'),'utf8');
  assert.match(calls,/restore-health/); assert.doesNotMatch(calls,/\nmerge\n/);
});
test('a competing CLI cannot recover or interrupt the live owner', async t => {
  const f=fixture(t,'applicationTests'); const first=f.launch();
  for(let i=0;i<200;i++) { if(readQueue(f.config.root).active?.operation==='applicationTests') break; await pause(10); }
  const second=await f.launch().done;
  assert.equal(second.code,1); assert.match(second.output,/already running/);
  const result=await first.done; assert.equal(result.code,0,result.output);
  assert.equal(readFileSync(join(f.root,'prod/version'),'utf8'),'new');
});

test('a killed standalone backup worker restarts unchanged PROD without an agent', async t => {
  const f=fixture(t,'backup-stop');
  const result=await f.launch('backup').done;
  assert.equal(result.code,1,result.output);
  assert.equal(readQueue(f.config.root).active,null,result.output);
  assert.equal(readQueue(f.config.root).ready.length,1);
  assert.equal(readFileSync(join(f.root,'prod/version'),'utf8'),'old');
  assert.equal(readFileSync(join(f.root,'state/history'),'utf8'),'original');
  assert.match(readFileSync(join(f.root,'calls'),'utf8'),/recover-backup-start\nrecover-backup-health/);
});
