import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error executable module
import { buildApplicationCore } from '../src/application-build-cache.mjs';
// @ts-expect-error executable module
import { ownApplicationOutput } from '../src/application-output.mjs';
// @ts-expect-error executable module
import { applicationSourceFiles } from '../src/application-source.mjs';
// @ts-expect-error executable module
import { treeDigest } from '../src/native-state.mjs';

function fixture() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'application-cache-')));
  const source = join(workspace, 'source'); mkdirSync(source);
  execFileSync('git', ['init', '-q', source]);
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'openclaw' }));
  writeFileSync(join(source, '.gitignore'), 'dist/\nnode_modules/\n');
  return { workspace, source, ...ownApplicationOutput(source, join(workspace, 'application')) };
}
it('reuses unchanged output and rebuilds edits, new inputs, or damaged output', async () => {
  const { workspace, source, owner, save } = fixture();
  try {
    writeFileSync(join(source, 'input.ts'), 'old');
    let builds = 0;
    const build = async () => { builds++; mkdirSync(join(source, 'dist'), { recursive: true }); writeFileSync(join(source, 'dist/main.js'), String(builds)); };
    expect(await buildApplicationCore(source, owner, save, build)).toBe('built');
    expect(await buildApplicationCore(source, owner, save, build)).toBe('reused');
    writeFileSync(join(source, 'input.ts'), 'new');
    expect(await buildApplicationCore(source, owner, save, build)).toBe('built');
    writeFileSync(join(source, 'new.ts'), 'new input');
    expect(await buildApplicationCore(source, owner, save, build)).toBe('built');
    writeFileSync(join(source, 'dist/main.js'), 'damaged');
    expect(await buildApplicationCore(source, owner, save, build)).toBe('built');
    expect(builds).toBe(4);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
it('caches mutable compiler output that links to its host dependencies', async () => {
  const { workspace, source, owner, save } = fixture();
  try {
    mkdirSync(join(source, 'node_modules')); writeFileSync(join(source, 'node_modules/dependency.js'), 'dependency');
    const build = async () => { mkdirSync(join(source, 'dist')); symlinkSync('../node_modules/dependency.js', join(source, 'dist/dependency.js')); };
    expect(await buildApplicationCore(source, owner, save, build)).toBe('built');
    expect(await buildApplicationCore(source, owner, save, () => { throw new Error('unexpected rebuild'); })).toBe('reused');
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
it('invalidates output cached before native source indexing was required', async () => {
  const { workspace, source, owner, save } = fixture();
  try {
    writeFileSync(join(source, 'patched-helper.ts'), 'export {};');
    mkdirSync(join(source, 'dist')); writeFileSync(join(source, 'dist/main.js'), 'old output');
    const legacy = createHash('sha256').update(process.version);
    for (const file of applicationSourceFiles(source)) {
      const absolute = join(source, file);
      legacy.update(file).update('\0').update(String(statSync(absolute).mode)).update('\0').update(readFileSync(absolute)).update('\0');
    }
    save({ coreInputs: legacy.digest('hex'), coreOutput: treeDigest(join(source, 'dist'), { excludeNames: ['control-ui'] }) });
    let builds = 0;
    const build = async () => {
      builds++;
      expect(execFileSync('git', ['-C', source, 'ls-files'], { encoding: 'utf8' })).toContain('patched-helper.ts');
    };
    expect(await buildApplicationCore(source, owner, save, build)).toBe('built');
    expect(await buildApplicationCore(source, owner, save, build)).toBe('reused');
    expect(builds).toBe(1);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
