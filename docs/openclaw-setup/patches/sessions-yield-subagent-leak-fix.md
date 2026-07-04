# OpenClaw — `sessions_yield` subagent-announce leak (cron + interactive)

**Status:** ✅ **FIXED + validated live (2026-07-02).** One unified fix covering cron *and* interactive.
**Fix diff:** [`sessions-yield-block-and-gather.patch`](./sessions-yield-block-and-gather.patch) (against OpenClaw source; 10 files).
**Deployed:** deployment host `dist.blockyield_v3`, rollback `~/restore-cron-patch.sh`.

> This doc supersedes and consolidates the earlier trail (cron block-wait, interactive
> enqueue-only, re-run wake, defer-deletion). Those iterations — and their patches — live
> in git history (checkpoint commit before this consolidation) if ever needed. Everything
> below is the final, validated understanding.

---

## Symptom (what the user sees)
A main agent that spawns a subagent and delivers its **raw output** to the channel — either
*instead of* a clean synthesis, or as an extra message(s) a few seconds *after* the clean
answer. Most glaring with a **browser-agent** (slow + verbose wall of text like
`"I can see the calendar loaded… monthly view… Verdict for…"`); a **reader** produces a
shorter `"## Results…"` block that's the same bug but easier to miss.

## Exact trigger
Main spawns one or more **async subagents** and then calls **`sessions_yield`** while at
least one subagent is **still running**. All three conditions required:
1. Main **yields** (calls `sessions_yield`). If it does the work inline without yielding, no leak.
2. There is an **async subagent** that reports back via a completion **announce** (readers, browser-agents).
3. The subagent is **still running at/after the yield** (didn't already report before main yielded).

Note: the `sessions_yield` tool description literally recommends this pattern
(*"Use after spawning subagents; results arrive as next message"*), so the leak-prone flow is
the documented/intended one.

## Root cause — one bug, two surfaces, two timing windows
Originally filed as two separate bugs (a **cron** leak and an **interactive** leak). They are
the **same root cause**: a subagent's result normally *steers* into main's live turn (internal —
main reads it and synthesizes). When main is **inactive**, steering fails and the announce
falls back to delivering the subagent's **raw text straight to the channel**. `sessions_yield`
is what makes main inactive. The announce can land in two windows relative to the yield:

- **Window 1 — during the wait.** Old flow: `sessions_yield` ended main's turn → main inactive →
  announce delivers raw output immediately. Every yielded subagent hit this.
- **Window 2 — ~5-8 s after the wait ends.** The announce fires a few seconds *after* the
  subagent's run ends (retry/dispatch delay). A naive in-turn fix that only suppresses during
  the blocking window has already cleared its flag by then, so the late announce leaks *after*
  the clean synthesis. **This is why "reader's fine, browser always leaks":** the reader is fast
  and its announce lands inside the window (suppressed); the browser is slow so its announce
  lands after, and its output is a big obvious wall.

## The fix
Three coordinated pieces (all provider-neutral OpenClaw source; see the patch):

1. **Block-at-yield (Window 1 + the architecture).** `sessions_yield`, when the caller has active
   descendant subagents, **blocks in-turn** instead of ending the turn: it waits for them to
   drain (`waitForAgentRunsToDrain`), reads **all** their replies
   (`readDescendantSubagentFallbackReply`), and returns them inline so main synthesizes **once**
   in its same active turn. Main never goes inactive → the CLI-style path that has always been
   100 %. While gathering, announces for that requester are suppressed via a `globalThis`-backed
   `keys` flag (`isYieldGathering`), keyed by the descendants' own `requesterSessionKey` (so it
   can't miss on key-spelling drift). Files: `tools/yield-gather-state.ts` (new),
   `yield-descendant-gather.ts` (new), `tools/sessions-yield-tool.ts`, `openclaw-tools.ts`,
   `subagent-announce-delivery.ts`. The whole gather is wrapped so any internal throw degrades to
   a normal yield (never strands the tool).

2. **Late-announce guard (Window 2).** The gather records the child session keys it gathered into
   a `globalThis` `done` set (`markYieldGathered`, capped at 500). The announce path suppresses
   any announce whose `sourceSessionKey` (= the subagent's `childSessionKey`) is in `done` —
   **permanently**, not just during the blocking window. Its content is already in the delivered
   synthesis, so a late delivery is pure leak. Confirmed live: `[OCFIX-SUPPRESS-LATE] agent:browser-agent:subagent:…`.

3. **Latent crash guard (separate, defensive).** The descendant-walk (`forEachDescendantRun`, the
   read-index builder, `readDescendantSubagentFallbackReply`'s filter, maintenance) did
   `entry.childSessionKey.trim()` **unguarded** — a run record can exist with an undefined
   `childSessionKey`, which throws and breaks *every* descendant walk (`countActiveDescendantRuns`,
   `listDescendantRunsForRequester`, the gather). Guarded all sites
   (`(entry.childSessionKey ?? "").trim()`, or skip the entry). Files:
   `subagent-registry-queries.ts`, `subagent-registry-maintenance.ts`, `cron/isolated-agent/subagent-followup.ts`.

**Unified.** This is **one mechanism for cron and interactive** — no cron special-casing. The
earlier cron-specific "disable yield" code (the `onYield` gating + wait-in-turn prompt) was
**removed** from both source and deployment; the patch touches neither `attempt.ts` nor `run.ts`.

## Validation
- **Cron:** 2-reader cron → `RESULT=<A> // <B>`; reader+browser cron → clean single delivery.
- **Interactive:** throwaway imessage-key runs (`agent:main:imessage:direct:…`) and the real
  live session — reader and browser-agent late announces consistently caught
  (`OCFIX-SUPPRESS-LATE` firing), delivered turns clean.
- Source: tsgo clean (2 pre-existing unrelated `config/io.ts` errors), 206/206 targeted tests.

## Fallback plan (if block-at-yield ever regresses)
Revert to **disabling `sessions_yield`** so main never goes inactive (the originally-validated
cron fix, 5/5): gate `onYield` for the relevant keys so the yield tool is inert → main can't
yield → it blocks in-turn → subagents steer into the live turn → main synthesizes. For cron,
pair with a `run.ts` "wait in-turn, don't yield" prompt hint. Block-at-yield is preferred
because it keeps yield *working* (block-and-resume) rather than removing it; disable-yield is
the safety net. Full detail + patches are in git history (checkpoint commit).

## Deployment notes (surgical chunk patching)
- **Do not full-rebuild** the deployed package from source, even at the same commit: a local
  `tsdown` rebuild bundles differently and **breaks sandboxed-subagent tool-bridging**
  (reader/browser-agent lose their plugin tools). Surgically patch the **published chunks**
  instead (they're barely-minified, tab-indented, ~1:1 with source). Keep all tool-bridging
  chunks untouched. Base snapshot: `dist.stockbak`; working: `dist.blockyield_v3`; restore:
  `~/restore-cron-patch.sh`.
- **Import-alias trap (cost a full debug cycle):** when hand-porting an import into a minified
  chunk, resolve the alias against the source chunk's **`export{ … as NAME }`** line — *not* a
  `grep "X as NAME"` that can match an *import* re-export inside that chunk. A wrong alias is
  **silent**: syntax-valid, loads clean, throws only at call time. If a surgically-added call
  throws, read the **stack trace** — it names the function actually being called.
- **source == deployed** (block-at-yield only). Any temporary `OCFIX-*` `console.error` probes in
  the deployed chunks are diagnostics not present in source; strip them once battle-testing is done.

## Testing lesson
Validate with a **browser-agent**, not just readers. Readers finish fast — their announce lands
inside the gather window and looks clean even when the after-window path is broken. The
browser-agent is slow (its announce lands *after*) and verbose (the leak is obvious), so it
exercises Window 2. A one-shot `openclaw agent` can also mask late announces (the process returns
before the announce fires) — check the delivered turns **and** the suppression log, not just the
final synthesis.
