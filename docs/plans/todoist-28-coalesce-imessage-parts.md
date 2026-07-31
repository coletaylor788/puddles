# Drain active iMessage input before replying

- **Status:** Steering-based design reviewed; landing waits for PR #56
- **Issue:** https://github.com/coletaylor788/puddles/issues/28
- **Last updated:** 2026-07-30
- **Owner:** Cole Taylor

## Human design

### Problem

The current iMessage fix waits several seconds before starting some messages.
That helps combine split text, links, and images, but it adds delay to normal
messages and can still miss a later correction.

### Outcome

The first message starts normal processing right away. More text, links, images,
or corrections from that conversation enter the active agent as normal user
turns before it replies. The agent sends one final reply only after admitted
input is empty. Input that arrives after closing starts the next normal turn.

### Approach

The design connects iMessage to the agent's existing steering support rather
than creating another queue or changing reasoning. Source order is reserved
only long enough to identify the conversation and decide whether to start or
steer. Pending input counts before slow media or context preparation, and one
close gate prevents the run from replying while accepted work is still arriving
or being prepared.

Immediate admission is available only when the source can replay from an exact
database generation and row. Local monitoring checks stable database evidence
before every live admission. A remote bridge stays on the current path until it
can provide equivalent identity and replay. If local identity becomes uncertain,
the source stores stable message references before waiting, then switches to its
current ordered path. Those references rebuild the messages from the database
after restart. Their bounded capacity is reserved atomically and cannot evict a
pending reference. When full, source dispatch stops with the cursor unchanged
until recovery frees space. The design does not copy message payloads into a
second queue.

The first fallback message waits for all earlier immediate work to finish
delivery or deliberate no-reply, replay commit, and ownership cleanup. Later
fallback messages stay behind it. Immediate handling cannot reopen until the
fallback chain finishes and continuity is proven again. The mode and barrier
survive restart. This preserves arrival order through replacement, restore,
retry, and restart.

Each accepted message becomes durable before assistant or tool processing and
keeps replay ownership until final output recovery and replay commit finish.
Recovery can resume unanswered input or pending delivery without adding the user
turn or running completed tools twice. It never guesses after a crash leaves a
non-repeatable tool call without a stored result. That case remains blocked until
an operator explicitly records a no-reply or error disposition after checking the
effect. The disposition never reruns the tool, but lets recovery commit replay
and safely release the blocked source.

### Safety and rollout

The immediate path is opt-in and limited to final replies on steer-capable
backends with proven source identity and replay. Other backends and sources keep
the current ordered path for the whole monitor generation. Reactions stay
entirely on their existing path and enter no immediate reservation or replay
state. Prompts, tools, approvals, transcripts, explicit message sends, and
delivery behavior do not change.

Production remains on the deployed coalescer. Implementation requires Cole's
approval after this design lands. Public landing is waiting for the cron-reader
change. Rollback persists recovery-only mode, pauses new source dispatch without
advancing its cursor, and drains accepted immediate and already queued fallback
work through the same full ownership boundary. The new package then runs
lossless cursor catchup through the current coalescer. An older package can
replace it only after that catchup reaches the live source. This avoids the old
catchup age and row limits.

## Agent details

### State

The current coalescer is healthy in production deployment
`73b08dc8-5c4d-40ed-808a-d46ee0eaa45d` at OpenClaw revision
`0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`. Its retained snapshot is
`~/.openclaw/deploy-snapshots/20260730T104410Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`.
Production remains unchanged.

Read-only source tracing confirms:

- `packages/agent-core/src/agent-loop.ts` checks `getSteeringMessages` after
  every completed assistant/tool turn, injects queued user messages, runs the
  model again, then drains follow-ups before `agent_end`;
- `src/agents/sessions/agent-session.ts` implements
  `steer(text, images)` and forwards text plus `ImageContent` to
  `agent.steer`;
- `src/agents/embedded-agent-runner/run/attempt.ts` already exposes an active
  queue handle, but `queueMessage` accepts only text and
  `acceptingSteerMessages` closes after the prompt returns;
- `src/auto-reply/reply/reply-run-registry.ts` can locate a running operation
  and queue text, but its helper is fire-and-forget;
- CLI reply backends attach no `queueMessage` capability, so the immediate
  strategy must be limited to configured embedded steer-capable routes;
- the deployed iMessage `dmCoalesceIngestChains` await debounce flush, whose
  dispatch awaits `handleMessageNow` through full reply completion; and
- the embedded payload path already selects the last current-attempt assistant
  as the final answer.

The previously landed orchestration-heavy proposal is superseded by this
revision. Independent full-diff review is clean. No executable artifact has been
approved or changed.

Public plan-only merges are temporarily frozen until cron-reader PR #56 lands so
this documentation change does not invalidate that feature's exact promotion
base. Local design review continues without moving `main`.

### Scope and acceptance criteria

In scope:

- provider-neutral structured active-run steering for prepared text and images;
- capability-gated use on embedded steer-capable routes, with the current
  coalescer retained elsewhere;
- source capability gating on a stable Messages database-instance identifier,
  finite row number, stable message reference, and lossless row replay;
- iMessage admission that does not wait for the active reply to finish;
- same-conversation source ordering through the start-or-steer decision;
- exact source-conversation matching before active-run steering;
- exact per-message persistence completion for duplicate text and images;
- provisional account cursor hold floors across observed live and catchup rows;
- a persisted source fallback/recovery mode reconstructed from existing
  cursor-relative state, without a second message queue;
- durable fallback source references that reconstruct payloads from Messages,
  without copying message payloads into plugin state;
- atomically reserved non-expiring fallback-reference capacity with source
  backpressure rather than eviction;
- an explicit operator disposition for blocked non-repeatable tool tails;
- one atomic steering/follow-up empty-and-close boundary before final answer
  commitment, including pending same-conversation admission tickets;
- removal of the queue-drain path's 7/15-second pre-run waits;
- focused OpenClaw tests, cumulative Puddles integration coverage, patch
  documentation, feature-switch rollout, and rollback validation after
  approval.

Out of scope:

- changing model prompts, reasoning, tools, hooks, approvals, or command
  semantics;
- combining messages based on content, attachment type, timing, or question
  shape;
- interrupting or restarting the current model call;
- suppressing or undoing tool effects from an earlier normal cycle;
- adding a second payload queue, candidate store, outbox, lease system, route
  lineage, or package-state migration;
