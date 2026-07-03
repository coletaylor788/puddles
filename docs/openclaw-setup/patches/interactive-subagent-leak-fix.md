# OpenClaw — interactive subagent wake lock-race (busy live main → raw leak / stall)

**Status:** 🔧 **Redesigned + implemented (enqueue-only) and deployed to the mini (2026-06-28).** Patch: [`interactive-enqueue-only.patch`](./interactive-enqueue-only.patch). Coexists live with the cron fix (cron POC still `delivered:true POC5=…`). S1+S2 design INVALIDATED by the 29-agent audit; replaced by the simpler enqueue-only fix. Needs a live multi-minute browser-agent POC to fully confirm.

**Update (volleyball test):** real leak is a **yielded** main (inactive) — fresh dispatch fence-fails and raw-dumps. Added: incomplete branch gated `!isSessionWriteLockAnnounceAgentError` (no raw-dump on lock errors) + lock/takeover + non-cron + no-media → enqueue + `{delivered:false,path:none,reason:requester_lock_contended,terminal:true}` (drop, no double-steer), new reason added to the union, lock test added (93/93). Stops the raw leak deterministically. **Known floor:** on a fully-yielded main the enqueue is best-effort (lost if main doesn't resume) — proactive synthesis needs a single-writer re-run wake, a follow-up. Subagent file-only-tools in the test is a deployment config bug, separate.

## Implemented fix (enqueue-only, no fresh dispatch)

**Status:** ✅ **Implemented + test-validated (92/92 announce tests pass), enqueue-only reason-gated. Patch: [`interactive-enqueue-only.patch`](./interactive-enqueue-only.patch).** Not deployed (mini stock). Needs a live multi-minute browser-agent POC for final sign-off.

## Final fix (implementable) — reason-gated enqueue-only

In `subagent-announce-delivery.ts`, the active-requester branch. After the steer wake fails (`!wakeOutcome.queued`), before the fresh dispatch, add:

```ts
if (
  !isCronRunSessionKey(canonicalRequesterSessionKey) &&
  !requiresMessageToolDelivery &&
  wakeOutcome.reason !== "not_streaming" &&
  wakeOutcome.reason !== "no_active_run" &&
  resolveRequesterSessionActivity(canonicalRequesterSessionKey).isActive
) {
  const enqueueOnlyOptions = { ...wakeOptions };
  delete enqueueOnlyOptions.waitForTranscriptCommit;
  const enqueueOutcome = await resolveActiveWakeWithRetries(
    requesterActivity.sessionId, params.triggerMessage, enqueueOnlyOptions, params.signal,
  );
  if (enqueueOutcome.queued) {
    return { delivered: true, deliveredAt: ..., enqueuedAt: ..., path: "steered" };
  }
  // not queued → fall through to dispatch (run no longer streaming → no lock race)
}
```

Rationale: the leak is the **fresh dispatch** spawning a competing run on the live transcript → fence takeover. For a genuine lock-race (active requester, wake failed for a commit/fence reason, not `not_streaming`/`no_active_run`), enqueue best-effort and return — the live run drains it on its next turn. S1 dropped (steered persist is already fence-safe). Gating excludes media/message-tool and inactive-run reasons, so all 92 announce tests pass; only the genuine lock-race window changes (direct→steered, no loss). 33-line addition. **Coexists with cron fix** — disjoint files, cron requesters excluded.

## ⚠️ Earlier S1/S2 design — superseded

A 29-agent adversarial audit (run alongside the cron fix) found three high-severity flaws:

1. **S1 fixes a non-problem.** The steered message is enqueue-only; the requester's **own** stream drains and persists it on `message_end` → `onMessagePersisted` → `refreshAfterOwnedSessionWrite` (`attempt.ts:1988-1990`), which already resets the fence. So the steered persist is *already* a fence-safe owned write. S1's "make it first-class owned" fortifies a write that never trips takeover. A successful steer returns `path:"steered"` with no foreign write.
2. **S2's steer-drop doesn't remove the takeover.** `steerActiveSessionWithOptionalDeliveryWait` (`attempt.queue-message.ts:192-206`) calls `steer()` in both branches; dropping `waitForTranscriptCommit` only skips the commit *wait*, not the steer. The real foreign writer is the **fallback** after steer fails: `sendSubagentAnnounceDirectly → dispatchGatewayMethodInProcess('agent', {sessionKey})` spawns a fresh embedded run on the same per-file lock — the exact mechanism the cron fix abandoned.
3. **Triggers are NOT mutually exclusive.** An active cron-run requester hits S2's branch (gated only on `isActive && expectsCompletionMessage`, no cron guard); test `subagent-announce-delivery.test.ts:1485` proves it. So A and B can fire on one event; S2 would also regress the cron media-completion contract.

**Real fix direction (from the audit):** the leak is the fresh-dispatch fallback, so the interactive fix should mirror the cron one — for an active channel requester, **enqueue-only and never fall through to a fresh `dispatchGatewayMethodInProcess`**, count enqueue as delivered (it genuinely drains for an active main). Drop S1 entirely. Add a cron-active guard so it can't shadow the cron synthesis path. Coexists with cron fix A (disjoint files, A confirmed cron-only).

**Distinct from** the cron bug ([cron-subagent-cleanup-fix.md](./cron-subagent-cleanup-fix.md)) — same symptom, different mechanism.

**Affected build:** OpenClaw 2026.6.1 (`2e08f0f`). Source: `~/git/openclaw` @ `v2026.6.1`.

---

## Symptom

You ask main something inline that spawns a subagent (esp. a multi-minute **browser-agent** booking, e.g. volleyball/TimeTree). The subagent finishes, but its output dumps raw into chat, or main stalls until you nudge ("so?" / "?"). Logs show, on `agent:main:imessage:direct:+…`:
- `session file changed while embedded prompt lock was released` (most cases), or
- `SessionWriteLockTimeoutError` after 60s.

**Confirmed:** 4 file-changed + 1 timeout incident, all browser-agent on this phone. (One earlier "interactive" give-up, Jun25 reader, was a *message-tool-policy* denial — a 3rd unrelated thing.)

---

## Root cause (validated)

The requester key **matches** the store (no key mismatch — C0/C2 don't apply). The race is on the live session's per-file lock:

1. During main's LLM stream, the embedded turn **releases** its per-transcript write lock and arms a stat-fingerprint **fence** (`attempt.session-lock.ts:1026-1044` → `releaseHeldLockWithFence:789-818`).
2. The finished subagent's announce wakes the live (busy) main: `sendSubagentAnnounceDirectly` **steers** a message in (`subagent-announce-delivery.ts:1321-1345`), persisting it to the same transcript **outside** main's owned-write context.
3. On stream return, `reacquireAfterPrompt → assertSessionFileFence` (`704-745`) sees the file's stat changed and is **not** a benign/owned write → throws `EmbeddedAttemptSessionTakeoverError` ("session file changed…"). Or, if main holds the lock continuously (Jun6 22:43: `ageMs=253918` ≈ 4.2 min), the wake's 60s acquire times out. Either way → raw fallback leaks.

Incidents: Jun6 22:25 + 22:43 (TimeTree volleyball, same session `6c19ad6e`), Jun8 17:48, Jun5 20:52/21:06. Cites: `gateway.log:106153-106214`, `108190`, `104079-104424`.

---

## Fix design — S1 + S2 (round-3, 5/5 sound-with-caveats)

- **S2 (cheap mitigation, ship first):** for an ACTIVE channel-bound requester, **enqueue-only** — drop `waitForTranscriptCommit`, never fall through to a fresh dispatch, count enqueue as delivered (`subagent-announce-delivery.ts:1326-1336, 621-625, 1354-1361`). Stops forcing a foreign write into main's release window → no takeover, no 60s acquire.
- **S1 (by-construction fix):** make the steered persist a **first-class owned write** on the requester run's controller, so the fence **escapes** instead of racing (`attempt.ts:2242-2243`, `agent-session.ts:550-552/602-608`, escape already supported `attempt.session-lock.ts:713-723`, proven by `attempt.session-lock.test.ts:856`). Closes the residual mid-stream-drain window.

**Recommended:** S2 now, S1 to fully close it. Both confined to `subagent-announce-delivery.ts` active branch (+ S1's persist wiring). **Coexists with cron C0+C2:** different files, and triggers are mutually exclusive (bug-2 only when requester is active; cron only when key mismatches + inactive).

**Verifier caveats (honest):** two skeptics flagged the premise is slightly off on *which* write trips the takeover — worth confirming before final build that the steer (not the announce dispatch) is the foreign writer. Byte-identical for cron + short non-active requesters under both fixes.

---

## Validation provenance

10-agent deep dive, ~753K tokens. Mechanism from mini incident traces + source. Not yet prototyped — needs S2 build → test under a real multi-minute browser-agent booking → S1.
