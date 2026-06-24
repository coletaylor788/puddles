# OpenClaw — isolated cron + subagent wake race fix (DRAFT, not applied)

**Status:** 📝 Draft. Design validated, patcher dry-tested + idempotent + syntax-clean against the real 2026.6.1 file. Silent-yield path question RESOLVED (2026-06-12): both the interim-text race and the silent-yield race funnel through the same `cleanupDirectCronSession` function, so the single wrap point covers both. Not yet applied to the mini — runtime re-test of TEST 4/5 still pending.

**Patcher:** `apply-cron-subagent-cleanup-fix.mjs` (draft alongside this doc)
**Marker:** `FIX-CRON-SUBAGENT-CLEANUP-DEFER`
**Target file (6.1):** `run-delivery.runtime-<hash>.js`
**Verified against:** OpenClaw 2026.6.1 (design only; runtime test TBD tomorrow)
**Tracks upstream:** openclaw/openclaw#46298 (closed as "fixed" but the fix is incomplete — see [Why Stephen's fix doesn't cover this](#why-stephens-existing-fix-doesnt-cover-this))

---

## Symptom

Cron with `sessionTarget: "isolated"`, agent=main, prompt instructs main to spawn a subagent and `sessions_yield` for completion. Observed in 2026.6.1:

```
[warn] Subagent announce give up (retry-limit)
       run=<runId>
       child=agent:reader:subagent:<uuid>
       requester=agent:main:cron:<jobId>:run:<runId>
       retries=3 endedAgo=<2-10>s
       deliveryError="announce deferred or direct delivery failed"
```

User-visible effect: cron fires, reader runs to completion, but main is never woken to synthesize a reply. User receives either silent loss or — if some other code path picks up the descendant's raw output as a fallback (Stephen's `readDescendantSubagentFallbackReply`) — a verbose dump of the subagent's raw text instead of main's synthesis.

**Reproduces 100% on stock 2026.6.1.** Live evidence: TESTs 4 and 5 in [test matrix from 2026-06-10 night session].

---

## Root cause

Race between two flows that both target the cron-spawned main session:

