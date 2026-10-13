import { expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-expect-error executable helper
import { ownApplicationOutput } from '../src/application-output.mjs';
it('reuses exactly its own output and rejects existing unrelated paths', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'application-output-')));
  try {
    const source = join(root, 'source'), output = join(root, 'output'), foreign = join(root, 'foreign');
    mkdirSync(source); mkdirSync(foreign);
    expect(() => ownApplicationOutput(source, foreign)).toThrow('unowned');
    expect(existsSync(foreign)).toBe(true);
    const first = ownApplicationOutput(source, output); first.save({ uiInputs: 'tested' }); mkdirSync(output);
    expect(ownApplicationOutput(source, output).owner.uiInputs).toBe('tested');
    expect(() => ownApplicationOutput(foreign, output)).toThrow('another source');
    expect(() => ownApplicationOutput(source, source)).toThrow('sibling');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it('does not replace an output redirected to another directory', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'application-output-link-')));
  try {
    const source = join(root, 'source'), output = join(root, 'output'), foreign = join(root, 'foreign');
    mkdirSync(source); mkdirSync(foreign); ownApplicationOutput(source, output); symlinkSync(foreign, output);
    expect(() => ownApplicationOutput(source, output)).toThrow('unowned');
    expect(existsSync(foreign)).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
