import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { replaceBackup, restoreBackup, verifyBackup } from '../src/backup.mjs';
import { enqueue, cancel, readQueue, updateQueue } from '../src/queue.mjs';
import { deployDev, runNext, validateConfiguration } from '../src/controller.mjs';
import { installTool } from '../src/install.mjs';
import { treeHash } from '../src/files.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'puddles-release-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const spec = name => ({ command: process.execPath, args: ['-e', ''], cwd: root, timeoutMs: 1000, env: { FIXTURE_ACTION: name } });
  const target = name => ({ runtime: join(root, name), stop: spec(name + '-stop'), start: spec(name + '-start'),
    health: spec(name + '-health'), tests: spec(name + '-tests') });
  const config = { version: 1, root: join(root, 'coordination'), test: target('test'), prod: target('prod'),
    backup: { root: join(root, 'backup'), paths: [{ name: 'runtime', path: join(root, 'prod') }, { name: 'state', path: join(root, 'state') }] } };
  config.prod.quiesce = spec('quiesce'); config.prod.resumeIntake = spec('resume-intake');
  for (const name of ['prod', 'state', 'workspace/artifact']) mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, 'prod/version'), 'old'); writeFileSync(join(root, 'state/history'), 'preserved');
  writeFileSync(join(root, 'workspace/artifact/version'), 'new');
  const ticket = { id: 'feature', workspace: join(root, 'workspace'), artifact: join(root, 'workspace/artifact'),
    rebase: spec('rebase'), build: spec('build'), applicationTests: spec('applicationTests'), merge: spec('merge') };
  const seen = [];
  const execute = async (cmd, env) => { seen.push(env.PUDDLES_RELEASE_PHASE); };
  return { root, config, ticket, seen, execute };
}

test('full application suite, TEST, backup, PROD, merge execute in order on one artifact', async t => {
  const f = fixture(t); enqueue(f.config.root, f.ticket);
  const result = await runNext(f.config, f.execute);
  assert.equal(result.status, 'released');
  assert.deepEqual(f.seen, ['rebase', 'build', 'applicationTests', 'test-stop', 'test-start', 'test-health', 'test-tests',
    'quiesce', 'backup-health', 'backup-stop', 'backup-restart', 'backup-restarted-health', 'prod-stop', 'prod-start', 'prod-health', 'prod-tests', 'merge', 'resume-intake', 'resume-health']);
  assert.equal(readFileSync(join(f.root, 'prod/version'), 'utf8'), 'new');
  assert.equal(readFileSync(join(f.root, 'backup/runtime/version'), 'utf8'), 'old');
  assert.equal(treeHash(f.ticket.artifact), treeHash(f.config.prod.runtime));
  assert.equal(readQueue(f.config.root).active, null);
  assert.deepEqual(readdirSync(f.config.root).sort(), ['current.json', 'queue.json', 'queue.lock', 'release.lock']);
});

for (const failedPhase of ['rebase', 'build', 'applicationTests', 'test-start', 'test-tests', 'backup-stop', 'prod-start', 'prod-tests']) {
  test(`${failedPhase} failure recovers and lets the next feature proceed`, async t => {
    const f = fixture(t); enqueue(f.config.root, f.ticket); enqueue(f.config.root, { ...f.ticket, id: 'second' });
    let failed = false;
    const result = await runNext(f.config, async (cmd, env) => {
      f.seen.push(env.PUDDLES_RELEASE_PHASE);
      if (!failed && env.PUDDLES_RELEASE_PHASE === failedPhase) { failed = true; throw new Error('injected failure'); }
    });
    assert.equal(result.status, 'failed');
    assert.equal(readQueue(f.config.root).active, null);
    assert.equal(readQueue(f.config.root).ready[0].id, 'second');
    assert.equal(readFileSync(join(f.root, 'prod/version'), 'utf8'), 'old');
    if (failedPhase.startsWith('prod')) assert.ok(f.seen.includes('restore-health'));
    if (failedPhase === 'applicationTests') assert.ok(!f.seen.includes('test-stop'));
    enqueue(f.config.root, f.ticket);
    assert.deepEqual(readQueue(f.config.root).ready.map(x => x.id), ['second', 'feature']);
  });
}

