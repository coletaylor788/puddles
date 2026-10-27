import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error executable helper
import { prepareApplicationSource } from '../src/application-source.mjs';
// @ts-expect-error executable helper
import { ownApplicationOutput } from '../src/application-output.mjs';
function fixture(run: (source: string, owner: object, git: (args: string[]) => string) => void) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'application-source-'))), source = join(workspace, 'source'); mkdirSync(source);
  const git = (args: string[]) => execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', source, ...args], { encoding: 'utf8' });
  try {
    git(['init', '-q']); writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'openclaw' }));
    writeFileSync(join(source, '.gitignore'), 'dist/\nnode_modules/\n'); git(['add', '.']);
    run(source, ownApplicationOutput(source, join(workspace, 'application')).owner, git);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
}
it('indexes exact authored paths without staging their contents or changing existing staged data', () => fixture((source, owner, git) => {
  writeFileSync(join(source, 'existing.ts'), 'staged'); git(['add', 'existing.ts']); writeFileSync(join(source, 'existing.ts'), 'working');
  const files = ['patched.ts', ':(glob)*.ts', 'line\nbreak.ts']; for (const file of files) writeFileSync(join(source, file), 'new');
  symlinkSync('patched.ts', join(source, 'link.ts'));
  mkdirSync(join(source, 'dist')); writeFileSync(join(source, 'dist/generated.js'), 'generated');
  const staged = git(['diff', '--cached', '--binary']);
  expect(prepareApplicationSource(source, owner).sort()).toEqual([...files, 'link.ts'].sort());
  expect(git(['diff', '--cached', '--binary'])).toBe(staged);
  expect(git(['show', ':existing.ts'])).toBe('staged'); expect(readFileSync(join(source, 'existing.ts'), 'utf8')).toBe('working');
  const indexed = git(['ls-files', '-z']).split('\0'); for (const file of files) expect(indexed).toContain(file);
  expect(indexed).not.toContain('dist/generated.js'); expect(prepareApplicationSource(source, owner)).toEqual([]);
}));
it('rejects author repositories and absent ownership before changing the index', () => fixture((source, owner, git) => {
  writeFileSync(join(source, 'new.ts'), 'new'); const before = git(['ls-files', '-s']);
  expect(() => prepareApplicationSource(source, {})).toThrow('managed application');
  for (const name of ['puddles', 'puddles-private']) {
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name }));
    expect(() => prepareApplicationSource(source, owner)).toThrow('not an author checkout');
  }
  expect(git(['ls-files', '-s'])).toBe(before);
}));
it('does not undo a staged deletion recreated in the working tree', () => fixture((source, owner, git) => {
  writeFileSync(join(source, 'deleted.ts'), 'original'); git(['add', 'deleted.ts']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
  git(['rm', 'deleted.ts']); writeFileSync(join(source, 'deleted.ts'), 'recreated'); writeFileSync(join(source, 'new.ts'), 'new');
  const before = git(['ls-files', '-s']); expect(() => prepareApplicationSource(source, owner)).toThrow('staged deletion');
  expect(git(['ls-files', '-s'])).toBe(before);
}));
