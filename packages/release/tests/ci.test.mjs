import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicJson, readJson } from '../src/files.mjs';
import { collectCandidates, loadCandidate, publishCandidate, recordGate, digest } from '../src/ci-candidate.mjs';
import { cancelCI, cancelRequestCI, deliverEvents, executeCI, requestCI, reconcileCI } from '../src/ci-run.mjs';
import { readQueue } from '../src/queue.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'puddles-ci-test-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const spec = name => ({ command: process.execPath, args: ['-e', ''], cwd: root, timeoutMs: 1000, env: { ACTION: name } });
  const target = name => ({ runtime: join(root, name), stop: spec(name + '-stop'), start: spec(name + '-start'), health: spec(name + '-health'), tests: spec(name + '-tests') });
  const config = { version: 1, registry: join(root, 'registry'), runs: join(root, 'runs'), dev: target('dev'),
    controller: { version: 1, root: join(root, 'controller'), test: target('test'), prod: target('prod'),
      backup: { root: join(root, 'backup'), paths: [{ name: 'runtime', path: join(root, 'prod') }] } },
    preflight: spec('preflight'), applicationTests: spec('applicationTests'), merge: spec('merge'), devCleanup: spec('dev-cleanup'), testCleanup: spec('test-cleanup'), notify: spec('notify') };
  config.controller.prod.quiesce = spec('quiesce'); config.controller.prod.resumeIntake = spec('resume');
  for (const name of ['source', 'prod']) { mkdirSync(join(root, name)); writeFileSync(join(root, name, 'version'), name); }
  const inputs = { repositories: [{ repository: 'example/app', head: '1'.repeat(40), base: '2'.repeat(40), tree: '3'.repeat(40), pullRequest: 1 }] };
  const policy = { maxBytes: 1024 * 1024, reserveBytes: 0 };
  const manifest = publishCandidate(config.registry, join(root, 'source'), inputs, policy);
  recordGate(config.registry, manifest.id, 'dev', { status: 'passed', targetDigest: digest(config.dev), run: 'previous-dev' });
  const request = (id, mode = 'dev') => requestCI(config, { id, candidate: manifest.id, mode, owner: 'fixture-task', githubRun: '1:1' });
  const seen = [];
  const execute = async (cmd, env) => { seen.push(cmd.env.ACTION); if (cmd.env.ACTION.endsWith('-cleanup')) rmSync(config[cmd.env.ACTION === 'dev-cleanup' ? 'dev' : 'controller'].runtime ?? config.controller.test.runtime, { recursive: true, force: true }); };
  return { root, config, manifest, request, execute, seen, inputs, policy };
}

test('published build retains bytes and rejects source-manifest and artifact mutation', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'source/version'), 'later edits');
  assert.equal(readFileSync(join(loadCandidate(f.config.registry, f.manifest.id).artifact, 'version'), 'utf8'), 'source');
  const path = join(f.config.registry, f.manifest.id, 'manifest.json');
  const changed = readJson(path); changed.repositories[0].head = '4'.repeat(40); atomicJson(path, changed);
  assert.throws(() => loadCandidate(f.config.registry, f.manifest.id), /identity changed/);
  atomicJson(path, f.manifest);
  writeFileSync(join(f.config.registry, f.manifest.id, 'artifact/version'), 'modified');
  assert.throws(() => loadCandidate(f.config.registry, f.manifest.id), /candidate changed/);
});

test('DEV holds ownership through failed cleanup and retry never redeploys', async t => {
  const f = fixture(t); f.request('one'); f.request('two');
  await assert.rejects(executeCI(f.config, 'one', async cmd => { if (cmd.env.ACTION === 'dev-cleanup') throw new Error('cleanup failure'); }));
  assert.equal(readJson(join(f.config.runs, 'one.json')).status, 'cleanup-required');
  assert.equal((await executeCI(f.config, 'two', f.execute)).status, 'admitted');
  assert.deepEqual(f.seen, []);
  assert.equal((await executeCI(f.config, 'one', f.execute)).status, 'passed');
  assert.deepEqual(f.seen, ['dev-stop', 'dev-cleanup']);
  assert.equal((await executeCI(f.config, 'two', f.execute)).status, 'passed');
  assert.equal(existsSync(f.config.dev.runtime), false);
});

test('request and event delivery are idempotent and candidate pins close after teardown', async t => {
  const f = fixture(t); const first = f.request('one'); assert.deepEqual(f.request('one'), first);
  assert.throws(() => f.request('one', 'prod'), /reused/);
  assert.deepEqual(collectCandidates(f.config.registry, { maxAgeMs: 0 }), []);
  const result = await executeCI(f.config, 'one', f.execute);
  assert.deepEqual(result.events.map(x => x.status), ['started', 'passed']);
  const deliveries = [];
  await deliverEvents(f.config, async (_, env) => deliveries.push(JSON.parse(env.PUDDLES_CI_EVENT).id));
  await deliverEvents(f.config, async () => assert.fail('duplicate delivery'));
  assert.deepEqual(deliveries, ['one:0', 'one:1']);
  assert.deepEqual(collectCandidates(f.config.registry, { maxAgeMs: 0 }), [f.manifest.id]);
  assert.equal((await executeCI(f.config, 'one', f.execute)).status, 'passed');
});

