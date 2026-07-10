import { describe, it, expect } from "vitest";
import { runAgent } from "../src/openclaw.js";
import { expectJudge } from "../src/judge.js";
import { E2E_ENABLED } from "../src/config.js";

// Phase-1 smoke: validates the whole toolchain end to end — the CLI driver,
// the --json envelope parsing, and the gateway-mediated LLM judge. Uses the
// `debug` agent (no active-memory, sandbox off) so it doesn't touch the main
// agent's state.
const d = E2E_ENABLED ? describe : describe.skip;

d("integration: smoke (real pipeline reachable)", () => {
  it("returns a healthy reply envelope for a trivial prompt", async () => {
    const res = await runAgent("Reply with exactly the single word: PONG", {
      agent: "debug",
      thinking: "off",
    });
    expect(res.status).toBe("ok");
    expect(res.summary).toBe("completed");
    expect(res.reply.toUpperCase()).toContain("PONG");
    expect(res.provider).toBeTruthy();
    expect(res.model).toBeTruthy();
  });

  it("responds appropriately to a natural greeting (LLM-judged)", async () => {
    const msg = "hey! just testing you out — say hi back in one short friendly sentence.";
    const res = await runAgent(msg, { agent: "debug" });
    expect(res.status).toBe("ok");
    expect(res.reply.length).toBeGreaterThan(0);
    await expectJudge({
      userMessage: msg,
      assistantReply: res.reply,
      rubric:
        "The reply is a friendly greeting or acknowledgement in English; it is not an error message, a refusal, or empty.",
    });
  });
});
