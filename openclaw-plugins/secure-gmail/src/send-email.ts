import type { AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { EgressHook } from "mcp-hooks";
import type { McpCaller, AuditLogger } from "./wrap-tool.js";
import { extractText } from "./wrap-tool.js";

export const SEND_NAME = "send_email";
export const SEND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    to: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 },
    cc: { type: "array", items: { type: "string" }, maxItems: 20 },
    bcc: { type: "array", items: { type: "string" }, maxItems: 20 },
    subject: { type: "string", maxLength: 200 },
    body_text: { type: "string", maxLength: 100000 },
  },
  required: ["to", "subject", "body_text"],
} as const;

const ADDRESS = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const HEADER_CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
export function validMailbox(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 254 || !ADDRESS.test(value)) return false;
  const [local, domain] = value.split("@");
  return local.length <= 64 && domain.split(".").every((label) => label.length <= 63);
}

export function validateEmail(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid email input.");
  const args = value as Record<string, unknown>;
  if (Object.keys(args).some((key) => !Object.hasOwn(SEND_SCHEMA.properties, key))) throw new Error("Unsupported email field.");
  for (const key of ["to", "cc", "bcc"]) {
    const list = args[key];
    if (key !== "to" && list === undefined) continue;
    if (!Array.isArray(list) || list.length > 20 || (key === "to" && !list.length) || !list.every(validMailbox)) {
      throw new Error("Recipients must be explicit mailbox addresses.");
    }
  }
  if (typeof args.subject !== "string" || args.subject.length > 200 || (HEADER_CONTROL.test(args.subject) || /[\ud800-\udfff]/u.test(args.subject))) {
    throw new Error("Invalid email subject.");
  }
  if (typeof args.body_text !== "string" || Buffer.byteLength(args.body_text, "utf8") > 100000 || (args.body_text.includes("\0") || /[\ud800-\udfff]/u.test(args.body_text))) {
    throw new Error("Invalid plain-text body.");
  }
  return args;
}

/** Display only. Gmail validation and content classification happen after approval. */
export function approvalSummary(mailbox: string, args: Record<string, unknown>): string {
  const display = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const lines = [`From: ${mailbox}`];
  for (const [key, label] of [["to", "To"], ["cc", "Cc"], ["bcc", "Bcc"]]) {
    const list = args[key];
    if (list === undefined && key !== "to") continue;
    if (!Array.isArray(list) || list.some((item) => typeof item !== "string")) throw new Error("Cannot display recipients.");
    lines.push(`${label}: ${list.map((item) => display(item as string)).join(", ")}`);
  }
  if (typeof args.subject !== "string" || typeof args.body_text !== "string") throw new Error("Cannot display email summary.");
  const envelope = lines.join("\n");
  const subject = `\nSubject: ${display(args.subject)}`;
  // Never hide a destination or silently truncate the subject.
  if (envelope.length + subject.length > 470) throw new Error("Email envelope is too large for the approval summary.");
  const head = envelope + subject + "\nBody preview: ";
  const body = display(args.body_text);
  const remaining = 512 - head.length;
  return head + (body.length > remaining ? body.slice(0, remaining - 1) + "…" : body);
}

function result(status: string, message: string, receipt: Record<string, string> = {}) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ status, message, ...receipt }) }],
    details: { source: "secure-gmail", status, ...receipt },
  };
}

export function createSendTool(options: {
  mailbox: string;
  guard: EgressHook;
  bridge: McpCaller;
  audit?: AuditLogger;
}): AnyAgentTool {
  return {
    name: SEND_NAME,
    label: "Send email",
    description: "Send a new plain-text email after native owner approval and content checks. Never automatically retry an unknown send outcome.",
    parameters: SEND_SCHEMA as never,
    async execute(_id, input, signal) {
      let args: Record<string, unknown>;
      try { args = validateEmail(input); } catch { return result("blocked", "Invalid email input. No email sent."); }
      if (!validMailbox(options.mailbox)) return result("blocked", "Mailbox configuration is invalid.");
      if (signal?.aborted) return result("cancelled", "No email sent.");
      const content = JSON.stringify(args);
      try {
        const verdict = await options.guard.check(SEND_NAME, content, args);
        options.audit?.({ timestamp: new Date().toISOString(), toolName: SEND_NAME, hookName: "ContentEgressGuard", action: verdict.action === "allow" ? "allow" : "block", contentLen: content.length });
        if (verdict.action !== "allow") return result("blocked", "Content guard blocked the email. No email sent.");
      } catch { return result("blocked", "Content guard unavailable. No email sent."); }
      if (signal?.aborted) return result("cancelled", "No email sent.");
      // No retry here: a bridge failure can occur after Gmail accepted the message.
      try {
        const raw = await options.bridge.callTool(SEND_NAME, args, signal);
        const receipt = JSON.parse(extractText(raw)) as Record<string, unknown>;
        if (!raw.isError && receipt.status === "sent" && typeof receipt.id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(receipt.id) && typeof receipt.threadId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(receipt.threadId)) {
          return result("sent", "Gmail accepted the email.", { id: receipt.id, threadId: receipt.threadId });
        }
        if (receipt.status === "failed_before_send") return result("failed_before_send", "Gmail setup or validation failed. No email sent.");
      } catch { /* Provider text is untrusted and may echo the email. */ }
      return result("unknown", "Send outcome is unknown. Do not retry automatically; reconcile with Gmail first.");
    },
  } as AnyAgentTool;
}
