import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli, reminders } from '../src/backend.js';

const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
it('uses fixed CLI profile and structured arguments and discards completion response text', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'communication-cli-')); roots.push(dir);
  const binary = join(dir, 'recording-cli');
  writeFileSync(binary, `#!${process.execPath}
import {writeFileSync} from 'node:fs';
writeFileSync(process.env.APPLE_PIM_CONFIG_DIR+'/args.json', JSON.stringify({args:process.argv.slice(2), leaked:process.env.COMMUNICATION_PRIVATE_FIXTURE}));
console.log(JSON.stringify({success:true, reminders:[], reminder:{id:'one',notes:'RAW_PROVIDER_TEXT'}}));
`, { mode: 0o700 });
  process.env.COMMUNICATION_PRIVATE_FIXTURE = 'must not reach CLI';
  try {
    const backend = reminders(cli(binary, dir, 'communication'), 'fixed-list');
    expect(await backend.list(true, 21)).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8'))).toEqual({args:['items','--list','fixed-list','--limit','21','--filter','completed','--profile','communication','--format','json']});
    expect(await backend.complete('one')).toBeUndefined();
    const raw = await cli(binary, dir, 'communication')(['literal', '$(touch must-not-run); exit 1']);
    expect(raw.success).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'args.json'), 'utf8')).args[1]).toBe('$(touch must-not-run); exit 1');
    writeFileSync(binary, `#!${process.execPath}\nconsole.error('PRIVATE_ERROR_TEXT'); process.exit(1);\n`, { mode: 0o700 });
    await expect(backend.get('one')).rejects.toThrow(/^unavailable$/);
  } finally { delete process.env.COMMUNICATION_PRIVATE_FIXTURE; }
});
