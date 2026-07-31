# Coalesce split iMessage message parts

- **Status:** Proposal landed - ready for Cole's design review
- **Issue:** https://github.com/coletaylor788/puddles/issues/28
- **Last updated:** 2026-07-30
- **Owner:** Cole Taylor

## Human design

### Problem

Messages.app can deliver one composition as several iMessage events, and users
also send immediate corrections or additions as separate messages. The deployed
coalescer waits up to 7 or 15 seconds for selected text/link/image shapes before
starting the agent. It fixes known split compositions but adds visible latency
and cannot cover every ordinary follow-up.

The desired behavior is not speculative or message-type-specific. Each iMessage
should start normal processing immediately. If another same-conversation message
reaches OpenClaw before the response is ready to send, the active agent should
process it as the next normal user turn and reconsider its response. The reply
should be sent only after that admitted queue is empty.

### Outcome

Replace shape-specific pre-run waits with a provider-neutral
**process while open, reply when drained** rule:

- every eligible iMessage starts the normal agent path immediately;
- later text, links, images, or corrections for the same session enter the
  active agent in source order;
- normal prompts, transcript, hooks, tools, approvals, and side effects keep
  their existing semantics;
- intermediate assistant turns remain internal transcript context rather than
  separate source-conversation replies;
- the final assistant answer is delivered at most once, or a deliberate
  no-delivery result is committed, when the active inbound queue is atomically
  sealed empty together with terminal-intent commitment; and
- an event arriving after seal starts the next normal turn.

There is no quiet timer, Messages.app poll, or question/payload classifier. An
event that has not reached OpenClaw before the atomic seal cannot be predicted
and remains a later turn. Production remains unchanged until Cole approves this
revised design.

### Approach

1. Before enabling the strategy, require every eligible route to expose a
   synchronous destination-affinity key: canonical session identity plus
   canonical reply conversation/alias group. At raw observation, reserve a
   process-wide ingress ordinal on both the transport conversation lane and that
   destination-affinity gate before any await. Asynchronous anchor repair cannot
   be overtaken by another event for the same destination, while unrelated
   destinations remain independent.
2. Run a minimal raw control classifier before expensive media/transcript work.
   `/stop` and approval responses use a durable immediate-control lane that can
   bypass unresolved data preparation while atomically aborting, disposing, or
   transferring older reservations. Other events continue through the existing
   pre-agent command, reaction, hook, route, prompt, and media pipeline in order.
3. Extend the provider-neutral active-run queue contract from text-only input to
   a structured user turn carrying text, images, the prepared prompt,
   source/reply identity, hook and approval identity, transcript ownership, and
   per-turn tool-routing context. Internally, `AgentSession.steer` already
   accepts text and images.
4. Add one admission gate shared by queue insertion, normal-cycle quiescence,
   candidate preparation, and outbound-intent commitment. Every raw reservation
   blocks seal. After normal pre-agent classification, non-droppable control and
   approval reservations retain their ordered position; configured cap/drop
   policy applies only to data turns. The agent drains only the contiguous
   committed prefix, and an unresolved earlier reservation blocks later input.
   One reply operation owns one session-plus-reply-conversation key. Proven aliases
   of that destination may merge; distinct reply conversations sharing a
   transcript session serialize on the session execution lane but never share a
   candidate or delivery target.
5. Hold every automatic source-conversation delivery surface until seal,
   including final, block, commentary, tool-progress/summary, plan-update,
   hook-handled, and TTS-only payloads. The existing
   final-payload path already selects the last canonical assistant answer from
   the completed attempt; queued intermediate assistant turns remain in normal
   transcript history. Model-loop emptiness produces a versioned candidate but
   does not seal. Raw admission blocks commitment without immediately destroying
   that candidate. Classification as a new answer-relevant user/hook turn
   supersedes it and discards its staged blocks; a malformed, denied,
   reaction-only, or other no-answer terminal outcome releases its reservation
   while retaining the prior candidate. If no prior candidate exists and the
   no-answer outcome empties the gate, it creates a durable current-generation
   `suppress(no_answer)` candidate so the operation can seal without delivery. A
   normal model `NO_REPLY` or deliberate empty response similarly creates a
   versioned terminal no-delivery candidate rather than restoring stale output.
   Persist each candidate generation, disposition,
   payload/resource ownership, and invalidation before it becomes sealable, so
   restart can recover it without rerunning hooks. Candidate media uses explicit
   leases: invalidation/suppression releases idempotently, seal atomically hands
   ownership to pending delivery, and recovery reconciles only unreferenced
   orphans. Only a current durable
   delivery/no-delivery candidate and an empty gate may seal and commit a
   terminal disposition together.
6. Keep normal tool execution and external side effects unchanged. Explicit
   message-tool sends execute immediately and remain irreversible tool effects.
   Add source-route-specific committed-send evidence for automatic mode, tagged
   with the answer generation and highest covered ingress ordinal. Consult it in
   the atomic final-intent transaction, suppressing an automatic duplicate only
   for current-generation evidence on the originating route. Approval and
   command-control responses that must unblock or reconfigure processing remain
   immediate. Hook-handled automatic replies and block-stream replies join the
   versioned drain fence.
7. Write a durable queue-drain operation record before finalizing replay/cursor
   ownership. It links each source envelope to transcript adoption, pending
   reservations, durable candidate generations, explicit-send state, terminal
   seal, and the existing pending-delivery recovery context. Explicit same-route
   sends use write-ahead `prepared`, `sending`, `ack`, `failed`, or `unknown`
   state before transport invocation. Restart either resumes the unanswered
   normal turn without replaying committed effects, leaves an unadopted row
   replayable, recovers the current candidate, or emits one explicit recoverable
   failure disposition. A crash with an unknown iMessage send remains
   `delivery_unknown` and is never retried blindly.

