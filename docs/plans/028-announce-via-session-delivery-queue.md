# Plan 028 — Route subagent announce wake-ups through `session-delivery-queue`

**Status:** 📝 Drafting (awaiting user review)
**Author:** Cole + Puddles
**Depends on:** Nothing — pure upstream change request (or local patch).
**Related:**
- [`cron-announce-bug-report.md`](../openclaw-setup/patches/cron-announce-bug-report.md) — original announce-delivery bug filed against 2026.4.20; this is "part 2" focused on the wake-the-parent path rather than the cron-classification path.
- [Plan 025](./025-openclaw-5.20-recovery.md) Task #17 — `missing scope: operator.write` on the announce dispatch. This plan subsumes that fix: routing through `session-delivery-queue` uses admin-scoped synthetic context, so the scope issue dissolves.

---

## Summary

OpenClaw already ships a durable, crash-safe, retrying, idempotent session-delivery queue (`session-delivery-queue` — SQLite-backed, supports `kind: "agentTurn"` and `kind: "systemEvent"` payloads, exponential backoff `[5s, 25s, 120s, 600s]`, max 5 retries, drains via `deliverQueuedSessionDelivery` → `dispatchAssembledChannelTurn`). It's the same infrastructure that real inbound channel messages and restart continuations flow through.

The subagent completion announce path does not use it. Instead it calls `dispatchGatewayMethodInProcess("agent", { sessionKey, message, ... })` synchronously, which spawns a fresh embedded run that competes with any existing in-process operation on the parent's session file. When that race is lost — most commonly to the parent's own embedded-attempt write lock — the announce retries 3× over ~64s and gives up silently. The parent never wakes; the human only learns the child finished by asking.

This plan proposes redirecting the announce wake-up through `enqueueSessionDelivery({ kind: "agentTurn", ... })`. The change is small (one call site in `subagent-announce-HPJnGzNW.js`), preserves the announce's semantics, and reuses a mechanism that already handles every failure mode the current path silently drops.

---

## Goals / non-goals

**Goals:**
- Subagent completion wake-ups are delivered exactly once with at-least-once-then-idempotent semantics. The parent reacts, even if delivery is delayed.
- Lock contention against the parent's session file no longer causes silent announce loss.
- The `missing scope: operator.write` bucket dissolves (the queue-drain path runs with `GatewayClientScopes: ["operator.admin"]`).
- Crash recovery for in-flight announces — gateway restart no longer loses pending wake-ups.
- No new files, no new lanes, no new queues. Reuse existing infrastructure.

**Non-goals:**
- Solving the `completion agent did not produce a visible reply` or Anthropic `Invalid signature in thinking block` buckets — those are LLM/network failures upstream of any queue we control.
- Replacing the announce's existing direct-to-channel delivery path. Direct delivery should still fire first when the parent's channel is durable (e.g., iMessage); the queue is what handles the "wake the agent to react" half.
- Changing the announce's existing reply-instruction prompt or response-shaping logic. Same wake message, different transport.
- Inventing TTL / drain-and-summarize policies for stale wake-ups. The user has accepted that staleness is fine; if a wake fires after the conversation has moved on, the parent's existing context-handling deals with it.

---

## Background — what's already there

### `session-delivery-queue` (the queue we want)

Defined in `dist/server-restart-sentinel-B1RsE_5L.js` (storage) and `dist/delivery-queue-Upc6HR7r.js` (recovery). Persists to SQLite under `~/.openclaw/state/...delivery_queue_entries` (table). Key surface:

```ts
enqueueSessionDelivery(params: {
  kind: "agentTurn" | "systemEvent",
  sessionKey: string,
  message: string,                          // wake-up text the parent will see
  idempotencyKey?: string,                  // dedup; reused on retry
  route?: { channel, accountId, to, threadId, replyToId, chatType },
  deliveryContext?: { channel, accountId, to, threadId },
  expectedSessionId?: string,               // skip if session changed under us
  maxRetries?: number,                      // overrides default 5
}, stateDir): Promise<entryId>
```

Drain path (`deliverQueuedSessionDelivery`, line 373):

1. Loads the target session.
2. Builds a synthetic inbound context (`finalizeInboundContext`) — exactly the same shape that real channel ingress produces, with `Provider: INTERNAL_MESSAGE_CHANNEL`, `GatewayClientScopes: ["operator.admin"]`, and `InputProvenance.kind: "internal_system"`.
3. Calls `dispatchAssembledChannelTurn` — the same dispatcher real channel messages use, which respects the lane queue (`session:agent:...`) and waits cleanly for any existing in-flight attempt to finish.
4. ACKs on success, increments retry on failure with exponential backoff `[5_000, 25_000, 120_000, 600_000]ms` and max 5 attempts before moving to `failed/`.

