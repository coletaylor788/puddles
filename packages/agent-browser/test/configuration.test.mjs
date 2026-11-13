import assert from 'node:assert/strict';
import test from 'node:test';
import { configureAgentBrowser, browserTools, namespace } from '../configuration.mjs';

const options = { command: '/usr/bin/node', args: ['/runtime/browser-launcher.mjs'],
  env: { PUDDLES_BROWSER_CONFIG: '/protected/browser.json' },
  protectedPaths: ['/protected/vault', '/protected/profile', '/protected/control'] };
function baseline() {
  return { agents: { entries: {
    main: { tools: { allow: ['read', 'link_financial__balances_list'] } },
    'browser-agent': { tools: { allow: ['browser', 'read', 'write', 'link_payments__spend-request_create'],
      deny: ['memory_get'], sandbox: { tools: { alsoAllow: ['browser', 'sessions_send'] } } },
      sandbox: { mode: 'all', browser: { enabled: true } } },
    'household-browser-agent': { tools: { allow: ['browser'] } },
  } }, plugins: { entries: { anthropic: { config: { cliProfiles: {
    main: { mode: 'workspace' }, 'browser-agent': { mode: 'restricted' },
  } } } } }, mcp: { servers: { link_payments: { command: '/native/link' } } } };
}
test('personal browser switches controllers while other agents and payment permissions stay scoped', () => {
  const before = baseline(), saved = structuredClone(before);
  const after = configureAgentBrowser(before, options);
  assert.deepEqual(before, saved);
  const personal = after.agents.entries['browser-agent'];
  assert.ok(personal.tools.deny.includes('browser'));
  assert.ok(!personal.tools.allow.includes('browser'));
  assert.ok(personal.tools.allow.includes('read') && personal.tools.allow.includes('write'));
  assert.ok(personal.tools.allow.includes('link_payments__spend-request_create'));
  assert.equal(personal.sandbox.browser.enabled, false);
  assert.deepEqual(after.mcp.servers.link_payments, before.mcp.servers.link_payments);
  for (const id of ['main', 'household-browser-agent']) {
    assert.deepEqual(after.agents.entries[id].tools.allow, before.agents.entries[id].tools.allow);
    assert.ok(after.agents.entries[id].tools.deny.includes(namespace + '_*'));
  }
  assert.equal(after.plugins.entries.anthropic.config.cliProfiles['browser-agent'].mode, 'workspace');
  assert.deepEqual(after.plugins.entries.anthropic.config.cliProfiles['browser-agent'].protectedPaths, options.protectedPaths);
  assert.equal(after.mcp.servers.agent_browser, undefined);
  const plugin = after.plugins.entries['agent-browser'];
  assert.equal(plugin.config.agentId, 'browser-agent');
  assert.deepEqual(plugin.config.args, options.args);
  const allowed = personal.tools.allow;
  assert.ok(allowed.includes('agent_browser_eval') && allowed.includes('agent_browser_auth_login'));
  for (const name of ['auth_save', 'auth_delete', 'cookies_get', 'storage_get', 'state_save']) {
    assert.ok(!allowed.includes('agent_browser_' + name));
  }
  assert.equal(new Set(browserTools).size, browserTools.length);
});
test('missing profiles, protected paths and occupied server names fail before any mutation', () => {
  assert.throws(() => configureAgentBrowser(baseline(), { ...options, protectedPaths: [] }), /protected/);
  const missing = baseline(); delete missing.plugins.entries.anthropic.config.cliProfiles['browser-agent'];
  assert.throws(() => configureAgentBrowser(missing, options), /profile/);
  const occupied = baseline(); occupied.mcp.servers[namespace] = {};
  assert.throws(() => configureAgentBrowser(occupied, options), /already/);
});
