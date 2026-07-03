# OpenClaw — cron→main→subagent never wakes main (run-key vs job-key mismatch)

> **✅ SUPERSEDING FIX (2026-06-30, v2): block-at-yield — `sessions_yield` gathers descendants in-turn.** Patch: [`sessions-yield-block-and-gather.patch`](./sessions-yield-block-and-gather.patch). This replaces the re-run-wake (banner below) after it leaked again live: in a 2-subagent interactive test, `countActiveDescendantRuns(canonicalRequesterSessionKey)` returned 0 while a sibling was still running (session-key drift between what the subagent recorded and the announce path's canonical key), so the suppress-gate missed → main re-ran on the *first* completion ("TimeTree back. Still waiting on reader…") and a near-simultaneous **double-fire** (same text 173 ms apart). The re-run is racy by construction: a yielded main loses context, must re-fetch child results, and each completion is an independent wake event.
>
> **The deterministic fix keeps main the live writer — the only path that is 100% (CLI/TESTH/cron-block-in-turn).** `sessions_yield`, before ending the turn, checks for active descendant subagents (`listDescendantRunsForRequester` via the same controller-key resolution the spawns use — no drift). If any are active it **blocks in-turn** (`waitForAgentRunsToDrain`), then reads **all** their replies (`readDescendantSubagentFallbackReply`, up to 4 joined — complete, not last-only) and returns them inline as the tool result. Main never goes inactive: it synthesizes from real results in its *same active turn*, single writer, no re-run, no lock/file-owner contention. While it gathers, the announce path **suppresses** delivery for that requester (a `globalThis`-backed `isYieldGathering` flag — works across chunk boundaries, keyed by the descendants' own `requesterSessionKey` through `resolveRequesterStoreKey` so suppression can't miss on key drift), so no descendant can steer/deliver raw text. When no descendants are active, yield ends the turn normally (unchanged). Applies to cron + interactive alike (additive safety over the cron don't-yield prompt). Source: tsgo clean (only 2 pre-existing unrelated `config/io.ts` errors), 22/22 yield-tool + flag tests pass, no regression in 192 announce/yield tests. Deploy: surgical chunk patch (yield-tool block logic + openclaw-tools gather wiring + announce-delivery `isYieldGathering` guard, globalThis flag inlined — no new module needed).
>
> **⏸ Prior approach (re-run wake, superseded):** single-writer re-run wake — when a yielded/inactive non-cron main (or a C0-retargeted cron job-key) gets a subagent completion, abort+drain any stale lock holder then re-run main on its EXISTING session (no sessionId rotation). Validated single-subagent (5/6) but the suppress-gate for *multi*-subagent missed on key drift and double-fired (see v2 evidence above). Kept here only as the trail; `cron-interactive-rerun-wake.patch` remains in the dir for reference.
>
> **🐞 Real bug found in interactive testing (2026-06-30, fixed):** the first interactive deploys leaked because `sessions_yield` was **throwing** `Cannot read properties of undefined (reading 'trim')` on every call (the gather degraded to a normal yield → main inactive → interim announces leaked). The hunt had two layers:
> 1. **Latent `childSessionKey` bug (real, fixed defensively):** several registry walks (`forEachDescendantRun`, the read-index builder, `readDescendantSubagentFallbackReply`'s filter, maintenance) did `entry.childSessionKey.trim()` **unguarded**, and a run record can exist with an undefined `childSessionKey`. Guarded all of them (`(entry.childSessionKey ?? "").trim()`, or skip the entry) — this hardens the whole registry, not just the gather.
> 2. **THE actual cause — wrong chunk import alias (surgical-deploy mistake):** the hand-patched `openclaw-tools-*.js` imported `listDescendantRunsForRequester` as **`b`** from `subagent-registry-dq-*.js`, but `b` in that chunk is `prependAgentSteeringPrompt` (the chunk *imports* the real fn as `b` from elsewhere and *re-exports* it as **`d`**). So the gather was calling the wrong function, which `.trim()`s an undefined arg → threw on every call. **The TS source was always correct** (it imports by name); only the minified-chunk translation picked the wrong letter. Fix: import `d as listDescendantRunsForRequester`.
>
> **Lesson for surgical chunk deploys:** verify an imported alias against the chunk's **`export{… as NAME}`** line, *not* a `grep "X as listDescendantRunsForRequester"` that can match an *import* re-export inside the chunk. A wrong alias is silent — syntax-valid, loads clean, throws only at call time. Add a one-shot `console.error` probe + read the **stack trace** (it names the real function) rather than guessing.
>
> **Bulletproofing:** the gather body is now fully wrapped — any throw degrades to a normal yield and always clears the suppression flag, so a primitive failure can never strand `sessions_yield` again. **Validated** on BOTH a cron (`activeRuns=2`, `RESULT=<A> // <B>`) AND an interactive imessage-key run (`agent:main:imessage:direct:…`, `activeRuns=2`, clean single output, no leak). Source: tsgo clean (2 pre-existing unrelated errors), 56/56 registry+yield+followup tests. Live snapshot `dist.blockyield_v2`, rollback `~/restore-cron-patch.sh`.
>
> **🐞 Late-announce leak (2026-07-02, fixed) — the one the reader-only tests missed.** Cole's real session still leaked, specifically with the browser-agent, while my reader/browser throwaway one-shots looked clean. Diagnostic logging on the REAL `+19372076233` session showed the gather resolving the right key and finding the descendants — but main's delivered turns were: `"Done 🦆 …"` (correct synthesis) **then ~5-8 s later** `"## Results Found 1 volleyball-related event…"` (raw reader) and `"**Deletion confirmed.** I can now clearly see the calendar…"` (raw browser). Root cause: a subagent's completion **announce fires several seconds after the gather returns and clears its suppression flag** — so the flag (scoped to the blocking window) had already lifted, and the late announce delivered the raw child text. Reader-only one-shots missed it because the process returned before the late announce fired; the browser-agent's longer lifecycle makes the late announce land after synthesis. **Fix:** the gather records the child session keys it gathered into a `done` set (`markYieldGathered`, `globalThis`-backed, capped at 500); the announce path suppresses any announce whose `sourceSessionKey` (= the subagent's `childSessionKey`) is in `done` — permanently, not just during the blocking window. Its content is already in the delivered synthesis, so a late delivery is a pure leak. **Validated:** reader+browser run delivered one clean `DONE=<email> // <event>` and the log shows `[OCFIX-SUPPRESS-LATE] agent:browser-agent:subagent:…` — the late browser announce suppressed. Source: tsgo clean, 206/206 tests. Live snapshot `dist.blockyield_v3`, rollback `~/restore-cron-patch.sh`.
>
> **Testing lesson:** validate with a **browser-agent**, not just readers — readers are fast and their announce lands inside the gather window; the browser-agent is slow and its announce lands *after*, exposing the late-announce path. A one-shot `openclaw agent` can also mask late announces (process returns first) — check the delivered turns AND the suppression log, not just the final synthesis.
>
> ---
> ### 🛟 FALLBACK PLAN (the known-working approach, if block-at-yield ever regresses)
> If the block-at-yield gather proves unreliable, fall back to **disabling `sessions_yield` so main never goes inactive** — the originally-validated fix. Two parts:
> 1. **Cron** (validated 5/5): `attempt.ts` passes `onYield: undefined` for `isCronRunSessionKey` keys (the yield tool returns "not supported" → main can't yield → blocks in-turn → subagents steer into the live turn → main synthesizes), plus `run.ts appendCronDeliveryInstruction` tells cron main to wait in-turn and never yield. Surgically: the cron prompt hint lives in the `isolated-agent-*.js` chunk; gate `createSessionsYieldTool` on `onYield` presence in `openclaw-tools.ts`.
> 2. **Interactive** (analogous fallback): make `sessions_yield` inert for interactive main too — gate `onYield` so a spawned-subagent turn cannot yield, forcing main to stay active so announces steer in (the proven active-main 100% path). Trade-off: main can't yield for genuinely long async work, but it never goes inactive mid-gather, so it never leaks. This is the "keep main the live writer" principle enforced by *removing* yield instead of *blocking* it.
>
> Block-at-yield is preferred because it lets yield keep working (block-and-resume) instead of disabling it; this disable-yield approach is the safety net if that regresses.
> ---


**Status:** ✅ **FIXED deterministically — 16/16 cron POCs synthesize, no-subagent + NO_REPLY controls clean, non-cron yield + announce tests pass. Deployed (2026-06-28).** Patch: [`cron-synthesis-blockwait.patch`](./cron-synthesis-blockwait.patch).

> **⚠️ Deployment method (learned the hard way):** do **not** deploy by replacing the mini's `dist/` with a from-source `tsdown` rebuild. Even at the same version/commit, a local rebuild bundles differently and **breaks sandboxed-subagent tool-bridging** (reader/browser-agent lose their plugin tools — get only read/write/apply_patch), while main keeps core tools. Verified by A/B: the published dist works, a same-commit rebuild does not. **Apply these patches surgically to the published chunks instead** (the source here is barely-minified template literals): inject the cron orchestration hint into `isolated-agent-*.js` (`appendCronDeliveryInstruction`) and the lock-leak guard into `subagent-announce-delivery-*.js`. Keep all other published chunks untouched so tool-bridging is preserved. Mini snapshot of the working surgical build: `dist.surgical`; pure published: `dist.stockbak`; restore: `~/restore-cron-patch.sh`. E2E verified: reader read a real email + browser read TimeTree, both synthesized.


## Root cause (final, convergent) and fix

The leak isn't a wake/key bug — it's that cron main calls **`sessions_yield`** before its subagents finish. A yielded run ends → main is inactive → every recovery path is a producerless transcript read (raw subagent output or "Checking." ack), ~20-50% of the time. CLI and TESTH crons hit 100% only because main **never yields** (blocks in-turn; results steer into the live turn; synthesizes). Two earlier hypotheses (run-executor 2nd-turn synthesis; C0 wake) capped ~50-80% because they synthesize *after* main is dead, with no data in context.

**Fix = keep cron main the live writer:** (1) `run.ts appendCronDeliveryInstruction` tells cron main to wait in-turn, never yield; (2) `attempt.ts` passes `onYield: undefined` for `isCronRunSessionKey` keys → `sessions_yield` is inert for cron-isolated → main *cannot* yield → blocks in-turn → synthesizes (the proven 100% lifecycle). Non-cron keeps `onYield` verbatim (byte-identical; yield tests pass). Parallel fan-out still works (3/3 two-subagent POCs synthesized both — parallelism comes from spawning N, not from yielding). C0 wake retarget dropped as dead code. Everything below is the invalidated trail.



**Affected build:** OpenClaw 2026.6.1 (commit `2e08f0f`). Source: `~/git/openclaw` @ `v2026.6.1`.

---

## The fix that shipped (one-paragraph version)

Cron main delivers a raw/ack leak because it calls **`sessions_yield`** before its subagents finish: a yielded run ends, main goes inactive, and recovery becomes a producerless transcript read. CLI/TESTH hit 100% only because main never yields. Fix: disable yield for cron-isolated keys (`attempt.ts` passes `onYield: undefined` + the tool is dropped from the cron roster) and instruct main to wait in-turn (`run.ts`). Main blocks, subagents steer in, main synthesizes. Non-cron byte-identical; parallel fan-out unaffected. See top banner for the validated patch.

**Proof (mini, isolated+announce cron, main spawns a reader that returns `POC-READER-DONE-5`):**
- Stock chunk: `delivered:true dur=8.9s summary="I'll spawn a subagent…"` (the **ack** leaked) → "Checking" hit the phone.
- From-source build: `delivered:true fallbackUsed:false dur=11.9s summary="POC5=POC-READER-DONE-5"` — main's **synthesis**, no give-up, no raw dump. The +3s is the drain wait.

Built via `tsdown -c tsdown.config.ts`, rsynced `dist/` to the mini (non-JS assets restored from stock backup), gateway restarted. C0 key-fix no longer applied (announce path sidestepped). Everything below is preserved as the investigation trail.

### What changed vs the parked C0+C2 plan

- **Dropped C0 + the whole announce-wake design.** No key normalization, no cleanup-deferral, no double-send guard, no group/channel suppression. Touches one file. The announce path stays inert; main delivers via the normal cron path.
- **Decoupled the trigger from interim-phrasing.** Stock gated descendants behind `isLikelyInterimCronMessage`; an ack like "Checking." matches none of its hints, so the first deploy delivered the ack (dur 8.9s, branch never fired). Split into `canFollowUp` (no error / no messaging-tool / no structured content) and gated synthesis on **descendants-existed**, not on wording.

### Validation caveats (honest)

- Proven on the mini, two cases: bare-ack `"Checking."` → spawn → drain → synthesize (`delivered:true dur=13s POC5=…`); NO_REPLY+spawn → silent (`delivered:false dur=8.3s`, no extra turn). A 15-agent adversarial audit (1.3M tokens) found the first cut over-broad — it synthesized on NO_REPLY, concrete answers, and fast-settled subagents. Re-narrowed: synthesis fires only on a **short bare ack** (≤45 words, non-empty) with descendants. A re-audit caught my anchored `^no_reply$` guard missing wrapped/repeated variants → now uses the canonical `isSilentReplyPayloadText` (exact/repeated/envelope/reasoning-prefixed); re-POC'd: `"NO_REPLY NO_REPLY"`+spawn stays silent. 4 unit tests; inverted stock test fixed.
- Accepted (low): a *short* concrete final answer (≤45 words) that also spawned a subagent still gets a synthesis turn — bounded re-summarization from subagent output, no data loss. Synthesis is a **bounded loop** (≤3 attempts, shared `Date.now()+600s` deadline, `OPENCLAW_TEST_FAST` shrinks): re-drains + re-synthesizes while the model re-acks/re-spawns, so a single ack can't leak. Validated 3/3 (`POC5=`, 22–32s) + NO_REPLY silent. Cron-only — coexists live with the interactive enqueue-only fix.

**Tracks upstream:** openclaw/openclaw#46298 (closed "fixed"; descendant-wait + raw fallback is incomplete — salvages some output but never wakes main to synthesize).

---

## Symptom

A cron with `sessionTarget: "isolated"`, `agent: main`, whose prompt spawns a subagent (e.g. `reader`) and then waits for it (via `sessions_yield` or a blocking `sessions_send`):

```
[warn] Subagent announce give up (retry-limit)
       run=<runId>
       child=agent:reader:subagent:<uuid>
       requester=agent:main:cron:<jobId>:run:<runId>
       retries=3 endedAgo=<2-10>s
       deliveryError="announce deferred or direct delivery failed"
```

**User-visible effect:** the cron fires, the subagent runs and finishes correctly, but **main is never woken to synthesize a reply**. The user receives either nothing (silent-yield path) or the subagent's **raw verbose output** dumped to chat (interim-text path, via the cron delivery's `readDescendantSubagentFallbackReply` fallback) — never main's clean synthesis.

**Reproduces 100% on stock 2026.6.1.** The "fast give-up" tell: 3 retries within ~2 seconds (not the 5s/10s/20s backoff), because the failure is a **fast early-return**, not a timeout.

---

## Root cause (validated)

Two session keys exist for one cron run, and the announce-wake looks up the wrong one.

In `src/cron/isolated-agent/run.ts`:
- **Job-scoped key** — what the session is stored under:
  `run.ts:550` → `baseSessionKey = cron:<jobId>` → `agent:main:cron:<jobId>`
- **Run-scoped key** — what spawned subagents record as their requester:
  `run.ts:593` → `runSessionKey = agentSessionKey + ":run:" + runSessionId` → `agent:main:cron:<jobId>:run:<runId>`
- `delivery-dispatch.ts:1105` → `subagentFollowupSessionKey = params.runSessionKey` (run-scoped)

The session **store entry lives under the job-scoped key**. The reader subagent's `spawnedBy` / requester is the **run-scoped key** (confirmed in the live store: reader entry `spawnedBy = agent:main:cron:<jobId>:run:<runId>`; main store top-level key = `agent:main:cron:<jobId>`).

When the reader finishes, `runSubagentAnnounceFlow` (`src/agents/subagent-announce.ts`) tries to wake the requester:

1. `requesterIsInternalSession()` returns **true** — because the requester key is a cron key (`isCronSessionKey`). The cron-main is classified as an internal subagent.
2. The cron run is inactive (main yielded), so it enters the internal-requester block.
3. `loadSessionEntryByKey(<run-scoped key>)` → **undefined** (`sid=undefined`, `usable=false`). The store has the *job-scoped* key, not the run-scoped key. A direct store lookup with no normalization (`subagent-announce-delivery.ts` `loadSessionEntryByKey` → `loadSessionStore(...)[sessionKey]`).
4. `resolveRequesterForChildSession(<run-scoped key>)` → **null**. That helper (`subagent-registry-state` `…FromRuns`) walks subagent *child→parent* chains; a cron top-level session is not a child of anything, so no match.
5. → **`return false`** at the "no fallback requester" branch (`subagent-announce.ts`, the `if (!fallback?.requesterSessionKey) { … return false }` inside the `requesterIsSubagent` block).

**The wake is never attempted.** `deliverSubagentAnnouncement` / the dispatch are never reached. Main never wakes. The cron delivery path then finds no main synthesis and falls back to raw subagent output.

### Empirical proof (the instrumentation trace)

Three identical confirmations via `defaultRuntime.log` probes inserted at the decision points:

```
[C-DIAG2] flow-entry   requesterKey=agent:main:cron:<jobId>:run:<runId>  expectsCompletion=true
[C-DIAG3] requesterIsSubagent=true   targetKey=agent:main:cron:<jobId>:run:<runId>
[C-DIAG3] runNotActive  sid=undefined  usable=false        ← run-scoped key resolves to NO session
[C-DIAG3] RETURN-FALSE-246  no-fallback-requester  fallback=null   ← gives up here
[warn] Subagent announce give up (retry-limit) … deliveryError="announce deferred or direct delivery failed"
```

And the store proves the key-scope split (11 cron keys in the live store: 10 job-scoped, 0 matching the run-scoped requester):

```
JOB agent:main:cron:b33cbad4-…  sid=de7bf174-…
JOB agent:main:cron:3bac19c4-…  sid=df2cf794-…
…   (the run-scoped key the announce looks up is never a top-level store key)
```

---

## Why this is cron-specific (and why non-cron works)

Channel-bound (`agent:main:imessage:direct:+…`) and CLI (`agent:main:<key>`) requesters have **no run-scoped vs job-scoped split** — the requester key spawned subagents record *is* the store key. So `loadSessionEntryByKey` succeeds, the flow proceeds to the wake dispatch, and main wakes normally. Empirically confirmed: CLI `main → 2 parallel readers → synthesize` worked cleanly (TEST 9, 2026-06-10), while the identical cron shape failed (TEST 4/5).

---

## The naive fix and why it is NOT viable

**Naive fix (`FIX-CRON-RUNKEY`):** at the top of `runSubagentAnnounceFlow`, when the requester is a cron run-scoped key with no usable stored entry, retarget to the job-scoped key (strip `:run:<runId>`) if *that* has a usable entry.

```js
if (/:cron:[^:]+:run:[^:]+$/.test(targetRequesterSessionKey)
    && !hasUsableSessionEntry(loadSessionEntryByKey(targetRequesterSessionKey))) {
  const jobKey = targetRequesterSessionKey.replace(/:run:[^:]+$/, "");
  if (hasUsableSessionEntry(loadSessionEntryByKey(jobKey))) targetRequesterSessionKey = jobKey;
}
```

**Result (validated 2026-06-20):**
- ✅ The wake **works** — main woke on the job session and produced its OWN synthesis (`[FIXTEST] main synthesized N=7`), not a raw reader dump.
- ❌ **Fatal side effect — write-lock contention.** Waking the job session collides with the cron's *own* delivery path (and/or main's still-active first turn) on the **job-session write lock**. Observed: `SessionWriteLockTimeoutError`, lock held by the gateway's own pid for **minutes** (`pid=<gateway> alive=true ageMs=6–8min`) → announce give-ups → raw fallback leaks. It **broke the TESTH-pattern crons** (Email Triage) that had previously been reliable.

So the key-resolution fix is necessary but not sufficient: **the wake and the cron delivery path are two writers contending for one session lock.** A viable fix must make main wake → synthesize → deliver **exactly once, with a single writer** — i.e. the two paths must be *coordinated*, not just have the lookup corrected.

> **Operational lesson (learned the hard way):** this naive fix was left running on the production gateway for ~3 days, where it caused the very leaks we were trying to fix. **Experimental patches must be reverted between test runs and never parked on the production host.**

---

## The disproven hypothesis (deletion race)

The original version of this doc claimed the cause was a *race*: `cleanupDirectCronSession()` deletes the cron session (delete-after-run) before the announce can wake it. **This was wrong.** Timing evidence: in the failing runs, the `sessions.delete` RPC fired *3 seconds AFTER* the announce already gave up — the session was still alive when the wake failed. The wake fails because of the **key-scope mismatch** (the lookup never matched the stored session), independent of deletion. The `apply-cron-subagent-cleanup-fix.mjs` patcher (defer-deletion) addresses a non-cause and is retired.

---

## Contention mechanism (validated against source, v2026.6.1)

Corrects an earlier guess ("the cron delivery path holds the lock while polling"). It does **not**.

- The session write lock is a **per-transcript-FILE** advisory sidecar lock (`${sessionFile}.lock`), process-global manager, **non-reentrant** by default (`session-write-lock.ts:84,887,895`).
- The job-scoped and run-scoped cron keys **share one `sessionId` → one transcript file → one `.lock`** (`run.ts:587–594`). An embedded run on *either* key contends on the same lock.
- The cron's **first turn releases the lock at teardown** (`attempt.ts:5260`) — *before* `dispatchCronDelivery` runs. And `dispatchCronDelivery` / `waitForDescendantSubagentSummary` hold **no** job-session lock (they're `agent.wait` + `chat.history` RPC reads; `subagent-followup.ts:112–148`).
- **The actual lock holder is the WAKE itself.** `sendSubagentAnnounceDirectly`, for an inactive cron requester, calls `dispatchGatewayMethodInProcess('agent', {sessionKey: jobKey})` (`subagent-announce-delivery.ts:1420–1431`), which spawns a **fresh embedded run** that holds the job-session file lock for the *entire* multi-minute synthesis turn. Embedded `maxHoldMs` ≈ **17 min** (compaction timeout 900k + 120k grace; `session-write-lock.ts:257–269`), acquire timeout 60s. So that wake run, holding for minutes, makes **any other writer on the same file time out at 60s** — including the announce's own 3 retries and parallel subagents' wakes, each of which spawns *another* competing run on the same file.
- Stock short-circuits cron-run requesters to `{delivered:true, path:'none'}` *without* waking (`subagent-announce-delivery.ts:1362–1377`). The naive fix bypassed that no-op → introduced the competing wake-run lock acquisition. That's the whole bug.

## Fix design — candidates, adversarial findings, recommendation

Five candidates were designed and then stress-tested by 5 adversarial verifiers. **Verdict tally: 2 flawed, 3 sound-with-caveats.** The verification overturned the initially-recommended candidate (C1).

| # | Approach | Status |
|---|---|---|
| **C0** | Key normalization: strip `:run:<id>` → job key for the announce lookup, **guarded on `isCronRunSessionKey`**, additive before the existing fallback. | ✅ **Necessary prerequisite. Verified no-op for non-cron** (channel, CLI, depth-1/2 non-cron subagent chains). Not standalone — re-introduces the lock timeout if shipped without a transport fix. |
| **C1** | Route the wake through the existing `session-delivery-queue` (`enqueueSessionDelivery({kind:'agentTurn'})`). *(This is the Plan 028 idea.)* | ❌ **FLAWED — do not ship.** Two source-verified blockers below. |
| **C2** | Cron delivery **owns the synthesis as a SECOND turn on the cron's OWN lock controller** (not a fresh embedded run), after descendants drain. | ⭐ **Structurally correct — the only candidate that guarantees a single writer.** Harder; reworks controller dispose lifecycle. |
| C3 | Minimal subset of C1 (enqueue from the cron delivery path instead of the registry push). | ❌ Inherits C1's dead-transport blocker. |
| C4 | Keep in-process wake but lane-serialize it. | ⚠️ Premise unverified — see below. |

### Why C1 (the session-delivery-queue route) is dead on arrival

Two independent verifiers caught it, both with source citations:

1. **Dead transport — the queue is never drained in steady state.** `drainPendingSessionDeliveries` / `deliverQueuedSessionDelivery` are called **only** from `drainRestartContinuationQueue` (`server-restart-sentinel.ts`), i.e. **only at gateway restart**. `enqueueSessionDelivery` just writes a SQLite row that nothing drains during normal operation — the wake would never fire until the next restart. (This invalidates the Plan 028 assumption that the queue has a live drainer.)
2. **No lane serialization — collision relocated, not removed.** Even with an added drain, the drain's `dispatchAssembledChannelTurn` (`kernel.ts:361–432`) contains **zero `lane` handling** (grep-confirmed); the cron `lane` is not propagated. So the drained wake still runs a fresh embedded attempt that calls `acquireEmbeddedAttemptSessionFileOwner(sessionFile)` (`attempt.ts:1925`) — the same independent file-lock acquirer. The central "serializes on the lane" claim is false.

### Recommended direction: C0 + C2 (cron-side second synthesis turn) — round-2 validated

**Fix at a glance (high level):** two pieces.
- **C0 — fix the lookup.** Subagent records requester as the *run-scoped* key (`…cron:<job>:run:<run>`) but the session is stored *job-scoped* (`…cron:<job>`), so the wake's lookup misses and bails. C0 normalizes a cron run-key to its job-key before lookup. Guarded to cron keys only → no-op everywhere else. Makes the wake *reachable*.
- **C2 — single-writer delivery.** C0 alone makes the wake fire, but the wake spawns a competing run → lock contention. So instead the cron's own delivery path runs **one more turn** after subagents drain ("synthesize + deliver"), reusing normal turn machinery, reacquiring the just-released lock with no rival. Cron = sole writer + sole deliverer; announce stays inert → exactly once, no lock timeout. Cost: one extra model turn + careful ordering (synthesize before cleanup, no double-send). Alternatives rejected: queue route is dead (no mid-run drainer), controller-reuse impossible (disposed).

Detailed plan and verification below.

Round 2 (12-agent deep dive, 4 sound-with-caveats / 1 placement-flaw) confirmed **C1 dead** (session-delivery-queue has no steady-state drainer + no lane serialization), **C4 dead** (per-session lanes key on run-vs-job so never serialize; group lane self-deadlocks), and **literal-C2 dead** (the `EmbeddedAttemptSessionLockController` is closure-local, disposed per attempt, never reusable). The provably-correct fix is:

**C0 (key normalization) + cron-side second synthesis turn.** After `waitForDescendantSubagentSummary` drains the descendants, the cron delivery path issues **one** more `executor.runPrompt` ("subagents done — synthesize + deliver") on the **same job transcript**. It's a fresh attempt that reacquires the released file lock with **no rival** (precedent: the interim-retry second runPrompt at `run-executor.ts:529`), serialized by the process-global `EmbeddedAttemptSessionFileOwner` queue (`attempt.session-lock.ts:431-468`, parks+hands-off, no 60s race). The cron becomes the **sole writer and sole deliverer**; the announce stays inert (keep the cron-RUN `{delivered:true,path:none}` short-circuit), so there is provably **one writer, one send**. This is the only candidate that fixes contention *and* exactly-once.

Implementation plan (source-cited, v2026.6.1):
1. **C0**: in `subagent-announce.ts:484-504` (verifier: locate it here, not in subagent-requester-store-key.ts) — when `isCronRunSessionKey(key)`, derive jobKey by stripping trailing `:run:<id>`; use jobKey for `loadSessionEntryByKey`; additive, before the existing fallback.
2. `delivery-dispatch.ts:1096-1102`: compute `hadDescendants` **above** the `!synthesizedText` return so silent-yield still triggers synthesis.
3. `run-executor.ts:520`/`507-530`: extend the descendant branch to wait-then-issue ONE synthesis runPrompt on `runSessionKey` (verifiers prefer this over threading through delivery-dispatch).
4. Keep announce inert: `subagent-announce-delivery.ts:1362-1377` cron-RUN no-op stays; set `deliveryAttempted=true` cron-side.
5. Defer `cleanupDirectCronSession` until after synthesis read (`delivery-dispatch.ts:786-800,1091-1093`) so the transcript isn't renamed mid-turn.
6. `deliveryAttempted=true` on synthesis path (`delivery-dispatch.ts:1162/1181`) so the cron timer fallback can't double-send.
7. Group/channel: cron `requesterIsInternalSession()`=true → `deliver:false` sink, cron sends once.
8. Tests: recurring/one-shot, silent-yield, ≥2 parallel, depth-2, byte-identical non-cron.

**Cost:** one extra model turn per cron synthesis; minor dispose-timing rework (synthesis must complete in `finalizeCronRun` before `disposeCronRunContext` at `run.ts:1364`) — verified **orthogonal to #85019** (that dispose clears context/MCP/store, not the controller). Net: invasive but provably correct; deserves a dedicated validation pass, never parked on prod.

### Original C0+C2 candidate matrix (round 1)

**C0** (verified-safe key normalization) **+ C2** (synthesis as a second turn on the cron's own already-held lock controller). C2 is the only design where there is **never a second independent file-owner acquirer** — synthesis runs single-threaded within the cron run's own lock, so cross-acquirer contention is impossible by construction, and there's no cleanup-vs-wake race.

**C2's cost / risks (must be handled):**
- Keeping the embedded controller alive past `executeCronRun`'s return reworks dispose timing (`attempt.ts:5260`, `run.ts:1188–1206`) and risks re-triggering the **#85019 heap-retention** pattern the dispose was added to fix.
- Re-entering a synthesis turn under the cron controller is a meaningful new code path.

### Must-fix list before any apply (from the verifiers)

1. **C0 additive + guarded**: insert before the `resolveRequesterForChildSession` fallback (`subagent-announce.ts:492`), guarded strictly on `isCronRunSessionKey`; never strip unguarded (it would mangle `agent:main:subagent:run:thing`). Must not replace/skip the existing fallback.
2. **Silent-yield**: the wake trigger must sit **above** the `if (!synthesizedText) return null` guard (`delivery-dispatch.ts:1099–1101`), or silent-yield-with-descendants falls through to no-delivery.
3. **Parallel subagents**: N completions must produce **one** aggregating wake, not N (each stock announce push spawns its own).
4. **delete-after-run**: defer `cleanupDirectCronSession` (`sessions.delete deleteTranscript:true`) until the synthesis turn completes — else it archives/renames the transcript mid-wake.
5. **Suppress the 3rd delivery path**: set `deliveryAttempted=true` on the new path so the cron timer's `enqueueSystemEvent` fallback doesn't fire a redundant send (the `double-announce.test.ts` invariant).
6. **Exactly-once for group/channel crons** with `visibleReplies:'message_tool'`: ensure the wake's route is non-deliverable so a message-tool send lands in the internal sink, not a second external send.
7. **5-strike silent-drop**: `MAX_SESSION_DELIVERY_RETRIES=5` abandons silently — add a terminal fallback/notice (only relevant if a queue path is used).
8. **Regression tests**: recurring vs one-shot cron, silent-yield, ≥2 parallel subagents, depth-2 nesting, and **byte-identical** non-cron behavior (channel/CLI/depth-1/depth-2 non-cron must hit the unchanged `dispatchGatewayMethodInProcess('agent')` path).

Constraints any fix must satisfy: (1) main wakes, synthesizes, delivers **exactly once**; (2) **no `SessionWriteLockTimeoutError`** — single writer; (3) **zero** non-cron behavior change; (4) handles silent-yield, interim-text, parallel subagents, depth-2, recurring vs one-shot, TESTH blocking-send, and restart mid-flight.

> **Investigation provenance:** 12-agent deep dive over `~/git/openclaw` @ `v2026.6.1` (commit `2e08f0f`), ~1.74M tokens. The adversarial pass is what saved us from shipping C1 — a patch that would have silently never fired.

---

## Methodology log

- Root cause found by **runtime instrumentation**, not static analysis. Earlier static-analysis conclusions (deletion race) were plausible but wrong; the empirical trace was decisive.
- Validate each step empirically; revert experimental code between runs; never leave an unvalidated patch on production.
- Source analysis uses `~/git/openclaw` @ `v2026.6.1` (commit `2e08f0f`) — byte-for-byte the build running on the host.
