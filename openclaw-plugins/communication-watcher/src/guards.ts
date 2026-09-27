import { InjectionGuard, SecretRedactor, type LLMClient } from "mcp-hooks";

export class BoundaryError extends Error {
  constructor(readonly code: "invalid" | "denied" | "unavailable" | "blocked" | "limit" | "changed") { super(code); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new BoundaryError("invalid");
  return value as Record<string, unknown>;
}
export function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Reflect.ownKeys(value).some(k => typeof k !== "string" || !allowed.includes(k)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !("value" in d))) throw new BoundaryError("invalid");
}
export function string(value: unknown, max = 16000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || value.includes("\0")) throw new BoundaryError("invalid");
  return value;
}
export function id(value: unknown): string {
  const result = string(value, 256);
  if (!/^[a-zA-Z0-9_.:@/+\-=]+$/.test(result)) throw new BoundaryError("invalid");
  return result;
}

/** Validate verdicts before existing hooks see them. Never return provider errors or evidence. */
export function guardedText(llm: LLMClient) {
  const strict: LLMClient = {
    async classify(content, prompt, options) {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let raw: string;
        try {
          raw = await Promise.race([
            llm.classify(content, prompt, options),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BoundaryError("unavailable")), 20000); timer.unref(); }),
          ]);
        } finally { if (timer) clearTimeout(timer); }
        if (raw.length > 32000) throw new Error();
        const verdict = object(JSON.parse(raw));
        if (options?.label === "secret-redact") {
          keys(verdict, ["findings"]);
          if (!Array.isArray(verdict.findings) || verdict.findings.length > 100) throw new Error();
          for (const value of verdict.findings) {
            const finding = object(value); keys(finding, ["secret", "type"]);
            const secret = string(finding.secret);
            if (!content.includes(secret) || !/^[a-z_]{1,40}$/.test(string(finding.type, 40))) throw new Error();
          }
        } else {
          keys(verdict, ["detected", "evidence"]);
          if (typeof verdict.detected !== "boolean" || typeof verdict.evidence !== "string" || verdict.evidence.length > 4000) throw new Error();
          // Evidence is classifier-generated untrusted content, not a useful log field.
          verdict.evidence = "content_check";
        }
        return JSON.stringify(verdict);
      } catch { throw new BoundaryError("unavailable"); }
    },
  };
  const secrets = new SecretRedactor({ llm: strict });
  const injection = new InjectionGuard({ llm: strict });
  let window = 0, day = 0, checks = 0, dailyChecks = 0;
  return async (input: string): Promise<string> => {
    if (input.length > 16000) throw new BoundaryError("limit");
    if (!input) return input;
    const now = Date.now();
    if (now - window >= 30 * 60_000) { window = now; checks = 0; }
    if (now - day >= 24 * 60 * 60_000) { day = now; dailyChecks = 0; }
    if (++checks > 64 || ++dailyChecks > 512) throw new BoundaryError("limit");
    const redacted = await secrets.check("communication", input);
    if (redacted.action === "block") throw new BoundaryError("unavailable");
    const text = redacted.action === "modify" ? redacted.content! : input;
    const verdict = await injection.check("communication", text);
    if (verdict.action !== "allow") throw new BoundaryError(verdict.details?.degraded ? "unavailable" : "blocked");
    return text;
  };
}
export type Guard = ReturnType<typeof guardedText>;