### Safety and rollout

This cycle is proposal and investigation only. Do not change patches, runtime
configuration, the production package, gateway, cron, Messages database,
delivery behavior, or mailbox state. Do not send test messages.

A later implementation must be opt-in, capability-checked before admission, and
isolated by account/reply-conversation/session. It must preserve queue and attachment
caps, source order, commands, reactions, hooks, replay/catchup, transcript
ownership, and existing delivery recovery. A later correction can influence
subsequent reasoning and the final reply but cannot undo a tool or external side
effect already completed by an earlier normal cycle.

Explicit message-tool sends are part of that irreversible-effect boundary. They
remain immediate and can be visible before the queue drains; holding an awaited
message-tool send until seal would deadlock the agent loop and returning success
before delivery would change tool failure semantics. The one-terminal-reply
guarantee therefore covers automatic source replies. The implementation adds
same-origin-route committed-send evidence so a committed explicit source send
prevents an additional automatic reply for the same answer generation without
affecting a later correction or other-target sends.

Candidate payloads and their local media/resource leases are durable before
seal. New answer-relevant admission invalidates that durable generation
atomically. Explicit same-route sends record write-ahead intent before calling
transport: `prepared` is known-not-sent, `sending` after a crash becomes
`unknown`, `ack` suppresses a same-generation automatic duplicate, and `failed`
does not. Recovery never reruns a handled hook merely to rebuild output.

The current buffered coalescer remains the configuration rollback path.
Promotion must use the existing exact-byte lifecycle, tests must use
deny-by-default recording transports, and automated production checks must
remain read-only. On an ownership conflict, duplicate intent, unsupported
structured admission, or unresolved operation, quarantine only the affected key
and disable new queue-drain admission until recovery is explicit. Ordinary
data-turn queue-cap exhaustion applies the configured `drop:new`, drop-old, or
summarize policy after pre-agent classification and does not trigger quarantine.
Control commands and approval traffic are non-droppable. The pre-classification
reservation spool is durably bounded; capacity failure blocks seal and trips the
keyed breaker rather than silently dropping observed input.

Queue-drain enablement is rejected for an account/configuration whose possible
routes cannot produce a synchronous destination-affinity key. This is a stable
capability decision, not per-event fallback. It prevents unresolved source A from
being invisible while resolved source B targets the same operation, without
globally blocking unrelated destination C.

Configuration rollback is an atomic per-lineage cutover, not a global mode
flip. Lineages without active operations switch to buffered ownership
immediately. An active lineage keeps queue-drain admission for newly observed
events until all member operations seal, then atomically transfers its transport
and destination-affinity lanes to buffered ownership. A timed-out lineage is
quarantined with new events durably held; buffered and queue-drain dispatch never
race.

Cutover ownership follows a stable transport/destination lineage, not only the
current operation key. `/new` and `/reset` atomically transfer that lineage,
reservations, and cutover token to the successor operation; an old key cannot
release shared lanes while any successor remains active. Configuration rollback
may quarantine a lineage, but package rollback is stricter: every record must be
either known-terminal and atomically archived outside the predecessor-visible
active store or transferred into predecessor-readable buffered ownership.
`delivery_unknown` is archive-ineligible and blocks package restore until
reconciled. Otherwise the new package remains installed with queue-drain
disabled.

## Agent details

### State

The bounded text/link/image/sandwich coalescer is healthy on production
deployment `73b08dc8-5c4d-40ed-808a-d46ee0eaa45d`, marker SHA-256
`cf9933e69bd2d7fda0ba164a5d3a290f9a9bb454d7ad8c90f0d4334b17029983`.
Its retained recovery snapshot is
`~/.openclaw/deploy-snapshots/20260730T104410Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`.

PR #64 landed the independently reviewed speculative-fork proposal as
`6b23e095961ded696c23762954edee2d7d113306`. Cole rejected that processing model
and requested normal processing with continuous same-session admission and
reply only after the queue drains. This revision replaces that proposal. No
implementation, configuration, deployment, cron, message, or mailbox mutation
has occurred.

Read-only tracing against exact production OpenClaw revision
`0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c` established:

- the deployed iMessage classifier holds selected lead-ins for 7 seconds and
  payload-referential prompts for 15 seconds;
- the patched per-DM ingest chain awaits `handleMessageNow`, so it can remain
  blocked through the complete reply lifecycle;
- `agent-core` drains steering after each assistant/tool turn, appends it as an
  ordinary user turn, runs another normal cycle, then checks follow-up input;
- `AgentSession.steer(text, images, recorder)` is already multimodal, but
  `ReplyBackendQueueMessageOptions` and `EmbeddedAgentQueueHandle.queueMessage`
  expose only text;
- active steering can wait for the queued user turn's `message_end` transcript
  commit before iMessage finalizes adoption;
- attempt payload construction chooses the last current-attempt assistant
  message as the canonical final answer, so earlier assistant turns need not be
  concatenated or delivered;
- the final empty check and `acceptingSteerMessages = false` are not one
  admission transaction: a message can observe an active outer reply operation
  after the embedded backend has stopped accepting input;
- the outer reply operation stays registered through payload preparation and
  delivery, and existing follow-up admission barriers can route post-seal input
  to a later turn;
- live iMessage configuration has no block-streaming override and the agent
  default is off, so ordinary production replies already use final delivery;
  the design must still cover opt-in block streaming; and
- iMessage cannot reconcile an unknown send after process loss, so the existing
  at-most-once unknown-outcome boundary remains.

### Scope and acceptance criteria

For this revised proposal:

- Every eligible non-control iMessage starts normal processing without the
  7/15-second classifier hold.
- Same-session text and supported media admitted before seal become normal
  ordered user turns, independent of question or payload type.
