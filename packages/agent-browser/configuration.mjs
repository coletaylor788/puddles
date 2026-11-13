import { isAbsolute } from 'node:path';

export const namespace = 'agent_browser';
// Native MCP selection. No replacement tool schemas or result filtering.
// Leave vault management to the owner, and expose only named login and discovery.
export const browserTools = [
  'open', 'read', 'snapshot', 'click', 'fill', 'type', 'press', 'check', 'uncheck',
  'select', 'scroll', 'wait_ms', 'wait_for_selector', 'wait_for_text', 'wait_for_load',
  'screenshot', 'get_text', 'get_url', 'get_title', 'eval', 'close', 'back', 'forward',
  'reload', 'keydown', 'keyup', 'keyboard_type', 'keyboard_insert_text', 'mouse_move',
  'mouse_down', 'mouse_up', 'mouse_wheel', 'set_viewport', 'set_device', 'set_geo',
  'set_media', 'tab_new', 'tab_list', 'tab_switch', 'tab_close', 'window_new',
  'frame_switch', 'frame_main', 'dialog_status', 'dialog_accept', 'dialog_dismiss',
  'tap', 'swipe', 'auth_login', 'auth_list',
].map(name => 'agent_browser_' + name);

export function configureAgentBrowser(before, { command, args, env, protectedPaths,
  browserAgent = 'browser-agent' }) {
  if (typeof command !== 'string' || !isAbsolute(command) || !Array.isArray(args)
    || args.some(arg => typeof arg !== 'string')) throw new Error('Explicit browser MCP command required');
  if (!Array.isArray(protectedPaths) || protectedPaths.length === 0
    || protectedPaths.some(path => typeof path !== 'string' || !isAbsolute(path))) {
    throw new Error('Absolute protected browser state paths required');
  }
  const config = structuredClone(before);
  const entries = config.agents?.entries;
  if (!entries?.[browserAgent]) throw new Error('Browser agent must already exist');
  const profiles = config.plugins?.entries?.anthropic?.config?.cliProfiles;
  if (!profiles?.[browserAgent]) throw new Error('Explicit Claude browser profile required');
  config.mcp ??= {}; config.mcp.servers ??= {};
  if (config.mcp.servers[namespace]) throw new Error('Browser MCP namespace is already configured');
  config.mcp.servers[namespace] = { command, args: [...args], env: { ...env },
    toolFilter: { include: [...browserTools] }, requestTimeoutMs: 120_000,
    supportsParallelToolCalls: false };
  const add = (previous, next) => [...new Set([...(previous ?? []), ...next])];
  for (const [id, agent] of Object.entries(entries)) {
    agent.tools ??= {};
    if (id !== browserAgent) {
      agent.tools.deny = add(agent.tools.deny, [namespace + '__*']);
      continue;
    }
    agent.tools.deny = add(agent.tools.deny, ['browser']);
    for (const field of ['allow', 'alsoAllow']) {
      if (agent.tools[field]) agent.tools[field] = agent.tools[field].filter(tool => tool !== 'browser');
    }
    const field = Array.isArray(agent.tools.allow) ? 'allow' : 'alsoAllow';
    agent.tools[field] = add(agent.tools[field], browserTools.map(tool => namespace + '__' + tool));
    agent.tools.sandbox ??= {}; agent.tools.sandbox.tools ??= {};
    agent.tools.sandbox.tools.alsoAllow = add(
      agent.tools.sandbox.tools.alsoAllow?.filter(tool => tool !== 'browser'),
      browserTools.map(tool => namespace + '__' + tool));
    agent.sandbox ??= {}; agent.sandbox.browser ??= {};
    agent.sandbox.browser.enabled = false;
  }
  profiles[browserAgent] = { ...profiles[browserAgent], mode: 'workspace', hostMcp: true,
    protectedPaths: add(profiles[browserAgent].protectedPaths, protectedPaths) };
  return config;
}
