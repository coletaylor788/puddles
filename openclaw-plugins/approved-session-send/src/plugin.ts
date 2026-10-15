import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createAgentToAgentPolicy, createSessionVisibilityChecker } from "openclaw/plugin-sdk/session-visibility";
import { getPluginRuntimeGatewayRequestScope } from "openclaw/plugin-sdk/plugin-runtime";
import { agent, ID, isRequesterSession, question, settings } from "./policy.js";

export default {
  id: ID,
  name: "Approved Session Send",
  register(api: OpenClawPluginApi) {
    const configured = settings(api.pluginConfig);
    // Native prepared runs use discovery registries, including executable policy
    // hooks. Only setup and CLI metadata modes omit these capabilities.
    if (api.registrationMode && !["full", "discovery", "tool-discovery"].includes(api.registrationMode)) return;
    const fingerprint = JSON.stringify(configured);
    let active = true;
    function current() {
      if (!active) throw new Error("Route is stopped");
      const cfg = api.runtime.config.current();
      const entry = cfg.plugins?.entries?.[ID];
      if (entry?.enabled !== true || JSON.stringify(settings(entry.config)) !== fingerprint) throw new Error("Route configuration changed");
      // If scoped access disappears, native admission must deny the send instead
      // of falling back to the ordinary peer reply flow.
      if (createAgentToAgentPolicy(cfg).isAllowed(configured.requesterAgentId, agent(configured.targetSessionKey))) {
        throw new Error("Ordinary cross-agent access must deny this route");
      }
      return configured;
    }
    function session(sessionKey: string) {
      const agentId = agent(sessionKey);
      const storePath = api.runtime.agent.session.resolveStorePath(api.runtime.config.current().session?.store, { agentId });
      const entry = api.runtime.agent.session.getSessionEntry({ sessionKey, agentId, storePath, readConsistency: "latest" });
      if (!entry?.sessionId || entry.archivedAt !== undefined) throw new Error("Session is absent or archived");
      return entry;
    }
    api.on("before_tool_call", (event, ctx) => {
      if (event.toolName !== "sessions_send") return;
      if (!ctx.agentId || !ctx.sessionKey) return { block: true, blockReason: "Session sends require host-derived caller identity." };
      const belongs = ctx.agentId === configured.requesterAgentId || ctx.sessionKey?.startsWith(`agent:${configured.requesterAgentId}:`);
      if (!belongs) return;
      try {
        const config = current();
        if (ctx.agentId !== config.requesterAgentId || !ctx.sessionKey || !ctx.sessionId || !ctx.runId) throw new Error("Runtime caller identity is required");
        if (!isRequesterSession(ctx.sessionKey, config) || session(ctx.sessionKey).sessionId !== ctx.sessionId) throw new Error("Caller is not authorized");
        session(config.targetSessionKey);
        return question(event.params, config, ctx.sessionKey);
      } catch {
        return { block: true, blockReason: "Question route unavailable or invalid. Use the configured agent, main target, and a question that fits the full approval summary." };
      }
    });
    const unregister = createSessionVisibilityChecker.registerScopedAccessProvider(request => {
      try {
        // Access providers are process-wide; hooks belong to the current run's
        // registry. Never lend a grant to a run that omitted this policy plugin.
        const registry = getPluginRuntimeGatewayRequestScope()?.pluginRegistry;
        if (!registry?.plugins.some(p => p.id === ID && p.status === "loaded") ||
            !registry.typedHooks.some(h => h.pluginId === ID && h.hookName === "before_tool_call")) return;
        const config = current();
        if (request.action !== "send" || request.targetSessionKey !== config.targetSessionKey ||
            !isRequesterSession(request.requesterSessionKey, config)) return;
        session(request.requesterSessionKey);
        return { expectedSessionId: session(config.targetSessionKey).sessionId };
      } catch { return; }
    });
    api.lifecycle.registerRuntimeLifecycle({ id: `${ID}-route`, description: "Retire the scoped question route with its plugin runtime.",
      cleanup: () => { active = false; unregister(); } });
  },
};