- Immediate corrections affect subsequent reasoning and the final answer.
- Prompts, assistant/tool transcript events, hooks, tools, approvals, command
  lanes, and side effects preserve normal behavior.
- Every observed event reserves on its transport lane and synchronous
  destination-affinity gate before asynchronous work. Unresolved source A blocks
  resolved source B only when both can target the same session-plus-reply
  conversation; unrelated C remains independent.
- No automatic source delivery surface is emitted while admitted user input
  remains queued, processing, or awaiting atomic intent commitment.
- Hook-handled automatic replies are versioned candidates and follow the same
  admission/intent fence as agent replies.
- Every sealable `deliver` or `suppress` candidate is durably recoverable with
  its generation and resource ownership; superseding admission atomically
  invalidates it.
- Candidate media/resource leases transfer atomically to pending delivery at
  seal, release idempotently on invalidation/suppression/completion, and survive
  quarantine or unknown delivery until explicit reconciliation.
- Approval responses and command-control replies that must unblock or
  reconfigure processing remain immediate protocol traffic.
- Raw `/stop` and approval traffic can bypass a slow data-preparation head or
  saturated data spool through a durable control lane while atomically disposing
  or transferring affected reservations.
- `/stop` aborts the active operation and resolves or transfers its reservations;
  `/new` and `/reset` invalidate the old candidate and atomically transfer
  subsequent reservations to the new session; `/compact` and `/model` execute in
  source order before later user turns. Their existing command responses remain
  immediate.
- Explicit message-tool sends retain immediate normal tool semantics and suppress
  duplicate automatic source delivery only when committed to the originating
  route for the current answer generation/covered ordinal; they are documented
  exceptions to the drained automatic-reply boundary.
- Same-route explicit sends use durable write-ahead lifecycle state. `ack` and a
  crash-ambiguous `unknown` prevent a same-generation automatic send; known
  `failed` evidence does not.
- A drained operation commits at most one automatic terminal
  source-conversation reply intent or one explicit no-delivery disposition,
  outside explicit message-tool/control traffic and the documented unknown-send
  crash boundary.
- Queue-empty detection, candidate version, admission seal, and outbound-intent
  commitment are one atomic ownership decision.
- Post-seal input follows the existing next-turn/follow-up path without being
  silently absorbed or dropped.
- Accounts, conversations, senders, and sessions remain isolated.
- One operation has exactly one canonical reply destination. Proven aliases may
  merge; distinct destinations that share a transcript session run as serialized
  operations and reply only to their own routes.
- Commands, reactions, groups, echoes, malformed rows, queue caps, attachment
  caps, replay/catchup, and cursor ordering preserve current behavior.
- Configured queue-cap/drop policy applies atomically to ordered reservations;
  ordinary data-turn overflow never becomes an ownership quarantine. Commands
  and approvals remain non-droppable even at saturation.
- Unsupported structured admission fails closed before ownership transfer; it
  never degrades an adopted image into text-only steering.
- Every admitted envelope preserves its own prepared prompt, source/reply
  identity, media, hook results, approval identity, transcript recorder, and
  tool-routing context for its model cycle.
- The shared queue and drain-fence changes are provider-neutral; iMessage owns
  only source-specific envelope construction and replay/cursor finalization.
- The documentation-only revision is independently reviewed, landed, and
  returned to Cole for approval without runtime or production changes.
- Rollback performs atomic per-lineage ownership cutover: active lineages keep
  admitting through seal, inactive lineages buffer, and timed-out lineages
  durably hold input in quarantine. Operation keys are lineage members, not
  independent cutover owners.
- `/new` and `/reset` preserve cutover lineage across operation-key changes; no
  predecessor package is restored while new-format or quarantined records remain
  in the predecessor-visible active store.

### Architecture and decisions

Ownership:

- **iMessage ingress** owns source identity, synchronous destination-affinity
  resolution, canonical admission coordination,
  replay claims, cursor order, the durable bounded transport-lane sequencer, and
  construction of ordered structured envelopes. It assigns a process-wide
  ingress ordinal on a stable account/conversation key and reserves the
  destination-affinity gate before any await, then transfers an ordered prefix
  atomically to the resolved operation key; sender remains metadata.
- **Reply operation admission gate** owns the canonical session key,
  canonical reply destination, `accepting`/`candidate`/`sealed` phases,
  source-ordered reservations, candidate generation, and an awaitable state
  change shared by enqueue and final outbound-intent commitment.
- **Session execution lane** serializes distinct reply-destination operations
  that share canonical transcript state without merging their candidates or
  delivery contexts.
- **Normal agent session** owns ordinary user, assistant, and tool transcript
  events plus hooks, approvals, and effects.
- **Pre-agent dispatcher** owns normal command, reaction, hook, route, prompt,
  and media preparation for each reserved event before it becomes agent input or
  a handled candidate.
- **Immediate-control lane** owns raw-recognizable `/stop` and approval responses
  and can bypass unresolved data preparation while durably resolving affected
  reservation ownership.
- **Source reply drain fence** owns final, block, commentary, progress/summary,
  plan-update, handled-hook, and TTS-only automatic payloads until the gate seals,
  discarding every superseded generation.
- **Durable candidate store** owns generation, `deliver|suppress` disposition,
  payload references, local media/resource leases, and invalidation before a
  candidate may seal.
- **Resource lease manager** atomically transfers candidate resources to pending
  delivery, releases terminal resources idempotently, and reconciles crash
  orphans without deleting any referenced or quarantined media.
- **Existing replay and delivery state** owns crash recovery, transcript
  adoption, outbound intent, and the `delivery_unknown` boundary.
- **Source-send evidence** records committed explicit sends by originating route
  and answer generation/covered ingress ordinal in automatic mode and
  a write-ahead `prepared|sending|ack|failed|unknown` lifecycle. It participates
  in final-intent deduplication without suppressing later generations or sends to
  other targets.
