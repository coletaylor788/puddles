import { isAbsolute } from 'node:path';
import { authTools, paymentTools, insightTools } from './policy.mjs';

export const namespaces = { insights: 'link_financial', payments: 'link_payments' };
export function configureLink(before, { node, cli, authFile, clientName, apiBaseUrl, authBaseUrl,
  mainAgent = 'main', browserAgent = 'browser-agent' }) {
  if (![node, cli, authFile].every(value => typeof value === 'string' && isAbsolute(value))) throw new Error('Absolute Link executable and protected state paths required');
  if (!clientName || !apiBaseUrl || !authBaseUrl || mainAgent === browserAgent) throw new Error('Explicit Link connection and distinct agents required');
  const config = structuredClone(before), entries = config.agents?.entries;
  if (!entries?.[mainAgent] || !entries?.[browserAgent]) throw new Error('Link agents must already exist');
  config.mcp ??= {}; config.mcp.servers ??= {};
  for (const [role, names] of [['insights', insightTools], ['payments', paymentTools]]) {
    const namespace = namespaces[role];
    config.mcp.servers[namespace] = { command: node, args: [cli, '--mcp'],
      env: { LINK_AUTH_FILE: authFile, LINK_CLIENT_NAME: clientName, PUDDLES_LINK_CAPABILITY: role,
        LINK_API_BASE_URL: apiBaseUrl, LINK_AUTH_BASE_URL: authBaseUrl, NO_UPDATE_NOTIFIER: '1' },
      toolFilter: { include: [...authTools, ...names] }, requestTimeoutMs: 60_000,
      supportsParallelToolCalls: false };
  }
  const add = (old, values) => [...new Set([...(old ?? []), ...values])];
  for (const [id, agent] of Object.entries(entries)) {
    agent.tools ??= {};
    const role = id === mainAgent ? 'insights' : id === browserAgent ? 'payments' : null;
    agent.tools.deny = add(agent.tools.deny, Object.entries(namespaces).filter(([key]) => key !== role).map(([, name]) => name + '__*')).sort();
    if (role) {
      const allowed = [...authTools, ...(role === 'insights' ? insightTools : paymentTools)].map(name => namespaces[role] + '__' + name);
      const field = Array.isArray(agent.tools.allow) ? 'allow' : 'alsoAllow';
      agent.tools[field] = add(agent.tools[field], allowed);
      agent.tools.sandbox ??= {}; agent.tools.sandbox.tools ??= {};
      agent.tools.sandbox.tools.alsoAllow = add(agent.tools.sandbox.tools.alsoAllow, allowed);
      // Native workspace clients otherwise ask again before calling the scoped
      // MCP server. Link owns account consent and payment approval.
      const profile = config.plugins?.entries?.anthropic?.config?.cliProfiles?.[id];
      if (profile && ['workspace', 'diagnostic'].includes(profile.mode)) {
        profile.allowedMcpTools = add(profile.allowedMcpTools, allowed.map(name => 'mcp__' + name));
      }
    }
  }
  return config;
}
