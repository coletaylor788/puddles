import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
it('interruption joins test workers and detached fixtures before deleting test state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'application-interrupt-')), state = join(root, 'state');
  mkdirSync(state); const pidFile = join(root, 'fixture.pid'), stopped = join(root, 'fixture.stopped');
  const moduleUrl = (file: string) => pathToFileURL(resolve(import.meta.dirname, '../src', file)).href;
  const worker = join(root, 'worker.test.mjs'), wrapper = join(root, 'wrapper.mjs');
  writeFileSync(worker, `
import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; import test from 'node:test';
import {registerNativeFixture} from ${JSON.stringify(moduleUrl('native-fixture.mjs'))};
test('pending fixture', async () => {
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
 await new Promise(r=>child.once('spawn',r));
 registerNativeFixture(async()=>{const done=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await done;writeFileSync(${JSON.stringify(stopped)},'stopped');});
 writeFileSync(${JSON.stringify(pidFile)},String(child.pid)); await new Promise(()=>{});
});`);
  writeFileSync(wrapper, `
import {withApplicationCheckCleanup} from ${JSON.stringify(moduleUrl('application-check-cleanup.mjs'))};
import {runCommand} from ${JSON.stringify(moduleUrl('process-runner.mjs'))};
await withApplicationCheckCleanup(${JSON.stringify(state)},()=>runCommand(process.execPath,['--import',${JSON.stringify(moduleUrl('application-test-lifecycle.mjs'))},'--test',${JSON.stringify(worker)}],{cwd:${JSON.stringify(state)}}));`);
  const child = spawn(process.execPath, [wrapper], { stdio: 'ignore' });
  let fixturePid: number | undefined;
  try {
    for (let i=0; i<100 && !existsSync(pidFile); i++) await new Promise(r=>setTimeout(r,50));
    expect(existsSync(pidFile)).toBe(true); fixturePid=Number(readFileSync(pidFile,'utf8'));
    const exit = new Promise(r=>child.once('exit',r)); child.kill('SIGTERM'); await exit;
    expect(existsSync(stopped)).toBe(true); expect(existsSync(state)).toBe(false);
    expect(()=>process.kill(fixturePid!,0)).toThrow();
  } finally {
    child.kill('SIGKILL'); if(fixturePid) try {process.kill(fixturePid,'SIGKILL');} catch {}
    rmSync(root,{recursive:true,force:true});
  }
},20000);
