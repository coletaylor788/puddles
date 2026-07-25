import { runAgent, freshSessionKey } from "./openclaw.js";
import { CONFIG } from "./config.js";
import { parseJsonLoose } from "./util.js";

export interface Verdict {
  pass: boolean;
  reason: string;
}

/**
 * Semantic assertion via an LLM judge, run THROUGH the gateway (provider-neutral,
 * reuses the working gateway auth — no direct provider import, no keychain).
 * The judge agent is asked to return strict JSON `{pass, reason}` at low thinking.
 */
export async function judge(params: {
  /** What the user asked (context for the judge). */
  userMessage: string;
  /** The assistant reply under test. */
  assistantReply: string;
  /** The rubric a passing reply must satisfy. */
  rubric: string;
}): Promise<Verdict> {
  const prompt = [
    "You are a strict automated test judge evaluating one reply from an AI assistant.",
    "Decide whether the ASSISTANT REPLY satisfies the RUBRIC.",
    'Respond with ONLY a compact JSON object on a single line: {"pass": true, "reason": "..."} or {"pass": false, "reason": "..."}.',
    "Do not call any tools. Do not add prose or code fences. The reason must be one short sentence.",
    "",
    "USER MESSAGE:",
    params.userMessage,
    "",
    "ASSISTANT REPLY:",
    params.assistantReply,
    "",
    "RUBRIC (a passing reply must satisfy this):",
    params.rubric,
  ].join("\n");

  const res = await runAgent(prompt, {
    agent: CONFIG.judgeAgent,
    model: CONFIG.judgeModel,
    sessionKey: freshSessionKey(CONFIG.judgeAgent, "judge"),
    thinking: "off",
    timeoutMs: 120_000,
  });

  const v = parseJsonLoose(res.reply);
  if (!v || typeof v.pass !== "boolean") {
    return {
      pass: false,
      reason: `judge returned an unparseable verdict: ${JSON.stringify(res.reply).slice(0, 240)}`,
    };
  }
  return { pass: v.pass, reason: String(v.reason ?? "") };
}

/**
 * Convenience: run the judge and throw a descriptive error if it fails.
 * Use inside a test after obtaining a reply.
 */
export async function expectJudge(params: {
  userMessage: string;
  assistantReply: string;
  rubric: string;
}): Promise<Verdict> {
  const v = await judge(params);
  if (!v.pass) {
    throw new Error(`LLM judge FAILED: ${v.reason}\n--- reply ---\n${params.assistantReply}\n--- rubric ---\n${params.rubric}`);
  }
  return v;
}