test('failed final merge keeps the slot; retry merges without redeploying', async t => {
  const f = fixture(t); enqueue(f.config.root, f.ticket);
  const result = await runNext(f.config, async (cmd, env) => {
    if (env.PUDDLES_RELEASE_PHASE === 'merge') throw new Error('GitHub unavailable');
  });
  assert.equal(result.status, 'merge-pending');
  assert.equal(readQueue(f.config.root).active.id, 'feature');
  assert.throws(() => cancel(f.config.root, 'feature'), /active release/);
  assert.equal((await runNext(f.config, f.execute)).status, 'released');
  assert.deepEqual(f.seen, ['merge', 'resume-intake', 'resume-health']);
});

test('changed frozen output cannot reach TEST or PROD', async t => {
  const f = fixture(t); enqueue(f.config.root, f.ticket);
  const result = await runNext(f.config, async (cmd, env) => {
    f.seen.push(env.PUDDLES_RELEASE_PHASE);
    if (env.PUDDLES_RELEASE_PHASE === 'applicationTests') writeFileSync(join(f.ticket.artifact, 'version'), 'unreviewed');
  });
  assert.equal(result.status, 'failed'); assert.ok(!f.seen.includes('test-stop'));
});

test('an interrupted production deployment restores before releasing its ticket', async t => {
  const f = fixture(t); enqueue(f.config.root, f.ticket);
  await runNext(f.config, async (cmd, env) => { if (env.PUDDLES_RELEASE_PHASE === 'merge') throw new Error('pause'); });
  updateQueue(f.config.root, state => { state.active.phase = 'prod'; state.active.status = 'running'; state.active.completed = state.active.completed.filter(x => x !== 'prod'); });
  assert.equal((await runNext(f.config, f.execute)).status, 'failed');
  assert.equal(readFileSync(join(f.root, 'prod/version'), 'utf8'), 'old');
  assert.deepEqual(f.seen, ['restore-stop', 'restore-start', 'restore-health', 'recover-intake', 'recover-intake-health']);
});

test('backup replaces the existing generation directly and restores readable state', async t => {
  const f = fixture(t);
  const run = async () => {};
  await replaceBackup(f.config.backup, f.config.prod, run);
  writeFileSync(join(f.root, 'state/history'), 'new state');
  writeFileSync(join(f.root, 'backup/obsolete'), 'must disappear');
  await replaceBackup(f.config.backup, f.config.prod, run);
  assert.ok(!existsSync(join(f.root, 'backup/obsolete')));
  assert.deepEqual(readdirSync(f.config.backup.root).sort(), ['backup.json', 'runtime', 'state']);
  writeFileSync(join(f.root, 'state/history'), 'corrupt');
  await restoreBackup(f.config.backup, f.config.prod, run);
  assert.equal(readFileSync(join(f.root, 'state/history'), 'utf8'), 'new state');
});

test('failed replacement invalidates old backup and restarts unchanged production', async t => {
  const f = fixture(t); await replaceBackup(f.config.backup, f.config.prod, async () => {});
  rmSync(join(f.root, 'state'), { recursive: true });
  const seen = [];
  await assert.rejects(replaceBackup(f.config.backup, f.config.prod, async (_, phase) => seen.push(phase)));
  assert.throws(() => verifyBackup(f.config.backup), /verified recovery/);
  assert.deepEqual(seen.slice(-2), ['backup-restart', 'backup-restarted-health']);
  assert.equal(readFileSync(join(f.root, 'prod/version'), 'utf8'), 'old');
});

test('failed deployment removes newly created guidance without restoring its unrelated workspace', async t => {
  const f = fixture(t), parent = join(f.root, 'authored-workspace');
  mkdirSync(parent);
  const guidance = join(parent, 'AGENTS.md'), other = join(parent, 'notes.md');
  writeFileSync(other, 'before');
  f.config.backup.paths.push({ name: 'guidance', path: guidance, allowAbsent: true });
  enqueue(f.config.root, f.ticket);
  const result = await runNext(f.config, async (_, env) => {
    if (env.PUDDLES_RELEASE_PHASE === 'prod-tests') {
      writeFileSync(guidance, 'candidate guidance'); writeFileSync(other, 'independent update');
      throw new Error('candidate rejected');
    }
  });
  assert.equal(result.status, 'failed');
  assert.ok(!existsSync(guidance));
  assert.equal(readFileSync(other, 'utf8'), 'independent update');
  assert.equal(readFileSync(join(f.root, 'prod/version'), 'utf8'), 'old');
  assert.equal(readQueue(f.config.root).active, null);
});

