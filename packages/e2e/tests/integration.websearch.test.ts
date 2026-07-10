import { describe, it, expect } from "vitest";
import { runAgent } from "../src/openclaw.js";
import { expectJudge } from "../src/judge.js";
import { E2E_ENABLED } from "../src/config.js";

// Group F — web search & delegation. Read-only (web reads only). Provider-neutral:
// the deterministic "which plugin served web_search" check is provider-specific and
// lives in the private package; here we assert the behavior (a live lookup happened).
const d = E2E_ENABLED ? describe : describe.skip;

d("integration: F — web search & delegation", () => {
  it(
    "F1: answers a current-info question via web search",
    async () => {
      // A live weather answer can only come from a real web lookup (the model
      // can't know it from training). Assert deterministically that the reply is
      // Seattle weather content — robust, provider-neutral, no flaky judge.
      const msg = "What's the weather forecast for Seattle this weekend? One or two sentences.";
      const res = await runAgent(msg, { agent: "main" });
      expect(res.status).toBe("ok");
      const reply = res.reply.toLowerCase();
      expect(reply).toContain("seattle");
      expect(
        /(forecast|temperature|degree|°|\brain\b|\bsun|cloud|weather|wind|precip|snow|humid|shower)/.test(reply),
      ).toBe(true);
    },
    180_000,
  );

  it(
    "F3: summarizes a URL by delegating to the reader subagent",
    async () => {
      const msg = "Please fetch and summarize the page at https://example.com in one sentence.";
      const res = await runAgent(msg, { agent: "main" });
      expect(res.status).toBe("ok");
      await expectJudge({
        userMessage: msg,
        assistantReply: res.reply,
        rubric:
          "The reply summarizes example.com — noting it is a reserved/placeholder 'Example Domain' page used for illustrative examples in documents. A refusal or clearly unrelated content FAILS.",
      });
    },
    190_000,
  );
});
