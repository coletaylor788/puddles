export const ID = "approved-session-send";
export const WAIT_SECONDS = 60;
export interface Settings {
  requesterAgentId: string;
  targetSessionKey: string;
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
  keys(raw, ["requesterAgentId", "targetSessionKey"]);
  const requesterAgentId = text(raw.requesterAgentId);
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(requesterAgentId)) throw new Error("Invalid requester agent");
  const targetSessionKey = text(raw.targetSessionKey);
  if (agent(targetSessionKey) === requesterAgentId) throw new Error("Target must belong to a different agent");
  return { requesterAgentId, targetSessionKey };
}
export function isRequesterSession(key: string, config: Settings): boolean {
  return agent(key) === config.requesterAgentId && !/:(?:subagent|cron|hook):/.test(key);
}
export function question(input: unknown, config: Settings, sessionKey: string) {
  const args = plain(input); keys(args, ["sessionKey", "message", "timeoutSeconds"]);
  if (args.sessionKey !== config.targetSessionKey ||
      (args.timeoutSeconds !== undefined && args.timeoutSeconds !== WAIT_SECONDS)) throw new Error("Use the fixed target and reply timeout");
  const message = text(args.message);
  // JSON quoting keeps question text distinguishable from host-owned routing text.
  const description = `From agent ${config.requesterAgentId}, conversation ${sessionKey}. Ask ${config.targetSessionKey} and share its answer here. Question: ${JSON.stringify(message)}`;
  if (description.length > 512) throw new Error("Shorten the question to fit the complete approval summary");
  return { params: { sessionKey: config.targetSessionKey, message, timeoutSeconds: WAIT_SECONDS },
    requireApproval: { title: "Ask main and share the answer", description, timeoutMs: 600_000,
      allowedDecisions: ["allow-once", "deny"] as ("allow-once" | "deny")[] } };
}