- sending automated live iMessages; and
- implementation or production deployment before Cole approves this design.

Acceptance criteria:

- a standalone message begins normal processing without an added coalescing
  delay;
- an eligible same-conversation event arriving before atomic close is accepted
  by the active run in source order and processed as another normal user turn;
- the first event does not release source-order admission until its accepting
  steering backend and close gate are attached or the handler reaches any
  successful or failed terminal outcome before readiness;
- an anchorless earlier row reserves source order before repair, so a later row
  cannot enter a potentially matching conversation lane first;
- an unresolved anchorless row blocks close for active runs on its account until
  repair atomically narrows it to one conversation or permanently skips it;
- retry of the same source row resumes its existing reservation slot instead of
  waiting behind itself;
- source row identity includes account and Messages database-instance
  generation proven by source continuity, so a same-path or in-place replacement
  cannot reuse another database's hold, pin, or cursor;
- live admission revalidates that continuity in one source snapshot before each
  reservation and atomically rotates or fences the source on uncertainty;
- an event without a finite row number stays on the current coalescer and never
  enters a shared row slot;
- a source without guaranteed exact-row replay remains current-path-only for its
  whole monitor generation and cannot have older immediate work to overtake;
- a local live event whose row identity becomes uncertain is resolved to and
  durably records a stable database message reference before it waits; restart
  reconstructs the exact row and payload from Messages before continuing;
- fallback-reference capacity is reserved before accepting the transition,
  pending references are never pruned by ordinary store limits, and saturation
  stops source dispatch without advancing its cursor;
- identity-incomplete fallback fences its source in arrival order, so later
  valid events cannot overtake it by re-entering immediate admission;
- the first fallback event waits behind every earlier accepted immediate
  identity's full delivery, replay, and ownership barrier before current-path
  processing starts, and later fallback events remain ordered behind it;
- fallback cannot reopen on terminal handoff alone; every earlier accepted
  identity must also complete delivery/no-reply disposition, replay commit, and
  claim, hold, and pin release;
- restart reconstructs fallback or recovery-only mode before live dispatch and
  cannot bypass either source barrier;
- authenticated `/stop` bypasses unresolved data reservations and retains its
  existing immediate abort behavior;
- a different iMessage conversation sharing the same session cannot steer into
  that run or inherit its reply target;
- text, link, image, and correction turns use the same admission rule;
- prepared image content reaches the existing multimodal steer API without
  text-only degradation;
- steering and close cannot both win for one event;
- a same-conversation ticket reserved before close prevents close while media,
  history, or context preparation is still pending;
- an empty run with a pending reservation awaits a signaled gate transition
  without exiting or polling;
- normal stop-after-turn cannot terminate ahead of a steer that already won
  admission; exceptional termination rejects every still-queued identity;
- accepted in-memory steering does not clear replay/cursor ownership until its
  source-identified turn is durably adopted, that user cycle is processed, the
  closed run's final output/no-reply disposition is durably handed off, and
  replay commit succeeds;
- identical text steers have independent completion and cancellation identities;
- cancellation cannot reject a steer after draining has taken ownership of it;
- a later completed conversation cannot advance an account cursor past an
  earlier row that has been observed but has not yet completed claim/repair;
- a duplicate observation of an in-flight row cannot clear that row's cursor
  hold; only a confirmed committed duplicate may clear it;
- a retryable conversation-repair error retains its row hold, while a confirmed
  permanent skip releases it;
- restart and catchup cannot omit the earliest cursor-held row because of age,
  page-size, total-row, or retry-give-up limits;
- pin capacity is reserved before dispatch across concurrent lanes, and a pin
  write failure aborts before assistant/tool processing;
- a first-session user turn is actually flushed before adoption is acknowledged;
- reactions are routed to current handling before any immediate reservation,
  blocker, hold, or pin;
- eligible transcript-free effects receive durable adopted ownership before
  execution and use an existing idempotent effect or delivery receipt before
  terminal commit; reactions remain on their current ephemeral path;
- same-process pin-write retry reconciles or retains the exact adopted turn
  instead of appending it again;
- terminal replay ownership follows durable pending-final or no-reply handoff,
  so recovery never suppresses an undelivered final result;
- recovery never reruns an unresolved non-idempotent tool call whose result was
  not durably recorded;
- a blocked non-idempotent tail can leave `blocked_unresumable` only through a
  durable explicit operator no-reply/error disposition that confirms no replay,
  commits source replay, and releases ownership;
- the final source reply is the existing last current-attempt assistant answer
  after all accepted steering and follow-ups drain;
- an event rejected after close starts exactly one later normal turn;
- existing commands, reactions, hooks, tools, approvals, transcripts,
  replay/cursor handling, and delivery recovery retain their behavior;
- no new durable queue or database schema is created; cursor-relative replay
  pins use ordinary entries in the existing plugin-state dedupe store;
- a CLI-backed, otherwise non-steerable, or source-identity-incomplete route
  remains on the current coalescer and cannot strand immediate admission;
- rollback pauses new source dispatch without cursor advancement, reconstructs
  recovery-only mode after restart, applies the full fallback drain predicate,
  then lets the replacement coalescer catch up; and
- the documentation-only revision is independently reviewed and landed without
  production changes.

### Architecture and decisions

The design adds no new queue. It connects iMessage to three existing OpenClaw
owners:

- **Normal inbound preparation** recognizes emergency stop and reactions before
  immediate admission, then continues to resolve route/session identity, hooks,
  prompt text, media, and replay metadata for eligible ordinary input.
- **Active reply-run registry** decides whether the prepared ordinary user turn
  belongs to the current run only after its in-memory source-conversation key
  equals the inbound key. Its queue contract becomes
  `queueMessage({ text, images, ...existing delivery options })` and returns
  `{ accepted, adopted, completion }`: admission is known promptly, durable
  adoption and terminal completion remain separate, and both promises are tied
  to one unique in-memory steering identity.
- **AgentSession and agent-core** remain the queue and processing owners.
  `AgentSession.steer` enqueues the user message in memory; `agent-core` drains
  it after the current assistant/tool turn and performs the next normal model
  cycle. `AgentSession` first reports durable adoption after transcript flush and
  strict pin acknowledgment, then reports when that adopted user cycle is
  processed. The reply operation resolves source completion only after final
  payload or no-reply handoff covers every accepted identity.

