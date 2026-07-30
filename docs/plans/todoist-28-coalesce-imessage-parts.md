# Coalesce split iMessage message parts

- **Status:** Proposed - independently reviewed; landing in progress
- **Issue:** https://github.com/coletaylor788/puddles/issues/28
- **Last updated:** 2026-07-30
- **Owner:** Cole Taylor

## Human design

### Problem

The deployed iMessage coalescer fixes split text, link, image, and trailing-text
compositions, but it waits before starting some turns. With the current live
configuration, ordinary complete messages remain immediate; short unfinished
lead-ins can wait up to seven seconds and narrowly payload-referential questions
can wait up to fifteen seconds. Model work starts only after that hold, so a
classified message pays both the composition window and normal response time.

Cole proposed starting promptly, then checking for newer input before replying.
OpenClaw's default queue mode is `steer`, but steering is not an in-progress
prompt update. The embedded agent consumes queued steering only after the current
assistant/tool turn finishes, after that stale turn's events may already have
entered agent state. The production steering contract also does not carry
images. Existing steering therefore cannot safely reconcile a split composition
inside one active reasoning branch.

There is also an unavoidable limit: the gateway cannot know that a future part
will arrive. Guaranteeing one context-complete reply across an observed
12.4-second notification gap still requires retaining an absolute deadline
somewhere. The latency improvement comes from overlapping that deadline with
useful model work, not from eliminating it.

### Outcome

Replace “wait, then process” with an event-driven **overlapped composition
window** for the same narrow iMessage lead-ins:

- dispatch the first part and start the agent immediately;
- release the iMessage per-key intake lock after durable run admission rather
  than holding it until reply completion;
- keep the existing absolute 7/15-second composition deadline running in
  parallel;
- admit correlated later text, links, images, and trailing text into the same
  logical turn while it is still open;
- permit speculative reasoning and read-only work, but commit no tool mutation,
  approval, block reply, direct message-tool send, or other visible effect before
  the composition seals;
- keep speculative assistant/tool transcript output in a versioned branch rather
  than canonical session history, promoting only the winning sealed version;
- hold only the candidate final delivery when it finishes before the deadline;
- deliver as soon as the deadline closes and all admitted input is reflected in
  the final answer; and
- preserve one user-visible reply when a correlated part lands during the
  active-run/final-delivery race.

This changes no-payload classified-message latency from approximately
`composition wait + agent time` to `max(composition wait, agent time)`. When a
later correlated part arrives, the safe replacement branch begins from the
latest admitted input, so response time is approximately `part arrival +
replacement agent time`; earlier speculative work may be discarded. Complete
unrelated messages keep their current immediate path.
The delivery guarantee is at-most-once, not exactly-once: because the current
iMessage adapter cannot reconcile an unknown send after a process crash, a crash
between platform acceptance and local acknowledgement can omit the reply rather
than risk duplicating it. Adding transport reconciliation is a separate
prerequisite for a stronger guarantee.
Production remains unchanged until Cole approves an implementation.

### Approach

Use events and existing run coordination rather than polling Messages.app.

1. The iMessage monitor keeps the current account/conversation/sender key,
   lead-in/payload/continuation classifier, source-order bounds, replay keys, and
   first absolute deadline, but durably admits and dispatches the lead-in
   immediately. Its per-key ingest chain ends after admission, not after the
   agent reply, so later parts can reach the active operation.
2. Active-mode eligibility is decided before any pre-seal plugin hook runs.
   Every reachable hook must declare itself pure/read-only or advertise and honor
   the same fail-closed effect barrier; otherwise that turn uses the existing
   buffered path. Effectful fire-and-forget hooks are not eligible because their
   barrier cannot be proven; pure telemetry hooks may remain asynchronous.
   Typing indicators and ordinary read receipts are explicitly exempt
   non-content signals; they cannot deliver answer text, media, tool output, or
   approval.
3. A provider-neutral composition-run coordinator accepts a structured inbound
   envelope, not text alone. It carries ordered prompt text, images, source
   message identity, replay ownership, and reply context. Admitted source rows
   remain in the durable composition record rather than being appended to
   canonical session history while the composition is open.
