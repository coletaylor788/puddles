import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { authTools, paymentTools, insightTools } from './policy.mjs';
import { fixture } from './test/fixture.mjs';

// Operator-only DEV/TEST check. Never point it at production state. CI supplies
// the installed candidate and its frozen recording endpoints.
export async function qualifyInstalled(runtime, config, scratch) {
  const urls = Object.values(config.mcp.servers).map(server => server.env?.LINK_API_BASE_URL).filter(Boolean);
  assert.equal(urls.length, 2);
  assert.equal(urls[0], urls[1]);
  assert.match(urls[0], /^http:\/\/127\.0\.0\.1:\d+$/);
  for (const name of ['link_financial', 'link_payments']) {
    const server = config.mcp.servers[name];
    assert.equal(server.env.LINK_AUTH_BASE_URL, urls[0]);
    assert.ok(server.env.LINK_AUTH_FILE.includes('/ci-slots/') || server.env.LINK_AUTH_FILE.startsWith(scratch + '/'), 'Synthetic Link state is required');
  }
  const service = await fixture(Number(new URL(urls[0]).port));
  const { materializeStaticMcpToolsForHarnessRun } = await import(pathToFileURL(join(runtime, 'dist/plugin-sdk/codex-mcp-projection.js')));
  const held = [];
  async function materialize(agentId, model) {
    const agent = config.agents.entries[agentId];
    const workspaceDir = agent.workspace ?? join(scratch, agentId);
    mkdirSync(workspaceDir, { recursive: true });
    const sessionId = randomUUID(), sessionKey = `agent:${agentId}:link-fixture-${sessionId}`;
    const slash = model.indexOf('/');
    const result = await materializeStaticMcpToolsForHarnessRun({ cfg: config, agentId,
      workspaceDir, agentDir: join(scratch, agentId, 'agent'), sessionId, sessionKey,
      manifestRegistry: { plugins: [] }, retireSessionRuntimeAfterDispose: true,
      requestInteractiveCodexApproval: async () => {},
      policyContext: { config, agentId, workspaceDir, sessionId, sessionKey,
        modelProvider: model.slice(0, slash), modelId: model.slice(slash + 1) } });
    held.push(result); return result.tools;
  }
  try {
    const models = [...new Set(['main', 'browser-agent'].flatMap(id => {
      const selection = config.agents.entries[id].model ?? config.agents.defaults.model;
      return typeof selection === 'string' ? [selection] : [selection.primary, ...(selection.fallbacks ?? [])];
    }))];
    assert.ok(models.length >= 2, 'Both configured model selections are required');
    for (const model of models) {
      for (const [id, prefix, allowed] of [['main', 'link_financial', insightTools], ['browser-agent', 'link_payments', paymentTools]]) {
        const tools = await materialize(id, model);
        assert.deepEqual(tools.map(tool => tool.name).sort(), [...authTools, ...allowed].map(name => prefix + '__' + name).sort());
        const status = await tools.find(tool => tool.name === prefix + '__auth_status').execute(randomUUID(), {});
        assert.match(JSON.stringify(status), /authenticated/);
      }
      for (const id of Object.keys(config.agents.entries).filter(id => !['main', 'browser-agent'].includes(id))) {
        assert.deepEqual(await materialize(id, model), [], 'Another agent received Link tools');
      }
    }
    assert.equal(service.calls.length, 0, 'Catalog/status qualification must not request account data or purchases');
    return { status: 'passed', modelSelections: models.length, externalWrites: 0 };
  } finally {
    for (const entry of held.reverse()) await entry.dispose();
    await service.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [runtime, configPath, scratch] = process.argv.slice(2);
  console.log(JSON.stringify(await qualifyInstalled(runtime, JSON.parse(readFileSync(configPath, 'utf8')), scratch)));
}
