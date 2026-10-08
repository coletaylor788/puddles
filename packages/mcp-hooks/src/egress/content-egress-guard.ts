import type { LLMClient } from "../llm-client.js";
import type { EgressHook, HookResult } from "../types.js";
import { classifyBoolean } from "../classify.js";
import { SECRETS_PROMPT, SENSITIVE_PROMPT } from "../prompts.js";

/** The shared secrets/sensitive-content policy, without recipient trust checks. */
export class ContentEgressGuard implements EgressHook {
  constructor(private readonly llm: LLMClient) {}

  async check(_toolName: string, content: string): Promise<HookResult> {
    const [secrets, sensitive] = await Promise.all([
      classifyBoolean(this.llm, content, SECRETS_PROMPT, "contacts-egress.secrets"),
      classifyBoolean(this.llm, content, SENSITIVE_PROMPT, "contacts-egress.sensitive"),
    ]);
    if (secrets.outcome !== "ok") {
      return {
        action: "block",
        reason: `Leak check degraded: secrets classifier ${secrets.outcome} (${secrets.error ?? "no detail"}). Failing closed to prevent egress.`,
      };
    }
    if (sensitive.outcome !== "ok") {
      return {
        action: "block",
        reason: `Leak check degraded: sensitive classifier ${sensitive.outcome} (${sensitive.error ?? "no detail"}). Failing closed to prevent egress.`,
      };
    }
    if (secrets.detected) {
      return {
        action: "block",
        reason: `Secrets detected: ${secrets.evidence}`,
      };
    }
    if (sensitive.detected) {
      return {
        action: "block",
        reason: `Sensitive data detected: ${sensitive.evidence}`,
      };
    }
    return { action: "allow" };
  }
}
