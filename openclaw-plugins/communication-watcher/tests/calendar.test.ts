import { describe, it, expect, vi } from "vitest";
import { Calendar } from "../src/calendar.js";
const input = { sourceId: "source-1", title: "Dinner", start: "2026-09-27T18:00:00-07:00", end: "2026-09-27T19:00:00-07:00", notes: "Proposed by sender, agreement pending", tentative: true };
describe("personal calendar scope", () => {
  it("creates a tentative placeholder with no invitations and strips write response", async () => {
    const command = vi.fn(async (args: string[]) => args[0] === "events" ? { events: [] } : { event: { id: "event1", calendarId: "personal", notes: "provider-secret" } });
    const calendar = new Calendar(command, "personal", async s => s);
    expect(await calendar.plan(input)).toEqual({ status: "saved", id: "event1" });
    expect(command.mock.calls[1][0]).toContain("Tentative: Dinner");
    expect(command.mock.calls[1][0]).not.toContain("--attendees");
  });
  it("rejects invitations and arbitrary calendars before any provider call", async () => {
    const command = vi.fn(); const calendar = new Calendar(command, "personal", async s => s);
    await expect(calendar.plan({ ...input, attendees: ["stranger"] })).rejects.toThrow("invalid");
    await expect(calendar.plan({ ...input, calendar: "shared" })).rejects.toThrow("invalid");
    expect(command).not.toHaveBeenCalled();
  });
  it("refuses to confirm another person's event or an event in another calendar", async () => {
    const command = vi.fn(async () => ({ event: { id: "x", calendarId: "personal", title: "Existing", notes: "not ours" } }));
    const calendar = new Calendar(command, "personal", async s => s);
    await expect(calendar.plan({ ...input, tentative: false, placeholderId: "x" })).rejects.toThrow("denied");
    expect(command).toHaveBeenCalledTimes(1);
  });
  it("guards calendar read results and rejects overly broad ranges", async () => {
    const guard = vi.fn(async s => s.replaceAll("secret", "removed"));
    const calendar = new Calendar(async () => ({ event: { id: "x", calendarId: "personal", title: "secret" } }), "personal", guard);
    expect(JSON.stringify(await calendar.read({ id: "x" }))).not.toContain("secret");
    await expect(calendar.read({ from: "2026-01-01T00:00:00Z", to: "2027-01-01T00:00:00Z" })).rejects.toThrow("limit");
  });
});