Immediate admission requires `dbInstanceId`, not the existing path/host cursor
scope alone. Local monitoring persists a generated source generation beside the
cursor. On startup/reconnect and before every live reservation, one consistent
source snapshot reads the current high-water row, stable GUID anchors around the
persisted cursor/high-water boundary, and the observed event row/GUID. File
identity is supporting evidence only. A lower high-water row, missing or changed
anchor, event mismatch, or any unprovable continuity atomically closes immediate
admission for that source and rotates the generation before it can accept
another immediate event. Immediate capability also requires lossless
`since_rowid` replay and a stable message reference that resolves to the exact
database row. A remote bridge without equivalent per-event generation,
continuity, and replay remains current-path-only for the entire monitor
generation. A generation change starts a separate cursor/hold/pin namespace and
never transfers old in-memory lanes into the new generation.

Each source has an arrival-order mode gate shared by immediate and current-path
handling. Missing or invalid row identity, continuity uncertainty, or unsupported
capability atomically fences that source into fallback before the event is
released to the current coalescer. A source that lacked capability at monitor
startup never entered immediate mode, so it needs no mixed-mode transition.
For an immediate-capable local source whose live event fails row continuity, the
monitor first atomically reserves bounded fallback-reference capacity, then
resolves the event's stable GUID and source generation to an exact database row
and durably stores that reference plus source order in the existing plugin-state
store. Pending references are non-expiring and excluded from ordinary oldest-
entry pruning. It does not copy text, media, or account content. Capacity
saturation, resolution failure, or persistence failure preserves existing
references and the cursor, then stops source dispatch with an explicit error
rather than releasing unordered work. The first fallback handler waits on a
source-drained barrier covering every earlier accepted immediate identity:
durable delivered or deliberate no-reply disposition, successful replay commit,
and release of all claims, cursor holds, and pins. Later fallback handlers queue
behind that first handler. The mode and barrier generation are persisted in the
existing plugin-state store before release. Restart reconstructs the fence from
that state plus unresolved pins and holds, resolves each pending source reference
back through Messages, and only then starts live dispatch. The gate may reopen
only after the earlier barrier, fallback chain, and continuity/capability proof
all complete. A merely `terminal` pin is not sufficient. This can temporarily
serialize unrelated conversations on an uncertain account, but no later
fallback event can overtake earlier immediate or fallback work.

The iMessage monitor first recognizes an authenticated `/stop` through its
existing control path and sends it directly to the existing abort behavior. It
then recognizes reactions and completes their existing ephemeral handling
without acquiring the source mode gate, row reservation, unknown-affinity
blocker, close ticket, cursor hold, or pin. Other events enter the source mode
gate. Eligible immediate events use a short per-account source-order reservation
gate. Every
notification synchronously acquires or resumes one slot keyed by
`(accountId, dbInstanceId, rowid)`. Only finite row IDs enter this path;
otherwise the event uses the current coalescer. Duplicate delivery or source
retry of row N joins N's existing slot rather than appending behind it. An
anchorless observation also registers
an unknown-affinity account blocker with all open close gates on that account
before repair can yield; a close gate attached later consults the same account
blocker set. Under the reservation gate the monitor repairs or confirms the
conversation anchor and synchronously appends its admission ticket to the
resulting per-conversation lock. It then atomically transfers the unknown
blocker to that conversation ticket, releasing unrelated run gates, before
releasing the account slot. A permanent skip releases the blocker; a retryable
repair failure retains the same row-keyed slot for source retry, process
teardown, or restart. The ticket immediately counts as pending work in the
conversation's close predicate, before attachment staging, history, or context
preparation awaits. Normally anchored rows pass through without I/O. This
prevents row N+1 from acquiring a conversation lane before potentially matching
anchorless row N and prevents any possibly matching active run from closing
first, while other accounts and already resolved distinct conversation lanes
remain concurrent.

The first event holds its per-conversation admission ticket until the normal run
has attached an accepting backend and its close gate, not merely until the reply
operation is registered. If any successful or failed handler terminal outcome
occurs first, that outcome resolves both admission and completion instead; a
hook-handled or otherwise backend-free success cannot strand the lock. A later
event holds the lock only until that ready backend accepts it or closed
admission routes it to start the next normal run. The event's existing handler
awaits terminal `completion` outside that lock before committing replay state.
Successful replay commit then releases the row hold and allows cursor
advancement. A processing failure releases the transient replay claim but
retains the row hold for retry; rejection by a closing run instead transfers the
still-claimed event directly to the next normal-run admission path. Reply
generation and delivery also occur outside the lock.

Each steering identity has one atomic in-memory lifecycle:
`queued -> draining -> adopted -> processed -> terminal` or
`queued -> canceled`. Transcript failure settles `draining` as failed. A pin
write failure keeps the claim and retries pin repair against the already flushed
source identity; it does not release into a second append. Model error or abort
settles an adopted identity as processed failure. Timeout or abort may remove
and reject the exact identity only by winning the `queued -> canceled`
transition. Once queue drain wins, cancellation cannot release replay ownership.
Durable adoption, cycle processing, and final output handoff settle their
separate transitions. This prevents retry from racing with a message that has
left the queue and prevents an unanswered or undelivered adopted turn from being
mistaken for completed work.

The only new concurrency primitive inside the run is an in-memory admission
gate with `open` and `closed` states:

- unknown-affinity reservations for the run's account register before repair
  and block close until atomically transferred or permanently released;
- steering and follow-up insertion acquire the gate, reject if closed,
  otherwise append to their existing queues and signal the loop;
- a same-conversation admission ticket registers with the gate before payload
  preparation, then atomically transfers to a steering identity or releases
  after a terminal command or skip disposition;
- after pending admission tickets and both existing steering and follow-up
  queues read empty, the loop acquires the same gate and closes only if all
  remain empty;
- if native queues are empty but a reservation or ticket remains, the loop
  captures the gate generation and awaits its change before rechecking;
- every reservation/ticket transfer or release, queue insertion, terminal
  failure, abort, and teardown advances the generation and wakes waiters;
- if insertion happened first, close fails and the loop processes the queued
  turn;
- if close happened first, insertion rejects and normal later-turn handling
  owns the event;
- a normal `shouldStopAfterTurn` decision uses that close operation, so an
  already accepted steer defers the stop until the admitted turn drains; and
- an exceptional error, abort, or terminal teardown closes admission and
  atomically rejects every identity still in `queued`, while any `draining`
  identity settles from its exact persistence success or terminal failure.

