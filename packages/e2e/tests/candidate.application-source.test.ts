import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

it('prepares patch-added files for the actual nested native collector and a physically Git-free copy', () => {
  const source = process.env.OPENCLAW_SRC ?? '';
  expect(isAbsolute(source)).toBe(true);
  const collector = join(source, 'scripts/lib/bundled-plugin-build-entries.mjs');
  expect(existsSync(collector)).toBe(true);
  // A real Node process exercises the native module's own child_process import.
  // No injected outer runner or mocked Git call can hide the discovery mismatch.
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
    import {execFileSync} from 'node:child_process';
    import {collectSourceCheckoutPluginBuildEntries} from ${JSON.stringify(pathToFileURL(collector).href)};
    import {buildApplicationCore} from ${JSON.stringify(pathToFileURL(resolve('src/application-build-cache.mjs')).href)};
    import {ownApplicationOutput} from ${JSON.stringify(pathToFileURL(resolve('src/application-output.mjs')).href)};
    const workspace=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'native-source-inventory-')));
    const root=path.join(workspace,'source'), gitfree=path.join(workspace,'git-free');
    const git=args=>execFileSync('git',['-c','core.fsmonitor=false','-C',root,...args],{stdio:'pipe'});
    const entries=cwd=>collectSourceCheckoutPluginBuildEntries({cwd,env:{}}).find(p=>p.id==='example').sourceEntries;
    try {
      fs.mkdirSync(path.join(root,'extensions/example'),{recursive:true});
      fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'openclaw'}));
      fs.writeFileSync(path.join(root,'.gitignore'),'dist/\\n');
      fs.writeFileSync(path.join(root,'extensions/example/package.json'),JSON.stringify({name:'@openclaw/example',openclaw:{extensions:['./index.ts']}}));
      fs.writeFileSync(path.join(root,'extensions/example/openclaw.plugin.json'),JSON.stringify({id:'example'}));
      fs.writeFileSync(path.join(root,'extensions/example/index.ts'),'export {};');
      git(['init','-q']);git(['add','.']);
      fs.writeFileSync(path.join(root,'extensions/example/patched-helper.ts'),'export {};');
      assert.deepEqual(entries(root),['./index.ts']);
      const {owner,save}=ownApplicationOutput(root,path.join(workspace,'application'));
      let builds=0;
      const build=async()=>{builds++;fs.mkdirSync(path.join(root,'dist/extensions/example'),{recursive:true});for(const entry of entries(root))fs.writeFileSync(path.join(root,'dist/extensions/example',entry.replace(/\\.ts$/u,'.js')),'export {};');};
      assert.equal(await buildApplicationCore(root,owner,save,build),'built');
      assert.equal(await buildApplicationCore(root,owner,save,build),'reused');
      fs.writeFileSync(path.join(root,'extensions/example/later-helper.ts'),'export {};');
      assert.equal(await buildApplicationCore(root,owner,save,build),'built');
      fs.cpSync(root,gitfree,{recursive:true,filter:p=>p!==path.join(root,'.git')});
      assert.equal(fs.existsSync(path.join(gitfree,'.git')),false);
      assert.deepEqual(entries(root),entries(gitfree));
      assert.equal(entries(gitfree).length,3);
      for(const entry of entries(gitfree))assert.ok(fs.existsSync(path.join(gitfree,'dist/extensions/example',entry.replace(/\\.ts$/u,'.js'))));
      console.log(JSON.stringify({builds,entries:entries(gitfree)}));
    } finally {fs.rmSync(workspace,{recursive:true,force:true});}
  `;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30_000 }));
  expect(result).toEqual({ builds: 2, entries: ['./index.ts', './later-helper.ts', './patched-helper.ts'] });
});
