import assert from 'node:assert/strict';
import { test } from 'node:test';
// Unit command fixtures must not inherit the parent's installed CI importer.
delete process.env.PUDDLES_CI_DOCKER_IMPORT;
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('shared resolver leaves normal workspace package resolution intact', () => {
  const root = mkdtempSync(join(tmpdir(), 'sandbox-import-'));
  try {
    mkdirSync(join(root, 'node_modules', 'example'), {recursive:true});
    writeFileSync(join(root, 'node_modules', 'example', 'package.json'), JSON.stringify({name:'example',type:'module',exports:'./index.js'}));
    writeFileSync(join(root, 'node_modules', 'example', 'index.js'), 'export default 42;');
    writeFileSync(join(root, 'script.mjs'), "import answer from 'example'; import assert from 'node:assert/strict'; assert.equal(answer,42);");
    const result = spawnSync(process.execPath, ['--import', new URL('../runtime/register.mjs', import.meta.url).href, join(root,'script.mjs')], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(root, {recursive:true,force:true}); }
});

test('tampered prepared image is rejected before Docker is called', async () => {
  const { createHash } = await import('node:crypto');
  const { sandboxManifest, loadSandbox } = await import('../installed.mjs');
  const root=mkdtempSync(join(tmpdir(),'sandbox-artifact-'));
  try {
    mkdirSync(join(root,'sandbox-tools'));
    const archive=Buffer.from('synthetic archive');
    const manifest={version:1,image:'sha256:'+'a'.repeat(64),archiveSha256:createHash('sha256').update(archive).digest('hex')};
    writeFileSync(join(root,'sandbox-tools/image.tar'),archive);
    writeFileSync(join(root,'sandbox-tools/manifest.json'),JSON.stringify(manifest));
    assert.equal(sandboxManifest(root).image,manifest.image);
    writeFileSync(join(root,'sandbox-tools/image.tar'),'changed');
    assert.throws(()=>loadSandbox(root,'/must-not-execute'),/integrity failed/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('fresh-daemon acceptance loads the prepared image; production acceptance does not', async t => {
  const { createHash } = await import('node:crypto');
  const { testSandbox } = await import('../installed.mjs');
  const root=mkdtempSync(join(tmpdir(),'sandbox-load-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  mkdirSync(join(root,'sandbox-tools'));
  const archive='archive',image='sha256:'+'a'.repeat(64);
  const script=Buffer.from("import assert from 'node:assert/strict';\nassert.equal('installed ✓', 'installed ✓');\n");
  writeFileSync(join(root,'sandbox-tools/installed.mjs'),script);
  writeFileSync(join(root,'sandbox-tools/image.tar'),archive);
  writeFileSync(join(root,'sandbox-tools/manifest.json'),JSON.stringify({version:1,image,archiveSha256:createHash('sha256').update(archive).digest('hex')}));
  let loaded=false,runs=0;
  const execute=(command,args,options)=>{
    assert.equal(command,'fixture-docker');
    if(args[0]==='image' && args[1]==='load'){loaded=true;return '';}
    if(args[0]==='image' && args[1]==='inspect'){assert.ok(loaded);return image;}
    assert.ok(loaded);
    assert.deepEqual(args,['run','--interactive','--pull=never','--rm','--network','none','--read-only','--tmpfs','/tmp:rw,size=256m',image,'node','--input-type=module']);
    assert.deepEqual(options.input,script);
    assert.deepEqual(options.stdio,['pipe','inherit','inherit']);
    assert.equal(options.timeout,300000);
    runs++;return '';
  };
  testSandbox(root,'fixture-docker',execute);assert.equal(runs,1);
  testSandbox(root,'fixture-docker',(command,args,options)=>{assert.equal(args[0],'run');return execute(command,args,options);},{load:false});
  assert.equal(runs,2);
  const failure=new Error('Docker acceptance failed');
  assert.throws(()=>testSandbox(root,'fixture-docker',()=>{throw failure;},{load:false}),error=>error===failure);
});
