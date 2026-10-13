import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { rebaseRepositories, mergeRepositories } from '../src/git.mjs';
function fixture(t) {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'release-git-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const git=(path,args)=>execFileSync('git',['-c','core.fsmonitor=false','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-C',path,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const origin=join(root,'origin.git'),primary=join(root,'primary'),feature=join(root,'feature');mkdirSync(primary);
 git(root,['init','--bare',origin]);git(primary,['init','-b','main']);git(primary,['config','user.name','Fixture']);git(primary,['config','user.email','fixture@example.invalid']);git(primary,['commit','--allow-empty','-m','base']);git(primary,['remote','add','origin',origin]);git(primary,['push','-u','origin','main']);
 git(primary,['worktree','add','-b','feature',feature]);writeFileSync(join(feature,'new.txt'),'feature');git(feature,['add','.']);git(feature,['commit','-m','feature']);git(feature,['push','origin','feature']);
 const repo={path:feature,branch:'feature',pullRequest:'https://example.invalid/fixture/repo/pull/1'};
 return{root,primary,feature,git,repo};
}
test('rebase incorporates main, publishes the refreshed feature, and refuses primary or dirty source',t=>{
 const f=fixture(t);writeFileSync(join(f.primary,'main.txt'),'main');f.git(f.primary,['add','.']);f.git(f.primary,['commit','-m','advance']);f.git(f.primary,['push']);
 const [result]=rebaseRepositories([f.repo]);assert.equal(readFileSync(join(f.feature,'main.txt'),'utf8'),'main');
 assert.equal(result.base,f.git(f.primary,['rev-parse','HEAD']));assert.equal(result.head,f.git(f.feature,['rev-parse','origin/feature']));
 writeFileSync(join(f.feature,'unpublished'),'keep');assert.throws(()=>rebaseRepositories([f.repo]),/Commit feature changes/);
 assert.throws(()=>rebaseRepositories([{path:f.primary,branch:'main'}]),/primary checkout/);
});
test('merge verifies the tested head, refuses main drift, and can resume an already merged PR',t=>{
 const f=fixture(t);rebaseRepositories([f.repo]);
 const bin=join(f.root,'bin');mkdirSync(bin);const state=join(f.root,'pr.json');writeFileSync(state,JSON.stringify({state:'OPEN',headRefOid:f.repo.head}));
 const gh=join(bin,'gh');writeFileSync(gh,`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv[3]==='view')console.log(fs.readFileSync(${JSON.stringify(state)},'utf8'));else throw Error('merge should not run on drift');\n`);chmodSync(gh,0o700);
 const previous=process.env.PATH;process.env.PATH=bin+':'+previous;t.after(()=>{process.env.PATH=previous;});
 writeFileSync(join(f.primary,'other.txt'),'other');f.git(f.primary,['add','.']);f.git(f.primary,['commit','-m','other']);f.git(f.primary,['push']);
 assert.throws(()=>mergeRepositories([f.repo]),/Main changed/);
 // A previously completed merge is checked against main's tree, not repeated.
 f.git(f.primary,['reset','--hard',f.repo.head]);f.git(f.primary,['push','--force-with-lease']);
 writeFileSync(state,JSON.stringify({state:'MERGED',headRefOid:f.repo.head}));mergeRepositories([f.repo]);
 writeFileSync(state,JSON.stringify({state:'MERGED',headRefOid:'0'.repeat(40)}));assert.throws(()=>mergeRepositories([f.repo]),/head changed/);
});
