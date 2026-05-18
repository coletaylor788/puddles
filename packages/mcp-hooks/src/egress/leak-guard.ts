import type { LLMClient } from "../llm-client.js";
import type { HookResult } from "../types.js";
import { classifyBoolean, type ClassificationResult } from "../classify.js";
import { SECRETS_PROMPT, SENSITIVE_PROMPT, PII_PROMPT } from "../prompts.js";

export class LeakGuard {
  private llm: LLMClient;

  constructor(options: { llm: LLMClient }) {
    this.llm = options.llm;
  }

  async check(_toolName: string, content: string): Promise<HookResult> {
    const [secrets, sensitive, pii] = await Promise.all([
      classifyBoolean(this.llm, content, SECRETS_PROMPT, "leak.secrets"),
      classifyBoolean(this.llm, content, SENSITIVE_PROMPT, "leak.sensitive"),
      classifyBoolean(this.llm, content, PII_PROMPT, "leak.pii"),
    ]);

    // Fail closed: if ANY of the three classifiers errored (api_error /
    // parse_error), we cannot rule out a leak so we must block. Reporting
    // the first degraded classifier in the reason makes the failure mode
    // visible in the audit log.
    const degraded = firstDegraded({ secrets, sensitive, pii });
    if (degraded) {
      return {
        action: "block",
        reason: `Leak check degraded: ${degraded.label} classifier ${degraded.outcome} (${degraded.error ?? "no detail"}). Failing closed to prevent egress.`,
      };
    }

    if (secrets.detected) {
      return { action: "block", reason: `Secrets detected: ${secrets.evidence}` };
    }
    if (sensitive.detected) {
      return { action: "block", reason: `Sensitive data detected: ${sensitive.evidence}` };
    }
    if (pii.detected) {
      return { action: "block", reason: `PII detected: ${pii.evidence}` };
    }

    return { action: "allow" };
  }
}

function firstDegraded(
  results: Record<string, ClassificationResult>,
): { label: string; outcome: string; error?: string } | null {
  for (const [label, r] of Object.entries(results)) {
    if (r.outcome !== "ok") return { label, outcome: r.outcome, error: r.error };
  }
  return null;
}