4. Each eligible turn has an input version and three phases:
   `accepting`, `sealing`, and `delivered`. A correlated part claimed before the
   seal increments the version. Finalization may deliver only when the version
   it answered is still current and the absolute composition deadline is closed.
5. A pre-seal commit barrier permits model reasoning and known read-only tools
   but blocks every unknown or mutating tool, approval request, streamed block,
   direct message-tool send, and other external or visible effect. If input
   changes while a planned effect is waiting, that uncommitted plan is discarded
   and regenerated from the new version.
6. Every input version runs in an isolated speculative branch forked from the
   same canonical session history plus all source parts admitted so far. Model,
   assistant, and read-only tool events stay in that branch. They do not enter
   the live `AgentSession` event stream, transcript, memory extraction, or
   compaction before seal.
7. A newer correlated text, link, image, or trailing-text part increments the
   input version, invalidates and cancels only the side-effect-free speculative
   branch, and starts a replacement branch from canonical history plus every
   admitted part in source order. A short internal restart coalescing interval
   may collapse parts that arrive together, but it cannot extend the first
   absolute deadline. Because pre-seal mutations and canonical writes are
   blocked, replacement can repeat reasoning and read-only work without
   duplicating effects. Existing `steer` remains only for genuinely separate
   messages after the composition boundary; it is not used to update a
   speculative composition branch.
8. When the deadline closes, sealing atomically claims the current version. If
   that branch is complete, its combined user turn and winning assistant/tool
   suffix are promoted together into canonical history. If it is still running,
   it may continue but any newly admitted pre-seal version invalidates it. A part
   that wins the admission race during sealing reopens replacement synthesis;
   a row that loses the atomic deadline/seal boundary follows normal queue
   behavior. A failed winning branch emits one deterministic context-complete
   failure notice rather than releasing an older stale answer.
9. A durable unresolved-composition record links replay claims, canonical base
   revision, input version, deadline, speculative branch generation, and delivery
   disposition. Restart recovery resumes records that have not entered outbound
   delivery. A record whose platform send outcome is unknown becomes
   `delivery_unknown`, is never blindly retried, and surfaces a local diagnostic;
   this preserves at-most-once delivery at the cost of a possible omitted reply.
10. A part claimed after the absolute deadline follows normal queue behavior.
   Genuinely separate messages are never marked as composition continuations and
   retain the normal `steer` or follow-up policy.

Do not implement “check once before send” as a database poll. It cannot repair an
already generated answer, duplicates the monitor's ownership, and still races a
part arriving one instruction later. Do not cancel and restart an ordinary
active run: tools or transcript events may already have committed. Restart is
safe only for the new isolated speculative branch while its mutation,
canonical-history, and delivery barriers remain closed.

### Safety and rollout

This cycle is investigation and proposal only. Do not change patches, runtime
configuration, cron, production packages, gateway state, Messages data, or
delivery behavior. Do not send test messages.

A later implementation should be opt-in behind a new iMessage strategy value so
the known-safe buffered mode remains available. It must preserve the first
absolute deadline, current row/character/attachment limits, replay and catchup
ordering, command and malformed-anchor fail-open behavior, and at-most-one
visible reply outside the documented unknown-send crash boundary. Unknown tools
are treated as mutating before seal. Unknown writes remain denied in tests.
Speculative assistant/tool events cannot enter canonical transcript history
before seal. Unsupported pre-seal hooks force the buffered path before any hook
invocation.
Promotion uses the existing exact-byte lifecycle. A durable circuit breaker
quarantines implicated active records and returns new turns to buffered mode
after a machine-detectable invariant breach. Package rollback is allowed only
after admission stops and every new-format record is terminally resolved; it
then restores the retained package/service snapshot without rewinding runtime or
cron state.

Quarantine is keyed and exclusive. Once an operation is quarantined, neither
active-mode nor buffered-mode dispatch may run or steer on that key. New input is
durably queued outside the active run until quarantine reaches a terminal state.

## Agent details

### State

The original feature is landed and healthy on exact-byte deployment
`73b08dc8-5c4d-40ed-808a-d46ee0eaa45d`, marker SHA-256
`cf9933e69bd2d7fda0ba164a5d3a290f9a9bb454d7ad8c90f0d4334b17029983`.
The public iMessage candidate
`5b771f91b9c949c8752b29b2c16c004bb5e2a8ce` and dependent private hardening
candidate `1915cc147cdb13c656270dfc5d04d718aedc256c` are landed. The retained
recovery snapshot is
`~/.openclaw/deploy-snapshots/20260730T104410Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`.

