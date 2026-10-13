import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error executable module
import { buildApplicationCore } from '../src/application-build-cache.mjs';
it('reuses unchanged output and rebuilds edits, new inputs, or damaged output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'application-cache-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    writeFileSync(join(root, '.gitignore'), 'dist/\n');
    writeFileSync(join(root, 'input.ts'), 'old');
    const owner = {}; const save = (value: object) => Object.assign(owner, value);
    let builds = 0;
    const build = async () => { builds++; mkdirSync(join(root, 'dist'), { recursive: true }); writeFileSync(join(root, 'dist/main.js'), String(builds)); };
    expect(await buildApplicationCore(root, owner, save, build)).toBe('built');
    expect(await buildApplicationCore(root, owner, save, build)).toBe('reused');
    writeFileSync(join(root, 'input.ts'), 'new');
    expect(await buildApplicationCore(root, owner, save, build)).toBe('built');
    writeFileSync(join(root, 'new.ts'), 'new input');
    expect(await buildApplicationCore(root, owner, save, build)).toBe('built');
    writeFileSync(join(root, 'dist/main.js'), 'damaged');
    expect(await buildApplicationCore(root, owner, save, build)).toBe('built');
    expect(builds).toBe(4);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('caches mutable compiler output that links to its host dependencies', async () => {
  const root=mkdtempSync(join(tmpdir(),'application-cache-links-'));
  try {
    execFileSync('git',['init','-q',root]);writeFileSync(join(root,'.gitignore'),'dist/\nnode_modules/\n');
    mkdirSync(join(root,'node_modules'));writeFileSync(join(root,'node_modules/dependency.js'),'dependency');
    const owner={};const save=(value:object)=>Object.assign(owner,value);
    const build=async()=>{mkdirSync(join(root,'dist'));symlinkSync('../node_modules/dependency.js',join(root,'dist/dependency.js'));};
    expect(await buildApplicationCore(root,owner,save,build)).toBe('built');
    expect(await buildApplicationCore(root,owner,save,()=>{throw new Error('unexpected rebuild');})).toBe('reused');
  } finally {rmSync(root,{recursive:true,force:true});}
});