- **Durable queue-drain record** links source replay ownership to reservation,
  transcript adoption, seal, recovery continuation, and final delivery state so
  adopted but unanswered turns are not lost on restart.
- **Circuit breaker/quarantine** isolates one key after an invariant failure and
  prevents queue-drain and buffered dispatch from racing for that key.
- **Cutover registry** owns per-lineage queue-drain/buffered/quarantined mode and
  changes ownership atomically only after every active operation in the lineage
  drains or transfers its durable lanes.
- **Cutover lineage** is anchored to the stable transport/destination affinity
  and spans `/new`/`reset` successor operation keys until every reservation and
  ownership token reaches buffered or terminal state.

Capability preflight derives a synchronous destination-affinity key for every
eligible source: canonical session admission identity plus canonical reply
conversation or a proven alias group. Raw observation assigns a process-wide
ingress ordinal and reserves both its account/conversation transport lane and
that affinity gate before any await. Conversation-anchor repair may refine the
reply address but cannot change affinity. A matching active operation sees the
provisional reservation; unrelated affinity keys remain unblocked.

After repair, the coordinator atomically transfers the contiguous transport
prefix to an operation keyed by canonical session plus canonical reply
destination. Multiple group senders and proven aliases of one conversation may
merge. Distinct reply destinations that happen to share a transcript session do
not merge: the session execution lane serializes their operations, and each owns
its own candidate, drain fence, source-send evidence, and delivery context. If
affinity cannot be derived synchronously, queue-drain is disabled stably for that
account/configuration rather than falling back per event.

Each reservation then runs through the normal pre-agent pipeline in source order.
Before expensive preparation, the existing command/approval parser is factored
into a raw-safe classifier with parity tests. `/stop` and approval responses use
the immediate-control lane and remain executable behind a slow data head or full
data spool. `/stop` atomically aborts the active operation and disposes or
transfers older reservations; approval responses unblock their target operation
without consuming data capacity. Classification marks all commands and approval
traffic non-droppable before applying configured queue policy to data turns.
Malformed, denied, reaction-only, and
other no-answer outcomes terminally resolve that exact reservation without
advancing the answer-relevant generation. Hook-handled output or a normal user
turn advances that generation; the latter becomes a structured active-run
envelope. The reservation becomes committed agent input only after the complete
prepared turn is available. The agent may drain only the contiguous committed
prefix from the oldest reservation, so a slow image/transcript cannot be
overtaken by later fast text. Failure releases the source row for replay or
records an explicit terminal disposition; it cannot degrade to a partial text
turn.

When a no-answer outcome has no prior candidate and resolving it empties the
gate, the same transaction creates a durable current-generation
`suppress(no_answer)` candidate. A later answer-relevant reservation can
invalidate it before seal like any other candidate. If no later input wins, it
seals to one no-delivery disposition, releases terminal resources, and makes the
operation and rollback lineage terminal.

The agent loop keeps its current turn ordering. After each assistant and its tool
calls complete, it drains steering and processes each queued user turn normally.
When steering and follow-up queues appear empty, the gate returns committed
prefix input, an awaitable pending-head result, or quiescence. Pending waits for
a gate-state signal without invoking the model or spinning. Quiescence captures
the input generation and allows final payload preparation while admission stays
open. The coordinator then atomically commits the outbound intent and seals only
if the generation is still current and no reservation is pending or committed.
If an answer-relevant reservation wins before that transaction, the prepared
candidate and staged blocks for its generation are discarded, the newly
committed prefix enters the same operation, and another normal cycle runs. A
no-answer terminal reservation only delays commitment until classification,
then leaves an existing candidate current or creates `suppress(no_answer)` when
candidate-less. After successful intent commitment, queue attempts reject
deterministically to the later-turn path.

Candidate state is `deliver(payloads)` or `suppress(reason)`. A deliberate empty
assistant answer or `NO_REPLY` creates a versioned `suppress` candidate for that
answer-relevant generation. Before the candidate is sealable, persist its
generation, disposition, payload references, and resource leases in the durable
operation record. New answer-relevant admission invalidates that generation in
the same transaction that advances generation. Recovery reuses the durable
candidate and never re-invokes a handled hook to reconstruct it. A current
`suppress` atomically seals to a no-delivery disposition when the gate is empty;
it never restores an older candidate or forces output. Invalidation and
suppression release leases idempotently after the state transaction commits.
Delivery seal hands leases to pending delivery atomically; acknowledgement or
known terminal failure releases them, while `unknown` and quarantine retain them
until explicit reconciliation. Startup orphan reconciliation deletes only
resources absent from every operation, candidate, outbox, unknown, and
quarantine reference.

The operation-owned intake endpoint remains available while the embedded model
cycle is quiescent or payloads are being prepared. It does not depend on the
attempt's closing text-only queue handle. The coordinator may start another
ordinary embedded cycle in the same reply operation and canonical session after
candidate invalidation; prior assistant/tool turns remain transcript history and
are not restarted or replayed.

Provider failure, timeout, abort, `/stop`, and early-stop hooks close admission
and atomically transfer every committed or pending reservation to the existing
later-turn recovery path or an explicit terminal disposition.

Native command transitions remain in the pre-agent lane. `/stop` immediately
aborts and resolves/transfers the operation. `/new` and `/reset` invalidate the
old automatic candidate, close its session ownership, and atomically transfer
later source sequences plus the cutover lineage/token to the new session
operation. The old key cannot transfer shared transport or affinity lanes while
that successor is active. `/compact` and `/model` execute in sequence before
later agent turns. Approval responses bypass the terminal reply fence to unblock
their waiting operation. A `before_dispatch` hook that handles an ordinary turn
produces a versioned automatic candidate rather than calling source delivery
immediately; newer admission invalidates it like an assistant candidate.

