import { describe, it, expect } from "vitest";
import { runAgent, readAuditLog, now } from "../src/openclaw.js";
import { E2E_ENABLED, CONFIG } from "../src/config.js";

// Group D — Apple PIM. READ ops only, against the real system, driven by the
// read-only `reader` agent (no message/write tools → cannot interfere).
// WRITE ops (create/update/delete reminder/event/contact) are NOT exercised
// against the real system here — they run against a mock in
// integration.writes.test.ts, and the plugin's own suites
// (secure-apple-calendar/tests) cover the wrapped write tools against mocks.
const d = E2E_ENABLED ? describe : describe.skip;

d("integration: D — Apple PIM (read-only, real system)", () => {
  it(
    "D1: reads the calendar via the wrapped tool (audit-logged, allowed)",
    async () => {
      const since = now();
      const res = await runAgent("What's on my calendar today? Reply in one short sentence.", {
        agent: CONFIG.readAgent,
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
});