This gate is not durable because it owns no message data. The inbound event
remains claimed after in-memory acceptance, durable adoption, and cycle
processing. After atomic close, the existing final-payload builder produces the
canonical last assistant answer. The reply operation durably hands that payload,
or an explicit no-reply disposition, to the existing pending-delivery recovery
path with the covered source identities before changing their pins to
`terminal`. Only that handoff followed by replay commit clears claims and row
holds. A crash after adoption resumes the source-identified cycle; a crash after
processing rebuilds the final handoff from persisted transcript state without
rerunning model or tools; a crash after handoff resumes existing delivery.

The monitor extends its existing pending-row hold-floor bookkeeping to every
observed row, not only startup/catchup work. The synchronous notification
boundary installs a unique provisional `(accountId, dbInstanceId, rowid)` hold
before any repair, dedupe claim, or dispatch await can yield to a later row.
Conversation repair
returns a discriminated result: `repaired(message)`, `permanent_skip(reason)`, or
`retryable_failure(error)`. Missing GUID or a complete successful search with no
usable anchor may be permanent; any chat-list/history RPC error makes the result
retryable rather than indistinguishable `null`. Successful repair and claim
transfer that same hold to the unresolved event. Replay claim results must
preserve the dedupe distinction: a confirmed committed duplicate or permanent
skip clears the hold, while an `inflight` duplicate retains the idempotent
`(accountId, dbInstanceId, rowid)` hold and observes the original owner's terminal
outcome. Every retryable repair, claim, dispatch, or completion failure also
retains it.
Completion alone does not remove the hold. Only successful replay commit does,
and cursor advancement may reach only the highest committed row below the
earliest provisional or unresolved row. Thus conversation B finishing row N+1
cannot make row N disappear while N is still repairing, claiming, processing,
duplicated in flight, or awaiting retry.

Before claim or dispatch of a row that may need cursor-relative protection, the
monitor atomically reserves one bounded pin-capacity slot. The capacity check
counts durable pins plus all concurrent in-flight reservations, so two lanes
cannot both consume the last slot. At capacity the monitor stops dispatching
newer rows for that account and leaves them recoverable from the unchanged
cursor.

Each prepared user message carries stable account/database/row/replay identity
in its transcript metadata. The transcript layer gains an explicit
append-and-flush operation that writes even a new session's first user turn and
confirms durable storage before returning. After that flush, but before
`message_end` returns to the agent loop and before any assistant/tool cycle can
start, the adoption callback strictly persists a non-expiring cursor-relative
pin through the existing plugin-state dedupe store. Unlike the generic
best-effort dedupe helper, both writes must return durable acknowledgment; either
failure aborts processing. A crash between transcript flush and pin is
reconciled by the stable transcript identity. In the same process, strict
pin-write failure retains the source claim and retries the pin against that
identity with backoff. A crash after the pin but before cycle processing leaves
the pin in `adopted` state. Recovery writes any missing pin and resumes the
pending assistant cycle from the already adopted user turn without appending or
executing the user turn twice.

Pins distinguish `adopted`, `processed`, and `terminal`. The source claim,
cursor hold, and pin remain after adoption while the corresponding
assistant/tool cycle runs. Cycle success or failure moves the pin to `processed`
with enough source linkage to finalize from persisted transcript state. After
the run closes, durable final payload/no-reply handoff moves every covered pin to
`terminal` before replay commit.

If recovery finds an assistant tool call without its durable result, it uses the
existing tool-recovery classification. A tool already proven idempotent may use
its existing retry contract. An unresolved non-idempotent tool changes the pin
to `blocked_unresumable`, preserves the cursor floor and source ownership,
surfaces the existing recovery error, and never automatically reruns the model
or tool. Final payload reconstruction is allowed only when the transcript has no
unresolved unsafe tool tail.

The existing plugin-state record also accepts one authenticated local operator
disposition for that exact blocked identity: `resolved_no_reply` or
`resolved_error`. The operator must explicitly confirm that the unsafe tool will
not be replayed. The write is durable and idempotent, records the disposition
without inventing a tool result, hands off the matching no-reply or error outcome,
commits replay, then releases the claim, cursor hold, and pin in normal cleanup
order. Recovery can resume those cleanup steps after a crash. No timeout,
capacity pressure, restart, or automated path may create this disposition.

Approval, pairing, and another transcript-free path may use immediate admission
only when it already has a stable request identity plus durable state transition
or pending-delivery record. It strictly persists an `adopted` pin before the
effect; recovery checks that existing receipt and resumes or finalizes before
moving the pin to `terminal`. Reactions use an ephemeral event queue and
therefore remain entirely on the current path.

Claim checks both ordinary replay identity and the pin. The pin is excluded from
ordinary oldest-entry pruning until the cursor crosses that row. Cursor crossing
is serialized with pin cleanup: first persist the new cursor, then durably
refresh the ordinary four-hour replay entry, then remove the pin. A failure at
either later step leaves the pin in place; startup cleanup repeats refresh and
removal for pins already below the durable cursor. Pin removal releases its
capacity reservation and wakes a monitor-owned cursor catchup pass before live
admission resumes. Thus disk failure, a four-hour delay, or 10,000 newer rows
cannot convert adopted work into duplicate side effects.

On restart the in-memory holds are reconstructed from the persisted cursor
rather than from a new durable record. Recovery queries rows strictly after that
cursor in ascending order and continues bounded pagination until the contiguous
prefix is resolved. The existing 500-row result size remains a page size, not a
total replay ceiling. The two-hour live/catchup age fence and retry give-up do
not discard or advance past the earliest unresolved row; a discriminated
permanent skip or successful replay commit is required. Existing replay keys
make already committed rows in later pages harmless.

Retryable conversation repair is owned by the row-keyed reservation slot. It
schedules one abortable exponential-backoff retry with jitter per row, reusing
the same slot and account close blocker; there is no maximum-attempt give-up
while the monitor remains active. Successful repair transfers the blocker and
permanent skip releases it. Monitor teardown cancels retry timers and releases
in-memory close blockers while leaving the persisted cursor floor and replay
pins intact for restart.

Only final source-reply mode is enabled for this strategy. iMessage production
already uses final delivery, so intermediate assistant turns stay internal and
the existing final-payload selection sends one answer. Block streaming is not
reimplemented or fenced by this feature.

### Implementation

