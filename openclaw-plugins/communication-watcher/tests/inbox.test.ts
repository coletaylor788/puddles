import { describe, it, expect, vi } from "vitest";
import { Inbox, type InboxBackend } from "../src/inbox.js";
import { BoundaryError } from "../src/guards.js";
const message = (name = "one", listId = "inbox") => ({ id: name, listId, isCompleted: false, title: "From sender", notes: JSON.stringify({ version: 1, sender: "+15555550123", timestamp: "2026-09-26T10:00:00-07:00", timestampKind: "captured", body: "Dinner tomorrow at six?" }) });
function setup(values = [message()], guard = async (s: string) => s) {
  const backend: InboxBackend = {
    list: vi.fn(async completed => values.filter(v => v.isCompleted === completed)),
    get: vi.fn(async id => values.find(v => v.id === id)),
    complete: vi.fn(async id => { values.find(v => v.id === id)!.isCompleted = true; return { notes: "secret must never escape" }; }),
  };
  const inbox = new Inbox(backend, "inbox", guard);
  inbox.start("reader-job", "watcher-job");
  return { inbox, backend, values };
}
describe("guarded intake and completion", () => {
  it("requires an allocated reader and never completes on read", async () => {
    const { inbox, backend } = setup();
    await expect(inbox.read("attacker", {})).rejects.toThrow("denied");
    const result = await inbox.read("reader-job", {});
    expect(result.items).toHaveLength(1); expect(backend.complete).not.toHaveBeenCalled();
  });
  it("binds completion to watcher session and strips mutation output", async () => {
    const { inbox, backend } = setup(); await inbox.read("reader-job", {});
    const [receipt] = inbox.finish("reader-job");
    await expect(inbox.complete("reader-job", receipt.ticket)).rejects.toThrow("denied");
    await expect(inbox.complete("other-watcher", receipt.ticket)).rejects.toThrow("denied");
    expect(await inbox.complete("watcher-job", receipt.ticket)).toEqual({ id: "one", status: "completed" });
    await inbox.complete("watcher-job", receipt.ticket);
    expect(backend.complete).toHaveBeenCalledTimes(1);
  });
  it("denies wrong lists and changed item contents before any write", async () => {
    const { inbox, backend, values } = setup(); await inbox.read("reader-job", {});
    const [receipt] = inbox.finish("reader-job"); values[0].notes = "changed";
    await expect(inbox.complete("watcher-job", receipt.ticket)).rejects.toThrow("changed");
    values[0].listId = "other";
    await expect(inbox.complete("watcher-job", receipt.ticket)).rejects.toThrow("denied");
    expect(backend.complete).not.toHaveBeenCalled();
    const wrong = setup([message("two", "other")]);
    await expect(wrong.inbox.read("reader-job", { ids: ["two"] })).rejects.toThrow("denied");
  });
  it("returns only safe quarantine metadata for injection, permits quiet checkoff", async () => {
    const { inbox } = setup([message()], async () => { throw new BoundaryError("blocked"); });
    const result = await inbox.read("reader-job", {});
    expect(JSON.stringify(result)).not.toContain("Dinner"); expect(result.items[0]).toMatchObject({ id: "one", status: "blocked" });
    const [receipt] = inbox.finish("reader-job");
    expect(() => inbox.authorizeSource("watcher-job", "one")).toThrow("denied");
    expect(await inbox.complete("watcher-job", receipt.ticket)).toMatchObject({ status: "completed" });
  });
  it("leaves transient guard failures pending without completion authority", async () => {
    const { inbox } = setup([message()], async () => { throw new BoundaryError("unavailable"); });
    expect(await inbox.read("reader-job", {})).toEqual({ items: [{ id: "one", status: "retry" }], more: false });
    expect(inbox.finish("reader-job")).toEqual([]);
  });
  it("requires the same guard on completed history and respects read budgets", async () => {
    const value = message(); value.isCompleted = true;
    const guard = vi.fn(async (text: string) => text);
    const { inbox } = setup([value], guard);
    expect((await inbox.read("reader-job", { mode: "history" })).items).toHaveLength(1);
    expect(guard).toHaveBeenCalledOnce();
    await inbox.read("reader-job", { mode: "history" });
    await expect(inbox.read("reader-job", {})).rejects.toThrow("limit");
  });
  it("restart invalidates authority and requires a fresh read", async () => {
    const { inbox, backend } = setup(); await inbox.read("reader-job", {});
    const [receipt] = inbox.finish("reader-job");
    const restarted = new Inbox(backend, "inbox", async s => s);
    await expect(restarted.complete("watcher-job", receipt.ticket)).rejects.toThrow("denied");
  });
  it("rejects additional parameters instead of allowing model-selected list/profile", async () => {
    const { inbox, backend } = setup();
    await expect(inbox.read("reader-job", { list: "other" })).rejects.toThrow("invalid");
    expect(backend.list).not.toHaveBeenCalled();
  });
  it("an oversized item is quarantined without blocking the next item", async () => {
    const oversized = message("oversized"); oversized.notes = "x".repeat(17000);
    const { inbox } = setup([oversized, message()]);
    const result = await inbox.read("reader-job", {});
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ status: "blocked" });
    expect(result.items[1]).toMatchObject({ status: "reviewed" });
  });
  it("cleanup of a rejected concurrent job cannot unlock an active review", () => {
    const { inbox } = setup();
    expect(() => inbox.start("second", "watcher-job")).toThrow("limit");
    inbox.finish("second");
    expect(() => inbox.start("third", "watcher-job")).toThrow("limit");
    inbox.finish("reader-job");
    expect(() => inbox.start("third", "watcher-job")).not.toThrow();
  });

});
