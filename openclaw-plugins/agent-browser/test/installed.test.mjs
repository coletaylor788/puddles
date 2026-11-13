import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { connectBrowser } from '../src/bridge.mjs';
import { browserTools } from '../../../packages/agent-browser/configuration.mjs';

test('relocated plugin preserves the pinned live MCP catalog and executes through its host client', async t => {
  const scratch = mkdtempSync('/private/tmp/browser-plugin-');
  let service, native;
  t.after(async () => { await service?.stop(); await native?.close(); rmSync(scratch, { recursive: true, force: true }); });
  const root = new URL('../', import.meta.url);
  execFileSync(process.execPath, [new URL('build.mjs', root).pathname], { timeout: 60_000, stdio: 'pipe' });
  const installed = join(scratch, 'plugin'); cpSync(new URL('dist', root), installed, { recursive: true });
  const plugin = (await import(pathToFileURL(join(installed, 'plugin.js')))).default;
  const requireBrowser = createRequire(new URL('../../../packages/agent-browser/package.json', import.meta.url));
  const upstream = dirname(requireBrowser.resolve('agent-browser/package.json'));
  const home = join(scratch, 'home'); mkdirSync(home);
  const empty = join(scratch, 'empty.json'); writeFileSync(empty, '{}');
  const config = { command: process.execPath,
    args: [join(upstream, 'bin/agent-browser.js'), 'mcp', '--tools', 'core,state,tabs,mobile', '--config', empty],
    env: { HOME: home, PATH: process.env.PATH ?? '', AGENT_BROWSER_SOCKET_DIR: join(scratch, 'sockets') }, agentId: 'browser-agent' };
  native = await connectBrowser(config);
  const catalog = []; let cursor;
  do { const page = await native.listTools(cursor ? { cursor } : {}); catalog.push(...page.tools); cursor = page.nextCursor; } while (cursor);
  const factories = [], hooks = {};
  plugin.register({ pluginConfig: config, on(name, fn) { hooks[name] = fn; }, registerTool(factory) { factories.push(factory); }, registerService(s) { service = s; } });
  assert.deepEqual(factories.map(fn => fn({ agentId: 'browser-agent' }).name), browserTools);
  assert.equal(hooks.before_prompt_build({}, { agentId: 'browser-agent' }).appendSystemContext, native.getInstructions());
  assert.equal(hooks.before_prompt_build({}, { agentId: 'main' }), undefined);
  assert.equal(hooks.before_prompt_build({}, { agentId: 'household-browser-agent' }), undefined);
  const packaged = JSON.parse(readFileSync(join(installed, 'tools.json'), 'utf8'));
  assert.deepEqual(packaged, browserTools.map(name => catalog.find(tool => tool.name === name)));
  for (const factory of factories) {
    assert.equal(factory({ agentId: 'main' }), null);
    const tool = factory({ agentId: 'browser-agent' }), source = catalog.find(entry => entry.name === tool.name);
    assert.deepEqual(tool.parameters, source.inputSchema); assert.equal(tool.description, source.description);
  }
  const listing = factories.map(fn => fn({ agentId: 'browser-agent' })).find(tool => tool.name === 'agent_browser_auth_list');
  const expected = await native.callTool({ name: listing.name, arguments: {} });
  const actual = await listing.execute('host-mcp', {});
  assert.deepEqual(actual.content, expected.content);
  assert.equal(actual.isError, expected.isError);
  await service.stop();
  await assert.rejects(listing.execute('after-stop', {}), /stopped/);
});
