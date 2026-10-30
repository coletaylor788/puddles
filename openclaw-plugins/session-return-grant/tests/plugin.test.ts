import { beforeEach, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ provider: undefined as any, unregister: vi.fn(), allowed: false,
  registry: { plugins: [{ id: "session-return-grant", status: "loaded" }] } as any }));
vi.mock("openclaw/plugin-sdk/session-visibility", () => ({
  createAgentToAgentPolicy: () => ({ isAllowed: () => sdk.allowed }),
  createSessionVisibilityChecker: { registerScopedAccessProvider: (fn: any) => { sdk.provider = fn; return sdk.unregister; } },
}));
vi.mock("openclaw/plugin-sdk/plugin-runtime", () => ({ getPluginRuntimeGatewayRequestScope: () => ({ pluginRegistry: sdk.registry }) }));
import plugin from "../src/plugin.js";
const config = { senderAgentId: "main", targetAgentId: "household" };
const request = { action: "send", requesterSessionKey: "agent:main:imessage:direct:owner", targetSessionKey: "agent:household:chat" };
function load(mode = "full") {
  let cleanup: any;
  const current = { plugins: { entries: { "session-return-grant": { enabled: true, config } } } };
  const entries: Record<string, any> = { [request.requesterSessionKey]: { sessionId: "caller-1" }, [request.targetSessionKey]: { sessionId: "target-1" } };
  plugin.register({ pluginConfig: config, registrationMode: mode,
    runtime: { config: { current: () => current }, agent: { session: {
      resolveStorePath: (_: any, { agentId }: any) => `/state/${agentId}`,
      getSessionEntry: ({ sessionKey }: any) => entries[sessionKey],
    } } }, lifecycle: { registerRuntimeLifecycle: (value: any) => { cleanup = value.cleanup; } },
  } as any);
  return { current, entries, cleanup };
}
beforeEach(() => { sdk.provider = undefined; sdk.allowed = false; sdk.registry = { plugins: [{ id: "session-return-grant", status: "loaded" }] }; sdk.unregister.mockClear(); });
it.each(["full", "discovery", "tool-discovery"])("grants only the live exact incarnation in %s", mode => {
  const { entries } = load(mode);
  expect(sdk.provider(request)).toEqual({ expectedSessionId: "target-1" });
  entries[request.targetSessionKey].sessionId = "target-2";
  expect(sdk.provider(request)).toEqual({ expectedSessionId: "target-2" });
});
it.each(["status", "history", "list", "search"])("never grants %s", action => {
  load(); expect(sdk.provider({ ...request, action })).toBeUndefined();
});
it.each([
  { requesterSessionKey: "agent:household:chat", targetSessionKey: "agent:main:main" },
  { requesterSessionKey: "agent:main:subagent:child" }, { requesterSessionKey: "agent:main:cron:job" },
  { targetSessionKey: "agent:household:subagent:child" }, { targetSessionKey: "agent:household:cron:job" },
  { targetSessionKey: "agent:other:chat" }, { targetSessionKey: "alias" }, { requesterSessionKey: undefined },
])("rejects ineligible routes %j", change => { load(); expect(sdk.provider({ ...request, ...change })).toBeUndefined(); });
it.each([undefined, { plugins: [] }, { plugins: [{ id: "session-return-grant", status: "error" }] }])("does not lend a grant to missing or failed registry %j", registry => {
  load(); sdk.registry = registry; expect(sdk.provider(request)).toBeUndefined();
});
it("stops granting when configuration changes or ordinary access permits the pair", () => {
  const { current } = load(); sdk.allowed = true; expect(sdk.provider(request)).toBeUndefined();
  sdk.allowed = false; current.plugins.entries["session-return-grant"].enabled = false; expect(sdk.provider(request)).toBeUndefined();
});
it.each([request.requesterSessionKey, request.targetSessionKey])("rejects absent or archived session %s", key => {
  const { entries } = load(); entries[key].archivedAt = 1; expect(sdk.provider(request)).toBeUndefined();
  delete entries[key]; expect(sdk.provider(request)).toBeUndefined();
});
it("retires authority during cleanup", () => {
  const { cleanup } = load(); cleanup(); expect(sdk.provider(request)).toBeUndefined(); expect(sdk.unregister).toHaveBeenCalledOnce();
});
it("does not register authority in metadata mode", () => { load("cli-metadata"); expect(sdk.provider).toBeUndefined(); });
