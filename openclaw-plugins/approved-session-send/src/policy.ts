export const ID = "approved-session-send";
export const WAIT_SECONDS = 60;
export interface Route {
  sessionKey: string;
  channel: string;
  accountId: string;
  senderId: string;
}
export interface Settings {
  requesterAgentId: string;
  targetSessionKey: string;
  requesters: Route[];
}
export function plain(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Expected an object");
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(p => !("value" in p))) throw new Error("Accessors are not supported");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Reflect.ownKeys(value).some(k => typeof k !== "string" || !allowed.includes(k))) throw new Error("Unsupported parameter");
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value !== value.trim() || /[\p{Cc}\p{Cf}]/u.test(value)) throw new Error("Invalid text");
  return value;
}
export function agent(key: string): string {
  const match = /^agent:([a-z0-9][a-z0-9_-]*):[^\s]+$/.exec(key);
  if (!match || key !== key.toLowerCase()) throw new Error("Use a canonical session key");
  return match[1];
}
export function settings(value: unknown): Settings {
  const raw = plain(value);
  keys(raw, ["requesterAgentId", "targetSessionKey", "requesters"]);
  const requesterAgentId = text(raw.requesterAgentId);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(requesterAgentId)) throw new Error("Invalid requester agent");
  const targetSessionKey = text(raw.targetSessionKey);
  if (agent(targetSessionKey) === requesterAgentId) throw new Error("Target must belong to a different agent");
  if (!Array.isArray(raw.requesters) || raw.requesters.length < 1 || raw.requesters.length > 32) throw new Error("Configure exact requesters");
  const requesters = raw.requesters.map(value => {
    const row = plain(value); keys(row, ["sessionKey", "channel", "accountId", "senderId"]);
    const route = { sessionKey: text(row.sessionKey), channel: text(row.channel), accountId: text(row.accountId), senderId: text(row.senderId) };
    if (agent(route.sessionKey) !== requesterAgentId || /:(?:subagent|cron|hook):/.test(route.sessionKey)) throw new Error("Requester must be an interactive session of the configured agent");
    return route;
  });
  return { requesterAgentId, targetSessionKey, requesters };
}
export function question(input: unknown, config: Settings, route: Route) {
  const args = plain(input); keys(args, ["sessionKey", "message", "timeoutSeconds"]);
  if (args.sessionKey !== config.targetSessionKey ||
      (args.timeoutSeconds !== undefined && args.timeoutSeconds !== WAIT_SECONDS)) throw new Error("Use the fixed target and reply timeout");
  const message = text(args.message);
  // JSON quoting keeps question text distinguishable from host-owned routing text.
  const description = `From ${route.channel}/${route.accountId} sender ${route.senderId}, session ${route.sessionKey}. Ask ${config.targetSessionKey} and share its answer here. Question: ${JSON.stringify(message)}`;
  if (description.length > 512) throw new Error("Shorten the question to fit the complete approval summary");
  return { params: { sessionKey: config.targetSessionKey, message, timeoutSeconds: WAIT_SECONDS },
    requireApproval: { title: "Ask main and share the answer", description, timeoutMs: 600_000,
      allowedDecisions: ["allow-once", "deny"] as ("allow-once" | "deny")[] } };
}
