# OpenClaw bug report draft (v2)

> **Review before submitting.** Personal data scrubbed: email → `<email-redacted>`, phone → `<phone-redacted>`, cron job content paraphrased. Session IDs and job IDs are random UUIDs and safe to share. The minified-filename / line numbers come from the published npm tarball `openclaw@2026.4.20`. The fix proposal has been verified against `2026.5.7` source — same code paths apply.

---

## Title

`[Bug]: Isolated cron jobs misclassified as "internal subagent" sessions, breaking announce-path delivery for cron+subagent jobs`

## Labels

`bug`, `agents`

## Body (paste into GitHub bug-report form)

### Bug type
Behavior bug (incorrect output/state without crash)

### Beta release blocker
No

### Summary
Isolated cron jobs (`sessionTarget: "isolated"`) that yield to a subagent for the actual work (e.g., `main` spawns `reader` to fetch email, then synthesizes the result) silently fail to deliver to the configured chat target. The subagent's announce-back to main does wake main and main does produce a final synthesis, but no delivery actor is responsible for sending it: the announce flow misclassifies cron sessions as "internal" (same category as nested subagents) and intentionally strips the chat target on the wake; the cron's own delivery path has already exited; and the cron session entry doesn't persist a chat target the gateway could fall back to. The result is that for cron jobs that delegate to subagents — a documented pattern — the user receives nothing, an intermediate "thinking" snippet, OR (when the prompt instructs main to self-deliver via the `message` tool) a duplicate of whatever main self-delivers.

### Steps to reproduce

1. Configure an isolated cron job that delegates the main work to a subagent. Example (paraphrased, redacted):
   ```json
   {
     "sessionTarget": "isolated",
     "delivery": {
       "mode": "announce",
       "channel": "bluebubbles",
       "to": "<phone-redacted>",
       "accountId": "default"
     },
     "payload": {
       "kind": "agentTurn",
       "message": "Spawn the reader subagent to fetch <some URL> and report back. After it reports back, write your final answer in plain text and yield.",
       "timeoutSeconds": 120
     }
   }
   ```

2. Configure a `main` agent that owns `subagent_spawn`/`sessions_yield` but delegates the actual work tools (e.g., `web_fetch`, `list_emails`) to a `reader` subagent.

3. Trigger the cron. Observe:
   - Cron run record: `delivered: false` OR `delivered: true` with `summary` containing intermediate "thinking" text from main's first turn (e.g., "Let me check that for you, spawning the reader now.")
   - Subagent runs successfully, produces the actual result
   - Main is woken via the announce flow, produces a perfect final synthesis text
   - **Nothing is delivered to the configured `bluebubbles` chat**

### Expected behavior
The configured chat target receives main's final synthesis text exactly once.

### Actual behavior
Either nothing is delivered, or an intermediate "thinking" text snippet is delivered as the final result. If the prompt is augmented to instruct main to self-deliver via the `message` tool with explicit args, two messages get delivered (main's tool send + cron's auto-deliver of intermediate text).