1. **Cron delivery cleanup flow** (`run-delivery.runtime-<hash>.js`):
   - `dispatchCronDelivery` runs main, finalizes
   - `cleanupDirectCronSession()` calls `sessions.delete({key: agentSessionKey})` at [`run-delivery.runtime-B0hfxpBW.js:125-147`](#) (line numbers in 6.1) when the cron is one-shot (`deleteAfterRun: true`)
   - This removes the session entry from the gateway session store

2. **Subagent announce wake flow** (`subagent-announce-HPJnGzNW.js` / `subagent-announce-delivery-DhVEJzi6.js`):
   - When a descendant subagent run ends, the announce fires asynchronously
   - The announce attempts to wake the requester via `dispatchGatewayMethodInProcess("agent", {sessionKey, message, ...})`
   - Before dispatching, it calls `loadSessionEntryByKey(sessionKey)` to check the session is reachable
   - If the entry is gone (because flow 1 deleted it), the wake exits early without dispatching, sets `didAnnounce=false`
   - 3 retries later, `subagent-registry-dq-LC-2-.js` logs `"announce deferred or direct delivery failed"`

The race window is the time between cron delivery cleanup completing and the subagent announce machinery getting to the dispatch step. With small subagents (calendar lookups, ~1-2s after spawn), the subagent's run actually ENDS before the cron's cleanup fires — but the announce dispatch happens via the subagent registry queue, which lags. Cleanup wins; announce loses.

### Why this affects only isolated cron sessions

| Session type | Has `deleteAfterRun: true`? | Result |
|---|---|---|
| `sessionTarget: isolated` (one-shot cron with `--at` or auto-set) | ✅ Yes | Hit by the race |
| `sessionTarget: isolated` (recurring cron) | ❌ No | Cleanup doesn't run; session stays |
| `sessionTarget: session:<persistent-name>` | ❌ No | Cleanup not invoked for custom sessions |
| `sessionTarget: main` | ❌ No | Runs on live session lane; no cleanup |
| `openclaw agent` CLI | ❌ No | No cron context; no cleanup |
| Channel-bound main (e.g. iMessage inbound) | ❌ No | Channel binding prevents deletion |

This is why TEST 9 (CLI → main → reader) worked perfectly tonight, while TEST 4 and TEST 5 (cron isolated → main → reader) failed identically.

### Why Stephen's existing fix doesn't cover this

Issue 46298 (steipete's closing comment) added `waitForDescendantSubagentSummary` in `subagent-followup.runtime-<hash>.js`. That function:
- Waits for descendant runs to **drain** (the run completes)
- Then polls the cron session for 5s (`finalReplyGraceMs`) looking for a NEW assistant reply from main

Two gaps:

1. It waits for descendant *runs* to end, NOT for the subagent *announce* to complete delivery. The announce fires AFTER the descendant run ends, in a separate flow, and the cleanup race opens during that gap.
2. The 5-second poll relies on main actually writing a new reply. But main never wrote a new reply because the wake never reached it. So the poll times out and the code falls back to `readDescendantSubagentFallbackReply` — which delivers the descendant's raw text directly to the channel. That fallback is the "verbose dumps from reader" symptom Cole reported on 2026-06-08.

So Stephen's fix prevents *total silent loss* by salvaging the descendant's output as a last resort, but it doesn't actually let main wake up and synthesize. The bug is structural and lower in the stack.

---

## Fix design

Defer `cleanupDirectCronSession` (specifically the `sessions.delete()` call) until the subagent flow for this session has settled. The `deleteAfterRun` contract is preserved — the session IS still deleted after the cron's full lifecycle — we just redefine "after it runs" to include the async announce phase, not stop at main's first turn completion.

### Where the fix lives

`cleanupDirectCronSession()` at `run-delivery.runtime-B0hfxpBW.js:125`.

Wrap the function body so that if there are active descendant runs for the cron session, cleanup is deferred to a polling timer with a backstop. When all descendant runs settle (counter reaches 0), cleanup proceeds. If the backstop expires first, cleanup runs anyway (avoids leak).

### Pseudocode for the patched function

```js
const __c_originalCleanup = cleanupDirectCronSession;  // capture original
async function cleanupDirectCronSession(params) {
  // FIX-CRON-SUBAGENT-CLEANUP-DEFER:start
  const subagentRegistry = await loadDeliverySubagentRegistryRuntime();
  const activeRuns = subagentRegistry.countActiveDescendantRuns(params.agentSessionKey);
  if (activeRuns > 0) {
    // Schedule a polling re-check, plus a backstop timer
    const announceTimeoutMs = 120_000;  // matches agents.defaults.subagents.announceTimeoutMs default
    const backstopMs = announceTimeoutMs + 30_000;  // 150s total budget
    const startedAt = Date.now();
    const pollIntervalMs = 2_000;
    const tryCleanup = async () => {
      try {
        const stillActive = subagentRegistry.countActiveDescendantRuns(params.agentSessionKey);
        if (stillActive === 0 || (Date.now() - startedAt) >= backstopMs) {
          await __c_originalCleanup(params);
          return;
        }
        setTimeout(() => tryCleanup().catch(() => {}), pollIntervalMs);
      } catch {
        // Last-resort: always attempt cleanup at backstop
        if ((Date.now() - startedAt) >= backstopMs) {
          await __c_originalCleanup(params).catch(() => {});
        } else {
          setTimeout(() => tryCleanup().catch(() => {}), pollIntervalMs);
        }
      }
    };
    setTimeout(() => tryCleanup().catch(() => {}), pollIntervalMs);
    return;
  }
  // FIX-CRON-SUBAGENT-CLEANUP-DEFER:end
  return __c_originalCleanup(params);
}
```

Notes:

- **2s poll interval** — fast enough to clean up promptly after subagents finish, slow enough to not pin a CPU core.
- **150s backstop** — generous: covers the default 120s subagent announce timeout plus 30s margin for the announce's own retry/backoff window. Configurable via env var in a future iteration.
- **No coordination across processes** — single-gateway-process assumption (matches OpenClaw's actual deployment model for the mini setup).
- **No persistent state** — if the gateway restarts mid-defer, the cleanup just doesn't happen. Existing stale-session maintenance (cron's `sessionRetention: "24h"` per cron config docs) will eventually reap it. That's acceptable for a one-shot cron.

### Edge cases considered

| Case | Behavior |
|---|---|
| No subagents spawned (synchronous cron) | `activeRuns === 0`, falls through to immediate cleanup. **Zero change from today.** |
| Subagent finishes BEFORE cleanup is called | Same as above. No-op deferral. |
| One subagent active when cleanup fires | Deferred. Polled every 2s. Cleanup fires within 2s of subagent's run ending. |
| Multiple subagents in parallel | `countActiveDescendantRuns` returns aggregate. Deferred until all settle. |
| Subagent spawns its own subagents (depth-2) | `countActiveDescendantRuns` walks the tree. Wait covers full subtree. |
| Subagent hangs forever (or until its own run timeout) | Backstop fires at 150s. Session cleanup proceeds. Subagent's eventual announce arrives to a deleted session — same failure as today, but only in pathological case. |
| Cron retries (transient delivery failure) | `retryTransientDirectCronDelivery` already handles this; cleanup is called once at end. Behavior unchanged. |
| User deletes the cron job mid-run | Existing cron deletion paths run separately; this fix only adds a deferral, doesn't change session-deletion mechanics elsewhere. |
| Gateway restart during the 150s defer window | Session entry persists in store. Existing `cron.sessionRetention` (24h) eventually cleans up. No leak in practice. |
| Cron is recurring (`deleteAfterRun: false`) | `cleanupDirectCronSession` is invoked but `sessions.delete()` is skipped internally. The defer wraps the whole function but the inner cleanup is a no-op. Same effective behavior. |

### Paths NOT affected (verified by call-site tracing)

- `openclaw agent` CLI invocations
- Persistent custom sessions (`session:<name>`)
- Channel-bound main sessions (iMessage/etc.)
- `sessionTarget: main` + `systemEvent` (main session wake lane, not isolated cron)
- Browser-agent spawns (those run as subagents OF main, not as cron agents)
- Cross-agent spawns covered by the existing `subagent-cross-agent-spawn-fix`
- All non-`agentTurn` cron payloads

### Paths that may or may not be affected — REQUIRES VERIFICATION

- **Silent-yield case** (main yields with empty `synthesizedText`, e.g. TEST 4 from tonight): **RESOLVED 2026-06-12.**
  - `finalizeTextDelivery` early-returns at `if (!synthesizedText) return null`, so `deliverViaDirectAndCleanup`'s finally block doesn't fire — BUT the silent-yield path reaches cleanup via a DIFFERENT route: `dispatchCronDelivery` → (empty/silent synthesized text at line 691) → `finishSilentReplyDelivery()` (line 444) → `cleanupDirectCronSessionIfNeeded()` (line 446) → **`cleanupDirectCronSession()` (line 437→125)** → `sessions.delete` (line 131).
  - So the silent-yield deletion goes through the **same `cleanupDirectCronSession` function** the patch wraps. The single wrap point covers both the interim-text race (via `deliverViaDirectAndCleanup`) AND the silent-yield race (via `finishSilentReplyDelivery`). No sibling patch needed.
  - Confirmed: `cleanupDirectCronSession` (line 125) has exactly two callers' funnel — `cleanupDirectCronSessionIfNeeded` (line 434) which is invoked from both `finishSilentReplyDelivery` and the `deliverViaDirectAndCleanup` finally block. Both honor the `directCronSessionDeleted` once-guard, so cleanup fires once.

---

## How to apply (when ready)

```bash
ssh mini-ts
bash /Users/puddles/git/puddles/docs/openclaw-setup/patches/apply-and-deploy.sh
```

The patcher writes a `.bak.cron-subagent-cleanup` backup, embeds the `FIX-CRON-SUBAGENT-CLEANUP-DEFER` marker for idempotency, and clears the node compile cache + restarts the gateway via the standard apply-and-deploy flow.

To revert: restore from `.bak.cron-subagent-cleanup` siblings, clear node cache, restart gateway. Same workflow as the other patches in this directory.

---

## Validation plan (tomorrow)

1. **Verify silent-yield deletion source.** Run the spawn+yield test from a fresh isolated cron, then immediately check `sessions.json` for the cron session entry's presence vs. absence. Time the disappearance. Find the code path that deletes it for the silent-yield case.
2. **Apply the patcher** and confirm `FIX-CRON-SUBAGENT-CLEANUP-DEFER` markers land in the right places.
3. **Re-run TEST 4** (cron isolated + spawn + yield). Expected outcome with fix:
   - Reader runs, ends
   - Cron cleanup defers
   - Subagent announce wake fires successfully
   - Main runs a second turn, writes synthesis
   - Stephen's `finalizeTextDelivery` picks up the synthesis (or it goes through the wake's own delivery path)
   - User receives main's synthesized reply
4. **Re-run TEST 5** (cron + 2 parallel subagents). Same outcome expected.
5. **Re-run TEST 1 and TEST 6** (crons without subagents). Expected: zero behavior change, no defer triggered.
6. **Smoke test the live Evening Brief / Email Triage** crons with their TESTH-pattern prompts to confirm no regression. (Bonus: if this fix works cleanly, the TESTH workaround pattern becomes optional — main can yield naturally instead of using blocking sessions_send.)

---

## Upstream issue draft (post-validation)

Title: **Isolated cron `deleteAfterRun` race-deletes session before subagent announce can wake it**

Body summary:
- Issue 46298's fix (descendant-run wait + descendant fallback) addresses the symptom partially but the underlying race is still present
- Root cause: `cleanupDirectCronSession` deletes the session entry before the async subagent announce can dispatch the wake turn
- 100% repro on 2026.6.1: cron `sessionTarget: isolated`, prompt = "spawn reader, yield"
- Proposed fix: defer session deletion in `cleanupDirectCronSession` until `countActiveDescendantRuns` reaches 0 (or backstop)

Will file once this fix is validated end-to-end.

---

## Open verification questions

- [x] **Silent-yield deletion source** — RESOLVED 2026-06-12. Same `cleanupDirectCronSession` function (line 125), reached via `finishSilentReplyDelivery` → `cleanupDirectCronSessionIfNeeded`. The single wrap covers it.
- [x] **`loadDeliverySubagentRegistryRuntime()` API surface** — CONFIRMED. Defined at `run-delivery.runtime-B0hfxpBW.js:104`, in scope for the insert. Returned runtime exposes `countActiveDescendantRuns(...)`, already used by Stephen's own code at lines 638 and 653.
- [ ] **Cron retention interaction**: `cron.sessionRetention: "24h"` — does its cleanup path also call `sessions.delete()` and potentially race? Likely not (it runs hours later) but worth confirming.
- [ ] **Backstop value tuning**: 150s fixed. Should this be configurable via `agents.defaults.subagents.cronCleanupBackstopMs`? (Deferred — fine as a constant for now.)
- [ ] **Runtime end-to-end**: apply on mini, re-run TEST 4 / TEST 5 (expect main wakes + synthesizes), TEST 1 / TEST 6 (expect no behavior change).