test('an optional path that exists is captured and restored normally', async t => {
  const f = fixture(t), guidance = join(f.root, 'AGENTS.md');
  writeFileSync(guidance, 'accepted instructions');
  f.config.backup.paths.push({ name: 'guidance', path: guidance, allowAbsent: true });
  await replaceBackup(f.config.backup, f.config.prod, async () => {});
  writeFileSync(guidance, 'rejected instructions');
  await restoreBackup(f.config.backup, f.config.prod, async () => {});
  assert.equal(readFileSync(guidance, 'utf8'), 'accepted instructions');
});

test('absence does not permit unexpected backup bytes or dangling source links', async t => {
  const f = fixture(t), guidance = join(f.root, 'AGENTS.md');
  f.config.backup.paths.push({ name: 'guidance', path: guidance, allowAbsent: true });
  await replaceBackup(f.config.backup, f.config.prod, async () => {});
  writeFileSync(join(f.config.backup.root, 'guidance'), 'unexpected data');
  assert.throws(() => verifyBackup(f.config.backup), /changed/);
  await assert.rejects(restoreBackup(f.config.backup, f.config.prod, async () => {}), /changed/);
  symlinkSync(join(f.root, 'missing-target'), guidance);
  await assert.rejects(replaceBackup(f.config.backup, f.config.prod, async () => {}));
  assert.throws(() => verifyBackup(f.config.backup), /verified recovery/);
});

test('production runtime cannot be optional', t => {
  const f = fixture(t); f.config.backup.paths[0].allowAbsent = true;
  assert.throws(() => validateConfiguration(f.config), /Production runtime must exist/);
  delete f.config.backup.paths[0].allowAbsent;
  f.config.backup.paths[1].allowAbsent = 'yes';
  assert.throws(() => validateConfiguration(f.config), /boolean/);
});

test('modified backup cannot authorize deployment or restoration', async t => {
  const f = fixture(t); await replaceBackup(f.config.backup, f.config.prod, async () => {});
  writeFileSync(join(f.root, 'backup/runtime/version'), 'tampered');
  assert.throws(() => verifyBackup(f.config.backup), /changed/);
});

test('backup paths and deployed paths cannot overlap', t => {
  const f = fixture(t); f.config.backup.root = join(f.root, 'state/backup');
  assert.throws(() => validateConfiguration(f.config), /overlap/);
});

test('a merge-blocked release can restore and leave the queue while intake is held', async t => {
  const f = fixture(t); enqueue(f.config.root, f.ticket);
  await runNext(f.config, async (_, env) => { if (env.PUDDLES_RELEASE_PHASE === 'merge') throw new Error('merge blocked'); });
  const result = await runNext(f.config, f.execute, { recover: true });
  assert.equal(result.status, 'failed');
  assert.equal(readFileSync(join(f.root, 'prod/version'), 'utf8'), 'old');
  assert.equal(readQueue(f.config.root).active, null);
});

test('recovery never consumes a waiting ticket', async t => {
  const f = fixture(t); enqueue(f.config.root, f.ticket);
  assert.equal((await runNext(f.config, f.execute, { recover: true })).status, 'idle');
  assert.equal(readQueue(f.config.root).ready.length, 1);
  assert.deepEqual(f.seen, []);
});

