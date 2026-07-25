import { describe, it, expect } from "vitest";
import { runAgent } from "../src/openclaw.js";
import { expectJudge } from "../src/judge.js";
import { E2E_ENABLED, CONFIG } from "../src/config.js";

// Group F — web search & delegation. READ-only, driven by read-only agents that
// have no message/write tools (guaranteed non-interference). Provider-neutral:
// the "which plugin served web_search" audit check is provider-specific and lives
// in the private package.
const d = E2E_ENABLED ? describe : describe.skip;

d("integration: F — web search & delegation", () => {
  it(
    "F1: answers a current-info question via web search",
    async () => {
      // Live weather can only come from a real web lookup. Deterministic keyword
      // check, no flaky judge. Driven by the read-only web agent (no message/write).
      const msg = "What's the weather forecast for Seattle this weekend? One or two sentences.";
      const res = await runAgent(msg, { agent: CONFIG.webAgent });
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
    "F3: fetches and summarizes a URL (read-only)",
    async () => {
      // Driven by the read-only reader agent (web_fetch; no message/write).
      const msg = "Please fetch and summarize the page at https://example.com in one sentence.";
      const res = await runAgent(msg, { agent: CONFIG.readAgent });
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
