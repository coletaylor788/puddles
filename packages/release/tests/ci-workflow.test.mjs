import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, matchesGlob} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const directory = new URL('../../../.github/workflows/', import.meta.url);
const parse = name => JSON.parse(execFileSync('/usr/bin/ruby', ['-rpsych','-rjson','-e',
  'puts JSON.generate(Psych.load_file(ARGV[0]))',fileURLToPath(new URL(name,directory))],{encoding:'utf8'}));

test('all active workflow jobs select the owned build Mac and exclude external fork heads', () => {
  assert.equal(existsSync(new URL('integration.yml',directory)),false);
  for (const name of readdirSync(directory)) {
    for (const job of Object.values(parse(name).jobs)) {
      assert.deepEqual(job['runs-on'],['self-hosted','macOS','ARM64','puddles-build'],name);
      assert.equal(job.if,"github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository",name);
      for (const step of job.steps.filter(step=>step.uses?.startsWith('actions/checkout@'))) {
        assert.equal(step.with['persist-credentials'],false,name);
      }
    }
  }
});

test('tooling checks remain scoped and do not rebuild or retest application output', () => {
  const workflow = parse('release.yml'), events=workflow.on??workflow.true;
  for (const event of ['push','pull_request']) {
    const runs=files=>files.some(file=>events[event].paths.some(pattern=>matchesGlob(file,pattern)));
    assert.equal(runs(['packages/release/src/ci-run.mjs']),true);
    assert.equal(runs(['.github/workflows/release.yml']),true);
    assert.equal(runs(['README.md','openclaw-plugins/example/src/index.ts']),false);
  }
  const job=workflow.jobs.release;
  assert.equal(job.defaults.run['working-directory'],'packages/release');
  assert.ok(job.steps.some(step=>step.run==='pnpm test'));
  assert.ok(!job.steps.some(step=>/openclaw-test-env|build-application|sandbox-tools\/build/.test(step.run??'')));
});

test('CodeQL keeps its security coverage and serializes scans on local compute', () => {
  const workflow=parse('codeql.yml'), events=workflow.on??workflow.true, job=workflow.jobs.analyze;
  assert.deepEqual(job.strategy.matrix.language,['actions','javascript-typescript','python']);
  assert.equal(job.strategy['max-parallel'],1);
  assert.equal(events.schedule.length,1);
  assert.equal(job.permissions['security-events'],'write');
  assert.ok(job.steps.some(step=>step.uses?.startsWith('github/codeql-action/analyze@')));
});

test('tooling teardown removes only its job output and temporary package manager', t => {
  const root=mkdtempSync(join(tmpdir(),'public-ci-cleanup-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const workspace=join(root,'workspace'), temp=join(root,'temp');
  for (const path of ['packages/release/node_modules','packages/release/dist']) mkdirSync(join(workspace,path),{recursive:true});
  mkdirSync(join(temp,'puddles-pnpm'),{recursive:true});
  writeFileSync(join(workspace,'packages/release/source.mjs'),'preserve');
  writeFileSync(join(temp,'foreign'),'preserve');
  const step=parse('release.yml').jobs.release.steps.at(-1);
  assert.equal(step.if,'always()');
  execFileSync('/bin/sh',['-eu','-c',step.run],{cwd:join(workspace,'packages/release'),env:{GITHUB_WORKSPACE:workspace,RUNNER_TEMP:temp}});
  for (const path of ['packages/release/node_modules','packages/release/dist']) assert.equal(existsSync(join(workspace,path)),false);
  assert.equal(existsSync(join(temp,'puddles-pnpm')),false);
  assert.equal(readFileSync(join(workspace,'packages/release/source.mjs'),'utf8'),'preserve');
  assert.equal(readFileSync(join(temp,'foreign'),'utf8'),'preserve');
});