Read-only configuration inspection found:

- `channels.imessage.coalesceSameSenderDms=true`;
- `channels.imessage.includeAttachments=true`;
- no explicit iMessage/global inbound debounce; and
- no explicit global/iMessage queue mode or queue debounce.

The maintained patch therefore supplies the seven-second compatibility window
and fifteen-second payload-referential window. OpenClaw revision
`0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c` supplies default queue mode `steer`
with a 500 ms steering debounce, cap 20, and summarize drop policy.

No implementation, deployment, rollback, or production mutation has occurred in
this design cycle.

### Scope and acceptance criteria

For the proposed later implementation:

- Ordinary complete iMessages start and deliver with no composition hold.
- Eligible short or payload-referential lead-ins start model work immediately.
- Their first absolute 7/15-second deadline is never extended by later parts.
- Text-link, image-caption, and exact text-link-text compositions produce one
  context-complete visible reply in source order.
- Starting work early does not permit a stale reply to escape before a
  pre-deadline correlated part is incorporated.
- Correlated input durably admitted before sealing survives replay/catchup and
  process interruption without duplicate or lost turns.
- The iMessage intake lock is released after durable turn admission, allowing a
  later part to reach an unresolved active operation.
- Before seal, no mutating tool, approval, block stream, direct message-tool
  output, or other visible effect can commit.
- Speculative assistant and tool transcript output cannot enter canonical
  history; only the winning sealed version is atomically promoted.
- Any pre-seal hook without explicit pure/read-only or effect-barrier capability
  forces that turn onto the buffered path before any hook runs.
- A stale branch remains suppressed even when its current replacement fails;
  one explicit composition failure disposition is visible instead.
- A crash-unknown iMessage send is never retried blindly; the system may omit
  that reply but cannot duplicate it.
- Genuine separate messages, controls, reactions, groups, outgoing echoes,
  malformed anchors, and post-deadline rows preserve current behavior.
- No ordinary active run is cancelled and restarted after effects or canonical
  transcript writes may have begun; only isolated pre-seal speculative branches
  are replaceable.
- The design is provider-neutral above the iMessage classifier and supports
  multimodal active-turn input without provider-specific APIs.
- The implementation is opt-in, cumulatively tested, remotely reviewed,
  promoted through the exact-byte lifecycle, and automatically rolled back on
  health, context, duplicate-reply, or latency-gate failure.

This proposal itself is complete when it is independently reviewed, landed, and
handed to Cole without production changes.

### Architecture and decisions

Current behavior and reusable primitives:

- The iMessage patch classifies `lead-in`, `payload`, `continuation`, and
  `instant` rows. Only lead-ins wait; complete unrelated messages are instant.
- A payload-referential default-path lead-in gets 15 seconds; a short unfinished
  lead-in gets 7 seconds. Explicit inbound timing overrides both, and zero is
  immediate.
- The production reply queue defaults to `steer`. A later text message reaching
  `runReplyAgent` while the same session is active is queued, but
  `AgentSession.steer()` consumes it only after the current assistant/tool turn
  has finished. By then stale events can already be part of active agent state.
  Steering therefore remains suitable for normal follow-up policy, not for
  replacing a speculative composition prompt.
- Transcript-commit waiting and user-turn transcript recorders already exist,
  but current `AgentSession` execution is not an isolated branch that can safely
  discard an already-produced suffix.
- `ReplyBackendQueueMessageOptions` and the embedded steering target carry text
  only; current-turn image data is not accepted. A fresh replacement run can use
  the normal multimodal initial-prompt contract instead of extending steering.
- The foreground reply fence already waits for newer active generations and
  suppresses an older payload only after a newer visible generation wins.
- The current channel inbound debouncer serializes each key through completion
  of `onFlush`, and the iMessage flush awaits `handleMessageNow`; overlap
  therefore requires a new admission boundary rather than merely changing the
  timer.
- Replay dedupe, follow-up message-id dedupe, reply-operation registration,
  abort primitives, and per-session queue ownership already exist.
