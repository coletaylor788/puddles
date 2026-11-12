import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, renameSync, readFileSync, realpathSync, readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareLinkCLI } from '../build.mjs';
import { connect } from './mcp-client.mjs';

test('frozen CLI remains self-contained and usable after relocation', async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'link-build-'))); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, 'source'), installed = join(dir, 'installed');
  await prepareLinkCLI(source); renameSync(source, installed);
  function check(path) {
    if (lstatSync(path).isSymbolicLink()) assert.ok(realpathSync(path).startsWith(installed + '/'));
    else if (lstatSync(path).isDirectory()) for (const name of readdirSync(path)) check(join(path, name));
  }
  check(installed);
  assert.equal(JSON.parse(readFileSync(join(installed, 'puddles-link.json'))).cliVersion, '1.4.1');
  const cli = await connect(join(installed, 'dist/cli.js'), { PATH: process.env.PATH, HOME: dir, LINK_AUTH_FILE: join(dir, 'auth.json'), NO_UPDATE_NOTIFIER: '1', PUDDLES_LINK_CAPABILITY: 'payments' });
  t.after(() => cli.close());
  assert.ok((await cli.request('tools/list')).result.tools.some(tool => tool.name === 'spend-request_create'));
});