After approval:

1. Replace the deployed queue-drain path's iMessage classifier/timers with a
   feature-switched immediate path; retain current code as configuration
   rollback.
2. Capability-gate the immediate strategy to final source-reply routes whose
   configured backend is embedded and exposes structured steering. Keep
   CLI-backed and other non-steerable routes on the current coalescer. Treat an
   unexpected attached backend without the capability as an unsupported
   readiness result and disable new immediate admission on that route. Also
   require a source-backed local or bridge-provided database-instance generation
   a finite source row ID, a stable message reference, and lossless exact-row
   replay. Persist local generation with high-water/GUID continuity anchors.
   Revalidate anchors plus the event row/GUID in one source snapshot before every
   live reservation. Keep a source without all capabilities current-path-only for
   the monitor generation; remote bridges remain there until they expose the
   same guarantees.
3. Route authenticated `/stop` through its existing immediate abort path before
   data reservation, then route reactions through their existing handling before
   any immediate gate, reservation, blocker, hold, or pin. For other events, add
   a source mode gate shared with the current coalescer. For a previously
   immediate-capable local source, continuity uncertainty atomically enters
   fallback only after resolving and durably recording the exact database
   generation/GUID/row reference and source order in existing plugin state.
   Atomically reserve bounded non-expiring, non-evictable reference capacity
   before acceptance. Store no payload. Preserve existing entries and the source
   cursor, then stop dispatch explicitly if capacity is full or the reference
   cannot be resolved or persisted. Hold the
   first fallback handler behind every earlier accepted immediate identity's
   delivered/no-reply, replay-committed, fully unclaimed, unheld, and unpinned
   barrier; queue later fallback handlers behind it. Reconstruct that barrier
   and rebuild every pending reference from Messages before live dispatch after
   restart. Reopen only after the complete immediate barrier and fallback chain
   drain at a proven boundary. Eligible events then use a short
   per-account source-order gate with one slot keyed by
   `(accountId, dbInstanceId, rowid)`. Duplicate
   notification or retry resumes the same slot. For unknown affinity, register
   an account blocker against existing and subsequently attached run gates
   before the first repair await. While holding the slot, resolve/repair
   affinity, append the event's ticket to the resulting conversation lock and
   close predicate, and atomically narrow the account blocker to that ticket
   before releasing it. Permanent skip releases it; retryable failure retains it
   for source retry or teardown. Do not await agent processing there. This
   serializes only affinity reservation on one account and leaves different
   accounts and resolved conversation lanes concurrent.
4. Split same-conversation processing into an admission receipt and completion
   promise so the keyed lock awaits backend-ready start-or-steer, while
   replay/cursor handling still awaits terminal user-cycle completion outside
   the lock.
   Resolve new-run admission after the accepting backend and close gate attach
   or on every successful or failed terminal-before-ready outcome. Hold the
   replay claim while unresolved; commit it on success or release it on
   processing failure. A closed-run rejection keeps ownership while starting
   the next normal run.
5. Extend `EmbeddedAgentQueueMessageOptions`, the active reply-run queue helper,
   and the embedded queue handle to carry prepared image content and return
   `{ accepted, adopted, completion }`. Store the canonical
   source-conversation key on the in-memory reply operation and reject steering
   on mismatch.
6. Forward accepted structured turns directly to the existing
   `AgentSession.steer` path with a unique in-memory identity, atomic
   queued/draining/adopted/processed/terminal transitions, an adoption promise,
   and a final completion promise. Add a flushed transcript append that durably
   writes even the first user turn in a new session. Persist stable source
   identity with that exact user message, then strictly acknowledge its
   cursor-relative `adopted` pin before the assistant cycle starts. Reject and
   abort on transcript failure. On pin failure, retain the claim and retry pin
   repair against the existing transcript identity. Mark `processed` when that
   exact user cycle finishes, but keep replay ownership until run-level output
   handoff marks all covered identities `terminal`. Recovery of
   append-without-pin writes the pin; recovery of an adopted pin resumes from
   the existing source-identified transcript turn without duplicate append.
   Cancellation may remove the identity only while queued. Do not add a second
   queue; keep agent-core turn processing unchanged apart from making its
   existing steering drain win before a normal stop-after-turn exit.
7. Add the atomic empty-and-close gate around unknown-affinity account
   reservations, pending same-conversation admission tickets, both existing
   steering/follow-up insertion paths, and their final empty check. Register the
   account reservation before repair and the ticket before payload preparation;
   atomically narrow, transfer, or release them on every disposition. Defer a
   normal `shouldStopAfterTurn` result when a reservation, ticket, or accepted
   identity already won the gate. Add an awaitable generation-change signal:
   empty queues with blockers sleep until any blocker/ticket transition,
   insertion, failure, abort, or teardown wakes them, then recheck atomically.
   On error, abort, or teardown, atomically close and reject all still-queued
   identities; settle already-draining identities from persistence or terminal
   failure. Keep the canonical final payload builder unchanged. After close,
   persist its payload or no-reply disposition through existing pending-delivery
   recovery with all covered source identities before marking pins terminal.
8. Extend the existing recovery/catchup cursor hold-floor bookkeeping to install
   a provisional hold synchronously for every observed live row before the first
   await. Scope every hold and cursor by the database-instance generation as
   well as account and row. Detect replacement as a new generation and keep old
   state isolated. Change conversation repair from nullable output to
   discriminated repaired/permanent-skip/retryable-failure output, retaining the
   hold for every RPC failure and clearing it only after a complete permanent
   result. Transfer repaired rows through replay claim into processing. Preserve
   the persistent dedupe result so an `inflight` duplicate retains the shared
   idempotent row hold and only a confirmed committed/permanently skipped row
   clears it.
   Otherwise clear only after terminal output handoff and replay commit both
   succeed; release a failed transient claim for retry without clearing its
   hold.
9. Make enabled-account recovery page from the persisted cursor forward in
   ascending source order. Treat the current 500-row limit as a page size and
   bypass age suppression and retry give-up for the earliest unresolved row;
   only permanent skip or successful replay commit may cross it.
