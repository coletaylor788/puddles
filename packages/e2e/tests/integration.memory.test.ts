import { describe, it, expect } from "vitest";
import { runAgent, freshSessionKey } from "../src/openclaw.js";
import { expectJudge } from "../src/judge.js";
import { E2E_ENABLED } from "../src/config.js";

// Group H — memory stack.
const d = E2E_ENABLED ? describe : describe.skip;

d("integration: H — memory stack", () => {
  it(
    "H1: recalls a fact from earlier in the same session (in-context)",
    async () => {
      const sk = freshSessionKey("debug", "recall");
      await runAgent(
        "For this test, keep in mind for later: my favorite test fruit is dragonfruit. Just acknowledge briefly.",
        { agent: "debug", sessionKey: sk },
      );
      const res = await runAgent("What did I just say my favorite test fruit is? Reply with one word.", {
        agent: "debug",
        sessionKey: sk,
      });
      expect(res.status).toBe("ok");
      expect(res.reply.toLowerCase()).toContain("dragonfruit");
    },
    170_000,
  );

  it(
    "H-recall: memory_search backend is healthy (recalls or reports empty — not 'down')",
    async () => {
      const msg = "Search your long-term memory for anything about volleyball, then answer in one sentence.";
      const res = await runAgent(msg, { agent: "main" });
      expect(res.status).toBe("ok");
      await expectJudge({
        userMessage: msg,
        assistantReply: res.reply,
        rubric:
          "The reply reflects an actual memory lookup — it shares something found about volleyball OR clearly says nothing was found. A reply saying the memory search is DOWN / unavailable / errored / 'no API key' FAILS (that means the memory backend is broken).",
      });
    },
    180_000,
  );
});
