import { afterEach, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
// @ts-expect-error executable module
import { prepareApplicationPython, selectApplicationPythonPaths } from '../src/application-python.mjs';
// @ts-expect-error executable module
import { applicationTestOperation } from '../src/application-test-operation.mjs';
// @ts-expect-error executable module
import { createProcessScope, prepareOwnedProcess } from '../../release/src/owned-process.mjs';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'python-suite-'))); roots.push(root);
  const repository = join(root, 'repository'), artifact = join(root, 'artifact'), scratch = join(root, 'scratch');
  for (const path of [repository, artifact, scratch]) mkdirSync(path);
  for (const path of ['servers/gmail-mcp', 'servers/rocket-money-mcp', 'packages/browser-auth']) {
    mkdirSync(join(repository, path), {recursive:true}); writeFileSync(join(repository,path,'pyproject.toml'), '');
  }
  for (const plugin of ['secure-gmail', 'rocket-money']) mkdirSync(join(artifact,'plugins',plugin,'python/lib'), {recursive:true});
  return {root,repository,artifact,scratch};
}
it('binds distinct interpreters and exact sources before the frozen runtime, with no ambient Python path or pip cache', async () => {
  const f = fixture(), calls: Array<{command:string;args:string[];env:Record<string,string>}> = [];
  const result = await prepareApplicationPython({...f, env:{GMAIL_MCP_PYTHON:'/shared/python',PYTHONPATH:'/foreign',PYTHONHOME:'/foreign',XDG_CACHE_HOME:'/maintained/cache',PNPM_CONFIG_STORE_DIR:'/maintained/store'},
    run: async(command:string,args:string[],options:{env:Record<string,string>}) => {
      calls.push({command,args,env:options.env});
      if(args.includes('venv')) mkdirSync(join(args.at(-1)!, 'lib/python3.11/site-packages'),{recursive:true});
    }});
  expect(result.interpreters['gmail-mcp']).not.toBe(result.interpreters['rocket-money-mcp']);
  expect(result.env.GMAIL_MCP_PYTHON).toBe(result.interpreters['gmail-mcp']);
  expect(calls[0].args.join(' ')).toContain('sys.version_info[:2] == (3, 11)');
  expect(calls.filter(c=>c.args.includes('-B')).every(c=>c.env.PYTHONPATH === '' && c.env.PYTHONHOME === '' && c.env.TMPDIR.startsWith(f.scratch+'/'))).toBe(true);
  const installs = calls.filter(c=>c.args.includes('install'));
  expect(installs.every(c=>c.args.includes('--no-cache-dir') && c.args.includes('--no-deps'))).toBe(true);
  expect(installs.filter(c=>c.args.includes('-e')).every(c=>c.args.includes('--no-build-isolation'))).toBe(true);
  expect(installs.filter(c=>c.args.includes('-r')).every(c=>c.args.includes('--require-hashes'))).toBe(true);
  for(const service of ['gmail-mcp','rocket-money-mcp']) {
    expect(readFileSync(join(f.scratch,service,'lib/python3.11/site-packages/puddles_application_test_environment.py'),'utf8')).toContain(join(f.repository,'servers',service,'src'));
  }
  const probes=calls.filter(c=>c.args.includes('-c')).slice(1);
  expect(probes.every(c=>c.args.at(-1)!.includes('assert actual == expected') && !c.args.includes('-B') && Object.keys(c.env).length === 0)).toBe(true);
  expect(result.env.XDG_CACHE_HOME).toBe('/maintained/cache');
  expect(result.env.PNPM_CONFIG_STORE_DIR).toBe('/maintained/store');
  expect(result.pythonEnv.XDG_CACHE_HOME).toBe(join(f.scratch,'cache'));
  expect(result.env.PYTEST_ADDOPTS).toBeUndefined();
});
it('loads the owned pth hook without environment or -B, preserving stdlib and exact frozen imports', () => {
  const f=fixture(), venv=join(f.scratch,'venv');
  const bootstrap=process.env.GMAIL_MCP_PYTHON ?? 'python3';
  const create=spawnSync(bootstrap,['-I','-B','-m','venv','--without-pip',venv],{encoding:'utf8',timeout:15000});
  expect(create.status,create.stderr).toBe(0);
  const python=join(venv,'bin/python');
  const locate=spawnSync(python,['-I','-c','import sysconfig;print(sysconfig.get_paths()["purelib"])'],{encoding:'utf8',env:{},timeout:5000});
  expect(locate.status,locate.stderr).toBe(0);
  const site=locate.stdout.trim(), reviewed=join(f.repository,'reviewed'), runtime=join(f.artifact,'runtime');
  mkdirSync(reviewed);mkdirSync(runtime);
  writeFileSync(join(reviewed,'reviewed_probe.py'),'value = "reviewed"\n');
  writeFileSync(join(runtime,'runtime_probe.py'),'value = "frozen"\n');
  writeFileSync(join(site,'runtime_probe.py'),'raise RuntimeError("dev dependencies shadowed runtime")\n');
  writeFileSync(join(runtime,'json.py'),'raise RuntimeError("runtime shadowed stdlib")\n');
  // On Homebrew, its stdlib sitecustomize wins over this file. Neither owns our hook.
  writeFileSync(join(site,'sitecustomize.py'),'pass\n');
  selectApplicationPythonPaths(site,[reviewed,runtime]);
  const code=`import sys; assert sys.dont_write_bytecode; import json,reviewed_probe,runtime_probe; assert reviewed_probe.__file__ == ${JSON.stringify(join(reviewed,'reviewed_probe.py'))}; assert runtime_probe.__file__ == ${JSON.stringify(join(runtime,'runtime_probe.py'))}; assert "puddles_application_test_environment" in sys.modules`;
  const result=spawnSync(python,['-I','-c',code],{encoding:'utf8',env:{},timeout:5000});
  expect(result.status,result.stderr).toBe(0);
  expect(existsSync(join(reviewed,'__pycache__'))).toBe(false);
  expect(existsSync(join(runtime,'__pycache__'))).toBe(false);
},20000);
it('refuses a missing, nonempty, linked or overlapping scratch before invoking Python', async () => {
  const f=fixture(); writeFileSync(join(f.scratch,'foreign'),'keep'); symlinkSync(f.scratch,join(f.root,'linked'));
  for(const scratch of [undefined,f.scratch,join(f.root,'linked'),f.artifact]) {
    await expect(prepareApplicationPython({...f,scratch,env:{},run:()=>{throw Error('Python must not run');}})).rejects.toThrow();
  }
  expect(readFileSync(join(f.scratch,'foreign'),'utf8')).toBe('keep');
});
it('standalone ownership removes success/failure scratch and refuses foreign roots', async () => {
  const f=fixture(), source=join(f.root,'source'); mkdirSync(source);
  for (const fail of [false,true]) {
    const action=applicationTestOperation({source,artifact:f.artifact,env:{}},async(spec:{env:Record<string,string>})=>{
      writeFileSync(join(spec.env.OPENCLAW_APPLICATION_TEST_SCRATCH,'venv'),'generated'); if(fail)throw Error('tests failed');
    });
    if(fail)await expect(action).rejects.toThrow('tests failed');else await action;
    expect(existsSync(f.artifact+'.tests')).toBe(false);
  }
  const foreign=join(f.root,'foreign-artifact');mkdirSync(foreign);mkdirSync(foreign+'.tests');writeFileSync(join(foreign+'.tests','keep'),'foreign');
  await expect(applicationTestOperation({source,artifact:foreign,env:{}},()=>{})).rejects.toThrow('unowned');
  expect(readFileSync(join(foreign+'.tests','keep'),'utf8')).toBe('foreign');
});
it('standalone recovery joins the retained real process before reclaiming interrupted venvs', async () => {
  const f=fixture(),source=join(f.root,'source');mkdirSync(source);
  let scope='',pid=0;
  try {
    await expect(applicationTestOperation({source,artifact:f.artifact,env:{}},async(spec:{env:Record<string,string>},_:unknown,observe:(child:unknown)=>void)=>{
      scope=createProcessScope();const owned=prepareOwnedProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:f.root,stdio:'ignore'},[scope]);pid=owned.child.pid;
      observe({pid,start:owned.start,scope});writeFileSync(join(spec.env.OPENCLAW_APPLICATION_TEST_SCRATCH,'partial'),'venv');owned.release();throw Error('interrupted parent');
    })).rejects.toThrow('interrupted parent');
    expect(existsSync(join(f.artifact+'.tests/scratch','partial'))).toBe(true);
    await applicationTestOperation({source,artifact:f.artifact,env:{}},async(spec:{env:Record<string,string>})=>{
      expect(existsSync(scope)).toBe(false);expect(existsSync(join(spec.env.OPENCLAW_APPLICATION_TEST_SCRATCH,'partial'))).toBe(false);
    });
    expect(existsSync(f.artifact+'.tests')).toBe(false);
  } finally {if(pid)try{process.kill(-pid,'SIGKILL');}catch{ /* already joined */ }}
});