test('frozen production runs full suite before TEST, merges after PROD, then cleans TEST', async t => {
  const f = fixture(t); f.request('prod-one', 'prod');
  assert.equal((await executeCI(f.config, 'prod-one', (cmd, env) => {
    assert.equal(env.PUDDLES_CI_RUN, 'prod-one');
    assert.equal(env.PUDDLES_CI_CANDIDATE, f.manifest.id);
    return f.execute(cmd, env);
  })).status, 'passed');
  assert.deepEqual(f.seen, ['preflight', 'preflight', 'applicationTests', 'test-stop', 'test-start', 'test-health', 'test-tests', 'quiesce',
    'prod-health', 'prod-stop', 'prod-start', 'prod-health', 'prod-stop', 'prod-start', 'prod-health', 'prod-tests', 'merge', 'resume', 'prod-health', 'test-stop', 'test-cleanup']);
  assert.equal(readFileSync(join(f.root, 'prod/version'), 'utf8'), 'source');
  assert.equal(readFileSync(join(f.root, 'backup/runtime/version'), 'utf8'), 'prod');
  assert.equal(existsSync(f.config.controller.test.runtime), false);
});

test('workflow cancellation before admission prevents a late submit and binds the exact request', async t => {
  const f = fixture(t), request = { id: 'late', candidate: f.manifest.id, mode: 'prod', owner: 'fixture-task', githubRun: '1:1' };
  assert.equal(cancelRequestCI(f.config, request).status, 'cancelled');
  assert.equal(requestCI(f.config, request).status, 'cancelled');
  assert.equal((await executeCI(f.config, 'late', f.execute)).status, 'cancelled');
  assert.deepEqual(f.seen, []);
  assert.throws(() => cancelRequestCI(f.config, { ...request, githubRun: '1:2' }), /does not match/);
  assert.equal(existsSync(join(f.config.registry, f.manifest.id, 'consumers/late.json')), false);
});

test('failed PROD tests restore and cleanup without merging', async t => {
  const f = fixture(t); f.request('fail', 'prod');
  const result = await executeCI(f.config, 'fail', async (cmd, env) => { if (cmd.env.ACTION === 'prod-tests') throw new Error('acceptance failed'); await f.execute(cmd, env); });
  assert.equal(result.status, 'failed');
  assert.equal(readFileSync(join(f.root, 'prod/version'), 'utf8'), 'prod');
  assert.ok(!f.seen.includes('merge'));
  assert.equal(readQueue(f.config.controller.root).active, null);
});

test('cancellation cannot clear partial merge ownership or restore committed sources', async t => {
  const f = fixture(t); f.request('merge', 'prod');
  assert.equal((await executeCI(f.config, 'merge', async (cmd, env) => { if (cmd.env.ACTION === 'merge') throw new Error('partial merge'); await f.execute(cmd, env); })).status, 'recovery-required');
  cancelCI(f.config, 'merge'); f.seen.length = 0;
  assert.equal((await executeCI(f.config, 'merge', f.execute)).status, 'recovery-required');
  assert.deepEqual(f.seen, []);
  assert.equal(readQueue(f.config.controller.root).active.id, 'merge');
  assert.equal(readFileSync(join(f.root, 'prod/version'), 'utf8'), 'source');
});

test('interrupted DEV fails and tears down without rerunning deployment', async t => {
  const f = fixture(t); f.request('crashed'); const path = join(f.config.runs, 'crashed.json');
  atomicJson(path, { ...readJson(path), status: 'running' });
  assert.equal((await executeCI(f.config, 'crashed', f.execute)).status, 'failed');
  assert.deepEqual(f.seen, ['dev-stop', 'dev-cleanup']);
});

test('explicit storage budget stops a new publication', t => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'source/version'), 'different build');
  assert.throws(() => publishCandidate(f.config.registry, join(f.root, 'source'), f.inputs, { maxBytes: 1, reserveBytes: 0 }), /capacity/);
});

test('application control closure is frozen with its candidate and included in storage admission', t => {
  const f = fixture(t), controls = join(f.root, 'controls'); mkdirSync(controls);
  writeFileSync(join(controls, 'checks.mjs'), 'original check');
  const manifest = publishCandidate(f.config.registry, join(f.root, 'source'), f.inputs, f.policy, controls);
  writeFileSync(join(controls, 'checks.mjs'), 'later edits');
  const candidate = loadCandidate(f.config.registry, manifest.id);
  assert.equal(readFileSync(join(candidate.controls, 'checks.mjs'), 'utf8'), 'original check');
  assert.notEqual(manifest.id, f.manifest.id);
  assert.throws(() => publishCandidate(f.config.registry, join(f.root, 'source'), manifest.inputs, f.policy), /controls are missing/);
  writeFileSync(join(candidate.controls, 'checks.mjs'), 'tampered');
  assert.throws(() => loadCandidate(f.config.registry, manifest.id), /controls changed/);
});