10. Reserve bounded pin capacity atomically before claim/dispatch, counting
   durable pins plus every in-flight reservation across lanes. After exact
   source-identified flushed transcript append, strictly persist a non-expiring
   `adopted` pin keyed by account, database-instance generation, row, and replay
   identity before allowing assistant/tool processing. Keep it through the user
   cycle, mark it `processed`, and durably hand off final payload/no-reply
   before marking `terminal` and committing replay. Reconcile
   append-without-pin, adopted turns, processed turns, and pending final delivery
   on restart. For transcript-free paths with an existing durable receipt,
   persist `adopted` before the effect and require the existing idempotent state
   or delivery receipt before `terminal`; keep reactions and any receipt-free
   path on current handling.
   Serialize cleanup as cursor persist, ordinary replay refresh, then pin
   removal; retry cleanup failures. Apply account backpressure instead of
   eviction, and run cursor catchup before live    admission resumes.
11. Preserve existing tool-tail recovery classification. Resume only tools whose
   existing contract proves replay safe. Mark an adopted/processed pin
   `blocked_unresumable` when a non-idempotent tool call lacks a durable result;
   keep source ownership and cursor floor, surface the existing recovery error,
   and never automatically rerun that tool or reconstruct final output past it.
   Add an authenticated local operator action keyed to the exact blocked
   identity. It may durably choose only `resolved_no_reply` or `resolved_error`
   after explicit no-replay confirmation, then use recoverable handoff, replay
   commit, and normal claim/hold/pin cleanup. No automatic path may invoke it.
12. Add monitor-owned abortable exponential-backoff repair retries keyed to the
   existing row slot. Reuse the slot for every attempt; cancel timers and release
   in-memory blockers on teardown while retaining the cursor floor for restart.
13. Add focused upstream-quality OpenClaw tests, register them in
   `packages/e2e/openclaw-patch-suite.json`, update patch documentation, and run
   the managed lifecycle.

### Validation

Executable implementation must pass the focused OpenClaw tests and:

```bash
node packages/e2e/bin/openclaw-test-env.mjs ci
```

The managed recording harness must prove:

- standalone text starts immediately and produces one normal final reply;
- text followed by link before close produces two normal user turns and one
  final reply containing both contexts;
- text followed by image preserves actual image content in steering;
- text-link-text and text-image-text sequences stay ordered and produce one
  final reply;
- an immediate correction causes another normal model cycle and the final reply
  reflects the correction;
- a message arriving while tools run is processed after those tool calls by the
  existing steering loop;
- a same-conversation ticket reserved before slow attachment staging or history
  lookup prevents close and then transfers atomically into steering;
- a steer accepted before `shouldStopAfterTurn` is evaluated drains before the
  normal stop is honored;
- two concurrent arrivals preserve source order through admission;
- a second arrival between operation registration and backend attachment waits
  and then steers rather than starting a second reply;
- successful hook-handled or other backend-free completion settles admission,
  replay, and cursor ownership without stranding a later event;
- anchorless row N repairing while anchored row N+1 arrives on the same account
  reserves N's conversation lane first when repair maps both rows together;
- anchorless row N blocks an already active possibly matching run from close
  before repair, then atomically narrows the blocker when affinity resolves;
- retryable repair of row N re-enters N's row-keyed reservation and eventually
  transfers it without deadlocking behind itself;
- an unrelated anchorless row cannot prevent a later correction from eventually
  steering into its active run; both remain close-blocking until repair proves
  them distinct;
- authenticated `/stop` bypasses an unresolved anchorless data reservation and
  aborts through the existing control path;
- rows on different accounts continue admission concurrently while one account
  repairs an anchorless row;
- an embedded steer-capable route uses immediate admission, while CLI and
  capability-missing routes retain the current coalescer without a readiness
  hang;
- two conversations mapped to one session never cross-steer or cross-deliver;
- two identical text steers complete and cancel independently by identity;
- cancellation racing queue drain has exactly one winner: queued cancellation
  prevents persistence, while draining ownership waits for append outcome;
- transcript append failure rejects only the matching completion, releases its
  replay claim for same-process retry, retains its cursor hold, and does not
  advance the cursor;
- a crash before durable adoption replays the source event; a crash after
  adoption resumes the exact adopted turn; a crash after processing rebuilds
  final handoff from transcript without rerunning model/tools; only durable
  output/no-reply handoff plus replay commit clears source ownership;
- conversation B completing row N+1 while conversation A still owns row N holds
  both recovery and catchup cursors below N through restart;
- conversation B completing row N+1 while row N is still repairing or acquiring
  its replay claim also holds both cursors below N through restart;
- a duplicate notification for row N while the original claim is `inflight`
  retains N's hold while row N+1 completes, and a crash still replays N unless
  the original owner committed it;
- chat-list or any history RPC failure during row N repair retains N's hold while
  N+1 completes, whereas an exhaustive successful no-anchor result releases N;
- restart with more than 500 newer rows still fetches cursor-held row N first and
  paginates forward without loss;
- restart after row N ages beyond two hours still retries N rather than
  suppressing it;
- repeated retryable catchup failure for row N never advances the cursor to
  N+1, while a confirmed permanent skip does;
- committed row N+1 remains deduplicated after row N holds the cursor for more
  than four hours and through restart;
- pinned replay entries are not evicted at 10,000 ordinary entries; reaching pin
  capacity pauses newer account dispatch, then pin removal runs cursor catchup
  before live admission resumes without loss;
- two concurrent lanes at capacity minus one reserve atomically, so only one
  dispatches and the other remains recoverable without pin eviction;
- pin disk-write failure after transcript append aborts before assistant/tool
  processing, retains the same-process claim for repair, and never appends the
  source turn again;
- a new session's first user turn is flushed durably before its adopted pin is
  acknowledged, including crash-before-first-assistant recovery;
- a crash with an `adopted` pin before model execution resumes the unanswered
  cycle instead of suppressing it as a duplicate;
- terminal assistant success, model error, and abort each settle the matching
  adopted identity as processed and preserve the correct retry outcome;
- a crash after a non-idempotent tool call is persisted but before its result is
  stored enters the existing unresumable failure path and never executes that
  tool again automatically;
- a blocked unsafe tool tail remains pinned across restart and capacity pressure;
  only an authenticated exact-identity operator no-reply/error disposition can
  release it, the disposition survives a crash at each handoff/commit/cleanup
  boundary, and no test reruns the tool;
- a replay-safe tool may resume only through its existing idempotent contract;
- approval, pairing, and other receipt-backed transcript-free successful
  handlers persist adopted pins before effects, reconcile through existing
  idempotent receipts, then persist terminal pins before replay commit;
