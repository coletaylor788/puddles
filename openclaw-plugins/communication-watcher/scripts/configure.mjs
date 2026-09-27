import { isAbsolute, join } from 'node:path';

export const SYSTEM_FILES = ['AGENTS.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'BOOT.md', 'MEMORY.md'];
export const WATCHER_TOOLS = ['communication_review', 'communication_inbox_complete', 'communication_memory_read', 'communication_memory_search', 'communication_memory_save', 'communication_report', 'communication_calendar_read', 'communication_calendar_plan'];
const denied = ['exec', 'process', 'read', 'write', 'edit', 'apply_patch', 'sessions_send', 'sessions_spawn', 'skill_workshop', 'memory_search', 'memory_get', 'session_status'];
function restrictedTools(names) {
  // A real built-in name anchors the allowlist if the optional plugin is absent.
  // Its explicit deny leaves no fallback native tools. Apply the sandbox layer too.
  return { allow: ['session_status', ...names], deny: denied,
    sandbox: { tools: { allow: ['session_status', ...names], deny: denied } }, elevated: { enabled: false } };
}
/** Pure configuration builder. Paused by default; activation must be explicit. */
export function configure(base, options) {
  const cfg = structuredClone(base);
  if (options.enableHeartbeat !== undefined && typeof options.enableHeartbeat !== "boolean") throw new Error("Invalid heartbeat activation");
  const { mainWorkspace, readerWorkspace, pluginPath, pluginConfig } = options;
  for (const path of [mainWorkspace, readerWorkspace, pluginPath]) {
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes(':') || path.includes('\n')) throw new Error('Invalid staging path');
  }
  const watcher = 'communication-watcher', reader = 'communication-reader';
  if (pluginConfig.watcherAgent !== watcher || pluginConfig.readerAgent !== reader) throw new Error('Invalid agent identity');
  const workspace = join(mainWorkspace, watcher);
  cfg.agents ??= {};
  // The current public host uses explicit entries. Reject old layouts rather than silently dropping agents during an upgrade.
  if (cfg.agents.list) throw new Error('Normalize the agent configuration through the selected host before staging watcher');
  cfg.agents.entries ??= {};
  if (cfg.agents.entries[watcher] || cfg.agents.entries[reader]) throw new Error('Refusing to replace an existing agent');
  if (!cfg.agents.entries.main || cfg.agents.entries.main.workspace !== mainWorkspace) throw new Error('Main workspace does not match the staged configuration');
  const mainTools = cfg.agents.entries.main.tools ??= {};
  const mainAllow = mainTools.allow ? 'allow' : 'alsoAllow';
  mainTools[mainAllow] = [...new Set([...(mainTools[mainAllow] ?? []), 'communication_memory_read'])];
  if (cfg.plugins?.entries?.['active-memory']?.enabled !== false) {
    const targets = cfg.plugins?.entries?.['active-memory']?.config?.agents;
    if (targets?.some(agent => [watcher, reader, '*'].includes(agent))) throw new Error('Restricted agents cannot use unguarded automatic recall');
  }
  const existing = Object.values(cfg.agents.entries);
  const explicitHeartbeat = existing.some(agent => agent.heartbeat !== undefined);
  if (!explicitHeartbeat && cfg.agents.entries.main) {
    cfg.agents.entries.main.heartbeat = structuredClone(cfg.agents.defaults?.heartbeat ?? { every: '30m' });
  }
  cfg.agents.entries[watcher] = {
    workspace,
    heartbeat: { every: options.enableHeartbeat === true ? '30m' : '0m', isolatedSession: true, target: 'none', prompt: 'Follow AGENTS.md for the communication heartbeat. Read pending intake through communication_review. No work means HEARTBEAT_OK.' },
    memory: { search: { enabled: true, sources: ['memory'], extraPaths: [], experimental: { sessionMemory: false } } },
    sandbox: { mode: 'all', backend: 'docker', scope: 'agent', workspaceAccess: 'rw',
      docker: { network: 'none', dangerouslyAllowReservedContainerTargets: true,
        binds: SYSTEM_FILES.map(file => `${join(workspace, file)}:/workspace/${file}:ro`) } },
    tools: restrictedTools(WATCHER_TOOLS),
  };
  cfg.agents.entries[reader] = {
    workspace: readerWorkspace,
    memory: { search: { enabled: false } },
    sandbox: { mode: 'all', backend: 'docker', scope: 'agent', workspaceAccess: 'ro', docker: { network: 'none' } },
    tools: restrictedTools(['communication_inbox_read']),
  };
  cfg.plugins ??= {}; cfg.plugins.entries ??= {}; cfg.plugins.load ??= {};
  cfg.plugins.load.paths = [...new Set([...(cfg.plugins.load.paths ?? []), pluginPath])];
  if (cfg.plugins.allow) cfg.plugins.allow = [...new Set([...cfg.plugins.allow, 'communication-watcher'])];
  cfg.plugins.entries['communication-watcher'] = { enabled: true, config: structuredClone(pluginConfig) };
  return cfg;
}