test('tool installation is independent and refuses an active release or unowned directory', t => {
  const f=fixture(t), dist=join(f.root,'tool-dist'), target=join(f.root,'installed-tool');
  mkdirSync(join(dist,'bin'),{recursive:true});writeFileSync(join(dist,'bin/puddles-release.mjs'),'// synthetic tool');
  assert.equal(installTool(dist,target,f.config).status,'installed');
  updateQueue(f.config.root,state=>{state.active={id:'active'};});
  assert.throws(()=>installTool(dist,target,f.config),/between tickets/);
  updateQueue(f.config.root,state=>{state.active=null;});
  writeFileSync(join(dist,'bin/puddles-release.mjs'),'// new synthetic tool');
  installTool(dist,target,f.config);assert.equal(readFileSync(join(target,'bin/puddles-release.mjs'),'utf8'),'// new synthetic tool');
  const foreign=join(f.root,'foreign-tool');mkdirSync(foreign);writeFileSync(join(foreign,'keep'),'other owner');
  assert.throws(()=>installTool(dist,foreign,f.config));
  assert.equal(readFileSync(join(foreign,'keep'),'utf8'),'other owner');
});
test('an uncertain intake resume cannot restore over possible new live writes', async t => {
  const f=fixture(t);enqueue(f.config.root,f.ticket);
  await runNext(f.config,async(_,env)=>{if(env.PUDDLES_RELEASE_PHASE==='resume-intake')throw new Error('uncertain resume');});
  await assert.rejects(runNext(f.config,f.execute,{recover:true}),/Intake resumed/);
});

test('recovery retries intake without restoring over writes accepted by the restored service', async t => {
  const f=fixture(t); enqueue(f.config.root,f.ticket);
  await assert.rejects(runNext(f.config,async(_,env)=>{
    if(env.PUDDLES_RELEASE_PHASE==='prod-tests') throw new Error('failed candidate');
    if(env.PUDDLES_RELEASE_PHASE==='recover-intake') {
      writeFileSync(join(f.root,'state/history'),'new live write');
      throw new Error('intake reopened before command failed');
    }
  }),/intake reopened/);
  assert.equal((await runNext(f.config,f.execute)).status,'failed');
  assert.equal(readFileSync(join(f.root,'state/history'),'utf8'),'new live write');
  assert.deepEqual(f.seen,['recover-intake', 'recover-intake-health']);
});

test('failed health after intake resumes retains ownership and preserves newly accepted data on retry', async t => {
  const f=fixture(t); enqueue(f.config.root,f.ticket); enqueue(f.config.root,{...f.ticket,id:'next'});
  const result=await runNext(f.config,async(_,env)=>{
    if(env.PUDDLES_RELEASE_PHASE==='resume-intake') writeFileSync(join(f.root,'state/history'),'new live write');
    if(env.PUDDLES_RELEASE_PHASE==='resume-health') throw new Error('normal listener unavailable');
  });
  assert.equal(result.status,'merge-pending'); assert.equal(readQueue(f.config.root).active.id,'feature');
  await assert.rejects(runNext(f.config,f.execute,{recover:true}),/Intake resumed/);
  assert.equal((await runNext(f.config,f.execute)).status,'released');
  assert.deepEqual(f.seen,['resume-intake','resume-health']);
  assert.equal(readFileSync(join(f.root,'state/history'),'utf8'),'new live write');
  assert.equal(readQueue(f.config.root).ready[0].id,'next');
});

test('failed recovered service health retries without another restore or intake restart', async t => {
  const f=fixture(t); enqueue(f.config.root,f.ticket);
  await assert.rejects(runNext(f.config,async(_,env)=>{
    if(env.PUDDLES_RELEASE_PHASE==='prod-tests') throw new Error('candidate failed');
    if(env.PUDDLES_RELEASE_PHASE==='recover-intake-health') {
      writeFileSync(join(f.root,'state/history'),'new recovered service write');
      throw new Error('normal listener unavailable');
    }
  }),/normal listener/);
  assert.equal((await runNext(f.config,f.execute)).status,'failed');
  assert.deepEqual(f.seen,['recover-intake-health']);
  assert.equal(readFileSync(join(f.root,'state/history'),'utf8'),'new recovered service write');
});

test('DEV cannot replace production state or an alias that escapes its workspace', async t => {
  const f=fixture(t);
  await assert.rejects(deployDev(f.config,f.ticket,{...f.config.test,runtime:join(f.root,'state')},f.execute),/overlap/);
  await assert.rejects(deployDev(f.config,{...f.ticket,artifact:f.ticket.workspace+'/../state'}, {...f.config.test,runtime:join(f.root,'dev')},f.execute),/normalized/);
  assert.equal(readFileSync(join(f.root,'state/history'),'utf8'),'preserved');
  assert.deepEqual(f.seen,[]);
});
