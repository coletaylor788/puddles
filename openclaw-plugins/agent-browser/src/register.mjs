import { isAbsolute } from 'node:path';
import { browserConnection } from './bridge.mjs';

const runtimeKey = Symbol.for('puddles.agent-browser.mcp.v1');
export function sharedRuntime() { return globalThis[runtimeKey] ??= {}; }

export function registerBrowser(api, tools, connect, runtime = sharedRuntime(), instructions = '') {
  const config = api.pluginConfig;
  if (!config || !isAbsolute(config.command ?? '') || !Array.isArray(config.args)
    || config.args.some(arg => typeof arg !== 'string') || !config.agentId) {
    throw new Error('Explicit host browser command and agent identity required');
  }
  const key = JSON.stringify([config.command, config.args, config.env ?? {}, config.agentId]);
  function getBridge() {
    if (runtime.stopped) throw new Error('Browser plugin is stopped');
    if (runtime.key && runtime.key !== key) throw new Error('Browser configuration changed; restart Gateway before use');
    runtime.key = key;
    return runtime.bridge ??= browserConnection(config, connect);
  }
  for (const tool of tools) {
    api.registerTool(ctx => ctx.agentId === config.agentId ? {
      name: tool.name, label: tool.name, description: tool.description ?? '',
      parameters: tool.inputSchema,
      async execute(_id, args, signal) {
        // Preserve native content (including images), structured output and errors.
        const result = await getBridge().call(tool.name, args, signal);
        return { ...result, details: { ...result, ok: result.isError !== true, isError: result.isError === true } };
      },
    } : null, { names: [tool.name] });
  }
  if (instructions) api.on('before_prompt_build', (_event, ctx) =>
    ctx.agentId === config.agentId ? { appendSystemContext: instructions } : undefined);
  api.registerService({ id: 'agent-browser-mcp',
    start() { runtime.stopped = false; },
    async stop() {
      runtime.stopped = true;
      try { await runtime.bridge?.close(); }
      finally { runtime.bridge = undefined; runtime.key = undefined; }
    },
  });
}
