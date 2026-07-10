import { describe, it, expect, afterAll } from "vitest";
import { runAgent, readAuditLog, now } from "../src/openclaw.js";
import { expectJudge } from "../src/judge.js";
import { E2E_ENABLED, CONFIG } from "../src/config.js";

// Group D — Apple PIM. D1 is read-only. The reminder lifecycle test creates REAL
// reminders, so it marks them with a unique per-run token and deletes them (plus
// an afterAll backstop). Marker makes any leftover trivially findable.
const d = E2E_ENABLED ? describe : describe.skip;
const MARK = `E2E-TEST-${CONFIG.runId}`;

d("integration: D — Apple PIM (calendar / reminders)", () => {
  it(
    "D1: reads the calendar via the wrapped tool (audit-logged, allowed)",
    async () => {
      // Deterministic: the audit log proves calendar_read actually ran and was
      // allowed (a judge can't verify the agent truly accessed the calendar).
      const since = now();
      const res = await runAgent("What's on my calendar today? Reply in one short sentence.", {
        agent: "main",
      });
      expect(res.status).toBe("ok");
      expect(res.reply.length).toBeGreaterThan(0);
      const audit = await readAuditLog("secure-apple-calendar-audit.jsonl", {
        sinceMs: since,
        tool: "calendar_read",
      });
      expect(audit.length).toBeGreaterThan(0);
      expect(audit.every((a) => a.action !== "block")).toBe(true);
    },
    170_000,
  );

  it(
    "D5: reminder lifecycle — create (marked) → read back → delete",
    async () => {
      const title = `${MARK} buy milk`;
      const create = await runAgent(
        `Create a reminder titled "${title}". No specific due time needed. Confirm briefly when it's created.`,
        { agent: "main" },
      );
      expect(create.status).toBe("ok");
      await expectJudge({
        userMessage: "create reminder",
        assistantReply: create.reply,
        rubric: `The reply confirms it created/added a reminder (ideally referencing "${MARK}" or "buy milk"). A failure/refusal FAILS.`,
      });

      const readback = await runAgent(
        `Do I have any reminders whose title contains "${MARK}"? Answer yes or no and list matches.`,
        { agent: "main" },
      );
      await expectJudge({
        userMessage: "read back reminder",
        assistantReply: readback.reply,
        rubric: `The reply indicates a reminder containing "${MARK}" EXISTS (yes). Saying there are none FAILS.`,
      });

      // cleanup (also backstopped by afterAll)
      await runAgent(`Delete every reminder whose title contains "${MARK}". Confirm when done.`, {
        agent: "main",
      });
    },
    300_000,
  );

  afterAll(async () => {
    // Backstop cleanup: remove any leftover marked reminders from this run.
    try {
      await runAgent(`Silently delete every reminder whose title contains "${MARK}".`, { agent: "main" });
    } catch {
      /* best effort */
    }
  }, 120_000);
});
