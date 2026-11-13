import assert from 'node:assert/strict';
import test from 'node:test';
import { registerBrowser } from '../src/register.mjs';

const tools = [{ name: 'agent_browser_eval', description: 'Native eval', inputSchema: {
  type: 'object', properties: { script: { type: 'string' } }, required: ['script'], additionalProperties: false } }];
const config = { command: '/trusted/node', args: ['/trusted/launcher'], env: {}, agentId: 'browser-agent' };
function register(connect, runtime = {}, cfg = config) {
  const factories = [], services = [];
  registerBrowser({ pluginConfig: cfg, registerTool(fn) { factories.push(fn); }, registerService(s) { services.push(s); } }, tools, connect, runtime);
  return { factories, service: services[0], tool: factories[0]({ agentId: 'browser-agent' }) };
}

test('synchronous native registration, agent scoping and shared process owner across registries', async () => {
  let connections = 0, closed = 0;
  const seen = [], runtime = {};
  const raw = { content: [{ type: 'text', text: 'native result' }, { type: 'image', data: 'cG5n', mimeType: 'image/png' }],
    isError: true, structuredContent: { status: 'native error' } };
  const connect = async settings => { assert.deepEqual(settings, config); connections++;
    return { async callTool(...args) { seen.push(args); return raw; }, async close() { closed++; } }; };
  const first = register(connect, runtime), second = register(connect, runtime);
  assert.equal(connections, 0);
  assert.equal(first.factories[0]({ agentId: 'main' }), null);
  assert.equal(first.factories[0]({ agentId: 'household-browser-agent' }), null);
  assert.deepEqual(first.tool.parameters, tools[0].inputSchema);
  assert.equal(first.tool.description, tools[0].description);
  const signal = new AbortController().signal, args = { script: 'document.title' };
  const result = await first.tool.execute('one', args, signal);
  await second.tool.execute('two', args);
  assert.equal(connections, 1);
  assert.deepEqual(seen[0], [{ name: tools[0].name, arguments: args }, undefined, { signal, timeout: 120_000 }]);
  assert.deepEqual(result.content, raw.content);
  assert.deepEqual(result.structuredContent, raw.structuredContent);
  assert.equal(result.isError, true);
  assert.deepEqual(result.details, raw);
  await first.service.stop();
  assert.equal(closed, 1);
  await assert.rejects(second.tool.execute('stopped', {}), /stopped/);
  second.service.start();
  await second.tool.execute('restart', {});
  assert.equal(connections, 2);
  await second.service.stop();
});

test('serializes calls and skips aborted queued calls without poisoning the queue', async () => {
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const fixture = register(async () => ({ async callTool() { calls++; if (calls === 1) await gate; return { content: [] }; }, async close() {} }));
  const first = fixture.tool.execute('one', {});
  const abort = new AbortController(), second = fixture.tool.execute('two', {}, abort.signal);
  const denied = assert.rejects(second, /cancelled/);
  abort.abort(new Error('cancelled'));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 1);
  release(); await first; await denied;
  await fixture.tool.execute('three', {}); assert.equal(calls, 2);
  await fixture.service.stop();
});

test('uncertain transport failure is never retried; a later request reconnects', async () => {
  let connections = 0, calls = 0;
  const fixture = register(async () => {
    const generation = ++connections;
    const client = { async callTool() { calls++; if (generation === 1) { client.onclose(); throw new Error('transport lost'); } return { content: [] }; }, async close() {} };
    return client;
  });
  await assert.rejects(fixture.tool.execute('one', {}), /transport lost/);
  assert.equal(connections, 1); assert.equal(calls, 1);
  await fixture.tool.execute('two', {});
  assert.equal(connections, 2); assert.equal(calls, 2);
  await fixture.service.stop();
});

test('startup failure permits a later request and shutdown joins an in-flight connection', async () => {
  let connections = 0, calls = 0, release, closed = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const fixture = register(async () => {
    if (++connections === 1) throw new Error('startup failed');
    await gate;
    return { async callTool() { calls++; return { content: [] }; }, async close() { closed++; } };
  });
  await assert.rejects(fixture.tool.execute('one', {}), /startup failed/);
  const pending = fixture.tool.execute('two', {});
  const denied = assert.rejects(pending, /stopped/);
  await new Promise(resolve => setImmediate(resolve));
  let stopped = false;
  const closing = fixture.service.stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(stopped, false);
  release(); await closing; await denied;
  assert.equal(closed, 1); assert.equal(calls, 0);
});

test('changed host configuration cannot start a second controller without shutdown', async () => {
  let connections = 0;
  const connect = async () => { connections++; return { async callTool() { return { content: [] }; }, async close() {} }; };
  const runtime = {}, first = register(connect, runtime);
  await first.tool.execute('one', {});
  const changed = register(connect, runtime, { ...config, args: ['/other/launcher'] });
  await assert.rejects(changed.tool.execute('two', {}), /configuration changed/);
  assert.equal(connections, 1);
  await first.service.stop();
});