- The production iMessage adapter does not implement unknown-send
  reconciliation, and outbound recovery correctly refuses blind replay.
- `before_dispatch` can handle a turn before the normal agent run exists, so the
  active-mode capability gate must run at channel-turn admission rather than
  trusting only a returned payload.
- `message_received`, prompt, model, tool-lifecycle, claiming, and dispatch hooks
  can all run before seal. Fire-and-forget execution is safe only for hooks
  declared pure/read-only; every effectful hook must be awaited behind the
  barrier or active mode is ineligible.
- The embedded agent persists assistant transcript output before downstream
  delivery, so delivery suppression alone cannot remove a stale answer from
  canonical history.

Recommended state ownership:

- **iMessage composition state:** owns correlation key, source rows, replay keys,
  current part anchor, absolute deadline, and whether a row is a true
  continuation.
- **Provider-neutral composition-run coordinator:** owns the canonical base
  revision, active input version, `accepting/sealing/delivered` phase, branch
  cancellation, and replacement generation.
- **Durable unresolved-composition record:** owns crash recovery from initial
  admission through `delivered`, `failed`, or `delivery_unknown`.
- **Speculation commit barrier:** owns whether tool or delivery effects may
  execute for the current input version.
- **Speculative transcript branch:** durably owns the combined source prompt and
  model, assistant, and read-only tool events for one input version. It is
  isolated from the live `AgentSession`; only the sealed winner is atomically
  promoted to canonical session history. Abandoned versions are never visible
  to later turns.
- **Composition invalidation fence:** owns which candidate may become visible;
  unlike the general foreground fence, invalidation does not depend on a newer
  visible success.
- **Follow-up queue:** owns genuinely separate or post-deadline input that is not
  part of the open composition.
- **Circuit breaker/quarantine:** immediately blocks delivery for every record
  implicated in an invariant breach, stops new active-turn admissions, and
  blocks all dispatch and steering on each implicated key. New rows wait in a
  durable quarantine queue; only records with proven ownership may drain.

The seal is an atomic ownership boundary. An inbound row either increments the
active version before seal or is assigned to normal post-deadline queue policy;
it cannot be acknowledged in neither place or both. A branch whose answered
version is stale cannot promote or deliver. Replay disposition and unresolved
reply ownership transition together in durable state before ingress
acknowledges the row. Outbound intent becomes durable before platform send.
Without transport reconciliation, a crash after possible platform acceptance
records `delivery_unknown` and does not retry.

Buffered mode is a strategy fallback, not a quarantine bypass. It may accept a
key only after the quarantined operation is terminal and active-run registration
for that key is cleared.

Canonical transcript promotion and composition sealing are one durable
transaction. A crash may leave a recoverable speculative branch or a promoted
winner, but never a canonical stale suffix plus an unresolved newer version.

Options considered:

| Option | Decision | Reason |
|---|---|---|
| Reduce the 7/15-second window | Reject | Known link notifications arrived after 5.3 and 12.4 seconds; shortening the bound reintroduces split replies. |
| Poll Messages.app immediately before send | Reject | The answer is already frozen, monitor ownership is duplicated, and the send boundary still races. |
| Use existing text steering only | Reject | It is consumed after the current turn, misses images, and cannot discard stale active-session events. |
| Interrupt and restart an ordinary active run | Reject | It can duplicate tool side effects and leave stale canonical transcript state. |
| Always make a second visible follow-up turn | Reject | It preserves the original confusing two-reply behavior. |
| Overlap the deadline with isolated versioned branches, restart only side-effect-free speculation, and durably seal the winner | Recommend | It hides the wait when input does not change, accepts normal multimodal prompts, prevents stale branch state from becoming canonical, and preserves at-most-one visible reply except for explicitly unknown transport delivery. |

Residual tradeoff: a fast direct answer can still wait until the absolute
deadline because future input is unknowable. Mutating work may also wait for the
seal; reducing conversational latency must not speculate irreversible effects.
Read-only model/tool work can overlap the window. A later implementation must
classify known tool effects through the established mutation metadata and treat
unknown effects as blocked. A late part discards earlier speculative compute and
starts replacement synthesis, so this design improves perceived latency but can
increase model/read-only-tool cost. The existing part cap plus a bounded,
non-deadline-extending restart coalescer limits churn.

