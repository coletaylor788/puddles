import assert from 'node:assert/strict';
import test from 'node:test';
import { configureLink } from '../configuration.mjs';
import { authTools, paymentTools, insightTools } from '../policy.mjs';

const settings = { node: '/runtime/node', cli: '/runtime/link/dist/cli.js', authFile: '/state/credentials/link.json', clientName: 'Example Assistant', apiBaseUrl: 'http://127.0.0.1:1234', authBaseUrl: 'http://127.0.0.1:1234' };
test('composition preserves other tools and exposes exact native namespaces to their owner', () => {
  const before = { agents: { entries: { main: { tools: { allow: ['read'] } }, 'browser-agent': { tools: { allow: ['browser'] } }, reader: { tools: { allow: ['read'] } }, household: {} } } };
  const after = configureLink(before, settings);
  assert.deepEqual(after, configureLink(after, settings));
  assert.deepEqual(before.agents.entries.main.tools.allow, ['read']);
  for (const [id, namespace, allowed, denied] of [['main', 'link_financial', insightTools, 'link_payments'], ['browser-agent', 'link_payments', paymentTools, 'link_financial']]) {
    const agent = after.agents.entries[id];
    const names = [...authTools, ...allowed].map(name => namespace + '__' + name);
    assert.deepEqual(agent.tools.allow.slice(1), names);
    assert.deepEqual(agent.tools.sandbox.tools.alsoAllow, names);
    assert.ok(agent.tools.deny.includes(denied + '__*'));
    assert.deepEqual(after.mcp.servers[namespace].toolFilter.include, [...authTools, ...allowed]);
  }
  for (const id of ['reader', 'household']) assert.deepEqual(after.agents.entries[id].tools.deny, ['link_financial__*', 'link_payments__*']);
  assert.equal(after.mcp.servers.link_financial.env.LINK_AUTH_FILE, after.mcp.servers.link_payments.env.LINK_AUTH_FILE);
});