Before replay claims or catchup cursors are finalized, the durable queue-drain
record must reference the adopted transcript turn and restart recovery context.
On restart, an unadopted reservation leaves its row replayable. An adopted but
unanswered turn resumes through existing incomplete-turn/reply recovery without
repeating committed tool effects. If the runtime cannot prove a safe
continuation, it records one deterministic failure for normal delivery rather
than silently quarantining routine interruption. Quarantine is reserved for
ownership or invariant breaches.

The embedded runner already preserves all assistant/tool turns in the transcript,
returns the last current-attempt assistant as the canonical final answer, and
intentionally supports empty/`NO_REPLY` output. The implementation therefore
must not concatenate candidates or restart the model. The source drain fence
stages every automatic dispatcher surface under the answer generation: final,
block, commentary, tool progress/summary, plan update, handled-hook, and TTS-only
payloads. New answer-relevant admission invalidates and discards that
generation's automatic payloads; stale output can never survive into the next
cycle. Typing may continue as channel-owned UI.
Approval prompts, control commands, and explicit message-tool sends bypass the
terminal fence because they are awaited protocol/tool effects. Existing
message-tool accounting is extended so automatic mode records a committed send
only when its resolved target equals the originating source route, tagged with
the current answer generation and highest covered ingress ordinal. The atomic
final-intent transaction suppresses a duplicate only when `ack` or `unknown`
evidence covers the current generation. Before transport invocation, the tool
persists `prepared`, then `sending`; success records `ack`, a known rejection
records `failed`, and restart converts unresolved `sending` to `unknown`.
`prepared` is known-not-sent and may resume safely; `unknown` is never retried
blindly. A correction advances generation, so stale send evidence cannot
suppress its updated answer. Sends to other targets never suppress the source
reply.

| Option | Decision | Reason |
|---|---|---|
| Keep shape-specific 7/15-second buffering | Reject | It adds pre-run latency and cannot cover general corrections. |
| Poll Messages.app or wait for quiet before send | Reject | It duplicates ingress ownership, adds latency, and still races. |
| Restart or fork speculative model work | Reject | Cole requires ordinary processing, transcript, tools, and effects. |
| Deliver every assistant cycle | Reject | It recreates multiple confusing source replies. |
| Reuse normal steering with an atomic seal and source reply fence | Recommend | The runtime already has the required normal queue loop and canonical final-answer behavior. |

Residual behavior:

- A standalone message has no new pre-run or post-run wait.
- An event whose admission loses the atomic outbound-intent commit is a later
  turn even if Messages.app composition began earlier.
- Each queued user turn may require another normal model cycle.
- A correction cannot roll back an effect completed by an earlier cycle.
- Immediate approval/control traffic can be visible before the final drained
  answer.
- An explicit message-tool send can also be visible before drain and cannot be
  revised by later input; this preserves normal tool semantics and suppresses
  the automatic final reply only for the same originating route and covered
  answer generation. A later correction can still produce an updated reply.
- A normal `NO_REPLY` or deliberate empty result drains to an explicit
  no-delivery disposition rather than hanging or reviving stale output.
- Process loss after an unconfirmed iMessage send remains
  `delivery_unknown`; blind retry is unsafe.

### Implementation

Only after Cole approves the revised design:

1. Add an opt-in queue-drain strategy beside the buffered coalescer and require
   structured-queue, source-fence, durable transport-lane, synchronous
   destination-affinity, and canonical-route transfer capabilities before
   enabling it. Reject enablement stably when any eligible route lacks affinity.
2. Add a durable bounded account/conversation transport sequencer at raw
   observation. Assign a process-wide ingress ordinal, reserve the synchronous
   destination-affinity gate before any await, serialize route repair, and
   atomically transfer the ordered prefix to one
   session-plus-reply-conversation operation and strategy.
3. Route every reservation through the existing pre-agent command/reaction/hook
   pipeline in order. Factor a raw-safe parity-tested control classifier and
   durable bypass for `/stop` and approvals. Convert hook-handled automatic
   output into a versioned candidate; define atomic transitions for `/stop`,
   `/new`, `/reset`, `/compact`, `/model`, and approval responses.
4. Define a provider-neutral structured active-run user-turn envelope with text,
   images/media, source identity, prepared prompt, reply context, hook/approval
   identity, transcript recorder, and per-turn tool-routing context.
5. Extend `ReplyBackendHandle`, `EmbeddedAgentQueueHandle`, and queue outcome
   helpers to accept that envelope without text-only fallback; pass images to
   the existing multimodal `AgentSession.steer` path. Before each queued model
   cycle, bind that envelope's turn-local context and restore the prior context
   afterward.
6. Add the operation admission gate and source-ordered reservation accounting.
   Mark commands and approvals non-droppable after normal classification, then
   apply configured cap/drop policy only to data turns; quarantine only
   ownership/invariant or durable-spool failures. Integrate the gate's
   ordered-prefix `queued | pending-head | quiescent` result with the normal
   agent cycle. Pending awaits a state-change signal without model work.
   Quiescence keeps operation intake open through versioned payload preparation;
   candidate generation, empty gate, seal, and outbound-intent commitment form
   one transaction. Admission before commitment invalidates the candidate and
   runs another ordinary cycle; post-commit rejection uses the existing
   follow-up barrier. Terminal error, timeout, abort, `/stop`, and early-stop
   paths must resolve or transfer every reservation before closing.
   Serialize distinct reply-destination operations that share one transcript
   session without merging candidates or delivery contexts.