it('real standalone CLI SIGTERM joins its Python child and removes generated scratch', async () => {
  const f=fixture(), source=join(f.root,'source');mkdirSync(join(source,'dist'),{recursive:true});writeFileSync(join(f.artifact,'openclaw.mjs'),'');
  const marker=join(f.root,'python.pid'),python=join(f.root,'python');
  writeFileSync(python,'#!'+process.execPath+'\nimport {writeFileSync} from "node:fs";writeFileSync('+JSON.stringify(marker)+',String(process.pid));setInterval(()=>{},1000);\n');chmodSync(python,0o755);
  const env: NodeJS.ProcessEnv={...process.env,OPENCLAW_SRC:source,OPENCLAW_CANDIDATE_DIR:f.artifact,GMAIL_MCP_PYTHON:python};
  delete env.OPENCLAW_APPLICATION_TEST_SCRATCH;delete env.E2E_APPLICATION_EXTENSION;
  const child=spawn(process.execPath,[fileURLToPath(new URL('../bin/openclaw-test-env.mjs',import.meta.url)),'ci'],{env,stdio:'ignore',detached:true});
  const exited=once(child,'exit');
  try {
    const deadline=Date.now()+8000;while(!existsSync(marker)&&Date.now()<deadline)await new Promise(r=>setTimeout(r,25));
    expect(existsSync(marker)).toBe(true);child.kill('SIGTERM');await exited;
    expect(existsSync(f.artifact+'.tests')).toBe(false);
    const db=new DatabaseSync(join(f.artifact+'.tests.lock','operation.sqlite'),{readOnly:true});
    try {expect(JSON.parse((db.prepare('SELECT payload FROM operation').get() as {payload:string}).payload).child).toBe(null);}finally{db.close();}
    expect(()=>process.kill(Number(readFileSync(marker,'utf8')),0)).toThrow();
  }finally{try{process.kill(-child.pid!,'SIGKILL');}catch{ /* joined */ }}
},15000);
it('killed SQLite metadata replacement recovers without random sibling temporary files', async () => {
  const f=fixture(),source=join(f.root,'source');mkdirSync(source);
  await applicationTestOperation({source,artifact:f.artifact,env:{}},async()=>{});
  const path=join(f.artifact+'.tests.lock','operation.sqlite');
  const killed=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(${JSON.stringify(path)});db.exec("BEGIN IMMEDIATE");db.prepare("UPDATE operation SET payload=?").run('incomplete replacement');process.kill(process.pid,'SIGKILL');`]);
  expect(killed.signal).toBe('SIGKILL');
  await applicationTestOperation({source,artifact:f.artifact,env:{}},async()=>{});
  expect(existsSync(f.artifact+'.tests')).toBe(false);
  expect(existsSync(path+'-journal')).toBe(false);
});
