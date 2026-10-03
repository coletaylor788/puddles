import { createHash } from "node:crypto";
import type { Command } from "./backend.js";
import { BoundaryError, id, keys, object, string, type Guard } from "./guards.js";

function date(value: unknown) {
  const text = string(value, 64);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)$/.test(text) || !Number.isFinite(Date.parse(text))) throw new BoundaryError("invalid");
  return text;
}
export class Calendar {
  private writes = 0;
  private window = 0;
  private busy = false;
  constructor(private command: Command, private calendarId: string, private guard: Guard) {}
  private scoped(value: unknown) {
    const event = object(value);
    if (event.calendarId !== this.calendarId) throw new BoundaryError("denied");
    id(event.id);
    return event;
  }
  async read(input: unknown) {
    const args = object(input); keys(args, ["id", "from", "to"]);
    if (args.id !== undefined) return { event: JSON.parse(await this.guard(JSON.stringify(this.scoped((await this.command(["get", "--id", id(args.id)]) ).event)))) };
    const from = date(args.from), to = date(args.to);
    if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 31 * 86400_000) throw new BoundaryError("limit");
    const response = await this.command(["events", "--calendar", this.calendarId, "--from", from, "--to", to, "--limit", "21"]);
    if (!Array.isArray(response.events) || response.events.length > 20) throw new BoundaryError("limit");
    return { events: JSON.parse(await this.guard(JSON.stringify(response.events.map(e => this.scoped(e))))) };
  }
  async plan(input: unknown) {
    if (this.busy) throw new BoundaryError("limit");
    this.busy = true;
    try {
      const args = object(input); keys(args, ["sourceId", "title", "start", "end", "location", "notes", "tentative", "placeholderId"]);
      const sourceId = id(args.sourceId);
      const marker = `communication-watcher:${createHash("sha256").update(sourceId).digest("hex")}`;
      if (typeof args.tentative !== "boolean") throw new BoundaryError("invalid");
      const start = date(args.start), end = date(args.end);
      if (Date.parse(end) <= Date.parse(start) || Date.parse(end) - Date.parse(start) > 7 * 86400_000) throw new BoundaryError("invalid");
      const text = object(JSON.parse(await this.guard(JSON.stringify({ title: string(args.title, 200), notes: string(args.notes, 2000), location: args.location === undefined ? "" : string(args.location, 500) }))));
      const title = `${args.tentative ? "Tentative: " : ""}${text.title}`;
      let notes = `${marker}\n${args.tentative ? "Agreement pending. " : ""}${text.notes}`;
      let action: string[];
      if (args.placeholderId !== undefined) {
        if (args.tentative) throw new BoundaryError("invalid");
        const existing = this.scoped((await this.command(["get", "--id", id(args.placeholderId)])).event);
        if (!/^communication-watcher:[a-f0-9]{64}\n/.test(String(existing.notes ?? "")) || !String(existing.title).startsWith("Tentative: ") || existing.attendees !== undefined || existing.recurrence !== undefined) throw new BoundaryError("denied");
        // Preserve the original proposal marker for reconciliation across a later confirmation.
        notes = `${String(existing.notes).split("\n")[0]}\nConfirmed by correspondence ${sourceId}. ${text.notes}`;
        action = ["update", "--id", id(args.placeholderId)];
      } else {
        const response = await this.command(["events", "--calendar", this.calendarId, "--from", start, "--to", end, "--limit", "101"]);
        if (!Array.isArray(response.events) || response.events.length > 100) throw new BoundaryError("limit");
        const matches = response.events.map(e => this.scoped(e)).filter(e => String(e.notes ?? "").startsWith(`${marker}\n`));
        if (matches.length > 1) throw new BoundaryError("changed");
        if (matches.length === 1) return { status: "exists", id: id(matches[0].id) };
        action = ["create", "--calendar", this.calendarId];
      }
      if (Date.now() - this.window > 30 * 60_000) { this.writes = 0; this.window = Date.now(); }
      if (++this.writes > 5) throw new BoundaryError("limit");
      const result = await this.command([...action, "--title", title, "--start", start, "--end", end, "--notes", notes, "--location", String(text.location)]);
      const saved = this.scoped(result.event);
      return { status: "saved", id: id(saved.id) };
    } finally { this.busy = false; }
  }
}
