import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { beginCheckOutput, finishCheckOutput, retireCheckOutput } from '../src/check-output.mjs';
import { treeHash } from '../src/files.mjs';
const helper = new URL('../src/check-output.mjs', import.meta.url).href;
const cli = fileURLToPath(new URL('../bin/puddles-release.mjs', import.meta.url));
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'check-output-test-'))), root = join(base, 'output');
  mkdirSync(root);
  t.after(() => {
    const receipt = root + '.check-output/receipt.json';
    if (existsSync(receipt)) {
      const r = JSON.parse(readFileSync(receipt));
      // Every fixture child is joined in its test. Only this test's scopes remain.
      if (existsSync(r.scope)) rmSync(r.scope, { recursive: true });
    }
    rmSync(base, { recursive: true, force: true });
  });
  return { base, root };
}
function child(source, cwd) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', source], { cwd, encoding: 'utf8', timeout: 15000 });
  assert.equal(r.error, undefined); return r;
}
function retained(root, extra = '', completion = '') {
  const r = child(`import {beginCheckOutput,finishCheckOutput} from ${JSON.stringify(helper)};
import {writeFileSync,symlinkSync} from 'node:fs';
const h=beginCheckOutput(${JSON.stringify(root)},{owner:'fixture'});
writeFileSync(${JSON.stringify(join(root, 'diagnostic'))},'failure evidence');
${extra}
try { finishCheckOutput(h,{failed:true${completion}}); } catch(error) { console.error(error.message); }
console.log(JSON.stringify(h));`, tmpdir());
  assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout);
}
function request(base, handle, options = {}) {
  const path = join(base, 'request.json');
  writeFileSync(path, JSON.stringify({ ...handle, ...options }));
  return spawnSync(process.execPath, [cli, 'check-output-retire', path], { encoding: 'utf8', timeout: 15000 });
}
test('failed diagnostics retire through the installed command contract in a fresh process', t => {
  const { base, root } = fixture(t), h = retained(root);
  assert.equal(readFileSync(join(root, 'diagnostic'), 'utf8'), 'failure evidence');
  assert.equal(JSON.parse(readFileSync(h.receipt)).status, 'failed-retained');
  const missing = request(base, h); assert.equal(missing.status, 1); assert.match(missing.stderr, /Acknowledge/);
  const wrong = request(base, h, { owner: 'another', acknowledgeFailure: true }); assert.equal(wrong.status, 1);
  const result = request(base, h, { acknowledgeFailure: true }); assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(root), false); assert.equal(JSON.parse(readFileSync(h.receipt)).status, 'removed');
  assert.equal(request(base, h).status, 0, 'completed retirement is idempotent');
  mkdirSync(root); writeFileSync(join(root, 'replacement'), 'preserve');
  assert.equal(request(base, h).status, 1); assert.equal(existsSync(join(root, 'replacement')), true);
});
test('successful checks remove output and keep a terminal receipt', t => {
  const { root } = fixture(t), h = beginCheckOutput(root);
  writeFileSync(join(root, 'result'), 'passed');
  assert.equal(finishCheckOutput(h).status, 'removed');
  assert.equal(existsSync(root), false); assert.equal(JSON.parse(readFileSync(h.receipt)).outcome, 'passed');
});
for (const change of ['content', 'identity', 'recovery', 'linked-root']) test('retirement refuses changed ' + change, t => {
  const { base, root } = fixture(t), h = retained(root);
  if (change === 'content') writeFileSync(join(root, 'diagnostic'), 'changed');
  if (change === 'recovery') writeFileSync(join(root, 'recovery.json'), '{}');
  if (['identity', 'linked-root'].includes(change)) {
    renameSync(root, root + '-original');
    if (change === 'identity') mkdirSync(root); else symlinkSync(root + '-original', root);
  }
  const r = request(base, h, { acknowledgeFailure: true }); assert.equal(r.status, 1, r.stdout);
  assert.equal(existsSync(root), true);
});
test('live creator cannot retire its failed diagnostics', t => {
  const { root } = fixture(t), h = beginCheckOutput(root);
  finishCheckOutput(h, { failed: true });
  assert.throws(() => retireCheckOutput({ ...h, acknowledgeFailure: true }), /active process/);
  assert.equal(existsSync(root), true);
});
for (const kind of ['incomplete', 'fixture-cleanup', 'recovery']) test('uncertain ' + kind + ' remains held after producer exit', t => {
  const { base, root } = fixture(t);
  const extra = kind === 'incomplete' ? "writeFileSync(h.scope+'/launches/pending.json',JSON.stringify({status:'pending'}));" : kind === 'recovery' ? `writeFileSync(${JSON.stringify(join(root, 'recovery.json'))},'{}');` : '';
  const h = retained(root, extra, kind === 'fixture-cleanup' ? ',fixturesStopped:false' : '');
  assert.equal(JSON.parse(readFileSync(h.receipt)).status, 'recovery-required');
  assert.equal(request(base, h, { acknowledgeFailure: true }).status, 1);
  assert.equal(existsSync(root), true); assert.equal(existsSync(h.scope), true);
});
test('fresh registration rejects existing output and links', t => {
  const { base, root } = fixture(t);
  writeFileSync(join(root, 'already-written'), 'preserve');
  assert.throws(() => beginCheckOutput(root), /before writing/);
  const linked = join(base, 'linked'); symlinkSync(root, linked);
  assert.throws(() => beginCheckOutput(linked), /unlinked/);
  assert.equal(existsSync(root + '.check-output'), false);
});
test('nested external links are hashed without following them and never deleted', t => {
  const { base, root } = fixture(t), outside = join(base, 'outside'); writeFileSync(outside, 'keep');
  const h = retained(root, `symlinkSync(${JSON.stringify(outside)},${JSON.stringify(join(root, 'link'))});`);
  assert.throws(() => treeHash(root), /escapes/);
  assert.equal(request(base, h, { acknowledgeFailure: true }).status, 0);
  assert.equal(readFileSync(outside, 'utf8'), 'keep');
});
test('a foreign process holding diagnostics blocks retirement without being killed', async t => {
  const { base, root } = fixture(t), h = retained(root);
  const writer = spawn(process.execPath, ['-e', `require('node:fs').openSync(${JSON.stringify(join(root, 'diagnostic'))},'r');console.log('ready');setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'ignore'] });
  const done = once(writer, 'exit');
  try {
    await once(writer.stdout, 'data');
    const r = request(base, h, { acknowledgeFailure: true }); assert.equal(r.status, 1); assert.match(r.stderr, /open handles|references/);
    process.kill(writer.pid, 0); assert.equal(existsSync(root), true);
  } finally { writer.kill('SIGTERM'); await done; }
  assert.equal(request(base, h, { acknowledgeFailure: true }).status, 0);
});
test('an interrupted removal resumes from the original directory identity', t => {
  const { base, root } = fixture(t), h = retained(root, `writeFileSync(${JSON.stringify(join(root, 'second'))},'second');`);
  const r = child(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
const rm=fs.rmSync;fs.rmSync=(path,options)=>{if(path.includes('.retiring-')){rm(path+'/diagnostic');throw new Error('interrupted removal');}return rm(path,options);};syncBuiltinESMExports();
const {retireCheckOutput}=await import(${JSON.stringify(helper)});retireCheckOutput(${JSON.stringify({ ...h, acknowledgeFailure: true })});`, base);
  assert.equal(r.status, 1); assert.match(r.stderr, /interrupted removal/);
  const record = JSON.parse(readFileSync(h.receipt)); assert.equal(record.status, 'retiring');
  assert.equal(existsSync(root), false); assert.equal(existsSync(join(record.trash, 'second')), true);
  assert.equal(request(base, h).status, 0); assert.equal(existsSync(record.trash), false);
});
test('native child registration is inherited and retired before successful output cleanup', t => {
  const { root, base } = fixture(t);
  const commands = new URL('../src/commands.mjs', import.meta.url).href;
  const result = child(`import {beginCheckOutput,finishCheckOutput} from ${JSON.stringify(helper)};
import {command} from ${JSON.stringify(commands)};import {writeFileSync,readFileSync} from 'node:fs';
const h=beginCheckOutput(${JSON.stringify(root)});
process.env.PUDDLES_PROCESS_SCOPES=JSON.stringify([...JSON.parse(process.env.PUDDLES_PROCESS_SCOPES??'[]'),h.scope]);
await command({command:process.execPath,args:['-e','require("node:fs").writeFileSync("joined-result","ok")'],cwd:${JSON.stringify(root)},timeoutMs:10000});
finishCheckOutput(h);const r=JSON.parse(readFileSync(h.receipt));if(r.records.length!==1||r.status!=='removed')throw Error('Native scope did not bind the joined child');`, base);
  assert.equal(result.status, 0, result.stderr); assert.equal(existsSync(root), false);
});