### Implementation

If Cole approves:

1. Add an opt-in active-turn strategy alongside the current buffered iMessage
   strategy; keep buffered behavior as the default during validation.
2. Add an admission-time capability scan for every hook reachable before seal:
   message-received, claim, prompt/model, dispatch, tool-lifecycle, and reply
   hooks. Each must declare pure/read-only or fail-closed barrier support.
   Unsupported hooks select buffered mode before any hook runs. Pure telemetry
   may remain fire-and-forget; effectful hooks must be awaited with the barrier
   token. Typing/read receipts remain exempt non-content signals.
3. Refactor the iMessage classifier to open an absolute composition record while
   durably admitting its lead-in immediately. Split the current debounce
   ownership so the per-key intake chain is released after admission while the
   reply operation continues independently.
4. Add a provider-neutral composition-run coordinator that snapshots canonical
   session history, builds one ordered multimodal initial prompt from every
   admitted source part, and starts an isolated branch for the current input
   version. Do not append open-composition input or branch output to the live
   `AgentSession`.
5. On a correlated admission, atomically increment the version, invalidate and
   cancel the prior isolated branch, and start a replacement from the same
   canonical base plus all admitted text/images. Coalesce only near-simultaneous
   restart requests within a bounded internal interval that never changes the
   first absolute deadline. Keep existing steering solely for unrelated
   post-composition queue behavior.
6. Add a pre-dispatch/pre-run commit barrier. Reuse established tool-mutation
   metadata, block unknown/mutating tools and every visible delivery path, and
   invalidate uncommitted planned effects when the input version changes.
7. Add durable versioned speculative transcript branches for assistant, model,
   and read-only tool events. Ensure branch events never enter the live session,
   memory, or compaction inputs. Atomically promote the combined user turn and
   sealed winning suffix into canonical history and discard stale branches
   across restart.
8. Add versioned `accepting/sealing/delivered` state and a
   composition-specific stale-candidate invalidation fence.
9. Define one atomic admission/seal boundary. A correlated part admitted before
   it reopens replacement synthesis even if the old branch emitted
   `message_end`; a row after it follows normal queue policy. On winning-branch
   failure, emit one deterministic composition failure notice and never release
   an older candidate.
10. Persist unresolved composition/outbox ownership together with replay
   disposition. Resume replacement synthesis, promotion, delivery, or explicit
   failure after restart. Mark unknown platform sends `delivery_unknown` and
   never replay them without a future iMessage reconciliation capability.
11. Add a durable active-turn circuit breaker that stops admission, immediately
    fences implicated records, and blocks all active and buffered dispatch plus
    steering on implicated keys. Queue new rows durably outside the composition,
    clear its registration at terminal quarantine, then admit queued rows under
    buffered mode. Drain only records whose ownership remains proven.
12. Add a rollback drain gate: disable admission, terminally resolve or
    quarantine all active-turn records, verify zero unresolved new-format
    ownership, and only then permit predecessor package installation.
13. Document configuration, content-free metrics, canary gates, rollout
    thresholds, and rollback.

No executable work starts before design approval.

### Validation

The later implementation must add focused OpenClaw tests and register them in
`packages/e2e/openclaw-patch-suite.json`, then pass
`node packages/e2e/bin/openclaw-test-env.mjs ci`.

Required deterministic scenarios:

- complete text remains immediate;
- lead-in model work begins before the 7/15-second deadline;
- a second part reaches the active operation while the first reply promise
  remains unresolved through the real inbound debouncer;
- no payload arrives and a fast candidate releases exactly at the deadline;
- no payload arrives and a slow candidate releases immediately after completion;
- link text arrives during model generation, invalidates the old branch, and is
  present in the replacement branch's combined prompt;
- trailing text arrives during a read-only tool step, cancels the old branch,
  and is reflected in the replacement final output;
- image arrives during the active run and retains image order and prompt context;
- correlated input arrives while the run is sealing;
- correlated input arrives after `message_end` but before seal/delivery, and no
  stale assistant or tool event appears in the replacement provider prompt or
  canonical transcript;
- correlated input arrives exactly at and just after the absolute deadline;
- speculative branch cancellation succeeds, races completion, times out, or
  loses its worker without exposing stale state;
