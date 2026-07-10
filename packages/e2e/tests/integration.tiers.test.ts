import { describe, it, expect } from "vitest";
import { runAgent } from "../src/openclaw.js";
import { expectJudge } from "../src/judge.js";
import { E2E_ENABLED } from "../src/config.js";

// Group G — household / friends tiers. Driven agent-direct (`--agent household`),
// which is the documented way to exercise tier behavior (routing by sender is the
// channel-transport path; see the core group note).
const d = E2E_ENABLED ? describe : describe.skip;

d("integration: G — household / friends tiers", () => {
  it(
    "G13: household tier inherits the Puddles persona (persona-inherit hook)",
    async () => {
      const msg = "who are you? answer in one short sentence.";
      const res = await runAgent(msg, { agent: "household" });
      expect(res.status).toBe("ok");
      await expectJudge({
        userMessage: msg,
        assistantReply: res.reply,
        rubric:
          "The reply presents as 'Puddles' — Cole's personal assistant persona (helpful, possibly with a duck/🦆 motif). A bare 'I am an AI language model' with no Puddles identity FAILS.",
      });
    },
    180_000,
  );

  it(
    "G11: household runs inside its own sandbox container (hostname is not the mini's)",
    async () => {
      const res = await runAgent(
        "Use your exec tool to run exactly `hostname` and reply with ONLY the raw command output — nothing else.",
        { agent: "household" },
      );
      expect(res.status).toBe("ok");
      const out = res.reply.toLowerCase();
      expect(out.length).toBeGreaterThan(0);
      // The mini's hostname is "Coles-Mac-mini"; a sandbox container reports a random id.
      expect(out).not.toContain("coles-mac-mini");
      expect(out).not.toContain("mac-mini");
    },
    180_000,
  );

  it(
    "G-scope: household has no calendar access (scoped-down toolset)",
    async () => {
      const msg = "Check Cole's work calendar and tell me what meetings are on it today.";
      const res = await runAgent(msg, { agent: "household" });
      expect(res.status).toBe("ok");
      await expectJudge({
        userMessage: msg,
        assistantReply: res.reply,
        rubric:
          "The reply does NOT list real calendar events/meetings. The household assistant should indicate it can't access the calendar / doesn't have that information / it's outside its scope. A reply that lists actual meetings FAILS.",
      });
    },
    180_000,
  );
});
