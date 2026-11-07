import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createAgentToAgentPolicy, createSessionVisibilityChecker } from "openclaw/plugin-sdk/session-visibility";
import { getPluginRuntimeGatewayRequestScope } from "openclaw/plugin-sdk/plugin-runtime";

const ID = "session-return-grant";
function settings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Return route configuration is required");
  const config = value as Record<string, unknown>;
  if (Object.keys(config).some(key => !["senderAgentId", "targetAgentId"].includes(key))) throw new Error("Unknown return route setting");
  const { senderAgentId, targetAgentId } = config;
  if (typeof senderAgentId !== "string" || typeof targetAgentId !== "string" ||
      !/^[a-z0-9][a-z0-9_-]*$/.test(senderAgentId) || !/^[a-z0-9][a-z0-9_-]*$/.test(targetAgentId) ||
      senderAgentId === targetAgentId) throw new Error("Return route requires distinct canonical agents");
  return { senderAgentId, targetAgentId };
}
function eligible(key: string, agentId: string) {
  return typeof key === "string" && key.startsWith(`agent:${agentId}:`) && key === key.toLowerCase() &&
    /^agent:[a-z0-9][a-z0-9_-]*:[^\s]+$/.test(key) && !/:(?:subagent|cron|hook):/.test(key);
}

export default {
  id: ID,
  name: "Session Return Grant",
  register(api: OpenClawPluginApi) {
    const configured = settings(api.pluginConfig);
    if (api.registrationMode && !["full", "discovery", "tool-discovery"].includes(api.registrationMode)) return;
    const fingerprint = JSON.stringify(configured);
    let active = true;
    const unregister = createSessionVisibilityChecker.registerScopedAccessProvider(request => {
      try {
        if (!active || request.action !== "send" || !eligible(request.requesterSessionKey, configured.senderAgentId) ||
            !eligible(request.targetSessionKey, configured.targetAgentId)) return;
        // The SDK supplies requester identity. A process-wide provider must not
        // lend authority to a run that omitted this plugin.
        const registry = getPluginRuntimeGatewayRequestScope()?.pluginRegistry;
        if (!registry?.plugins.some(plugin => plugin.id === ID && plugin.status === "loaded")) return;
        const cfg = api.runtime.config.current();
        const entry = cfg.plugins?.entries?.[ID];
        if (entry?.enabled !== true || JSON.stringify(settings(entry.config)) !== fingerprint ||
            createAgentToAgentPolicy(cfg).isAllowed(configured.senderAgentId, configured.targetAgentId)) return;
        const session = (sessionKey: string, agentId: string) => {
          const storePath = api.runtime.agent.session.resolveStorePath(cfg.session?.store, { agentId });
          return api.runtime.agent.session.getSessionEntry({ sessionKey, agentId, storePath, readConsistency: "latest" });
        };
        const caller = session(request.requesterSessionKey, configured.senderAgentId);
        const target = session(request.targetSessionKey, configured.targetAgentId);
        if (!caller?.sessionId || caller.archivedAt !== undefined || !target?.sessionId || target.archivedAt !== undefined) return;
        // Native execution binds this incarnation and suppresses separate peer
        // and announcement turns. The target handles its native source reply.
        return { expectedSessionId: target.sessionId };
      } catch { return; }
    });
    api.lifecycle.registerRuntimeLifecycle({ id: `${ID}-route`, description: "Retire the scoped answer return grant with its runtime.",
      cleanup: () => { active = false; unregister(); } });
  },
};
