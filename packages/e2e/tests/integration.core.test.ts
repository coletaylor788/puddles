import { describe, it, expect } from "vitest";
import { runAgent, getBindings, freshSessionKey } from "../src/openclaw.js";
import { expectJudge } from "../src/judge.js";
import { E2E_ENABLED, CONFIG } from "../src/config.js";

// Group A — core messaging & routing. Read-only prompts (no side effects).
// NOTE: sender-based binding routing (a message *from* number X waking agent Y)
// runs in the channel-transport ingress path, which `openclaw agent` can't
// simulate (`--to` is the reply recipient, not the inbound sender). So we assert
// the routing CONFIG deterministically here, and verify each agent's behavior
// directly in its own group (e.g. tiers drive `--agent household`).
// The owner number is injected via E2E_OWNER_NUMBER — never hardcode PII here.
const d = E2E_ENABLED ? describe : describe.skip;
const OWNER = CONFIG.ownerNumber || undefined;

d("integration: A — core messaging & routing", () => {
  it(
    "A1: replies to a DM in the assistant's voice",
    async () => {
      const msg = "hey, you around? just checking in.";
      const res = await runAgent(msg, { agent: "main", channel: "imessage", to: OWNER });
      expect(res.status).toBe("ok");
      expect(res.reply.length).toBeGreaterThan(0);
      await expectJudge({
        userMessage: msg,
        assistantReply: res.reply,
        rubric:
          "A friendly, conversational check-in reply from a personal assistant. Not an error message, refusal, or empty.",
      });
    },
    150_000,
  );

  it.skipIf(!OWNER)(
    "A3: resolves the owner identity from sender metadata",
    async () => {
      const msg = "quick test — what's my first name, and am I your owner/primary user?";
      const res = await runAgent(msg, { agent: "main", channel: "imessage", to: OWNER });
      expect(res.status).toBe("ok");
      await expectJudge({
        userMessage: msg,
        assistantReply: res.reply,
        rubric:
          "The reply identifies the user by their first name and/or confirms they are the owner/primary user. A reply that says it doesn't know who the user is FAILS.",
      });
    },
    150_000,
  );

  it(
    "A-routing: bindings map the household number to household and the default account to main",
    async () => {
      const bindings = await getBindings();
      const household = bindings.find((b) => b.agentId === "household");
      expect(household?.match?.peer?.id).toBe("+15555550123");
      const main = bindings.find((b) => b.agentId === "main");
      expect(main?.match?.channel).toBe("imessage");
      expect(main?.match?.accountId).toBe("default");
    },
    60_000,
  );

  it(
    "A-multiturn: retains context across turns within a session",
    async () => {
      const sk = freshSessionKey("debug", "multiturn");
      await runAgent("My test codeword for this chat is BANANA-42. Just acknowledge briefly.", {
        agent: "debug",
        sessionKey: sk,
      });
      const res = await runAgent("What was the test codeword I just gave you? Reply with only the codeword.", {
        agent: "debug",
        sessionKey: sk,
      });
      expect(res.status).toBe("ok");
      expect(res.reply.toUpperCase()).toContain("BANANA-42");
    },
    160_000,
  );
});
