import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createAgentToAgentPolicy, createSessionVisibilityChecker } from "openclaw/plugin-sdk/session-visibility";
import { getPluginRuntimeGatewayRequestScope } from "openclaw/plugin-sdk/plugin-runtime";
import { agent, ID, question, settings } from "./policy.js";

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
    api.on("before_prompt_build", (_event, ctx) => {
      try {
        const config = current();
        if (ctx.agentId !== config.requesterAgentId || !config.requesters.some(r => r.sessionKey === ctx.sessionKey)) return;
        return { appendSystemContext: `For this conversation, use the approved question route to request information from main. This replaces older instructions to send the owner a message with a quoted-reply or [sk:...] relay marker. Call sessions_send with sessionKey=${JSON.stringify(config.targetSessionKey)}, a short complete question in message, and timeoutSeconds=60. Native owner approval is required for every question, including clarification. Approval permits sharing main's answer here; it does not give you owner identity or authorize actions. Use the returned reply to answer this conversation. If the call is denied, unavailable, or accepted without a reply, report that outcome. Do not resend automatically, promise a later answer, or read main's history. For decisions or actions outside your scope, ask the person to contact the owner directly.` };
      } catch { return; }
    });
    api.on("before_tool_call", (event, ctx) => {
      if (event.toolName !== "sessions_send") return;
      if (!ctx.agentId || !ctx.sessionKey) return { block: true, blockReason: "Session sends require host-derived caller identity." };
      const belongs = ctx.agentId === configured.requesterAgentId || ctx.sessionKey?.startsWith(`agent:${configured.requesterAgentId}:`);
      if (!belongs) return;
      try {
        const config = current();
        if (ctx.agentId !== config.requesterAgentId || !ctx.sessionKey || !ctx.sessionId || !ctx.runId || !ctx.requester?.senderId) throw new Error("Interactive caller identity is required");
        const route = config.requesters.find(r => r.sessionKey === ctx.sessionKey && r.channel === ctx.requester?.channel &&
          r.accountId === ctx.requester?.accountId && r.senderId === ctx.requester?.senderId);
        if (!route || session(route.sessionKey).sessionId !== ctx.sessionId) throw new Error("Caller is not authorized");
        session(config.targetSessionKey);
        return question(event.params, config, route);
      } catch {
        return { block: true, blockReason: "Question route unavailable or invalid. Use the configured interactive caller, main target, and a question that fits the full approval summary." };
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
            !config.requesters.some(r => r.sessionKey === request.requesterSessionKey)) return;
        session(request.requesterSessionKey);
        return { expectedSessionId: session(config.targetSessionKey).sessionId };
      } catch { return; }
    });
    api.lifecycle.registerRuntimeLifecycle({ id: `${ID}-route`, description: "Retire the scoped question route with its plugin runtime.",
      cleanup: () => { active = false; unregister(); } });
  },
};