7. Add a source reply drain fence around every automatic dispatcher surface:
   final, block, commentary, tool progress/summary, plan update, hook-handled,
   and TTS-only payloads, versioned by answer-relevant generation. Every raw reservation
   blocks seal; only a classified answer-producing turn supersedes the candidate
   and its blocks. Preserve an existing candidate across malformed, denied,
   reaction-only, and other no-answer dispositions; when none exists and the
   no-answer reservation empties the gate, atomically create
   `suppress(no_answer)` for the current generation. Preserve immediate
   approvals, control responses, typing, explicit message-tool sends, and other
   tool effects. Add source-route-specific committed-send evidence in automatic
   mode, tagged with answer generation and highest covered ingress ordinal, and
   consult it atomically to suppress only a current same-route duplicate.
8. Represent terminal candidate state as `deliver` or `suppress`; persist
   generation, payload references, resource leases, invalidation, deliberate
   empty/`NO_REPLY`, and candidate-less no-answer suppression before seal.
   Recover candidates directly without rerunning handled hooks. Add atomic
   candidate-to-outbox lease handoff, idempotent terminal release, retained
   unknown/quarantine leases, and startup orphan reconciliation.
9. Persist a minimal durable queue-drain record before replay/cursor
   finalization. Reuse current user-turn transcript recorders, incomplete-turn
   recovery, pending final delivery, and delivery disposition to resume adopted
   unanswered turns without repeating committed effects.
10. Add write-ahead explicit same-route send state:
    `prepared|sending|ack|failed|unknown`, tagged by generation and covered
    ordinal. Persist before transport, convert crash-ambiguous `sending` to
    `unknown`, and fence automatic intent against current `ack|unknown` only.
11. Remove the queue-drain path's shape classifier and 7/15-second waits while
   retaining the existing implementation behind the rollback configuration.
12. Add keyed metrics and quarantine for ownership conflict, failed structured
    adoption, cross-session admission, duplicate terminal intent, unresolved
    operation, and delivery unknown; record configured cap/drop outcomes
    separately.
13. Add a durable per-lineage cutover registry. During rollback, inactive
    lineages transfer immediately, active lineages keep queue-drain admission
    until every member operation seals, and timed-out lineages quarantine and
    hold new input before buffered ownership. Anchor lineage identity to
    transport/destination affinity and transfer its token across `/new`/`reset`
    successor operation keys.
14. Add a package-rollback preflight that rejects every active new-format,
    quarantined, `delivery_unknown`, or nonterminal record. Before restore,
    atomically archive only known-terminal records outside the
    predecessor-visible active store and durably convert held input to
    predecessor-readable buffered ownership; otherwise keep the new package
    installed but disabled.
15. Add cumulative regressions, update patch documentation and manifest, and
    prove promotion, interruption recovery, configuration rollback, and package
    rollback in the managed test environment.

### Validation

The implementation must add focused OpenClaw tests, register every applicable
target in `packages/e2e/openclaw-patch-suite.json`, and pass:

```text
node packages/e2e/bin/openclaw-test-env.mjs ci
```

Required deterministic scenarios:

- standalone text, image, link, and ordinary question start immediately with no
  classifier hold;
- a second text is transcript-adopted while the first model cycle runs;
- a second raw event observed while first-turn adoption is blocked reserves
  before the first operation can seal;
- unresolved source A and resolved source B with the same destination affinity
  cannot reorder or let B seal first, while unrelated destination C proceeds;
- two group senders in one reply conversation retain observation order;
- proven route aliases merge, while two distinct reply conversations sharing one
  transcript session serialize as separate operations and deliver only to their
  own targets;
- images and links use the same structured queue path without media loss;
- text-link-text and correction sequences retain source order and produce one
  terminal source reply containing the latest context;
- intermediate assistant turns and tool calls remain in transcript history but
  are not automatically delivered;
- block-stream replies wait for drain, while explicit message-tool sends and
  ordinary effects execute once at their normal point; a committed explicit
  same-route source send suppresses duplicate automatic delivery, while an
  other-target send does not;
- approval prompts and responses remain immediate and do not deadlock the run;
- raw `/stop` and approval responses bypass a slow media/transcript head and a
  saturated data spool while resolving older reservation ownership exactly once;
- `/stop`, `/new`, `/reset`, `/compact`, and `/model` preserve existing
  pre-agent ordering, replies, session transitions, and exact reservation
  disposition;
- saturated data-turn caps cannot drop `/stop`, approval responses, or session
  commands before classification;
- a handled `before_dispatch` hook stages versioned output and a later correction
  invalidates it before delivery;
- crash after durable handled-hook `deliver` or model `suppress` candidate and
  before seal recovers that candidate without rerunning hooks or losing resource
  ownership;
- supersession, suppression, seal handoff, delivery acknowledgement, known
  failure, unknown outcome, quarantine, and restart release or retain sensitive
  media leases exactly once; orphan cleanup never deletes a referenced resource;
- several rapid sessions remain isolated;
- admission races steering drain, follow-up drain, `message_end`, synchronous
  quiescence, backend close, payload preparation, seal/outbound-intent
  commitment, and delivery;
- a delayed transcript-recorder/media resolution produces an awaitable pending
  reservation, no busy loop, and no model call without its user turn;
- a slow first reservation and fast second reservation drain only in original
  source order;
- an event admitted before outbound-intent commitment invalidates prepared
  automatic payloads and causes another normal cycle; an event losing that
  atomic commitment starts exactly one later turn;
- block-stream payloads produced by an intermediate cycle are discarded when a
  correction supersedes their generation;
- a valid prior agent or handled-hook candidate survives a later malformed,
  denied, reaction-only, or other no-answer reservation and commits only after
  that reservation resolves;
- first/only malformed, denied, and reaction-only reservations each create one
  durable `suppress(no_answer)` candidate when they empty the gate, recover
  terminally after restart, permit configuration cutover, and become
  archive-eligible known-terminal records before package rollback;
