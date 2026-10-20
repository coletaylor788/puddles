import { expect, it } from 'vitest';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error executable helper
import { assertEmptyCacheParentAbsent, prepareEmptyCacheParent } from '../src/prepared-source-cache.mjs';
// @ts-expect-error executable helper
import { treeDigest } from '../src/native-state.mjs';

const expected = { before: 'absent', mode: 0o755 };
const policy = { exclude: ['.cache/vitest'] };
function fixture(run: (source: string) => void) {
  const source = mkdtempSync(join(tmpdir(), 'prepared-cache-'));
  try { writeFileSync(join(source, 'source.ts'), 'original'); run(source); }
  finally { rmSync(source, { recursive: true, force: true }); }
}

it('materializes only the expected empty parent and preserves the exact source digest under a restrictive umask', () => fixture(source => {
  const before = treeDigest(source, policy), cache = join(source, '.cache');
  mkdirSync(cache); chmodSync(cache, 0o755);
  const after = treeDigest(source, policy); rmSync(cache, { recursive: true });
  expect(treeDigest(source, policy)).toBe(before);
  expect(assertEmptyCacheParentAbsent(source, expected)).toBe(true);
  expect(existsSync(cache)).toBe(false);
  const previous = process.umask(0o077);
  try { prepareEmptyCacheParent(source, expected); }
  finally { process.umask(previous); }
  expect(lstatSync(cache).mode & 0o777).toBe(0o755);
  expect(treeDigest(source, policy)).toBe(after);
  expect(readFileSync(join(source, 'source.ts'), 'utf8')).toBe('original');
}));

it('requires explicit preparation and refuses different permissions or paths', () => fixture(source => {
  prepareEmptyCacheParent(source, undefined);
  expect(existsSync(join(source, '.cache'))).toBe(false);
  for (const value of [{ before: 'absent', mode: 0o700 }, { ...expected, path: 'other' }]) {
    expect(() => prepareEmptyCacheParent(source, value)).toThrow();
    expect(existsSync(join(source, '.cache'))).toBe(false);
  }
}));

it('preserves unexpected directories, files and symlinks instead of repairing them', () => fixture(source => {
  const path = join(source, '.cache');
  for (const kind of ['directory', 'file', 'symlink']) {
    if (kind === 'directory') mkdirSync(path);
    else if (kind === 'file') writeFileSync(path, 'existing');
    else symlinkSync(source, path);
    const before = treeDigest(source, policy);
    expect(() => prepareEmptyCacheParent(source, expected)).toThrow();
    expect(treeDigest(source, policy)).toBe(before);
    rmSync(path, { recursive: kind === 'directory' });
  }
}));

it.each([0o022, 0o077])('keeps non-excluded cache children, their contents and ordinary source changes in the digest with umask %s', umask => {
  const previous = process.umask(umask);
  try {
    fixture(source => {
      prepareEmptyCacheParent(source, expected);
      const empty = treeDigest(source, policy), path = join(source, '.cache', 'input');
      writeFileSync(path, 'first'); chmodSync(path, 0o644);
      const added = treeDigest(source, policy);
      expect(added).not.toBe(empty);
      writeFileSync(path, 'second'); const changed = treeDigest(source, policy);
      expect(changed).not.toBe(added);
      chmodSync(path, 0o600); const permissions = treeDigest(source, policy);
      expect(permissions).not.toBe(changed);
      symlinkSync('../source.ts', join(source, '.cache', 'link'));
      const linked = treeDigest(source, policy); expect(linked).not.toBe(permissions);
      writeFileSync(join(source, 'source.ts'), 'changed');
      expect(treeDigest(source, policy)).not.toBe(linked);
    });
  } finally { process.umask(previous); }
});