The restart-continuation flow (`buildQueuedRestartContinuation`, line 460) already uses this exact mechanism for "wake an agent that was mid-turn when the gateway restarted." A subagent completion announce is conceptually identical: "wake a parent agent whose child has finished while parent was yielded." Same shape, different trigger.

### Where the announce diverges today

In `dist/subagent-announce-HPJnGzNW.js`, `runSubagentAnnounceFlow` ends with `deliverSubagentAnnouncement(...)`, which under the hood (`dist/subagent-announce-delivery-DhVEJzi6.js`) eventually calls:

```js
await subagentAnnounceDeps.dispatchGatewayMethodInProcess("agent", {
  sessionKey: targetRequesterSessionKey,
  message: triggerMessage,
  deliver: false,
  inputProvenance: { kind: "inter_session", sourceTool: "subagent_announce", ... },
  idempotencyKey: directIdempotencyKey,
}, { timeoutMs: announceTimeoutMs })
```

This is the in-process dispatch that fails on:
- `SessionWriteLockTimeoutError` (parent's session file is locked by another in-process operation — see live trace in [`cron-announce-bug-report.md`](../openclaw-setup/patches/cron-announce-bug-report.md) and the 2026-06-06 22:43:21 incident on the mini)
- `session file changed while embedded prompt lock was released` (the variant where announce sneaks in during the parent's LLM call, then the parent aborts with `EmbeddedAttemptSessionTakeoverError`)
- `missing scope: operator.write` (channel-bound requester's client lacks the scope; admin scope short-circuits but channel clients aren't admin)
- `In-process gateway dispatch requires a gateway request scope` (shutdown-replay edge case)

All four become "give up after 3 retries with no breadcrumb the parent can find on its next turn."

---

## Design

### The change

In the announce-delivery dispatch (`dist/subagent-announce-delivery-DhVEJzi6.js` — function that wraps the in-process `agent` call), replace the `dispatchGatewayMethodInProcess` call with:

```js
const route = resolveRouteFromRequesterEntry(targetRequesterSessionKey);

await enqueueSessionDelivery({
  kind: "agentTurn",
  sessionKey: targetRequesterSessionKey,
  message: triggerMessage,
  idempotencyKey: directIdempotencyKey,        // existing announce ID — survives retry
  route,                                        // parent's channel routing
  deliveryContext: targetRequesterOrigin,       // optional, falls back to entry
  expectedSessionId: parentSessionId,           // skip if parent's session was rotated
}, stateDir);
```

Behavior changes:

| Before | After |
|---|---|
| In-process call races for the parent's session lock | Queue entry written to SQLite; drainer respects lane queue |
| 60s timeout, 3 retries, then silent loss | 5 retries with `[5s, 25s, 120s, 600s]` backoff; `failed/` directory on exhaustion (auditable) |
| Channel-bound requester's narrow scopes used | Drainer synthesizes `GatewayClientScopes: ["operator.admin"]` |
| Gateway restart loses in-flight announce | Queue entry survives; `recoverPendingDeliveries` replays it on next start |
| Idempotency tracked only in-memory for the retry window | SQLite-level dedup by `idempotencyKey` (the existing announce ID) |

Direct-to-channel delivery (the path that texts the user "Done 🦆" immediately when the parent is offline / unreachable) is unchanged — it runs first, just as today, and `enqueueSessionDelivery` is added in place of the parallel "wake the parent's session" half.

### What `triggerMessage` looks like in the queue

The existing `triggerMessage` is built by `buildAnnounceSteerMessage(internalEvents)` in `subagent-announce-HPJnGzNW.js`. It's already a self-contained wake-up text shaped as:

```
[Subagent Context] Your prior run ended while waiting for descendant subagent completions.
[Subagent Context] All pending descendants for that run have now settled.
[Subagent Context] Continue your workflow using these results. Spawn more subagents if needed, otherwise send your final answer.

Task: <label>

<findings>
```

When the queue drainer pulls this and calls `dispatchAssembledChannelTurn`, the parent agent sees it as an inbound "internal" message (via `InputProvenance.kind: "internal_system"`, the same provenance type already used for restart continuations). No prompt change required.

### What the parent's experience looks like

1. Subagent finishes at T+0.
2. Announce direct-to-channel delivery fires (unchanged from today).
3. Announce enqueues a `session-delivery-queue` entry at T+0.
4. Drainer picks it up. If parent's session lane is idle → fires immediately. If parent is busy (mid-turn from another inbound message, or holds the lock from an active-memory call, etc.) → drainer waits for the lane, then fires.
5. Parent processes the wake message as a normal turn. Sees the completion. Sends a user-facing reply via its existing reply-delivery path.

Net: yesterday's TimeTree booking flow would have been: subagent done at 22:42:18 → direct delivery to iMessage (immediate) → wake enqueued → main agent woken at next lane availability (probably ≤1s after the holding operation released) → main confirms "Done 🦆" automatically without Cole asking.

---

## Open questions

1. **Does the announce flow have a usable `parentSessionId` for the `expectedSessionId` field?** The restart-continuation flow uses it to skip wake-ups after a session reset. The announce should set it too. Verify that `loadRequesterSessionEntry(targetRequesterSessionKey).entry.sessionId` is available at the dispatch site.

2. **Should we keep `dispatchGatewayMethodInProcess` as a fast-path when the parent is known to be idle, falling back to the queue only on contention?** Probably no — the queue drainer already short-circuits to immediate dispatch when the lane is free, so the extra in-process attempt adds no value and reintroduces the race. Simpler to always queue.

3. **Direct-to-channel + queue wake-up: do they double-report?** Direct delivery sends "Done 🦆" to the user immediately. The wake-up then arrives at the parent agent, which sees the completion in context. If the parent decides to also reply ("looks great, both bookings confirmed"), that's a second message — sometimes desirable, sometimes redundant. The existing `replyInstruction` logic (silent token / NO_REPLY pattern) already handles this; the parent SHOULD reply NO_REPLY when "this exact result was already delivered to the user in this same turn." Trust the existing prompt; reassess if duplicate replies become a complaint.

4. **What about the cross-process safety the file lock currently provides?** The session-delivery-queue lives in SQLite, which IS cross-process safe. The current concern (multiple gateway processes both writing the JSONL) is handled at the drain step — only one process drains a given entry at a time, via `entriesInProgress` and `claimRecoveryEntry`. So this is strictly better than the file-lock+in-process-dispatch path for multi-process scenarios too.

5. **What happens to the `direct-primary: ...` second failure phase in the error string?** Today the announce attempts two paths and the error reports both. With the queue path, the "primary" is the queue write (~instantaneous, ~always succeeds), and the "direct" (channel send) is unchanged. The error shape may simplify; check that downstream log-parsing isn't depending on the two-phase format.

---

## How to deploy this

### Path A — upstream PR

File against `openclaw/openclaw`. Reference [`cron-announce-bug-report.md`](../openclaw-setup/patches/cron-announce-bug-report.md) as the prior bug report and this plan as the architectural follow-up. Frame as: "OpenClaw already has the right primitive (`session-delivery-queue`); the announce path just doesn't use it. Single-call-site change."

Diff is small enough to fit in one PR. Existing tests for restart-continuation cover the drainer behavior; need new tests for the announce-enqueues case.

### Path B — local patch (if upstream is slow)

Same shape as the existing `apply-cron-announce-fix.mjs`. Patch `dist/subagent-announce-delivery-DhVEJzi6.js` (or wherever the in-process dispatch happens after upstream layout shifts):
- Find the `dispatchGatewayMethodInProcess("agent", ...)` call inside the announce delivery flow.
- Replace with an `enqueueSessionDelivery` call. Reuse the existing `idempotencyKey` and routing.
- Add a `FIX-ANNOUNCE-VIA-SESSION-QUEUE` marker so the patcher is idempotent and survives the version-bump workflow.
- Bump the README's "Tested versions" table.

Risk: the file shape is more involved than the cron-announce patches (more import wiring, the queue helpers may not be exported from a stable surface). Likely doable but more brittle than the C1–C4 patches. Try upstream first; only do this if upstream takes >2 weeks.

---

## Why now

Yesterday (2026-06-06) the TimeTree volleyball booking flow lost its announce on a `SessionWriteLockTimeoutError`. The browser-agent finished correctly, both bookings were made, but Cole only knew because he asked "Did it finish?" 25 minutes later. Across the gateway log there are 48 `Subagent announce give up` events; this plan addresses ~22 of them (the lock-contention + scope buckets), and combined with the 2026-06-07 fix of the `__c4_match` patch bug (26 events), gets the residual failure rate down to the small handful of legitimate LLM/network failures (`completion agent did not produce a visible reply`, `Invalid signature in thinking block`) that no queue change can fix.

---

## Tasks

1. **Verify `enqueueSessionDelivery` is exported from a stable surface.** It's currently in `dist/server-restart-sentinel-B1RsE_5L.js`; check whether it's re-exported from a public-shaped path or only internally.
2. **Confirm `triggerMessage` content survives a round-trip through `dispatchAssembledChannelTurn`.** The internal provenance should preserve it; verify with a test queue entry.
3. **File the upstream issue.** Use the cron-announce report as a template. Lead with the 4-line code change; back it with the architectural rationale and the live failure trace.
4. **Decide on the local-patch fallback.** If upstream lands quickly, skip. Otherwise, prototype the patch against `delivery-DhVEJzi6.js` and verify on the mini gateway.
5. **Update the audit pattern.** Once deployed, monitor `~/.openclaw/logs/gateway.log` for residual `Subagent announce give up` events — they should drop to the LLM/network bucket only. If any lock-related ones appear, the queue isn't being used for that code path.