- a first no-answer reservation creates `suppress(no_answer)`, then valid
  answer-relevant admission before seal atomically invalidates that suppression,
  runs one normal model cycle, and commits exactly one delivered answer;
- correction followed by deliberate empty/`NO_REPLY` seals to one no-delivery
  disposition without hanging, forcing output, or restoring the stale answer;
- an explicit same-route send in generation one does not suppress an updated
  automatic answer after a generation-two correction;
- explicit same-route send crashes before intent, after `prepared`, after
  `sending`, after platform acceptance, after `ack`, and after known failure
  produce the documented safe retry, suppression, or `delivery_unknown`
  disposition without duplicate automatic delivery;
- commentary, tool progress/summary, plan updates, handled hooks, and TTS-only
  automatic payloads are version-fenced and cannot escape before drain;
- failure during structured transcript adoption releases the exact replay claim
  or records one explicit terminal disposition without text-only fallback;
- restart occurs before and after first-turn adoption, queued-turn adoption,
  assistant completion, seal, outbound intent, and send acknowledgement;
- provider error, timeout, abort, `/stop`, and early-stop hooks resolve or
  transfer every pending and committed reservation exactly once;
- queued inline replies, reactions, approvals, hooks, and tools observe the
  admitted envelope's own source/reply identity and turn-local routing context,
  then restore prior context for later turns;
- crash before send retries safely, acknowledged send does not retry, and an
  unknown send becomes `delivery_unknown`;
- queue and attachment caps, malformed envelopes, commands, reactions, groups,
  echoes, catchup, and cursor floors preserve current behavior;
- `drop:new`, drop-old, and summarize policies apply only to classified data
  reservations without quarantine or source-order inversion; control and
  approval reservations remain non-droppable;
- no drained operation creates more than one automatic terminal visible reply
  intent or one explicit no-delivery disposition;
- every breaker survives restart and isolates only the implicated key;
- rollback rejects unresolved queue-drain ownership and succeeds after drain or
  explicit quarantine;
- rollback during continuous same-key ingress keeps the active lineage on
  queue-drain through seal, then transfers once to buffered ownership without
  loss, indefinite hold, reordering, or concurrent dispatch; and
- sustained same-key ingress past the bounded rollback deadline quarantines the
  lineage and durably holds later input instead of forcing seal or starting
  buffered dispatch;
- rollback concurrent with `/new` or `/reset` transfers cutover lineage to the
  successor and never lets the old key release shared lanes early;
- package rollback rejects quarantined, `delivery_unknown`, or active new-format
  records, succeeds only after predecessor-readable buffered transfer and atomic
  archival of known-terminal records outside the predecessor-visible active
  store, and otherwise leaves the new package installed but disabled;
- crash injection between terminal archival, held-input conversion, final
  preflight, and predecessor restore never loses ownership, and the restored
  predecessor reader consumes every converted buffered record exactly once; and
- recording mocks reject unknown writes and automated tests deliver no live
  messages.

Latency assertions:

- standalone events add no queue-drain pre-run delay;
- active-run admission starts promptly after source observation;
- final delivery starts promptly after the latest admitted turn completes and
  the atomic seal/outbound-intent commitment succeeds; and
- no assertion depends on message wording, payload shape, or an arbitrary quiet
  period.

This design revision uses static, read-only investigation only. No managed
lifecycle or production smoke is required until executable artifacts exist.

### Rollout and rollback

After approval and full isolated validation:

1. Land the disabled strategy and cumulative regressions.
2. Exercise it through recording transports with production-equivalent caps and
   deterministic admission/seal/delivery races.
3. Promote the exact remotely approved candidate through
   `docs/openclaw-setup/patches/apply-and-deploy.sh` with `MINI_HOST` unset on the
   target Mac mini.
4. Verify exact-byte marker, recovery snapshot, config, gateway health,
   iMessage capability, locks, and no-test-delivery evidence.
5. Enable only for an explicit canary conversation.
6. Observe content-free admission latency, queue depth, seal rejection,
   intermediate suppression, duplicate intent, unresolved operation, and
   terminal delivery metrics.
7. Initiate atomic per-lineage cutover on invariant or health failure: inactive
   lineages return to buffered mode immediately, active lineages retain
   queue-drain admission through seal, and lineages exceeding the deadline
   quarantine and durably hold new input.
8. Expand only after the configured duration, sample, queue-depth, duplicate,
   unresolved-operation, and p95 latency thresholds pass.

Configuration rollback creates an atomic per-lineage cutover record. Lineages
without active operations move to buffered ownership immediately. Active
lineages retain queue-drain admission—including newly observed same-key
events—until seal, then atomically transfer transport and destination-affinity
lanes to buffered ownership. `/new` and `/reset` transfer lineage and the cutover
token to their successor; no predecessor ownership transfer occurs until all
successor keys drain. A lineage that exceeds the bounded drain deadline enters
quarantine and durably holds new input rather than racing buffered dispatch.

Package rollback does not accept quarantine as sufficient because the
predecessor cannot interpret new-format records. It restores the retained
package/service snapshot only after every queue-drain record is either
known-terminal and atomically archived outside the predecessor-visible active
store or converted into predecessor-readable buffered ownership.
`delivery_unknown` is not archive-eligible. If any active new-format,
quarantined, unknown, or nonterminal record remains, the new package stays
installed with queue-drain disabled until reconciliation. Rollback must not
rewind runtime, cron, Messages, or mailbox state. Crash-injection validation must
cover every archival/conversion/preflight/restore boundary against the actual
retained predecessor reader.

### Review log

- The deployed buffered coalescer, cumulative test pool, exact-byte lifecycle,
  and replacement marker previously completed independent review and production
  validation.
- PR #64 documented an isolated speculative-fork proposal after adversarial
  review and green remote checks.