### OpenClaw version
`2026.4.20`. Same architectural issue verified to exist in `2026.5.7` source (the `requesterIsInternalSession` filter is unchanged; `subagent-followup.runtime` is byte-identical; `finalizeTextDelivery`'s empty-text bail at the new line 433 is identical).

### Operating system
macOS 15.x (mac mini, gateway runs as user LaunchAgent).

### Install method
`npm install -g openclaw` (gateway as `launchctl` user agent).

### Model
`claude-opus-4.6` via the configured LLM provider.

### Provider / routing chain
`openclaw → <llm provider> (anthropic/claude-opus-4.6)`.

### Additional provider/model setup details
Default. Reproduces independently of model — what matters is that `main` yields to a subagent for the answer.

### Logs, screenshots, and evidence

Architecture diagram — current state:

```
Cron fires
   │
   ▼
runCronIsolatedAgentTurn
  agentSessionKey = "agent:main:cron:<jobId>" (parent, no :run:)
  runSessionKey = "agent:main:cron:<jobId>:run:<runId>"
   │
   ▼
executeCronRun → runEmbeddedPiAgent
  passes messageChannel/messageTo/etc → main has chat target in turn 1
   │
   ▼
Agent first turn (LLM + tools)
  - Main yields to reader subagent
  - Cron's executeCronRun returns
   │
   ▼
finalizeCronRun → dispatchCronDelivery → finalizeTextDelivery
  - Empty payloads OR text payloads
  - Wait branch sees descendants, polls main's session for 5s
  - 5s expires before main wakes → returns initial preamble OR null
  - Cron records delivered:false OR delivers preamble; exits

   ─────── meanwhile, asynchronously ───────

Subagent finishes → runSubagentAnnounceFlow
  - requesterIsSubagent = TRUE for cron (per requesterIsInternalSession check at line 154)
   │
   ▼
sendSubagentAnnounceDirectly
  - deliveryTarget = { deliver: false }    ← intentionally stripped for "internal" requester
  - callGateway({method:"agent", channel:undefined, to:undefined, deliver:false, expectFinal:true})
   │
   ▼
Gateway agent handler → runEmbeddedPiAgent
  - request.channel/to undefined
  - Cron session entry has no lastChannel/lastTo to fall back to
  - resolvedChannel falls back to "webchat" (default)
  - Main continuation runs with NO chat target context
   │
   ▼
Main produces final synthesis text → runtime captures it
  - But deliver:false → runtime does NOT auto-deliver
  - And currentChannelId is unset → message tool with no args fails ("Action send requires a target")
  - And nobody else is watching to deliver this text
   │
   ▼
Main's final synthesis is sitting in the session transcript, undelivered
```

The conflation point is in two places (both in 4.20 and 5.7):

`subagent-announce-C06jI_ZN.js:154`
```js
const requesterIsInternalSession = () => requesterDepth >= 1 || isCronSessionKey(targetRequesterSessionKey);
```

`subagent-announce-delivery-ChDxBkZB.js:258`
```js
function isInternalAnnounceRequesterSession(sessionKey) {
  return getSubagentDepthFromSessionStore(sessionKey) >= 1 || isCronSessionKey(sessionKey);
}
```

Both treat cron sessions as if they were nested subagents. They aren't — cron is a top-level scheduled trigger that has its own chat target (the job's `delivery.{channel,to,accountId}`).

The same `requesterIsSubagent` flag also controls the reply-instruction template main receives via `buildAnnounceReplyInstruction` (`subagent-announce-C06jI_ZN.js:29-33`):

- For "internal subagent" requester: `"Convert this completion into a concise internal orchestration update for your parent agent in your own words. Keep this internal context private..."`
- For top-level requester: `"A completed [job] is ready for user delivery. Convert the result above into your normal assistant voice and send that user-facing update now."`

So cron-spawned subagents currently tell main to write an "internal orchestration update for your parent agent" — main has no parent agent. The instruction is wrong for cron.

#### Live trace evidence (instrumented gateway, 2026-05-08 + 2026-05-09)

Three test scenarios on a minimal repro cron:

**Scenario: empty preamble + spawn subagent + main produces text in continuation**
```
TRACE-1 dispatchCronDelivery: { skipHeartbeatDelivery: true, synthesizedTextLen: 0 }
                                ↑ outer guard skips (payloads.length===0)
TRACE-A1 sendSubagentAnnounceDirectly: { requesterIsSubagent: true, effectiveDirectOriginChannel: "bluebubbles" }
                                                                    ↑ chat target is known
TRACE-A2 gateway agent call params: { deliveryTarget: { deliver: false } }
                                                       ↑ ...but stripped due to requesterIsSubagent
TRACE-GW dispatchAgentRunFromGateway: {
  channel: "webchat",         ← defaulted
  to: undefined,              ← dropped
  sessionEntryHasChannel: false,
  sessionEntryLastChannel: undefined,
  sessionEntryLastTo: undefined
}

Main continuation transcript: "The Apple TV has been delivered..." → calls message() with no args
Tool result: { error: "Action send requires a target." }

User receives: nothing
```