- final payload handoff is durable before any covered source pin becomes
  terminal; a crash at each payload/no-reply, pin, replay, and delivery boundary
  recovers without rerunning completed model/tools or losing the reply;
- cursor advancement past N+1 removes its pin and refreshes its ordinary replay
  TTL in cursor/refresh/remove order, and failure after each step remains safe;
- replacing the Messages database at the same local path with one that reuses
  row numbers creates a new generation with distinct holds, pins, capacity
  reservations, and cursors;
- restoring older database contents in place while preserving path, file
  identity, and the live subscription fails the next per-event
  high-water/GUID/row snapshot, atomically fences immediate admission, and
  rotates the generation;
- a remote bridge database replacement uses its new bridge-provided generation,
  while a bridge without that capability stays on the current coalescer;
- an invalid-row correction followed by a valid row fences the source into the
  current ordered path until delivery/no-reply, replay commit, and ownership
  cleanup complete, so the valid row cannot overtake it;
- an earlier immediate row held mid-tool, followed by the first invalid fallback
  row and then another fallback row, processes in that order; neither fallback
  handler starts before the immediate source-drained barrier;
- restart during that transition reconstructs fallback mode and the barrier
  plus every pending database source reference before live dispatch, then drains
  in the same order without duplicate work or copied payload state;
- a remote bridge without exact generation and lossless row replay remains
  current-path-only from startup, so it never creates a mixed immediate/fallback
  crash window;
- failure to resolve or persist a local fallback source reference stops dispatch
  explicitly and cannot release later work around it;
- filling fallback-reference capacity never evicts the oldest pending reference;
  the next transition stops with its cursor unchanged, restart reconstructs all
  prior references, and admission resumes only after cleanup frees capacity;
- a continuity failure followed concurrently by valid-looking rows atomically
  admits no new immediate work until fallback drains, all prior claims, holds,
  and pins clear, and continuity is proven;
- replay commit failure after a terminal output handoff keeps fallback fenced
  through retry and prevents a later valid row from immediate admission;
- transient anchor repair retries in the same row slot with bounded backoff and
  no duplicate timer, then wakes close when repair succeeds;
- monitor teardown cancels repair timers and releases in-memory blockers while a
  restart still begins from the held cursor;
- insertion immediately before empty-and-close wins and causes another cycle;
- insertion immediately after close is rejected and starts one later turn;
- empty queues plus a pending ticket await one signaled generation change
  without busy polling, then deterministically drain or close;
- follow-up insertion has the same before/after-close behavior as steering;
- model error, abort, and terminal teardown reject every still-queued steering
  and follow-up identity so no completion, replay claim, or cursor hold hangs;
- the start-versus-steer race cannot create two active runs or lose a message;
- queue rejection, prompt failure, abort, timeout, restart, and transcript
  commit failure retain existing replay/cursor behavior;
- `/stop`, other commands, reactions, approvals, groups, echoes, catchup, and
  attachment caps retain current behavior;
- reactions never enter immediate admission or depend on ephemeral events for
  durable replay reconciliation;
- explicit message-tool sends retain normal tool semantics;
- rollback durably pauses new source dispatch without cursor advancement, drains
  accepted immediate and already queued fallback work through delivery, replay,
  and ownership cleanup, switches the same package to the current coalescer,
  runs uncapped/unaged cursor catchup to the live row, then permits older package
  replacement at quiescence;
- restart during rollback reconstructs recovery-only mode before live dispatch,
  resumes the full drain and lossless current-coalescer catchup, and never asks an
  older capped/aged implementation to consume the retained backlog;
- recording transports fail unknown writes and no automated test delivers a
  live message.

Latency assertions compare source observation to initial run start and require
no fixed 7/15-second delay. The test fixture controls model/tool completion and
the close race deterministically; it does not use sleeps as proof.

### Rollout and rollback

After approval, implementation, full managed validation, clean review, and
remote checks:

1. Land the disabled steering-admission strategy and cumulative regressions.
2. Promote the exact approved patch through
   `docs/openclaw-setup/patches/apply-and-deploy.sh` with `MINI_HOST` unset on
   the target Mac mini.
3. Verify exact-byte marker, recovery snapshot, gateway health, iMessage
   capability, and read-only no-delivery evidence.
4. Enable for one explicit canary conversation in final source-reply mode.
5. Observe content-free admission accepted/rejected counts, duplicate-run
   count, queue depth, and p95 initial-start latency.
6. Expand only after the canary shows no loss, duplicate reply, or ordering
   regression.

Rollback first durably enters recovery-only mode, then pauses new source
dispatch without advancing the source cursor. Restart reads that mode before
starting live dispatch. The current package remains installed while accepted
immediate and already queued fallback handlers complete durable delivery or
deliberate no-reply, replay commit, and release of every claim, cursor hold, and
pin. Pending-final and delivery recovery remain enabled. A
`blocked_unresumable` identity requires its explicit operator disposition before
quiescence; rollback never resolves it automatically.

At that first quiescent boundary, the same new package switches the source to
the current coalescer and runs the new lossless cursor pager without the old
500-row or age limits until the persisted cursor reaches a freshly sampled live
high-water row and all catchup handlers complete replay commit. New rows that
arrive during catchup extend the target or remain for normal live handling.

Older package replacement is allowed only after this second quiescent boundary,
when the source mode gate has no immediate or fallback handler, pending source
reference, delivery, claim, hold, or pin and no retained cursor backlog. If
catchup or an operator-blocked identity cannot finish, rollback remains
configuration-only on the new package. The persisted mode, references, and pins
use the existing plugin-state schema, so no data conversion is required.

### Review log

- Source tracing on the exact production revision confirms steering,
  multimodal `AgentSession.steer`, active-run registration, and canonical final
  payload selection already exist.
- Cole rejected the prior orchestration-heavy proposal and directed reuse of
  OpenClaw steering, matching other harnesses.
- This revision removes the proposed durable operation, candidate, output
  fencing, lease, route-lineage, quarantine, and package-migration systems.
- The first simplified-design review found three narrow gaps: replay ownership
  must wait for transcript completion, steering must require exact
  source-conversation equality, and follow-up insertion must share the close
  gate. The design now addresses each without adding another queue or durable
  format.
- The recheck found existing transcript waits match text before persistence and
  existing cursor floors omit unresolved live rows. The design now completes
  each steer by unique in-memory identity after successful append and extends
  existing hold-floor bookkeeping across all observed rows.
