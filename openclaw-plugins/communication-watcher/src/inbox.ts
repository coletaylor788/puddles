import { createHash, randomUUID } from "node:crypto";
import { BoundaryError, id, keys, object, string, type Guard } from "./guards.js";

export interface InboxBackend {
  list(completed: boolean, limit: number): Promise<unknown[]>;
  get(id: string): Promise<unknown>;
  complete(id: string): Promise<unknown>;
}
export interface Receipt { id: string; ticket: string; senderKey?: string; date?: string; status: "reviewed" | "blocked"; }
interface Admission { status: Receipt["status"]; id: string; fingerprint: string; session: string; expires: number; }
interface ReaderJob { owner: string; issued: Receipt[]; calls: number; bytes: number; }
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

export class Inbox {
  private admissions = new Map<string, Admission>();
  private jobs = new Map<string, ReaderJob>();
  private completed = new Set<string>();
  private busy = false;
  private window = 0;
  private reads = 0;
  constructor(private backend: InboxBackend, private listId: string, private guard: Guard, private now = Date.now) {}
  start(reader: string, owner: string) {
    if (this.busy) throw new BoundaryError("limit");
    for (const [token, entry] of this.admissions) if (entry.expires < this.now()) { this.admissions.delete(token); this.completed.delete(token); }
    if (this.admissions.size > 200) throw new BoundaryError("limit");
    this.busy = true; this.jobs.set(reader, { owner, issued: [], calls: 0, bytes: 0 });
  }
  finish(reader: string) {
    const issued = this.jobs.get(reader)?.issued ?? [];
    if (this.jobs.delete(reader)) this.busy = false;
    return issued;
  }
  private scoped(value: unknown, expectedId?: string) {
    const record = object(value);
    const itemId = id(record.id);
    if (record.listId !== this.listId || (expectedId && itemId !== expectedId)) throw new BoundaryError("denied");
    if (typeof record.isCompleted !== "boolean") throw new BoundaryError("invalid");
    // Only these text fields cross the boundary; all other provider fields are discarded.
    const title = typeof record.title === "string" ? record.title : "";
    const notes = typeof record.notes === "string" ? record.notes : "";

    return { id: itemId, listId: this.listId, title, notes, isCompleted: record.isCompleted };
  }
  private fingerprint(value: ReturnType<Inbox["scoped"]>) { return hash(JSON.stringify({ ...value, isCompleted: false })); }
  private receipt(item: ReturnType<Inbox["scoped"]>, session: string, status: Receipt["status"], sender?: string, date?: string): Receipt {
    const ticket = randomUUID();
    this.admissions.set(ticket, { status, id: item.id, fingerprint: this.fingerprint(item), session, expires: this.now() + 30 * 60_000 });
    return { id: item.id, ticket, status, ...(sender ? { senderKey: hash(sender).slice(0, 32), date } : {}) };
  }
  async read(readerSession: string, input: unknown) {
    const job = this.jobs.get(readerSession);
    if (!job) throw new BoundaryError("denied");
    const args = object(input); keys(args, ["mode", "ids"]);
    const mode = args.mode ?? "pending";
    if (mode !== "pending" && mode !== "history") throw new BoundaryError("invalid");
    const ids = args.ids;
    if (ids !== undefined && (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || ids.some(v => typeof v !== "string"))) throw new BoundaryError("invalid");
    if (this.now() - this.window >= 30 * 60_000) { this.window = this.now(); this.reads = 0; }
    if (++this.reads > 8 || ++job.calls > 2) throw new BoundaryError("limit");
    const raw = ids ? await Promise.all((ids as string[]).map(v => this.backend.get(id(v)))) : await this.backend.list(mode === "history", 21);
    if (!Array.isArray(raw) || raw.length > 21) throw new BoundaryError("invalid");
    const results: unknown[] = [];
    for (const [index, value] of raw.slice(0, 20).entries()) {
      const item = this.scoped(value, ids ? (ids as string[])[index] : undefined);
      if (mode === "pending" && item.isCompleted) continue;
      if (mode === "history" && !item.isCompleted) continue;
      if (item.notes.length + item.title.length > 16000) {
        const receipt = this.receipt(item, job.owner, "blocked");
        job.issued.push(receipt); results.push(receipt); continue;
      }
      job.bytes += item.notes.length + item.title.length;
      if (job.bytes > 16000) return { items: results, more: true };
      try {
        // Phone sends JSON in Notes. Parsing is admission, not a trust upgrade.
        const payload = object(JSON.parse(item.notes));
        keys(payload, ["version", "sender", "senderName", "timestamp", "timestampKind", "body"]);
        if (payload.version !== 1 || !["sent", "captured"].includes(String(payload.timestampKind))) throw new BoundaryError("invalid");
        const sender = string(payload.sender, 512);
        const timestamp = string(payload.timestamp, 64);
        if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) throw new BoundaryError("invalid");
        string(payload.body, 15000);
        if (payload.senderName !== undefined) string(payload.senderName, 512);
        const text = await this.guard(JSON.stringify({ title: item.title, ...payload }));
        const receipt = this.receipt(item, job.owner, "reviewed", sender, timestamp.slice(0, 10));
        job.issued.push(receipt);
        results.push({ ...receipt, text, untrusted: true });
      } catch (error) {
        if (error instanceof BoundaryError && (error.code === "unavailable" || error.code === "limit")) {
          results.push({ id: item.id, status: "retry" });
        } else {
          const receipt = this.receipt(item, job.owner, "blocked");
          job.issued.push(receipt); results.push(receipt);
        }
      }
    }
    return { items: results, more: raw.length > 20 };
  }
  authorizeSource(session: string, sourceId: string) {
    if (![...this.admissions.values()].some(a => a.session === session && a.id === sourceId && a.status === "reviewed" && a.expires >= this.now())) throw new BoundaryError("denied");
  }
  async complete(session: string, ticket: string) {
    const admission = this.admissions.get(ticket);
    if (!admission || admission.session !== session || admission.expires < this.now()) throw new BoundaryError("denied");
    if (this.completed.has(ticket)) return { id: admission.id, status: "completed" };
    const item = this.scoped(await this.backend.get(admission.id), admission.id);
    if (this.fingerprint(item) !== admission.fingerprint) throw new BoundaryError("changed");
    if (!item.isCompleted) {
      // The installed CLI has no compare-and-set operation. Recheck immediately before writing.
      await this.backend.complete(admission.id);
      const after = this.scoped(await this.backend.get(admission.id), admission.id);
      if (!after.isCompleted || this.fingerprint(after) !== admission.fingerprint) throw new BoundaryError("changed");
    }
    this.completed.add(ticket);
    return { id: admission.id, status: "completed" };
  }
}