test('DEV cancellation during installed tests produces no successful gate and still tears down', async t => {
  const f = fixture(t); rmSync(join(f.config.registry, f.manifest.id, 'gates/dev.json'));
  f.request('cancel');
  const result = await executeCI(f.config, 'cancel', async (cmd, env) => {
    if (cmd.env.ACTION === 'dev-tests') cancelCI(f.config, 'cancel');
    await f.execute(cmd, env);
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(existsSync(join(f.config.registry, f.manifest.id, 'gates/dev.json')), false);
  assert.equal(existsSync(f.config.dev.runtime), false);
});

test('service restart closes terminal owner, admits interrupted registration, and collects despite failed notify', async t => {
  const f = fixture(t); f.config.serviceIntervalMs = 1000; f.config.candidateAgeMs = 0;
  f.config.notify.args = ['-e', 'process.exit(1)'];
  f.request('completed'); await executeCI(f.config, 'completed', f.execute);
  atomicJson(join(f.config.runs, '.dev-owner.json'), { id: 'completed' });
  f.request('registration'); const requestPath = join(f.config.runs, 'registration.json');
  atomicJson(requestPath, { ...readJson(requestPath), status: 'registering' });
  writeFileSync(join(f.root, 'source/version'), 'unreferenced artifact');
  const garbage = publishCandidate(f.config.registry, join(f.root, 'source'), f.inputs, f.policy);
  const configPath = join(f.root, 'config.json'); atomicJson(configPath, f.config);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/puddles-ci.mjs', import.meta.url)), 'service', configPath], { stdio: 'ignore' });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  const until = Date.now() + 15_000;
  while (Date.now() < until && (readJson(requestPath).status !== 'passed' || existsSync(join(f.config.registry, garbage.id)) || existsSync(join(f.config.runs, '.dev-owner.json')))) await delay(50);
  assert.equal(readJson(requestPath).status, 'passed');
  assert.equal(existsSync(join(f.config.registry, garbage.id)), false);
  assert.equal(existsSync(join(f.config.runs, '.dev-owner.json')), false);
  child.kill('SIGTERM'); await exited;
});

for (const mode of ['dev', 'prod']) test(`killed ${mode} CI worker recovers owned child and teardown from disk`, async t => {
  const f = fixture(t), helper = join(f.root, 'callback.mjs'), marker = join(f.root, 'test-started');
  writeFileSync(helper, `import {writeFileSync,rmSync} from 'node:fs';
    const action=process.argv[2];
    if(action===${JSON.stringify(mode + '-tests')}) {writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);}
    if(action==='dev-cleanup')rmSync(${JSON.stringify(f.config.dev.runtime)},{recursive:true,force:true});
    if(action==='test-cleanup')rmSync(${JSON.stringify(f.config.controller.test.runtime)},{recursive:true,force:true});`);
  const bind = object => { for (const value of Object.values(object)) if (value && typeof value === 'object') {
    if (value.command) { value.args = [helper, value.env.ACTION]; value.timeoutMs = 30_000; } else bind(value);
  } };
  bind(f.config);
  recordGate(f.config.registry, f.manifest.id, 'dev', { status: 'passed', targetDigest: digest(f.config.dev), run: 'qualified' });
  f.request('killed', mode);
  const configPath = join(f.root, 'config.json'); atomicJson(configPath, f.config);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/puddles-ci.mjs', import.meta.url)), 'work', configPath, 'killed'], { stdio: 'ignore' });
  const exited = new Promise(resolve => child.once('exit', resolve));
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  const until = Date.now() + 15_000;
  while (!existsSync(marker) && Date.now() < until) await delay(25);
  assert.ok(existsSync(marker), 'worker reached owned acceptance child');
  const phasePid = Number(readFileSync(marker, 'utf8'));
  child.kill('SIGKILL'); await exited;
  assert.equal((await executeCI(f.config, 'killed')).status, 'failed');
  assert.throws(() => process.kill(phasePid, 0), { code: 'ESRCH' });
  assert.equal(existsSync(mode === 'dev' ? f.config.dev.runtime : f.config.controller.test.runtime), false);
  assert.equal(readFileSync(join(f.root, 'prod/version'), 'utf8'), 'prod');
  assert.equal(readQueue(f.config.controller.root).active, null);
});


test('DEV failure retains its callback phase after successful teardown', async t => {
  const f = fixture(t); f.request('failed-phase');
  const result = await executeCI(f.config, 'failed-phase', async (cmd, env) => {
    assert.equal(readJson(join(f.config.runs, 'failed-phase.json')).phase, env.PUDDLES_RELEASE_PHASE);
    if (cmd.env.ACTION === 'dev-health') throw new Error('exact health failure');
    return f.execute(cmd, env);
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.phase, 'complete');
  assert.equal(result.failurePhase, 'dev-health');
  assert.equal(result.error, 'exact health failure');
  assert.equal(result.child, null);
  assert.equal(existsSync(f.config.dev.runtime), false);
  assert.equal(existsSync(join(f.config.runs, '.dev-owner.json')), false);
});
