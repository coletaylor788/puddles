import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, renameSync, readFileSync, realpathSync, readdirSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { prepareAgentBrowser, version } from '../build.mjs';
import { browserTools } from '../configuration.mjs';
import { connect } from './mcp-client.mjs';

test('relocated unmodified upstream CLI supplies selected tools and native encrypted auth storage', async t => {
  const dir = realpathSync(mkdtempSync('/private/tmp/pb-'));
  let mcp, cli, env;
  t.after(async () => {
    await mcp?.close();
    if (cli && env) execFileSync(process.execPath, [cli, 'close'], { env, timeout: 15_000, stdio: 'ignore' });
    rmSync(dir, { recursive: true, force: true });
  });
  const source = join(dir, 'source'), installed = join(dir, 'installed');
  await prepareAgentBrowser(source); renameSync(source, installed);
  function check(path) {
    if (lstatSync(path).isSymbolicLink()) assert.ok(realpathSync(path).startsWith(installed + '/'));
    else if (lstatSync(path).isDirectory()) for (const name of readdirSync(path)) check(join(path, name));
  }
  check(installed);
  const upstream = dirname(createRequire(import.meta.url).resolve('agent-browser/package.json'));
  cli = join(installed, 'upstream/bin/agent-browser.js');
  assert.deepEqual(readFileSync(cli), readFileSync(join(upstream, 'bin/agent-browser.js')));
  const home = join(dir, 'home'); mkdirSync(home);
  const config = join(dir, 'agent-browser.json'); writeFileSync(config, '{}');
  env = { PATH: process.env.PATH, HOME: home, AGENT_BROWSER_SOCKET_DIR: join(dir, 'sockets') };
  const saved = execFileSync(process.execPath, [cli, '--config', config, '--json', 'auth', 'save', 'fixture',
    '--url', 'https://example.invalid/login', '--username', 'fixture-user', '--password-stdin'],
  { env, input: 'synthetic-only-password\n', encoding: 'utf8', timeout: 15_000 });
  assert.ok(!saved.includes('synthetic-only-password'));
  mcp = await connect(cli, env, ['mcp', '--tools', 'core,state,tabs,mobile', '--config', config]);
  assert.equal(mcp.initialized.result.serverInfo.version, version);
  const tools = await mcp.tools();
  for (const name of browserTools) assert.ok(tools.some(tool => tool.name === name), 'Native tool missing: ' + name);
  const listed = await mcp.call('agent_browser_auth_list');
  assert.ok(!listed.result.isError);
  assert.match(JSON.stringify(listed), /fixture/);
  assert.ok(!JSON.stringify(listed).includes('synthetic-only-password'));
  const vault = join(home, '.agent-browser/auth');
  assert.ok(readdirSync(vault).some(name => name.endsWith('.json')));
  for (const name of readdirSync(vault)) {
    if (lstatSync(join(vault, name)).isFile()) assert.ok(!readFileSync(join(vault, name), 'utf8').includes('synthetic-only-password'));
  }
  const denied = await mcp.call('agent_browser_read', { url: 'https://example.invalid', extraArgs: ['--config', '/untrusted/config.json'] });
  assert.ok(denied.error || denied.result?.isError, 'Upstream must reject tool-supplied host configuration');
});