- Cole rejected that model on 2026-07-30 and clarified that every iMessage
  should use normal processing, same-session messages should enter the active
  agent, and reply should wait only until the queue is empty.
- The complete proposal was rewritten around existing normal steering, then
  tightened after read-only tracing of the exact production revision's queue,
  multimodal, transcript, final-payload, operation, and delivery boundaries.
- Independent adversarial review found four material design gaps: awaited
  message-tool delivery deadlock, pending-reservation spin/terminal exits,
  adopted-turn loss on restart, and missing turn-local context. The plan accepts
  and addresses all four.
- The replacement recheck found three further races: admission during payload
  preparation, asynchronous reservation reordering, and stale staged blocks.
  The plan now keeps admission open through atomic outbound-intent commitment,
  drains only the committed source-order prefix, and invalidates every
  superseded output generation.
- The next recheck found four integration gaps: same-route message-tool
  deduplication was absent in automatic mode, keyed ingress could hide observed
  backlog, pre-agent commands/hooks lacked operation semantics, and normal cap
  policy was incorrectly treated as quarantine. The plan adds source-route send
  evidence, raw-observation reservation, ordered pre-agent processing with
  explicit command transitions, and configured cap/drop behavior. A fresh
  recheck then found control traffic could be dropped before classification,
  sender-keyed lanes could reorder one canonical session, and no-answer terminal
  reservations could erase a valid handled candidate. The plan now classifies
  before data cap policy, sequences the canonical session lane with sender as
  metadata, and separates seal-blocking admission from answer-generation
  invalidation.
- The fifth recheck found mixed fallback during asynchronous route repair,
  missing model-level no-delivery state, immediate controls blocked behind data,
  unscoped explicit-send evidence, and incomplete automatic-surface fencing. The
  plan now uses stable transport-lane ownership and atomic canonical transfer,
  versioned `deliver|suppress` candidates, a durable immediate-control lane,
  generation/ordinal-scoped same-route send evidence, and exhaustive automatic
  dispatcher fencing.
- The sixth recheck found unresolved transport lanes could be invisible across
  sources targeting one session, while session-only operations could merge
  distinct reply destinations and misdeliver. The plan now requires synchronous
  destination affinity, provisional destination-scoped reservations, operation
  keys combining session and reply conversation, and serialization rather than
  merging for distinct destinations.
- The seventh recheck found pre-seal hook/no-delivery candidates were not durable
  and explicit-send evidence lacked write-ahead crash states. The plan now
  persists candidate generations, payload/resource ownership, and invalidation,
  and adds generation-scoped `prepared|sending|ack|failed|unknown` send evidence
  before transport.
- The eighth recheck confirmed prior corrections and found resource leases lacked
  transfer/cleanup states and rollback lacked atomic lineage cutover. The plan
  now defines candidate-to-outbox lease handoff, idempotent release and orphan
  reconciliation, plus lineage ownership cutover that keeps active admission
  through seal or quarantines with durable input.
- The ninth recheck found package rollback could strand new-format quarantine
  records and `/new`/`reset` could let an old key release shared lanes before its
  successor drained. The plan now requires predecessor-readable transfer or
  archival of terminal records outside the active store before package restore
  and carries stable cutover lineage/tokens across successor operation keys.
- The tenth recheck found terminal new-format records were both allowed and
  rejected by package-rollback rules. The plan now requires atomic archival of
  terminal records outside the predecessor-visible active store, rejects every
  remaining active new-format record, and explicitly tests sustained ingress
  beyond the bounded cutover deadline.
- The eleventh recheck found `delivery_unknown` was not explicitly
  archive-ineligible and the rollout list still described a global admission
  disable. The plan now blocks package restore on unknown delivery, tests each
  restore crash boundary with the actual predecessor reader, and uses the same
  per-lineage cutover contract throughout.
- The twelfth recheck found acceptance and implementation still assigned
  rollback ownership to individual operation keys. The plan now makes the
  durable registry and all ownership transfer lineage-scoped; operation keys are
  only lineage members, including `/new` and `/reset` successors.
- The thirteenth recheck found a first/only malformed, denied, reaction-only, or
  other no-answer reservation had no candidate to seal. The plan now atomically
  creates `suppress(no_answer)` when such a reservation empties a candidate-less
  gate and tests restart, configuration cutover, and package rollback for each
  outcome.
- The fourteenth recheck found the matrix did not prove that valid admission
  before seal invalidates durable `suppress(no_answer)`. The plan now requires
  that exact race to run one normal cycle and commit exactly one delivered
  answer.
- The fifteenth fresh full-diff review found no actionable high-confidence
  material findings. The remaining validation gaps are intentionally deferred
  to the unapproved implementation: prove synchronous destination affinity and
  run the complete managed suite against the exact target OpenClaw revision.
- PR #65 landed the exact reviewed documentation-only candidate as
  `de118104bf7f34b793ef6adc347713f20e06640a`. CodeQL and the cumulative managed
  integration workflow passed. No runtime, configuration, deployment, cron,
  Messages, delivery, or mailbox mutation occurred.

### Checklist

- [x] Land and validate bounded iMessage text/link/image/sandwich coalescing.
- [x] Promote and reconcile the exact-byte production patch stack.
- [x] Investigate the deployed 7/15-second latency paths.
- [x] Land the first investigation-only proposal without production changes.
- [x] Capture Cole's queue-drain correction and replace the rejected design.
- [x] Trace exact normal queue, multimodal, transcript, payload, and delivery behavior.
- [x] Finalize queue-drain ownership, races, tests, rollout, and rollback.
- [x] Complete independent adversarial review of the revised proposal and remediation.
- [x] Land the revised investigation-only plan and pass remote checks.
- [x] Prepare issue #28 and Todoist for Cole's design approval without deployment.
