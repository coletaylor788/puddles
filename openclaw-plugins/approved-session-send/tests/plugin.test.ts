import { beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "../src/plugin.js";
import { ID, question, settings } from "../src/policy.js";
const sdk = vi.hoisted(() => ({ register: vi.fn(), allowed: vi.fn(() => false), unregister: vi.fn(), scope: vi.fn() }));
vi.mock("openclaw/plugin-sdk/plugin-runtime", () => ({ getPluginRuntimeGatewayRequestScope: sdk.scope }));
vi.mock("openclaw/plugin-sdk/session-visibility", () => ({
  createAgentToAgentPolicy: () => ({ isAllowed: sdk.allowed }),
  createSessionVisibilityChecker: { registerScopedAccessProvider: sdk.register },
}));
const route = { sessionKey: "agent:household:imessage:direct:fixture", channel: "imessage", accountId: "default", senderId: "fixture-person" };
const config = { requesterAgentId: "household", targetSessionKey: "agent:main:main" };
const args = { sessionKey: config.targetSessionKey, message: "What time is dinner?" };
const context = { agentId: "household", sessionKey: route.sessionKey, sessionId: "household-session", runId: "run-1", requester: { channel: route.channel, accountId: route.accountId, senderId: route.senderId } };
function setup(registrationMode = "full") {
  let hook: any, cleanup: any;
  const runtimeConfig = { session: { store: "/fixture/{agentId}/sessions.json" }, plugins: { entries: { [ID]: { enabled: true, config: structuredClone(config) } } } };
  const entries = new Map<string, any>([[route.sessionKey, { sessionId: "household-session" }], [config.targetSessionKey, { sessionId: "main-session" }]]);
  const getSessionEntry = vi.fn(({ sessionKey }) => entries.get(sessionKey));
  const resolveStorePath = (store: string, { agentId }: { agentId: string }) => store.replace("{agentId}", agentId);
  const api = { pluginConfig: config, registrationMode, runtime: { config: { current: () => runtimeConfig }, agent: { session: { getSessionEntry, resolveStorePath } } },
    on: (name: string, fn: any) => { if (name === "before_tool_call") hook = fn; },
    lifecycle: { registerRuntimeLifecycle: (value: any) => { cleanup = value.cleanup; } } };
  plugin.register(api as never);
  const provider = sdk.register.mock.calls[0][0];
  return { hook, provider, cleanup, runtimeConfig, entries, getSessionEntry };
}
beforeEach(() => {
  vi.clearAllMocks(); sdk.register.mockReturnValue(sdk.unregister); sdk.allowed.mockReturnValue(false);
  sdk.scope.mockReturnValue({ pluginRegistry: { plugins: [{ id: ID, status: "loaded" }], typedHooks: [{ pluginId: ID, hookName: "before_tool_call" }] } });
});
describe("native question policy", () => {
  it("requests approval of the full origin and final bounded arguments on every call", () => {
    const { hook } = setup();
    for (const toolCallId of ["first", "clarification", "new-human-question"]) {
      const result = hook({ toolName: "sessions_send", params: args, toolCallId }, context);
      expect(result.params).toEqual({ ...args, timeoutSeconds: 60 });
      expect(result.requireApproval).toMatchObject({ timeoutMs: 600000, allowedDecisions: ["allow-once", "deny"] });
      for (const text of [config.requesterAgentId, route.sessionKey, args.message, config.targetSessionKey]) expect(result.requireApproval.description).toContain(text);
    }
  });
  it.each(["sessionId", "expectedSessionId", "label", "agentId", "watch", "mode", "senderId", "extra"])("rejects caller-supplied %s", field => {
    const { hook } = setup();
    expect(hook({ toolName: "sessions_send", params: { ...args, [field]: "forged" } }, context).block).toBe(true);
  });
  it.each([0, 30, -1, 600, "60"])("rejects alternate timeout %s", timeoutSeconds => {
    const { hook } = setup();
    expect(hook({ toolName: "sessions_send", params: { ...args, timeoutSeconds } }, context).block).toBe(true);
  });
  it.each(["agent:other:main", "main", "AGENT:MAIN:MAIN"])("rejects alternate destination %s", sessionKey => {
    const { hook } = setup();
    expect(hook({ toolName: "sessions_send", params: { ...args, sessionKey } }, context).block).toBe(true);
  });
  it.each(["", "x".repeat(600), "hidden\u202equestion", "line\nbreak", " trailing "])("rejects undisplayable question %j", message => {
    expect(() => question({ ...args, message }, config, route.sessionKey)).toThrow();
  });
  it.each([
    { agentId: "main" }, { agentId: undefined }, { sessionId: "replaced" }, { sessionId: undefined }, { runId: undefined },
    { sessionKey: "agent:household:subagent:child" }, { sessionKey: "agent:other:main" },
  ])("rejects missing or spoofed interactive identity %j", change => {
    const { hook } = setup();
    expect(hook({ toolName: "sessions_send", params: args }, { ...context, ...change }).block).toBe(true);
  });
  it.each([
    ["agent:household:ios-fixture", undefined],
    ["agent:household:main", undefined],
    ["agent:household:imessage:direct:another-person", { channel: "imessage", accountId: "another", senderId: "another-person" }],
    ["agent:household:webchat:fixture", { channel: "webchat" }],
  ])("requires fresh approval independent of the originating conversation %s", (sessionKey, requester) => {
    const { hook, entries, provider } = setup();
    entries.set(sessionKey, { sessionId: "household-session" });
    const ctx = { ...context, sessionKey, requester };
    for (const toolCallId of ["question", "follow-up"]) {
      const result = hook({ toolName: "sessions_send", params: args, toolCallId }, ctx);
      expect(result.requireApproval.allowedDecisions).toEqual(["allow-once", "deny"]);
      expect(result.requireApproval.description).toContain(sessionKey);
    }
    expect(provider({ action: "send", requesterSessionKey: sessionKey, targetSessionKey: config.targetSessionKey })).toEqual({ expectedSessionId: "main-session" });
  });
  it.each(["subagent", "cron", "hook"])("does not grant the route to %s sessions even with an existing session", kind => {
    const { hook, entries, provider } = setup();
    const sessionKey = `agent:household:${kind}:fixture`;
    entries.set(sessionKey, { sessionId: "household-session" });
    expect(hook({ toolName: "sessions_send", params: args }, { ...context, sessionKey }).block).toBe(true);
    expect(provider({ action: "send", requesterSessionKey: sessionKey, targetSessionKey: config.targetSessionKey })).toBeUndefined();
  });
  it("does not change other agents or unrelated tools", () => {
    const { hook } = setup();
    expect(hook({ toolName: "send_email", params: {} }, context)).toBeUndefined();
    expect(hook({ toolName: "sessions_send", params: args }, { agentId: "main", sessionKey: "agent:main:main" })).toBeUndefined();
  });
});
describe("scoped host access", () => {
  const request = { action: "send", requesterSessionKey: route.sessionKey, targetSessionKey: config.targetSessionKey };
  it("grants only send to the host-resolved session incarnation", () => {
    const { provider, entries, getSessionEntry } = setup();
    expect(provider(request)).toEqual({ expectedSessionId: "main-session" });
    expect(getSessionEntry).toHaveBeenCalledWith({ sessionKey: config.targetSessionKey, agentId: "main", storePath: "/fixture/main/sessions.json", readConsistency: "latest" });
    entries.set(config.targetSessionKey, { sessionId: "new-main-session" });
    expect(provider(request)).toEqual({ expectedSessionId: "new-main-session" });
    for (const action of ["list", "history", "search", "status"]) expect(provider({ ...request, action })).toBeUndefined();
    expect(provider({ ...request, requesterSessionKey: "agent:household:subagent:child" })).toBeUndefined();
    expect(provider({ ...request, targetSessionKey: "agent:main:other" })).toBeUndefined();
  });
  it.each([{}, { sessionId: "main-session", archivedAt: 1 }, undefined])("denies missing or archived metadata %j", value => {
    const { provider, entries } = setup();
    entries.set(config.targetSessionKey, value);
    expect(provider(request)).toBeUndefined();
  });
  it("fails closed on host lookup error and broad native fallback", () => {
    const { hook, provider, getSessionEntry } = setup();
    getSessionEntry.mockImplementation(() => { throw new Error("private diagnostic"); });
    expect(provider(request)).toBeUndefined();
    expect(JSON.stringify(hook({ toolName: "sessions_send", params: args }, context))).not.toContain("private diagnostic");
    sdk.allowed.mockReturnValue(true);
    expect(provider(request)).toBeUndefined();
    expect(hook({ toolName: "sessions_send", params: args }, context).block).toBe(true);
  });
  it("revokes access and blocks calls after config change, disable, or cleanup", () => {
    const { hook, provider, cleanup, runtimeConfig } = setup();
    runtimeConfig.plugins.entries[ID].config.targetSessionKey = "agent:main:changed";
    expect(provider(request)).toBeUndefined();
    runtimeConfig.plugins.entries[ID].config = structuredClone(config);
    runtimeConfig.plugins.entries[ID].enabled = false;
    expect(provider(request)).toBeUndefined();
    runtimeConfig.plugins.entries[ID].enabled = true;
    expect(provider(request)).toEqual({ expectedSessionId: "main-session" });
    cleanup();
    expect(sdk.unregister).toHaveBeenCalledOnce();
    expect(provider(request)).toBeUndefined();
    expect(hook({ toolName: "sessions_send", params: args }, context).block).toBe(true);
  });
  it("rejects invalid registration and stays inert for CLI metadata", () => {
    expect(() => settings({ ...config, requesterAgentId: "invalid agent" })).toThrow();
    plugin.register({ pluginConfig: config, registrationMode: "cli-metadata" } as never);
    expect(sdk.register).not.toHaveBeenCalled();
  });
  it.each(["discovery", "tool-discovery"])("enforces approval in native %s run registries", mode => {
    const { hook, provider } = setup(mode);
    expect(hook({ toolName: "sessions_send", params: args }, context).requireApproval.allowedDecisions).toEqual(["allow-once", "deny"]);
    expect(provider(request)).toEqual({ expectedSessionId: "main-session" });
  });
  it("denies a global grant when the run omits its own loaded approval hook", () => {
    const { provider } = setup();
    for (const scope of [undefined, {},
      { pluginRegistry: { plugins: [{ id: ID, status: "loaded" }], typedHooks: [] } },
      { pluginRegistry: { plugins: [{ id: ID, status: "loaded" }], typedHooks: [{ pluginId: "other", hookName: "before_tool_call" }] } },
      { pluginRegistry: { plugins: [{ id: ID, status: "disabled" }], typedHooks: [{ pluginId: ID, hookName: "before_tool_call" }] } },
    ]) {
      sdk.scope.mockReturnValue(scope);
      expect(provider(request)).toBeUndefined();
    }
  });
});
