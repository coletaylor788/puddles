import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveImage } from '../archive.mjs';
import { loadSandbox, testSandbox } from '../installed.mjs';
import { prepareSandboxTools } from '../build.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(t,manifest){
  const root=mkdtempSync(join(tmpdir(),'sandbox-archive-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const config=JSON.stringify({architecture:'arm64',os:'linux'}),archive=join(root,'image.tar');
  writeFileSync(join(root,'config.json'),config);writeFileSync(join(root,'manifest.json'),JSON.stringify(manifest??[{Config:'config.json',RepoTags:[],Layers:[]}]));
  execFileSync('/usr/bin/tar',['-cf',archive,'-C',root,'manifest.json','config.json']);return {root,archive,image:'sha256:'+hash(config)};
}
test('untagged docker export verifies the actual configuration bytes',t=>{
  const f=fixture(t);assert.equal(archiveImage(f.archive,{untagged:true}),f.image);
});
test('CI rejects tagged, multiple-image and escaping-config archives',t=>{
  for(const [manifest,error]of [
    [[{Config:'config.json',RepoTags:['foreign:tag']}],/introduce tags/],
    [[{Config:'config.json'},{Config:'config.json'}],/exactly one/],
    [[{Config:'../config.json'}],/Invalid archive/],
  ]){const f=fixture(t,manifest);assert.throws(()=>archiveImage(f.archive,{untagged:true}),error);}
});
test('installed acceptance delegates each import/test to the maintained CI owner',t=>{
  const f=fixture(t),sandbox=join(f.root,'sandbox-tools');mkdirSync(sandbox);
  const bytes=readFileSync(f.archive);writeFileSync(join(sandbox,'image.tar'),bytes);writeFileSync(join(sandbox,'manifest.json'),JSON.stringify({version:1,image:f.image,archiveSha256:hash(bytes)}));
  const previous=process.env.PUDDLES_CI_DOCKER_IMPORT;t.after(()=>{if(previous===undefined)delete process.env.PUDDLES_CI_DOCKER_IMPORT;else process.env.PUDDLES_CI_DOCKER_IMPORT=previous;});
  process.env.PUDDLES_CI_DOCKER_IMPORT=JSON.stringify({node:'/fixture/node',script:'/fixture/adapter.mjs',config:'/fixture/host.json'});
  const calls=[],execute=(program,args)=>calls.push([program,...args]);
  loadSandbox(f.root,'docker',execute);testSandbox(f.root,'docker',execute);testSandbox(f.root,'docker',execute,{load:false});
  assert.deepEqual(calls.map(call=>call[2]),['load','test','test-existing']);assert.ok(calls.every(call=>call[0]==='/fixture/node'&&call[3]==='/fixture/host.json'));
});
test('repeated CI builds reuse the direct archive without loading or tagging daemon images',t=>{
  const f=fixture(t),output=join(f.root,'application'),previous=process.env.PUDDLES_SANDBOX_BUILDER;
  process.env.PUDDLES_SANDBOX_BUILDER='puddles-ci-fixture';
  t.after(()=>{if(previous===undefined)delete process.env.PUDDLES_SANDBOX_BUILDER;else process.env.PUDDLES_SANDBOX_BUILDER=previous;});
  const calls=[],execute=(_program,args)=>{
    calls.push(args);
    if(args[0]==='info')return 'linux/aarch64';
    if(args[0]==='buildx'&&args[1]==='inspect')return 'Driver: docker-container\n';
    if(args[0]==='buildx'&&args[1]==='build'){
      const destination=args[args.indexOf('--output')+1].replace('type=docker,dest=','');
      writeFileSync(destination,readFileSync(f.archive));writeFileSync(args[args.indexOf('--metadata-file')+1],JSON.stringify({'containerimage.config.digest':f.image}));return '';
    }
    throw Error('Unexpected Docker mutation '+args);
  };
  assert.equal(prepareSandboxTools(output,'docker',execute).untagged,true);
  assert.equal(prepareSandboxTools(output,'docker',execute).image,f.image);
  assert.equal(calls.filter(args=>args[1]==='build').length,1);
  assert.equal(calls.some(args=>args[0]==='image'||args.includes('--load')||args.includes('--tag')),false);
});