- replacement synthesis succeeds, fails, or is interrupted;
- multiple rapid correlated parts are restart-coalesced without extending the
  first deadline, reordering input, or exceeding the configured part cap;
- known mutating, unknown, approval, block-streaming, direct-send, and normal
  final-delivery paths remain blocked before seal;
- every pre-seal hook family is capability-scanned before invocation;
- unsupported or undeclared hooks force buffered mode before any hook runs;
- pure asynchronous hooks cannot perform effects; supported effectful hooks are
  awaited and require a valid barrier token;
- hook capability changes after admission invalidate active eligibility safely;
- stale speculative assistant/tool output never enters canonical transcript
  history, later prompt context, memory extraction, or compaction;
- the winning branch promotes atomically with seal across restart;
- typing and read-receipt exemptions cannot carry reply content or media;
- input changes while a mutating tool plan waits and no stale effect executes;
- replay/catchup restart occurs before and after winning-branch promotion;
- crashes occur before and after durable admission, branch replacement, replay
  disposition, sealing, canonical promotion, candidate persistence, and visible
  delivery;
- crashes occur before, during, and after speculative transcript promotion;
- recovery yields one resumed reply or one explicit failure, never a lost or
  duplicated turn before outbound platform acceptance;
- crash before send retries safely, crash after acknowledged send does not
  retry, and crash with unknown send outcome records an omission-risk diagnostic
  without duplicate delivery;
- a failed or silent replacement never releases a stale predecessor branch;
- two simultaneous compositions on one key serialize without sharing versions;
- two accounts/conversations/senders remain isolated;
- genuinely separate rapid messages preserve normal queue policy;
- commands, reactions, groups, echoes, malformed anchors, row caps, media caps,
  and cursor ordering remain unchanged;
- no path emits two visible replies for one correlated composition;
- recording mocks reject all unknown writes and no live delivery occurs;
- rollback with unresolved records is rejected; drain/quarantine permits
  rollback only after zero unresolved new-format ownership remains.
- every circuit-breaker trigger persists across restart, quarantines the
  implicated key, blocks active and buffered steering/dispatch, and releases
  durably queued rows only after terminal cleanup;
- gateway health, iMessage health, replay conflict, cross-key admission,
  duplicate intent, restart overflow, unresolved timeout, context-version
  mismatch, and p95 latency each trigger deterministic breaker coverage; and
- all new durable composition, transcript-branch, quarantine, and breaker state
  is absent before predecessor package rollback.

Latency assertions should prove:

- complete messages add no new wait;
- classified no-payload messages take roughly
  `max(agent duration, composition deadline)`, not their sum; and
- a late correlated part never extends the first absolute deadline; the expected
  time is its arrival plus replacement synthesis, not an unsupported claim that
  the already-running model can adopt it in place.

Investigation evidence was static and read-only. No managed lifecycle or
production smoke was run because no executable artifact changed.

### Rollout and rollback

After approval and green local/test gates:

1. Land the reviewed candidate remotely without enabling the new strategy.
2. Exercise the strategy in the isolated recording transport with the same
   configuration and deterministic latency/invariant thresholds intended for
   production.
3. Promote the exact candidate through
   `docs/openclaw-setup/patches/apply-and-deploy.sh` with `MINI_HOST` unset on the
   target Mac mini.
4. Validate marker, config, gateway, iMessage, locks, and no-mutation evidence
   read-only.
5. Enable the active-turn strategy only for a configured canary conversation
   scope.
6. Observe structured, content-free metrics for lead-in classification, branch
   starts/cancellations/replacements, seal races, duplicate suppression, and
   latency.
7. Automatically trip the durable circuit breaker to buffered mode on duplicate
   delivery intent, unresolved-record timeout, replay ownership conflict,
   cross-key admission, restart overflow, configured p95 latency breach,
   gateway health failure, or iMessage health failure. The breaker immediately
   quarantines implicated active records before any further delivery. All
   dispatch and steering for each implicated key remains blocked; newly arrived
   rows wait durably until terminal cleanup clears active-run ownership.
8. Expand scope only after the canary observation bound passes. A semantic
   context omission reported outside machine-detectable gates triggers the same
   documented buffered-mode rollback before diagnosis. Machine context coverage
   verifies that every admitted source message identity is present in the sealed
   input version and committed transcript; it cannot prove answer quality.