**Scenario: non-interim preamble + spawn subagent**
```
TRACE-1 dispatchCronDelivery: { synthesizedTextHead: "Let me check that for you, spawning the reader now." }
TRACE-3 countActiveDescendantRuns(...) = 1, expectedSubagentFollowup = false
TRACE-4 entering wait branch
TRACE-5 resolveUsableLatestReply: {
  initialReplyHead: "Let me check that for you, spawning the reader now.",
  latestHead:       "Let me check that for you, spawning the reader now.",
  latestEqualsInitial: true,
  latestIsInterim: false,         ← doesn't match INTERIM_CRON_HINTS
  decision: "RETURN"              ← returns the preamble as the final reply
}

Cron run record: delivered: true, summary: "Let me check that for you, spawning the reader now."

User receives: a useless preamble snippet, NOT the actual answer
```

**Scenario: prompt augmented to self-deliver via message tool with explicit args (Cole's workaround)**
```
Main calls message(action=send, channel=bluebubbles, target=bluebubbles:chat_guid:any;-;<phone>, accountId=default, message=<actual answer>)
                                                              ↑ chat_guid format
Cron's resolved delivery target: <phone>                       ↑ E.164 format
matchesMessagingToolDeliveryTarget: false  ← target format mismatch, normalize doesn't equate them
skipMessagingToolDelivery: false → cron also auto-delivers

User receives: 2 messages (one from main's tool send, one from cron's auto-deliver). Plus N intermediate-text messages from main's first turn (Bug I).
```

### Impact and severity

- **Affected:** Anyone using `sessionTarget: "isolated"` cron jobs that delegate to subagents (a documented pattern per the [subagents docs](https://docs.openclaw.ai/tools/subagents) and a natural way to scope tools).
- **Severity:** High for the affected pattern. ~93% silent failure rate observed on a real-world Apple TV tracker cron over 28 runs (`d7627b2b-...`); same pattern observed across other crons (Wishlist Price Check, Daily Email Triage).
- **Frequency:** Reliably reproduces.
- **Consequence:** Any cron-driven background workflow that delegates work to subagents (the natural way to scope tools to specialized agents) silently loses delivery. Users blame channel reliability; the actual issue is internal classification.

### Additional information

#### Relationship to existing issues

- **#73813** (open): cron classifier records `status:"ok"` with short `durationMs` while subagent is still running. That's an observability bug describing the same symptom from a different angle (cron records "done" before delivery completes). My report covers the actual delivery loss.
- **#62054** (closed by `e6d04682d33c`): added the queue-fallback path for busy-parent active sessions. Doesn't address the cron-classification-as-internal issue.
- **#79053 / PR #79059** (open): different code path (`requesterActivity.isActive` early-return). Orthogonal.

#### Proposed fix (4 changes, 3 verified live + 1 needing source verification)

**Change 1: drop cron from `requesterIsInternalSession` (two places, one-line each)**

`subagent-announce-C06jI_ZN.js:154`
```diff
- const requesterIsInternalSession = () => requesterDepth >= 1 || isCronSessionKey(targetRequesterSessionKey);
+ const requesterIsInternalSession = () => requesterDepth >= 1;
```

`subagent-announce-delivery-ChDxBkZB.js:258`
```diff
function isInternalAnnounceRequesterSession(sessionKey) {
-   return getSubagentDepthFromSessionStore(sessionKey) >= 1 || isCronSessionKey(sessionKey);
+   return getSubagentDepthFromSessionStore(sessionKey) >= 1;
}
```

This restores the original intent of the filter ("nested intermediate subagents shouldn't deliver to chat") without wrongly treating top-level cron sessions as nested.

Effect on cron requesters:
- Reply instruction switches from "write internal orchestration update for parent agent" to "send user-facing update now"
- `deliveryTarget` is no longer stripped — chat channel/to/accountId propagate to the gateway agent call
- The runtime now correctly auto-delivers main's continuation reply to the chat target

**Change 2: cron's `finalizeTextDelivery` defers to announce when descendants are active**

`run-delivery.runtime-D5c9lsGd.js:391` (and equivalent in 5.7's `run-delivery.runtime-Cbm9rJpU.js:432`):
```diff
const finalizeTextDelivery = async (delivery) => {
+   const subagentRegistryRuntime = await loadDeliverySubagentRegistryRuntime();
+   const activeSubagentRunsAtStart = subagentRegistryRuntime.countActiveDescendantRuns(params.agentSessionKey);
+   // When descendants are active, defer delivery to the announce flow which will
+   // wake main with subagent results; runtime auto-delivers main's continuation.
+   // This is correct because cron's path can never observe main's continuation
+   // reply (cron exits before the announce wake fires), so any delivery cron
+   // attempts here is necessarily based on stale/incomplete data.
+   if (activeSubagentRunsAtStart > 0) {
+     return params.withRunSession({ status: "ok", summary, outputText, deliveryAttempted: false, ...params.telemetry });
+   }
    if (!synthesizedText) return null;
    const initialSynthesizedText = synthesizedText.trim();
    const expectedSubagentFollowup = expectsSubagentFollowup(initialSynthesizedText);
-   const subagentRegistryRuntime = await loadDeliverySubagentRegistryRuntime();
-   let activeSubagentRuns = subagentRegistryRuntime.countActiveDescendantRuns(params.agentSessionKey);
+   let activeSubagentRuns = activeSubagentRunsAtStart;
    ...
```

This kills several existing bugs as collateral:
- The wait function returning the initial preamble as "final" (the polling loop's narrow `INTERIM_CRON_HINTS` matching)
- The 5-second grace period being too short for main's continuation
- Cron delivering intermediate text payloads from main's first turn

Cron's path becomes responsible only for the synchronous case (main produces full answer in turn 1, no `subagent_yield` for the answer — e.g., the wishlist pattern). When descendants are active, announce owns delivery.

**Change 3: persist cron's `delivery.mode` on the cron session entry, then gate `deliveryTarget` on it**

This is the only change in the set that requires touching more than one file because `expectsCompletionMessage` (the obvious-looking flag) is **not** mode-aware — it defaults to `true` and is only flipped by the spawning agent's `sessions.spawn` arguments (`openclaw-tools-CaaMSBf3.js:6810`). It does not differ between `mode: "announce"`, `mode: "none"`, and `mode: "webhook"` cron jobs.

The cleanest fix is to persist the cron's `delivery.mode` on the cron session entry at run start, then read it back in the announce flow:

`run-session-state-DbyWQbGl.js` — extend `createPersistCronSessionEntry` to write a `cronRunnerDeliveryEnabled` field (`true` only for `delivery.mode === "announce"`):
```diff
  const sessionEntry = {
    sessionKey,
    parentSessionKey,
    sessionTarget,
    accountId,
    model,
    cronJobId: input.job.id,
+   cronRunnerDeliveryEnabled: input.job.delivery?.mode === "announce",
    // ...
  };
```

`subagent-announce-delivery-ChDxBkZB.js:492` — load the requester entry and gate `deliveryTarget` on the new flag:
```diff
+ const requesterEntry = loadRequesterSessionEntry(params.targetRequesterSessionKey).entry;
+ const isCronWithoutRunnerDelivery = isCronSessionKey(params.targetRequesterSessionKey)
+                                     && requesterEntry?.cronRunnerDeliveryEnabled !== true;
- const deliveryTarget = !params.requesterIsSubagent
+ const deliveryTarget = (!params.requesterIsSubagent && !isCronWithoutRunnerDelivery)
    ? resolveExternalBestEffortDeliveryTarget({...})
    : { deliver: false };
```

And the parallel `normalizedSessionOnlyOriginChannel` line (498) needs the same gating.

This honors `delivery.mode`:
- `mode: "announce"` cron → `cronRunnerDeliveryEnabled: true` → runner delivers ✓
- `mode: "none"` cron → `cronRunnerDeliveryEnabled: false` → runner stays silent, agent owns delivery via message tool ✓
- `mode: "webhook"` cron → `cronRunnerDeliveryEnabled: false` → runner stays silent, webhook handles ✓
- External user→main (not a cron session) → `isCronSessionKey === false` → unchanged ✓
- Nested subagent (depth ≥ 1) → `requesterIsSubagent: true` → `deliver: false` (unchanged from Change 1)

**Gap 1 status (verified)**: I initially proposed gating on `expectsCompletionMessage`, but live source-trace shows the flag is not mode-aware — it's `params.expectsCompletionMessage !== false` at the spawn site, defaulting to true regardless of cron mode. The persist-and-read mechanism above is the smallest change that actually distinguishes cron modes.

**Change 4: extend `didSendViaMessagingTool` dedup to `deliverAgentCommandResult` (defense in depth)**

`delivery.runtime-5-1bY-d7.js:231`:
```diff
+ const didSendViaMessagingTool = result?.didSendViaMessagingTool === true;
+ const messagingToolMatchedTarget = didSendViaMessagingTool 
+   && (result.messagingToolSentTargets ?? []).some(t => 
+        matchesMessagingToolDeliveryTarget(t, { 
+          channel: deliveryChannel, 
+          to: deliveryTarget, 
+          accountId: resolvedAccountId 
+        }));

- if (deliver && deliveryChannel && !isInternalMessageChannel(deliveryChannel)) {
+ if (deliver && deliveryChannel && !isInternalMessageChannel(deliveryChannel) && !messagingToolMatchedTarget) {
    if (deliveryTarget) await deliverOutboundPayloads({...});
  }
```

This extends the existing `skipMessagingToolDelivery` dedup logic from `finalizeCronRun` (cron's first-turn path) to `deliverAgentCommandResult` (announce wake's continuation-turn path). Without this, a model that habitually calls `message` tool to the same target during the continuation turn would produce duplicate deliveries even after Changes 1–3 (because Changes 1–3 instruct the announce wake to auto-deliver the reply, but if the model also calls `message` tool, both fire).

**Gap 2 status (verified)**: a live test cron run was instrumented to capture `messagingToolSentTargets` at `finalizeCronRun`. Result:
```json
{"runDidSendViaMessagingTool":false,"messagingToolSentTargets":[]}
```
This was for a job whose subsequent continuation turn DID call `message` tool. The reason `messagingToolSentTargets` is empty here is that cron's first-turn path finalizes BEFORE the continuation turn runs — cron has no visibility into the message tool calls the continuation will eventually make. So the `skipMessagingToolDelivery` logic in `finalizeCronRun` is structurally unable to dedup against the continuation's tool calls.

This means **Change 2 (cron defers when descendants active) is what actually prevents the duplicate-delivery symptom in production**, not the dedup. With Change 2, cron's first-turn path stays silent when there's a continuation coming, leaving delivery entirely to the announce wake. Change 4 above is then defense-in-depth for the narrower case where the announce wake's continuation turn ALSO calls the message tool against the same target — reasonable code hygiene, but not the primary mechanism.

The bluebubbles target normalizer (`normalizeBlueBubblesMessagingTarget` in `probe-BV33FmEj.js:354`) was source-verified to correctly equate `bluebubbles:chat_guid:any;-;<phone>` and `<phone>` formats — both reduce to `"<phone>"`. So when Change 4 does fire, the dedup match works.

#### Verification

All four changes have been applied to a running OpenClaw 2026.4.20 gateway and validated end-to-end across this scenario matrix (each test sent exactly one observed message to the user, confirmed by direct chat inspection):

| Scenario | Before | After all four changes |
|---|---|---|
| `mode: "announce"` cron + subagent + text reply (no `message` tool in prompt) | Silent loss (or preamble delivered as final) | Single delivery via announce wake ✓ |
| `mode: "announce"` cron + subagent + `message` tool (explicit args in prompt) | Often duplicates: cron auto-delivered preamble + tool delivered final | Single delivery via tool; cron defers; announce wake dedups ✓ |
| `mode: "announce"` cron, no subagent (synchronous reply) | Worked | Still works (Change 2 no-op for `descendants === 0`) ✓ |
| `mode: "none"` cron + subagent + `message` tool | Worked, but cron's runner could spuriously deliver intermediate texts | Runner stays silent (Change 3); only `message` tool delivers ✓ |

The patched gateway has run unattended in production for 22+ hours covering wishlist, email-triage, and evening-brief crons with no observed regressions and the expected `delivered:false fb:true` signature on the cron run records (cron's path correctly defers, announce wake / `message` tool owns delivery).

#### What this fix does NOT break

- Nested subagent chains (depth ≥ 1): unchanged — `requesterDepth >= 1` check preserved
- Cron with `sessionTarget=main`: unchanged — different code path (cron uses sendMessage to main's session, not isolated agent run)
- Cron with `mode: "webhook"`: Change 3 keeps runner silent (`cronRunnerDeliveryEnabled=false`), webhook delivery unchanged
- Cron with `mode: "none"`: Change 3 keeps runner silent, agent owns delivery via message tool (per docs)
- Existing prompts that explicitly call message tool: Change 4 prevents double delivery
- Cron's run record `delivered` field: now `false` when descendants are active and delivery is deferred to announce. This is more honest (cron didn't deliver itself; announce did). Tools/dashboards reading the record may need to also check the chat for confirmation, or read the new `delivery.fallbackUsed` signal.

#### Local patch (for users who want the fix before upstream merge)

A standalone patcher that applies all four changes to the OpenClaw `dist/` bundle is published at https://github.com/coletaylor788/puddles/tree/main/docs/openclaw-setup/patches alongside the same architectural rationale captured here. It works as follows:

- `apply-cron-announce-fix.mjs` — pure Node patcher. Locates target files by content signatures (not hash-suffixed names) so it tolerates rebuilds within the same release. Idempotent. Embeds `FIX4-Cn` markers in patched files. Writes `.bak.fix4` backups on first apply.
- `apply-and-deploy.sh` — Mac mini wrapper that invokes the patcher, mirrors patched files into `~/.openclaw/plugin-runtime-deps/openclaw-<ver>/dist/`, clears the node compile cache, and restarts the gateway LaunchAgent.
- `README.md` — full procedure including verification, reverting via the `.bak.fix4` backups, and what to do when an OpenClaw upgrade changes the surrounding code (the patcher fails loudly with the unmatched signature; signatures are then either updated or — once upstream merges — the patcher is removed entirely).

The patches in that repo produce byte-identical output to what was used to generate the verification traces above.

#### What this fix does change (intended)

- The reply instruction main receives in the announce wake switches from "write internal orchestration update" to "send user-facing update now". Main may produce slightly different (more user-facing) text. Functionally correct for cron.
- Cron jobs with subagents that previously needed the `--message` to instruct main to call `message` tool with explicit args no longer need that. Auto-routing works.

I'm tagging `@tyler6204` per CONTRIBUTING.md (cron + subagents + iMessage maintainer). Happy to open a PR with the verified changes after the two open gaps are confirmed.

---

## Notes for Cole (not part of submission)

- Personal data scrubbed: phone → `<phone-redacted>`, real cron content paraphrased
- **Both open gaps verified** (2026-05-09):
  1. `expectsCompletionMessage` is NOT mode-aware — it defaults to `true` and only changes via `sessions.spawn` args. Change 3 was rewritten to use a new persisted `cronRunnerDeliveryEnabled` flag on the cron session entry instead.
  2. `messagingToolSentTargets` for cron's first-turn finalize is empty when main calls `message` tool only in the continuation turn (after announce wake). The dedup gap was real but Change 2 is what actually fixes the duplicate-delivery production symptom — Change 4 is defense in depth for the narrower continuation-also-calls-message-tool case. Bluebubbles target normalizer correctly equates the two formats per source.
- Real-behavior-proof requirement applies to PRs not issues, but this report includes structured trace evidence anyway because it's exactly what the bug template asks for
- If we want to also include Bug I (intermediate messages from main's chatty first turn) and Bug DUPE explicitly, can add them as additional findings, but Cole's pragmatic call is to keep the report focused on the architectural classification issue (and Change 2 + Change 4 already address the duplicate-delivery surface)