- The next recheck found replay claim lifecycle was ambiguous. The design now
  holds the claim only while completion is unresolved, commits it after
  persistence succeeds, releases it on failure for normal retry, and clears the
  cursor hold only after replay commit.
- The latest recheck found registration/backend readiness, pre-claim cursor
  ordering, and cancel-versus-drain races. The design now resolves initial
  admission only after the steering backend and close gate attach, installs a
  provisional row hold before the first await, and gives each steering identity
  an atomic queued/draining/settled lifecycle.
- The following recheck found the current inbound dedupe wrapper collapses
  committed and `inflight` duplicate outcomes. The design now requires the
  persistent distinction to survive admission, retains the idempotent row hold
  for `inflight`, and clears it only for confirmed committed duplicates.
- The latest recheck found nullable conversation repair conflates retryable RPC
  failure with permanent absence, and exceptional agent exits can strand queued
  identities. The design now uses discriminated repair outcomes, defers normal
  stop-after-turn behind accepted steering, and rejects all still-queued
  identities on exceptional termination.
- The next recheck found successful backend-free completion can also strand
  readiness, and anchor repair can reorder a later same-conversation row before
  affinity is known. The design now settles admission on every terminal-before-
  ready outcome and reserves per-account source order only through repair and
  conversation-lane ticketing.
- The latest recheck found payload preparation was absent from the close
  predicate and CLI backends have no steering queue. The design now counts
  pending same-conversation tickets before preparation and capability-gates the
  immediate path to embedded steer-capable routes.
- The following recheck found an unresolved anchorless row can delay a later
  correction's ticket while an active run closes. The design now makes unknown-
  affinity account reservations provisional close blockers and atomically
  narrows them to the repaired conversation.
- The latest recheck found retry could queue behind its own reservation,
  `/stop` could wait behind unresolved data, and blocked close lacked a sleep/
  wake transition. The design now uses row-keyed resumable slots, preserves the
  existing authenticated stop bypass, and adds a signaled gate generation.
- The next recheck found existing 500-row, two-hour, and retry-give-up catchup
  limits could skip a cursor-held row after restart. The design now pages
  oldest-first from the persisted cursor and forbids those limits from crossing
  the contiguous unresolved row.
- The latest recheck found ordinary replay keys expire after four hours/capacity
  pruning and live repair had no retry scheduler. The design now pins committed
  rows above the cursor in the existing dedupe store with capacity backpressure,
  prunes pins as the cursor crosses, and retries repair in the existing row slot
  with abortable backoff.
- The following recheck found pin writes were best-effort and capacity ignored
  concurrent admissions. The design now reserves capacity before dispatch,
  requires strict pin acknowledgment before assistant/tool processing, stores
  stable source identity for crash reconciliation, and orders cursor cleanup
  before pin removal.
- The latest recheck found adoption was mistaken for terminal completion, first-
  session transcript writes were not durable, and transcript-free successes
  lacked pins. The design now flushes every adopted user turn, keeps claims and
  pins through terminal cycle completion, resumes adopted unanswered turns, and
  pins every successful transcript-free path.
- The next recheck found transcript-free effects could run before pin adoption,
  final source pins could become terminal before durable output handoff, and a
  local pin retry could append twice. The design now adopts before effects,
  retains claims through processed and pending-final states, reuses existing
  idempotent effect/delivery records, and reconciles stable transcript identity
  on every retry.
- The latest recheck found unsafe incomplete tool calls cannot be resumed and
  row numbers can repeat across Messages databases. The design now preserves
  the existing unresumable-tool failure path and keys every source reservation,
  hold, pin, capacity entry, and cursor by database identity.
- The following recheck found path/host identity does not distinguish same-path
  database replacement and notifications may lack row IDs. The design now
  requires a database-instance generation plus finite row ID and falls back to
  the current coalescer whenever either capability is unavailable.
- The latest recheck found file metadata misses in-place restores, rollback
  cannot discard unresolved pins, and reactions have no durable receipt. The
  design now requires source continuity anchors, keeps recovery active through
  rollback drain, and leaves reactions on the current path.
- The next independent review found continuity was only checked at monitor
  startup, reactions still appeared after reservation in operational text, and
  per-event identity fallback could be overtaken by later immediate input. The
  design now revalidates one consistent source snapshot before every live
  reservation, routes reactions before all immediate state, and uses a
  source-wide ordered fallback fence.
- The retained reviewer then found the fallback fence could reopen at
  `terminal`, before replay commit and ownership cleanup, and that the plan used
  an obsolete section contract. The fence now requires delivery/no-reply,
  successful replay commit, and release of every claim, hold, and pin. The plan
  now uses the current `Human design` and `Agent details` structure.
- The next full review found the first fallback handler could start before
  earlier immediate work drained, rollback used a weaker predicate, and
  `blocked_unresumable` had no terminating safe disposition. The design now
  persists a reconstructible source barrier before fallback release, makes
  rollback pause dispatch and use the same quiescent predicate, and adds an
  explicit authenticated operator no-replay disposition.
- The following review found mode alone could not recover a fallback event that
  lacked replay identity, and an older rollback target could age- or row-cap the
  paused backlog. Immediate mode now requires exact replay capability, local
  fallback persists only stable Messages source references before waiting, and
  unsupported remote bridges remain current-path-only. Rollback keeps the new
  package installed for lossless current-coalescer catchup before any older
  package replacement.
- The latest review found ordinary plugin-state pruning could silently evict
  pending fallback references. The design now reserves bounded non-expiring
  capacity atomically, excludes pending references from ordinary pruning, and
  stops source dispatch without cursor movement when full.
- A fresh complete-diff recheck found no actionable high-confidence issues.
  Implementation still must prove the planned crash, capacity, recovery,
  rollback, and integration behavior against actual APIs.
- Landing is intentionally held until cron-reader PR #56 merges; no public head
  movement will occur before coordination clears.

### Checklist

- [x] Reopen the task after Cole's design correction.
- [x] Reconfirm existing agent-core steering and multimodal session support.
- [x] Identify the narrow iMessage serialization, text-only wrapper, and close-race gaps.
- [x] Replace the orchestration-heavy proposal with the minimal steering design.
- [x] Complete independent adversarial review and resolve actionable findings.
- [ ] Land the reviewed documentation-only revision and pass remote checks.
- [ ] Return issue #28 and Todoist to Cole for design approval without deployment.