The canary scope, observation duration, minimum sample count, p95 threshold, and
maximum restart/invariant counts must be explicit configuration validated in
the isolated lifecycle; rollout cannot proceed with omitted thresholds.
Configuration and circuit-breaker rollback return new turns to buffered mode.
Package rollback first disables active-turn admission, drains or quarantines all
records to terminal states, and verifies zero unresolved new-format ownership.
If that gate cannot pass, the package remains installed in buffered mode until
records are safely resolved. Only then may the guarded lifecycle restore the
retained package and service snapshot, without restoring the old runtime tree or
rewinding cron/message state.

### Review log

- The landed buffered coalescer and exact-byte deployment lifecycle previously
  completed reusable and terminal adversarial review with no unresolved
  actionable findings.
- The replacement-marker reconciliation landed through PR #60 and final handoff
  through PR #61; Integration and CodeQL passed on both exact merges.
- The latency investigation traced the maintained patch, live non-secret timing
  settings, exact production queue/steering contracts, transcript adoption,
  foreground delivery fence, and multimodal gap.
- Independent review found that the first draft did not release the debouncer
  after admission, gate speculative side effects, suppress stale output after a
  failed successor, persist replay/reply ownership atomically, or define
  executable rollback. The proposal now includes each required boundary.
- Independent remediation review is pending before handoff.
- Remediation review then identified unknown-send delivery ambiguity,
  predecessor rollback incompatibility, incomplete circuit-breaker quarantine,
  non-executable health/context gates, and pre-run hook bypass. The proposal now
  documents at-most-once unknown-send behavior, rollback draining, immediate
  quarantine, machine context/health gates, and admission-level hook fencing.
- Final remediation review is pending before handoff.
- Final review found that hook-owned effects could precede the returned payload
  fence, quarantined operations could still accept buffered steering, and
  breaker restart tests were incomplete. The proposal now fails closed to
  buffered mode before unsupported hooks, enforces per-key quarantine across
  both strategies, and requires deterministic coverage for every breaker trigger
  and restart state.
- Clean final review is pending before handoff.
- Clean review then found that delivery suppression left stale speculative
  assistant output in canonical transcript history and that non-dispatch hooks
  could bypass the barrier. The proposal now uses durable versioned transcript
  branches with atomic winner promotion and fail-closed capability scanning for
  every pre-seal hook family.
- Terminal review then found that `AgentSession.steer()` consumes later input
  only after the current assistant/tool turn finishes, so stale events can
  already exist in active agent state before steering. The proposal now runs
  each version in an isolated speculative fork, cancels and replaces only that
  side-effect-free branch from canonical history plus all admitted input, and
  atomically promotes only the sealed winner. Existing steering is not used to
  update a composition branch.
- Fresh independent review found no actionable defects. It verified that input
  arriving after `message_end` but before seal cannot leak stale branch events
  into either the replacement provider prompt or canonical transcript. Remaining
  gaps are implementation-level validation details already represented in the
  required deterministic test matrix.
- The first immutable-candidate review found no design defect but caught that the
  branch predated PR #63 and would have reverted its review-policy files if
  merged. The proposal was rebased onto current `main` with those files
  preserved.
- Terminal review of the exact rebased candidate found no actionable defects,
  confirmed PR #63 remained byte-identical, and verified the complete safety and
  deterministic-test contract. Remote CodeQL and cumulative integration checks
  passed on that candidate; merge is pending.

### Checklist

- [x] Land and validate bounded iMessage text/link/image/sandwich coalescing.
- [x] Promote and reconcile the exact-byte production patch stack.
- [x] Reopen the task at an investigation-only design checkpoint.
- [x] Identify the exact current 7/15-second latency paths.
- [x] Trace production prompt admission, steering consumption, transcript
  persistence, follow-up fallback, and final-delivery fencing.
- [x] Compare feasible reconciliation designs and select a recommendation.
- [x] Define state ownership, race behavior, integration tests, rollout, and
  rollback.
- [x] Complete independent adversarial review of the proposal.
- [ ] Land the investigation-only plan update and pass remote documentation gates.
- [ ] Set issue #28 and Todoist to Ready for design review without deployment.
