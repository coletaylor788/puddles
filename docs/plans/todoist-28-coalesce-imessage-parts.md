# Drain active iMessage input before replying

- **Status:** Steering-based design passed retained review; exact candidate ready
- **Issue:** https://github.com/coletaylor788/puddles/issues/28
- **Last updated:** 2026-07-31
- **Owner:** Cole Taylor

## Human section

### Design

The current fix waits before it starts some iMessage turns. That delay helps
join split text, links, and images, but it slows every affected message and can
still miss a later correction. The replacement starts normal processing as soon
as the first message arrives. More input from the same conversation enters the
active run through the agent's existing steering path. One close gate tracks
everything already admitted, including slow attachment preparation. The run
sends one final reply only after that gate is empty and stays empty through the
final close check. Input that arrives after close starts the next normal turn.

Each source event keeps its arrival order and becomes durable before the model
can see it. Prepared input stays hidden until the correct run adopts it, then it
appears once as a normal user turn. Source checkpoints bind each saved database
row to its real message identity. A normal deletion of old committed messages
shrinks that checkpoint and, when needed, rewinds the saved row boundary so a
future reused row cannot be missed. A changed binding, reordered row, or new row
inside the committed range still stops for review. Database replacement and
restart reconcile the remaining exact committed prefix before replay continues.
The prefix comes directly from stable database rows and does not change when
message parsing changes.

Immediate mode requires the bridge to replay every row after the saved cursor
with no fixed lookback clamp. Existing stale-message time limits still decide
whether an old ordinary message may start an agent turn. They no longer discard
source ownership. The source records the age window and reply eligibility once
when it first observes the row, before that row can wait behind other work. A
live row stays replyable while the same process drains its queue. After restart,
the source keeps the saved age-window class and checks the same two-hour recovery
cutoff that current restart replay uses. The restart time is sampled before
other startup work, so startup cost cannot consume that window. A restart within
the recovery window preserves the reply. A row older than that window becomes a
durable no-reply and can never become replyable again. Stale rows still advance
the cursor and checkpoint in order. If the source timestamp is missing or
invalid, observation time starts the recovery window so restart behavior remains
defined without suppressing a live message. Current handling can keep such an
undated row eligible through an unlimited outage. This proposal intentionally
bounds it to two hours from observation, matching the normal recovery window.
Accepted input, reply delivery, and source ownership recover together. An
ambiguous database change or an unknown non-repeatable tool result stops for
operator review instead of guessing and risking loss or a duplicate effect.

Each ordinary row uses one durable lifecycle record with one stable identity for
its whole lifetime. Its observation state, source generation, preparation
state, and replay identity live inside that record. Moving from observation to
preparation updates the record once and keeps the same capacity token. It never
needs a second reservation or a cross-record transaction, so a full pool cannot
block its oldest row from draining.

Stops and reactions use the same ordered source gate. Stops keep their current
authorization and behavior, but record the exact older work they may cancel so
recovery cannot target newer input. General reactions still create no agent
turn. Approval reactions keep their existing receipt behavior. Live reaction
notifications and the approval poller use the same real database row and message
identity, while any synthetic approval key stays outside source replay state.
They join one owner, so the same approval cannot be applied twice. A blocked
candidate returns control to the poller at once and retries on a later interval
instead of stopping future polls. A missed approval already behind the source
cursor uses a separate recovery claim, not a cursor-relative turn pin. That
claim survives restart, releases when the approval receipt confirms completion,
and cannot consume normal message capacity. Sources that cannot prove a stable,
replayable identity keep the current coalescer and stop path as one unchanged
unit.

Immediate admission is opt-in. The local source needs an operator-reviewed
starting boundary because its message database has no immutable generation
identity, then it validates the full committed prefix before each admission. It
must also prove unbounded ordered replay and real reaction identity. Remote and
legacy sources stay on the current path until they can provide the same proof.
Production remains unchanged until Cole approves implementation. Rollback keeps
the deployed version, drains accepted work, catches up the source without loss,
and switches configuration back to the current coalescer.

### Status

The design keeps live queue delay from changing reply eligibility, preserves
the original age class across restart, and applies the existing two-hour
recovery cutoff to eligible pre-adoption rows. One stable non-expiring lifecycle
record carries the row and its single capacity token through observation,
preparation, processing, and replay commit. Fresh terminal review remediation is
complete, and retained complete-diff review is clean. The exact documentation
candidate is ready for final review. Production remains unchanged,
implementation is not approved, and public landing waits for prerequisite PR
#56.

## Agent section

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
revision. Repeated complete-diff adversarial review hardened generation,
recovery, stop, hook, reaction, and rollback boundaries. The latest recheck
found that non-slash stop triggers could bypass the journal and that successful
bridge receipts do not always include an external GUID. The next review found
that a legacy current-path source may also omit stable stop identity. This
revision uses one shared normalization and authorization decision at the source
gate and downstream fast-abort path, routes every accepted trigger on an
identity-proven immediate source through the same journal, treats a successful
receipt with an optional GUID as terminal, and keeps identity-lacking sources
wholly on their existing message and stop path. The latest review found that a
completed stop behind an unresolved predecessor could replay after ordinary
dedupe expiry. The full journal now compacts to a non-expiring terminal
tombstone that remains until contiguous cursor and checkpoint crossing. The
next review found older prepared input could resolve into a shared stopped
session after the fence released. The stop snapshot now includes every
pre-cutoff matching or unresolved prepared identity and keeps newer
shared-session admission fenced until each match is durably suppressed. The
latest review also found that predecessor transcript readers cannot preserve the
new prepared/adoption record ordering. Rollback is now configuration-only on the
deployed package, with binary downgrade prohibited. The next review found that a
historical stop replay after database replacement could affect current work
before continuity classification. Stop effects now require an unchanged-
generation/new-row proof or replacement-prefix classification first; historical
prefix members are durable no-effect. The latest review found live tombstones
could be lost when replacement changed their generation and row key.
The next review found the same gap for live reaction markers. Reconciliation now
migrates every live stop tombstone and reaction marker by stable GUID before
catchup, or remains blocked on an ambiguous match. A fresh review then found
close could wait on a ticket while holding the transcript lock that ticket needs
for preparation. Close waiting now uses the existing fenced lock
release/reacquire and transcript merge boundary. The latest review found a
matching cursor-row GUID still cannot prove an older legacy prefix. Automatic
nonempty bootstrap now requires a preexisting full-prefix commitment or
immutable database identity; the current deployment needs an operator-reviewed
boundary. The latest recheck found and removed one stale acceptance criterion
that still allowed cursor-row-only proof. The next review found runtime forks
could preserve all boundary anchors while changing an earlier committed row.
The current source now recomputes the full committed row/GUID bindings and
digest before every admission; only a genuine immutable generation ID can
replace that scan.
The latest review found stale text that could let reactions bypass this gate.
Live reactions and new polled rows now pass FIFO continuity and prefix validation
first; a historical polled approval instead proves its exact committed-prefix
row before the receipt path. General reactions use sparse-marker enqueue and
receipt-backed approval reactions use their adopted-pin receipt path. The latest review found the independent approval
poller remediation mixed its synthetic approval key with the database source
GUID and could hold the timer while waiting for FIFO ownership. The design now
uses the real database row/GUID for all source state, keeps synthetic data out of
that state, and gives polling a prompt completed, pending, or rejected result.
The next recheck found a historical approval could leak a cursor-relative pin
below the already committed cursor. Historical approvals now use a separate
durable effect-claim class and capacity pool. Receipt confirmation releases that
claim without cursor movement, while restart reconciles rather than sweeps it.
The complete current-diff recheck found no actionable issues. Remaining bridge
capability, stop-latency, and restart-barrier proof belongs to implementation
validation after approval. Fresh terminal review then found that the shared
prefix still depended on parser classification and that the existing 500-row
constant is a replay floor clamp, not pagination. The design now uses a
version-stable structural database prefix and requires proven unclamped ordered
replay from the saved cursor before enrollment. The complete corrected-diff
recheck found no actionable issues. Fresh terminal review then found that an
old message deletion would look like a database fork and that removing the
existing age fences would let stale Push-recovery rows generate replies. The
design now stores exact row bindings so a pure committed-row deletion can
shrink the checkpoint safely, and treats the existing live and recovery age
limits as durable no-reply dispositions rather than cursor skips. The latest
recheck found one sentence that could preserve an old startup high-water across
restart. It now requires a fresh startup sample, preserving the existing
two-hour window for outage messages, and the empty-prefix fixture explicitly
proves numeric cursor `0` is not collapsed to absent. The retained reviewer
rechecked that corrected diff and found no actionable issues. Fresh terminal
review then found that an observed stale live row could become replyable after
restart and that a replyable live row could age out while waiting behind an
older FIFO entry. The source now persists one bounded, non-evicting
observation classification before FIFO delay. Fresh terminal review of the
exact candidate found three remaining defects: older architecture text still
required a second capacity reservation, the proposed cross-key marker rekey was
not supported by the existing store, and an eligible row could reply after an
unbounded outage. The design now uses one immutable lifecycle-record key,
updates generation and pin state atomically inside its value, reserves capacity
only once, and saves a defined age basis plus the existing two-hour recovery
cutoff. A missing or invalid send date uses observation time. Queue delay never
downgrades an eligible row. Restart samples time before other startup work and
performs one one-way recovery cutoff check before agent work, preserving current
recovery behavior while bounding long-outage replies.
Fresh terminal review found one leftover architecture sentence that still
reserved capacity during preparation and no defined restart cutoff for a
missing or invalid send date. The design now reuses the first-observation token
everywhere and uses observation time as the fallback recovery basis. Retained
complete-diff review found no actionable issues, including the explicit
dateless-message tradeoff. The exact candidate is ready for retained and fresh
terminal review. No executable artifact has been approved or changed.

Public plan-only merges are temporarily frozen until cron-reader PR #56 lands so
this documentation change does not invalidate that feature's exact promotion
base. Local design review continues without moving `main`.

### Scope and acceptance criteria

In scope:

- provider-neutral structured active-run steering for prepared text and images;
- capability-gated use on embedded steer-capable routes, with the current
  coalescer retained elsewhere;
- source capability gating on a stable Messages database-instance identifier,
  guaranteed finite row identity for every ordinary event, and lossless row
  replay;
- iMessage admission that does not wait for the active reply to finish;
- same-conversation source ordering through the start-or-steer decision;
- exact source-conversation matching before active-run steering;
- exact per-message persistence completion for duplicate text and images;
- generation-neutral pre-continuity and generation-bound post-continuity cursor
  hold floors across observed live and catchup rows;
- a persisted source fallback/recovery mode reconstructed from existing
  cursor-relative state, without a second message queue;
- a durable ordered-GUID committed-prefix checkpoint that reconciles database
  generations without copying payloads into plugin state;
- pre-enable checkpoint bootstrap only from a preexisting full-prefix commitment,
  an immutable source identity recorded before cursor movement, or an
  authenticated reviewed boundary; a row-only legacy cursor and one matching
  boundary GUID are insufficient;
- generation-safe at-most-once reaction committed-GUID markers without reaction
  transcript turns, durable payloads, or agent pins;
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
- every ordinary notification enters a generation-independent per-account FIFO
  reservation with a generation-neutral hold before continuity inspection, so a
  later row cannot rotate the generation around an unstaged predecessor;
- at first observation, before FIFO waiting or conversation repair, each
  ordinary row atomically reserves one bounded, non-evicting, non-expiring
  lifecycle-capacity token and persists its source row/GUID, sampled
  startup-high-water threshold class, observation time, parsed original send
  time when available, defined age basis, two-hour recovery cutoff, and initial
  disposition; a missing or invalid send time uses observation time as the age
  basis and remains initially eligible like current production; FIFO delay never
  changes it, while restart may only downgrade pre-adoption `reply_eligible` to
  final `stale_no_reply` after the saved recovery cutoff;
- a `reply_eligible` row atomically updates that same stable lifecycle record
  from observation to prepared without a second reservation or capacity check;
  saturation blocks only a new first observation and can never block a row that
  already owns a token from progressing or releasing it;
- observation-classification persistence failure leaves the row behind its
  source hold with no hook, model, tool, delivery, replay, or cursor effect;
  saturation applies source backpressure and never evicts unresolved age state;
- startup restores lifecycle-record capacity and generation-neutral holds
  before source subscription or work admission, captures restart time before
  structural bootstrap, applies the one-way recovery-cutoff downgrade, joins
  replay by exact row/GUID, and never replaces a saved threshold class with the
  new startup boundary;
- no later source row can leave its reservation slot until the current row has
  either committed a durable `stale_no_reply` disposition or staged its complete
  text and immutable attachment bytes with a source-identified `prepared` pin;
  that prepared record stays model-hidden until durable adoption;
- source row identity includes account and Messages database-instance
  generation proven by source continuity, so a same-path or in-place replacement
  cannot reuse another database's hold, pin, or cursor;
- live admission revalidates that continuity in one source snapshot before each
  reservation, including the complete ordered row/GUID binding map and digest
  through the committed cursor when no genuine immutable database generation ID
  exists, and atomically repairs a proven committed-row deletion or rotates and
  fences the source on uncertainty;
- a source without guaranteed exact-row replay remains current-path-only for its
  whole monitor generation and cannot have older immediate work to overtake;
- enrollment explicitly probes that the gateway can perform the structural
  source-database read for the configured account; a remote host, unsupported
  wrapper, permission failure, or unavailable database remains current-path-only
  with a clear capability result rather than a generic bootstrap failure;
- a source whose transport contract permits missing or invalid ordinary row
  identity remains current-path-only for its whole monitor generation;
- a runtime identity-contract violation fails the source closed, disables
  immediate mode, and never dispatches that event independently around an
  active immediate turn;
- each contiguous cursor commit atomically advances a durable checkpoint
  containing the versioned predicate and scope, every structural database
  row/GUID binding through the cursor, and a cryptographic digest before pin
  cleanup;
- bootstrap, incremental commit, per-admission validation, catchup, and
  replacement matching enumerate the same set directly from the source database:
  every account-scoped row in the Messages message table at or below the cursor,
  whether or not live notification delivery or the current parser exposed it,
  stored as ordered source-row and real-database-GUID bindings with a digest; if
  the schema cannot distinguish the configured account, the set includes every
  message-table row in that database; any member without a stable real GUID
  blocks the boundary;
- parser, notification-classifier, and catchup behavior changes cannot alter an
  already committed prefix; any intentional structural predicate migration uses
  an explicit versioned re-bootstrap and never replacement reconciliation;
- on the current source, removal of committed rows is accepted automatically
  only when every retained row keeps the same row/GUID binding, no unknown row
  appears at or below the old cursor, and every unresolved identity above the
  cursor still matches; the monitor atomically replaces the checkpoint with the
  retained bindings and rewinds the cursor to the highest retained row when a
  deleted suffix lowered the source high-water;
- a changed row/GUID binding, reordered retained row, inserted or reused row at
  or below the old cursor, missing unresolved identity, or irreproducible
  predicate scope remains a continuity failure and enters generation
  reconciliation;
- initial enablement scans oldest-first through the existing cursor and
  atomically seeds generation, cursor, predicate version, scope, row/GUID
  bindings, count, and digest before any immediate event only after durable state
  proves the complete ordered prefix, an immutable database identity recorded
  before cursor advancement proves continuity, or an operator records a reviewed
  initial boundary; a lone stable GUID match at the cursor row is explicitly
  rejected;
- a same-path replacement before bootstrap cannot inherit the legacy numeric
  cursor without that binding proof;
- a cursor-crossed row without a stable cross-generation identity blocks
  checkpoint advancement and enters reviewed recovery rather than permanent
  skip;
- generation reconciliation maps only the checkpoint's exact ordered remaining
  GUID sequence to the replacement row after that prefix and replays every
  later row in order;
- unresolved identities above the checkpoint remain non-expiring through
  reconciliation and cannot be rerun from the replacement database;
- no automatic transition occurs when the replacement cannot prove the prefix;
  an authenticated operator must durably select a reviewed boundary;
- a local generation change replays only after the replacement database proves
  the durable committed GUID prefix; persistence failure retries reconciliation
  on restart without choosing a new floor;
- generation fencing transfers the trigger and every queued unassigned successor
  with its immutable observation classification to transition ownership,
  detaches all of their old-run blockers, removes their row numbers from old
  cursor accounting, and preserves each marker's capacity plus one source
  transition fence until catchup reconciles them;
- generation fencing pauses ordinary live ingestion, so an operator-blocked
  transition cannot grow an unbounded in-memory backlog;
- an unmatched or ambiguous generation remains fail-closed until an
  authenticated operator records an explicit reviewed source boundary;
- new-generation or capability-loss current-path catchup waits behind every
  earlier accepted immediate identity's full delivery, replay, and ownership
  barrier before processing starts;
- fallback cannot reopen on terminal handoff alone; every earlier accepted
  identity must also complete delivery/no-reply disposition, replay commit, and
  claim, hold, and pin release;
- restart reconstructs fallback or recovery-only mode before live dispatch and
  cannot bypass either source barrier;
- a channel-task restart that leaves reply operations alive preserves unresolved
  source blockers in gateway-process ownership until the replacement task
  reattaches or the matching run terminates;
- on an identity-proven immediate source, every authenticated request accepted by
  the existing stop classifier is journaled immediately after one durable
  epoch/cutoff fence and snapshot of every immutable effect and acknowledgment
  target; effects start only after a consistent source snapshot proves unchanged
  generation and a row after the committed prefix, including full-prefix
  validation when no immutable generation ID exists, while uncertain continuity
  defers effects to reconciliation and a historical row becomes durable no-effect;
- cutoff capture atomically fences descendant creation and new scope admission,
  so pre-cutoff work cannot create a later queue entry, ACP session, subagent, or
  other stop target while journal persistence is pending;
- the cutoff also snapshots every older source reservation and prepared identity
  that may still resolve into the stopped session; newer input that could share
  that session waits until each older identity is classified and every matching
  identity has a durable no-reply stop disposition;
- full-journal failure recovers targets only at or below the durable gateway
  epoch/cutoff; minimal-fence failure admits no newer stoppable work, and process
  restart scans every configured or previously enrolled journal-capable source
  before gateway work admission;
- a disabled source is scanned read-only and an unavailable source keeps the
  global admission barrier closed; an unfenced stop older than the current
  gateway epoch never receives a fresh cutoff and requires an authenticated
  durable no-effect disposition;
- an operator may retire a permanently unavailable source at its last committed
  cursor/checkpoint only by explicitly accepting every unseen later row as
  no-effect; the source remains disabled and cannot return without a full scan,
  reviewed boundary, and new bootstrap;
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
- cancellation that wins while queued preserves the exact prepared transcript,
  pin, claim, and hold and returns that identity to recoverable admission rather
  than deleting or appending it again;
- a later completed conversation cannot advance an account cursor past an
  earlier row that has been observed but has not yet completed claim/repair;
- a duplicate observation of an in-flight row cannot clear that row's cursor
  hold; only a confirmed committed duplicate may clear it;
- a retryable conversation-repair error retains its row hold, while a confirmed
  permanent skip releases it;
- restart and catchup cannot omit the earliest cursor-held row because of age,
  page-size, total-row, or retry-give-up limits; ordinary rows older than the
  existing live or recovery threshold at first observation instead receive a
  durable `stale_no_reply` classification, then cross replay, cursor, and
  checkpoint state normally without model, tool, hook, or delivery work; an
  observed `reply_eligible` row remains eligible through unbounded in-process
  queue delay; after restart, one pre-agent check preserves it only while its
  saved two-hour recovery cutoff remains open and otherwise atomically
  downgrades it to final `stale_no_reply`;
- enrolled recovery passes the persisted cursor directly to a bridge contract
  that proves complete ordered replay of every later row; the existing
  500-row lookback floor clamp is removed for enrolled accounts and is never
  treated as pagination;
- an ordinary row's first-observation lifecycle token is its only pin-capacity
  reservation; conversion to prepared performs no capacity check, while a path
  without an observation record reserves once before dispatch; a state-write
  failure aborts before assistant/tool processing;
- a first-session user turn is actually flushed before adoption is acknowledged;
- general reactions enter the source FIFO, continuity check, generation-neutral then
  generation-bound row hold, and atomic sparse committed-GUID state before
  ephemeral enqueue, but never an active-run close ticket,
  steering queue, transcript turn, or pin;
- the non-expiring marker remains until contiguous cursor/checkpoint commit
  crosses the reaction, even when an older row stays unresolved beyond ordinary
  replay TTL; the FIFO ticket remains held through post-marker enqueue, so later
  rows cannot overtake it; crash after commit may drop that ephemeral event but
  restart never enqueues the same GUID twice;
- sparse reaction-marker capacity never evicts unresolved entries; saturation or
  persistence failure stops before enqueue with source cursor and hold intact;
- eligible transcript-free effects receive durable adopted ownership before
  execution and use an existing idempotent effect or delivery receipt before
  terminal commit; reaction payload handling retains its current ephemeral
  behavior;
- live and polled discovery of one approval reaction use the byte-identical real
  database row/GUID as source identity; the poller's synthetic approval key is
  never used in a FIFO slot, pin, marker, prefix checkpoint, or generation
  reconciliation record;
- a polled approval reaction above the cursor joins normal row ownership, while
  one at or below the cursor may use a receipt-backed historical effect claim
  only after the current full-prefix proof confirms that exact row/GUID; this is
  a separate record class and capacity pool, not a cursor-relative pin, and the
  historical path does not change cursor or checkpoint state;
- a historical effect claim is non-evictable until its existing approval receipt
  proves terminal, then deletes and releases its capacity without cursor
  movement; restart reconciles it against that receipt and neither the
  cursor-crossing cleanup nor the below-cursor pin sweep may delete it;
- poll submission returns promptly as `completed`, `pending`, or `rejected`;
  pending joins one monitor-owned slot and leaves the interval free to poll
  again, and only completed stops polling for the resolved target;
- a poll result without a finite real database row and real database GUID
  performs no effect, reports an identity gap, and leaves live or catchup
  ownership available without fencing an otherwise healthy enrolled source;
- immediate mode remains unavailable for an account unless the bridge history
  contract proves it can expose the real row and GUID for approval reactions;
  safe rejection alone is not accepted as working poller support;
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
  pins and observation classifications are states of one bounded non-expiring
  lifecycle record in the existing plugin-state dedupe store; its immutable key
  stays stable while generation binding, replay identity, reply disposition,
  and lifecycle state change atomically in the value, which contains no message
  payload;
- immediate enrollment requires the configured plugin-state store to expose its
  atomic single-key update operation; a store without that optional capability
  keeps the account wholly on the current coalescer;
- a CLI-backed, otherwise non-steerable, or source-identity-incomplete route
  remains on the current coalescer and cannot strand immediate admission;
- rollback pauses new source dispatch without cursor advancement, reconstructs
  recovery-only mode after restart, applies the full fallback drain predicate,
  catches up on the deployed package, then stays on that package with the current
  coalescer enabled because its prepared/adoption transcript format is not
  backward compatible; and
- the documentation-only revision is independently reviewed and landed without
  production changes.

### Architecture and decisions

The design adds no new queue. It connects iMessage to three existing OpenClaw
owners:

- **Normal inbound preparation** recognizes emergency stop before source
  admission. Reactions use normal payload handling after generation-safe source
  bookkeeping. Eligible ordinary input continues to route/session identity,
  hooks, prompt text, media, and replay metadata.
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
cursor. Startup/reconnect checks continuity before subscription. Every live
ordinary notification first acquires a generation-independent per-account FIFO
ticket. Only when that ticket reaches the head does one consistent source
snapshot read the current high-water row, the observed event row/GUID, and
continuity proof through the committed cursor. A source-provided immutable
generation ID is sufficient only when its contract guarantees it changes for
every replacement or historical mutation. The current local source exposes no
such ID, so each admission scans ordered stable GUIDs through the committed
cursor and compares the exact row/GUID bindings with the stored checkpoint.
Boundary anchors and file identity are supporting evidence only. An exact match
proves the committed prefix unchanged. A strict subset is a benign committed-row
deletion only when every retained row keeps the same row/GUID binding, no
unknown row exists at or below the old cursor, and every unresolved identity
above the cursor still matches. The monitor atomically replaces the checkpoint
with that subset. If a deleted suffix lowered the high-water row, it also
rewinds the cursor to the highest retained row, or the empty boundary, before
live replay resumes. This prevents SQLite row reuse from landing below the saved
cursor. A changed binding, reordered row, inserted or reused row inside the old
committed range, missing unresolved identity, irreproducible predicate scope,
event mismatch, or any other unprovable continuity atomically closes immediate
admission for that source and rotates the generation before it can accept
another immediate event. Immediate capability also requires the transport
contract to guarantee finite row/GUID identity for every ordinary event and
every authenticated stop request accepted by the existing classifier, and
complete ordered `since_rowid` replay from any persisted cursor with no fixed
lookback clamp. Every cursor-crossed row in that replay stream must expose a
cross-generation stable identity. The current
`IMESSAGE_RECOVERY_MAX_ROWS` calculation is a hard floor on `watchSinceRowid`,
not pagination, so enrolled accounts remove that clamp and pass the persisted
cursor directly. Enrollment requires a startup capability probe and a fixture
with more than 500 later rows proving that `watch.subscribe` emits every row in
order. A source whose event contract
permits missing identity, including an unequipped remote bridge, remains
current-path-only for the entire monitor generation. A generation change starts
a separate cursor/hold/pin namespace and never transfers old in-memory lanes
into the new generation.

Every prefix operation uses one versioned structural database enumeration that
does not call notification parsing or catchup classification. It selects every
row in the Messages `message` table for the source account at or below the
cursor, including rows never surfaced live, and orders each real database GUID
with its source row ID. If the schema cannot distinguish the configured account,
the predicate includes every message-table row in that database. The checkpoint
stores which scope variant was used, the complete ordered row/GUID binding map,
its count, and a cryptographic digest. Bootstrap, incremental cursor commit,
per-admission validation,
historical-reaction proof, catchup, and replacement reconciliation share that
exact predicate. Parser and classifier upgrades therefore cannot change an
existing checkpoint. A qualifying row without a stable real GUID blocks the
boundary. Any future structural predicate change increments its stored version
and requires an explicit reviewed re-bootstrap. A scope variant that cannot be
reproduced does the same. Neither case is interpreted as a database replacement.
Enrollment probes this direct read capability separately from bridge replay and
reaction-history capability. A remote source, unsupported local wrapper,
permission failure, or unavailable database fails the probe clearly and keeps
the whole account on the current coalescer.

Before the feature switch enables immediate admission for an existing account,
the monitor must bind the path-scoped legacy cursor to the current database. It
may automatically trust a nonempty prefix only when durable state already
contains its ordered row/GUID binding commitment or an immutable source database
identifier that was recorded before any row in that cursor range was crossed.
The current row-only cursor and transcript/replay evidence for a GUID at its
boundary do not prove earlier rows, even when that exact GUID still matches.
Without full historical proof, an authenticated local operator must inspect the
source and explicitly accept the initial committed boundary before any scan can
seed it. An empty cursor may seed an empty prefix after recording the current
generation. The oldest-first scan then computes and atomically persists
`(dbInstanceId, cursor, predicateVersion, scopeVariant, rowGuidBindings, count,
digest, bindingProof)`. Bootstrap is read-only against Messages. Any RPC/read
error, full-prefix proof mismatch, continuity gap, or row without stable
identity fails bootstrap closed and leaves the account on the current coalescer.
Remote sources require equivalent full-prefix or immutable-identity proof, or an
authenticated reviewed boundary; otherwise they remain current-path-only.

Each source has an arrival-order mode gate shared by immediate and current-path
handling. Its FIFO head is the only operation allowed to inspect or change the
generation. A source that lacked capability at monitor startup never entered
immediate mode, so it needs no mixed-mode transition. For an immediate-capable
local source whose head snapshot proves a generation change, the monitor
atomically persists recovery-only mode and the barrier to unresolved
old-generation ownership. It pauses live dispatch and does not release the
triggering notification as a separate handler. Once the source mode gate
prevents any new old-generation attachment, it atomically transfers the trigger
and every queued unassigned successor from the admission FIFO to a fenced
transition backlog with their stable lifecycle records, threshold classes,
recovery cutoffs, and current dispositions, detaches all of their unknown-affinity
blockers from every old-generation run, preserves lifecycle capacity, converts their
generation-neutral holds into one transition-owned source fence outside old
cursor accounting and the old-generation ownership barrier, and wakes those
runs. It pauses the ordinary
live subscription. Any callback that reaches the gate after the fence records no data reservation
or cursor result and returns, because lossless catchup owns its source row. A
control-only notification path may still persist the exact-effect stop journal
without admitting row work. It performs no stop effect or acknowledgment until
replacement catchup classifies the GUID after the matched committed prefix; a
GUID inside that prefix becomes terminal no-effect. After any permitted effects
and terminal acknowledgment disposition finish and catchup commits the matching
GUID to replay, catchup compacts the journal to the same non-expiring terminal
tombstone. Contiguous cursor/checkpoint crossing clears it. Thus only tickets admitted before
the fence enter the transition backlog, which is limited to the finite callbacks
already admitted when the gate was fenced.
Every
normal contiguous cursor commit already persisted the versioned predicate and
scope, complete ordered row/GUID binding map, and cryptographic digest before
ordinary replay refresh or pin cleanup. After
old-generation identities complete durable delivered or deliberate no-reply
disposition, replay commit, and release of every claim, cursor hold, and pin, the
monitor scans the replacement database oldest-first and searches for the exact
ordered remaining GUID sequence. Only that exact sequence establishes the
replacement row that ends the already committed prefix. Same-generation deletion
repair is not available after generation fencing. Lossless current-coalescer
catchup after the matched row owns every unobserved row, including rows before
the triggering notification. Each backlog event is matched by stable row/GUID
to that catchup ownership or rejected as stale before its transition entry is
released; no backlog notification dispatches independently.
Before that catchup may classify or dispatch any row, reconciliation scans the
replacement for every live stop tombstone and reaction marker whose old row
remains above the contiguous cursor. Each stable GUID must match exactly one
replacement row after the prefix. The monitor atomically rekeys each marker to
the replacement generation and row while preserving its capacity reservation
and terminal suppression meaning. Catchup suppresses that row and retains the
migrated marker until the replacement cursor/checkpoint crosses it. A missing,
duplicate, or before-prefix match is ambiguous and leaves the source
recovery-only for authenticated operator reconciliation.

If transition-state persistence fails after the head snapshot proves
replacement, the in-memory source gate remains fenced, dispatch stops, and the
trigger and every queued successor transfer to the transition backlog, detach
their old-run blockers, and convert their neutral holds into the separate
transition fence. This release cannot
admit a replacement event. Restart observes that
the stored generation anchors do not match, reconstructs the old-generation
barrier, and performs the same checkpoint reconciliation before live dispatch.
It never defaults to the database minimum or triggering row. If no exact ordered
remaining prefix exists,
the source remains blocked in recovery-only mode. An authenticated local operator
may inspect both generations and durably record an explicit accepted boundary or
abandon the new generation; no automated timeout or fallback chooses one. A
runtime route capability loss without a database change uses the existing cursor
and already bound holds under the same current generation. The gate may reopen
immediate admission only after old ownership, reconciliation, and current-path
catchup fully drain and continuity/capability is proven again. A merely
`terminal` pin is not sufficient. This can temporarily serialize unrelated
conversations on an uncertain account, but no later row can overtake earlier
immediate or replay-owned work.

For an enrolled identity-proven source, the iMessage monitor applies the existing
abort decision at the same source gate used by ingress and catchup. One shared
helper performs the existing structural-prefix removal, group mention removal,
authorization check, and `isAbortRequestText` classification in the same order
used by downstream fast-abort handling. Both callers consume that single
decision instead of normalizing or classifying independently. Every
authenticated request it accepts, including `/stop`, bare abort phrases,
localized triggers, and group-mentioned stop forms, follows this journaled path
rather than ordinary steering. A source that cannot guarantee a stable,
crash-replayable identity for each accepted stop row remains wholly
current-path-only, including its unchanged fast-stop path, and never enters this
journal. Before the first persistence await on an enrolled source, a
pre-fence stop installs its FIFO ticket, generation-neutral hold, and bounded
journal-capacity reservation while that gate prevents successor progress. Under
the gateway work-registry lock it snapshots a durable gateway epoch and
monotonic creation-sequence cutoff for the affected stop scope, then first
persists the minimal `(sourceGuid, scope, gatewayEpoch, cutoff)` fence. Every
reply operation, ACP session, queue entry, subagent, and metadata target has an
immutable creation epoch/sequence, so the full journal can reconstruct only
targets at or below that fence. Capturing the cutoff under the same registry lock
also snapshots all pre-cutoff source reservations and model-hidden prepared
identities whose final session affinity is either matching or unresolved. It
installs a stop-scope creation fence before releasing the lock. Pre-cutoff
targeted work cannot create new queue entries, ACP sessions, subagents, or other
stoppable descendants after that point. Each unresolved older identity must
finish affinity resolution under the fence. A nonmatching identity transfers
out without being stopped. A matching identity receives a durable no-reply stop
disposition in its prepared record and pin, completes replay ownership without
model or tool execution, and joins the journal outcome set. New admission that
could map to the same session waits until all snapshotted identities are
classified and every matching identity has that durable disposition. This keeps
a newer shared-session message from clearing the abort cutoff before older
prepared input is suppressed. The creation fence remains through those
classifications and dispositions, replay commit, and terminal tombstone
publication. A
post-fence stop instead installs a transient GUID handoff barrier in the existing
catchup slot while the same gate prevents catchup claim or commit for that GUID;
it creates no second row reservation. It persists the same minimal epoch/cutoff
fence and full journal before releasing that handoff. If catchup already committed the GUID, the
control callback performs no effect. The gate remains exclusive until journal
success makes the handoff durably visible or journal failure clears it without
an effect. A process crash leaves either a durable journal or no effect, and
startup catchup resolves the row in source order.

Journal durability is not permission to mutate current work. Before any stop
effect, hook launch, metadata change, or acknowledgment, the source gate performs
one consistent generation snapshot. It must prove the persisted generation
anchors still match, the event row/GUID exists in that generation, and the row
lies after the committed cursor/prefix. That proof may run ahead of unrelated
slow data preparation because it does not rotate generation or advance a cursor.
If any part is uncertain, the journal remains fenced and effects wait for the
serialized continuity or replacement reconciliation owner. Exact-prefix
reconciliation classifies a GUID inside the already committed prefix as
`historical_no_effect` and never runs hooks, aborts, metadata changes, or
acknowledgment. Only a GUID proven after the matched prefix may execute the
recorded stop effects.

Failure after the minimal fence but before the full journal leaves the source
blocked and recovery rebuilds the exact target set from that cutoff. Failure to
persist even the minimal fence performs no effect and keeps a process-global
admission barrier on the affected scope. A full process restart runs a
gateway-wide pre-admission recovery phase over the durable inventory of every
configured or previously enrolled journal-capable source before creating any
new stoppable work. A current-path-only source has no new journal state and does
not join this barrier. Disabled enrolled sources are still scanned read-only. An unavailable
source keeps global stoppable admission closed rather than being omitted. An
authenticated operator may durably dispose its pre-restart unfenced stop rows as
`no_effect`; no automated timeout does so. If the source cannot be read, the
operator may instead durably retire its last known source identity at the last
committed cursor/checkpoint, explicitly abandoning every unseen later row as
no-effect. Retirement opens the global admission barrier but leaves that source
disabled. A later source return is treated as a new untrusted generation and
requires full scan, operator-reviewed boundary selection, and bootstrap before
enablement. Recovery never writes a new
epoch/cutoff fence for an unfenced pre-restart stop and never executes it against
newly resolved targets. It either proves the original durable fence, records the
reviewed no-effect disposition, or remains blocked.

The bounded non-expiring source-GUID journal snapshots immutable reply-operation
IDs, ACP session IDs, queued-work generation/cutoff, subagent run IDs, session
abort-metadata target/version, pre-cutoff source reservation/prepared identity
IDs with current affinity state, and a stable journal acknowledgment identity
and target before any stop effect. An unresolved affinity remains a journal
target, not an omission. Existing stop behavior then acts only on recorded or
subsequently classified matching targets at or below the cutoff. Each exact
operation and prepared no-reply disposition is idempotent; the journal durably
stores its actual outcome before marking that effect complete. After all
affinities and outcomes are known, it derives and durably freezes the final
acknowledgment payload and target. A token-bearing compare-and-swap changes acknowledgment state from
`ready` to `dispatching` before the single iMessage send call. A normal success
records the complete returned receipt and an external GUID when the bridge
provides one; success without a GUID is still terminal. A normal failure records
`failed`. Process crash, timeout, or disconnect after `dispatching` records
`unknown_after_dispatch` on recovery and never retries because the bridge cannot
reconcile that external send. These are all terminal acknowledgment
dispositions. This explicit at-most-once policy may lose the acknowledgment in
the unknown crash window but cannot duplicate it or block source commit.

Every live, control-only, replay, and catchup stop dispatcher must acquire one
atomic execution lease keyed by source GUID and journal identity before any
effect. The journal moves
`unstarted -> owned -> effects_complete -> replay_committed -> tombstone`.
`owned` stores the gateway epoch, a unique fencing token, and whether this is an
initial or recovery pass. A dispatcher joins any owned journal whose exact
epoch/token is registered live in the gateway. It atomically reclaims any owned
journal when the epoch is older or the current-epoch token is conclusively
unregistered, replacing both epoch and token before resuming unfinished effects.
This same rule applies after any number of recovery crashes. The journal
coordinator keeps the winning token registered through replay commit and
terminal tombstone publication.
Every runner-owned mutation uses a token-bearing compare-and-swap, including
generic hook markers, effect outcomes, frozen acknowledgment, dispatch state,
effects-complete transition, source replay commit, terminal tombstone
publication, cursor/checkpoint crossing, and tombstone clearing. A stale runner
therefore cannot
mutate or erase reclaimed state. A dispatcher that finds a matching live owned
runner joins its completion and does not execute effects.
Catchup may take the lease only before its handler starts. A post-fence callback
that races an already claimed row either publishes the journal before execution
and becomes or wakes its single runner, or joins the runner already executing
that journal. Process crash releases only the in-memory lease; durable per-effect
outcomes let recovery resume the one journal without applying completed effects.

The journal effect set is path-specific and cannot add behavior. The existing
iMessage fast-stop path emits plugin `message_received` and internal
`message` plus `message:received` hooks before returning, so the journal
preserves them as two coarse at-most-once journal effects. One effect invokes the
existing plugin dispatcher. The other invokes the existing internal dispatcher,
which keeps generic handlers before specific handlers and passes the same
mutable event/context object through the complete chain. The runner durably
marks a dispatcher effect `started` before invoking it through the existing
fire-and-forget wrapper. `started` is the effect's terminal durable handoff and
the runner does not await, record, or gate on handler completion. After any
process crash, recovery changes a not-yet-started hook effect to
`skipped_after_crash`; a started effect is already terminal and never invokes
again.
This matches best-effort hook behavior, prevents duplicate side effects, and
requires no serialized hook arguments, configuration secrets, handler IDs, or
registration migration. The fast path returns before regular
stop-command hooks, so its journal contains no `command:stop` hook effect and
recovery never invokes one. Any future reuse by another path requires its own
reviewed hook contract rather than inheriting one here.

The pre-fence stop row receives its generation/new-row proof before effects,
then continues through serialized continuity, replay, cursor, and checkpoint
disposition without a run-close blocker, transcript turn, or agent pin. If the
fast proof is unavailable, serialized continuity owns classification before any
effect. A post-fence journal hands the same GUID back to existing catchup
ownership after persistence and waits for prefix reconciliation. Replay commit
and terminal tombstone publication occur only after every permitted effect
outcome and terminal acknowledgment disposition are durable. A
`historical_no_effect` classification clears the journal only after durable proof
that the matched committed prefix already crosses that GUID. Journal-capacity or persistence failure performs no effect, fails
source bookkeeping closed, and leaves the row to ordered lossless replay. No
journal-less path may resolve current work.
All other
cursor-advancing events, including reactions, append a source FIFO ticket and
install a generation-neutral hold before continuity inspection. Unless the
source gate is already fenced, an ordinary notification additionally registers
an unknown-affinity blocker with all open and subsequently attached run gates on
that account before waiting for predecessors. An event arriving at a fenced gate
returns without row ownership because catchup owns it. A reaction registers no
active-run close ticket or blocker. At the
FIFO head, the monitor validates continuity. If continuity holds, it atomically
binds the neutral hold to the proven generation and assigns or resumes one exact
row slot keyed by
`(accountId, dbInstanceId, rowid)`. A runtime event that violates the transport's
finite row/GUID guarantee fails the source closed and disables immediate mode; it
does not take an independent current-path shortcut. Duplicate delivery or source
retry of row N joins N's existing row slot when it reaches the FIFO head rather
than appending the source turn again. A reaction uses explicit at-most-once
handling. While its FIFO ticket and generation-bound hold remain exclusive, it
atomically reserves bounded non-evictable marker capacity and persists a compact non-expiring
`(dbInstanceId, rowid, guid, committed)` sparse marker before the existing
in-memory enqueue. The marker is excluded from replay TTL/entry caps and remains
until contiguous cursor/checkpoint advancement crosses that GUID, even while an
older unresolved row floors the cursor. The monitor then attempts enqueue and
releases the FIFO ticket. Enqueue failure is surfaced but does not undo the
at-most-once marker. Restart suppresses enqueue for a marked GUID and
reconciliation carries the stable marker across a proven database generation.
A crash after marking can lose the ephemeral event, as the current in-memory
queue can, but cannot duplicate it. No reaction payload, transcript turn,
prepared pin, or steering admission is persisted. Capacity or persistence
failure stops source dispatch before enqueue and leaves cursor/hold ownership
for retry. An ordinary event instead repairs or confirms the
conversation anchor and synchronously appends its admission ticket to the
resulting per-conversation lock. The ticket immediately counts as pending work
in the conversation's close predicate. While still holding the row slot, the
monitor reuses the row's existing first-observation lifecycle token without a
capacity check, snapshots immutable attachment bytes, and flushes the complete
source-identified user turn to the existing transcript as a hidden `prepared`
record, then atomically updates that same lifecycle value to `prepared`. Every history,
compaction, retry, and recovery loader excludes prepared records that lack a
durable adoption marker. It then atomically
transfers the unknown blocker to that conversation ticket, releasing unrelated
run gates, before releasing the FIFO ticket. A permanent skip releases the
blocker; a retryable repair or preparation failure retains the same row-keyed
slot, FIFO head, and hold for retry, process teardown, or restart. History and
context preparation continue from the durable record after FIFO release. This
prevents row N+1 from acquiring a conversation lane before potentially matching
anchorless row N or before N is crash-recoverable, and prevents any possibly
matching active run from closing first. Other accounts remain concurrent.

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

Each source identity has one lifecycle:
`reserved -> prepared -> queued -> draining -> adopted -> processed -> terminal`
back to `prepared` when ordinary queued cancellation wins. `prepared` means the
full source turn and immutable media are flushed and its strict pin is durable,
but it is model-hidden and history/context preparation or active-run admission
may still be pending. Recovery resumes those steps from that exact transcript
record. A preparation or
pin-write failure keeps the row slot and retries against the stable source
identity; it does not release into a second append. Model error or abort settles
an adopted identity as processed failure. Timeout may dequeue the exact identity
only by winning `queued -> prepared`; the source handler retains claim, hold, and
pin and re-enters normal admission from that record. Authenticated stop keeps its
existing explicit command disposition. Once queue drain wins, cancellation
cannot release replay ownership. Durable adoption, cycle processing, and final
output handoff settle their separate transitions. This prevents retry from
racing with a message that has left the queue and prevents an unanswered or
undelivered adopted turn from being mistaken for completed work.

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
  captures the gate generation, releases the session transcript lock through the
  existing prompt-release fence/merge mechanism, awaits its change, reacquires
  the lock, merges intervening transcript entries, and rechecks; a prepared
  record remains model-hidden during that merge until adoption;
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

The loop never waits on a pending reservation or ticket while retaining the
session transcript lock. It captures gate generation before the existing
prompt-release handoff. A change before release or while the lock is free is
observed immediately after handoff. Reacquisition uses the existing fenced
session-lock token and transcript merge, so a stale writer cannot overwrite the
new prepared record. Final close is allowed only after lock reacquisition and a
fresh atomic check of the gate, queues, reservations, and tickets.

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
boundary installs a unique generation-neutral
`(accountId, fifoTicketId, observedRowid)` hold before any repair, dedupe claim,
or dispatch await can yield to a later row. Before continuity, it prevents any
same-source cursor commit from passing the observed row but belongs to no
database generation's ownership barrier. Only the
FIFO-head continuity snapshot may atomically bind it to
`(accountId, dbInstanceId, rowid)`. A replacement instead transfers it to the
source-wide transition fence and removes its row number from old-generation
cursor accounting. Lossless catchup later matches or reconciles the backlog
row's stable identity under the new generation.
Conversation repair
returns a discriminated result: `repaired(message)`, `permanent_skip(reason)`, or
`retryable_failure(error)`. A complete successful search with no usable
conversation anchor may be permanent only when the source row has a stable GUID.
A missing message GUID enters fail-closed reviewed recovery and cannot cross the
cursor/checkpoint. Any chat-list/history RPC error makes the result retryable
rather than indistinguishable `null`. Successful repair and claim
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

An ordinary row reserves its one bounded lifecycle-capacity slot at first
observation. That same slot protects every later cursor-relative state, so claim
and dispatch never reserve or check capacity again for that row. A path without
an observation record atomically reserves one slot before claim or dispatch.
The shared count includes each lifecycle record and each not-yet-persisted
reservation exactly once, so concurrent lanes cannot both consume the last
slot. At capacity the monitor backpressures only new reservations and leaves
them recoverable from the unchanged cursor. Existing token holders always remain
able to advance and release capacity.

Each reserved user message has one immutable lifecycle key derived from its
generation-neutral source identity. Its durable value gains database generation
and replay identity after continuity binds them. The transcript carries those
fields in metadata. Before its source-order slot releases, the transcript
layer's append-and-flush operation writes the complete text and immutable media
snapshot as a model-hidden prepared record, including a new session's first user
turn, and atomically updates the same non-expiring lifecycle value to
`prepared` through the existing plugin-state dedupe store. Every path that
constructs model history, including retry, compaction, and recovery, excludes a
source record until its durable adoption marker exists. Unlike the generic best-effort dedupe
helper, both writes require durable acknowledgment. A crash between transcript
flush and pin is reconciled by the stable transcript identity. In the same
process, strict pin-write failure retains the source claim and row slot and
retries the pin against that identity.

After history/context preparation and queue drain take ownership, the adoption
callback first strictly promotes the existing pin from `prepared` to `adopted`,
then appends and flushes one source-identity-keyed adoption marker before any
assistant/tool cycle starts. That marker makes the existing record model-visible
and does not append the turn again. A crash after pin promotion but before the
marker completes the marker on recovery; a marker for the same source identity
is idempotent. A record cannot return to `prepared` after its adoption marker
exists. Recovery of a `prepared` pin resumes pending preparation/admission,
while recovery of an `adopted` pin resumes or completes marker publication and
then the pending assistant cycle from the same record.

Pins distinguish `prepared`, `adopted`, `processed`, and `terminal`. The source
claim, cursor hold, and pin remain after preparation and adoption while the
corresponding assistant/tool cycle runs. Cycle success or failure moves the pin
to `processed`
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

Every live reaction and every polled reaction above the cursor first passes the
account FIFO, full continuity/prefix validation, generation binding, and replay
ownership before any effect. A polled reaction already inside the committed
prefix uses the historical proof and receipt path below instead of reopening
cursor ownership.
Receipt-backed approval reactions then follow the same durable transcript-free
path as approvals. Approval, pairing, and another transcript-free path may use immediate admission
only when it already has a stable request identity plus durable state transition
or pending-delivery record. It strictly persists an `adopted` pin before the
effect; recovery checks that existing receipt and resumes or finalizes before
moving the pin to `terminal`. A general reaction that is not consumed by a
receipt-backed path instead persists its sparse committed-GUID marker after
continuity, then uses the existing ephemeral event queue without a transcript
turn or agent pin.

The periodic approval-reaction poller never calls the approval handler directly
in immediate mode. It submits the canonical reaction candidate to the same
source admission function as a live notification. The history adapter must
return the finite reaction row ID and real database reaction GUID. The
row/GUID pair is byte-identical across live and polled discovery and is the only
identity used by FIFO, replay, pins, prefix checkpoints, and generation
reconciliation. The existing synthetic poller value may remain inside approval
payload matching, but never enters source state.

Submission never waits for FIFO ownership or source recovery. It joins or
creates one monitor-owned row/GUID slot and promptly returns `completed`,
`pending`, or `rejected`. Only completed handling stops polling for the target.
Pending leaves the timer free to fetch history again, and later discovery joins
the same slot. A candidate without both real identity fields is rejected with no
effect and does not fence a healthy source. A real row/GUID conflict found in a
consistent database snapshot follows normal continuity fencing.

A polled approval reaction above the cursor follows ordinary FIFO ownership. A
reaction at or below the cursor is not discarded merely because the live stream
missed it. After the current generation and full prefix prove that exact
row/GUID, a historical receipt-backed effect claim joins any live owner and
invokes the existing idempotent approval transition. The claim is a separate
plugin-state record class with a separate bounded, non-evicting capacity pool.
It is not a cursor-relative replay pin and never enters turn-pin cleanup. Receipt
confirmation moves it to terminal, deletes it, and releases capacity without
moving the source cursor or changing the committed-prefix checkpoint. A crash
after claim persistence resumes or finalizes against the existing approval
receipt. Cursor crossing and the startup sweep for ordinary pins explicitly
ignore this claim class. Saturation returns pending and keeps polling without
blocking ordinary account dispatch. Missing proof, a source fence, or an older
FIFO blocker returns pending or rejected without effect and without blocking
later poll intervals.

Immediate enrollment also requires the bridge history capability to return the
real row and GUID for a reaction. A startup capability check and fixture against
the supported bridge response prove that contract before the poller is enabled.
If the bridge cannot provide both fields, the account stays wholly on the
current coalescer; repeatedly rejecting identity-poor poll results is safe but
does not satisfy feature compatibility.

Claim checks both ordinary replay identity and the pin. The pin is excluded from
ordinary oldest-entry pruning until the cursor crosses that row. Cursor crossing
is serialized with pin cleanup. First atomically persist the new cursor and the
next versioned predicate, scope variant, ordered row/GUID binding map, count, and
cryptographic digest for the structural database prefix crossed by that cursor,
including rows never accepted by the current parser. A
GUID-less row cannot be crossed or classified as a permanent skip; it blocks
checkpoint/cursor advancement in reviewed recovery. Then durably refresh the
ordinary four-hour replay entry and remove the pin. A failure at either later
step leaves the pin in place; startup cleanup repeats refresh and removal for
pins already below the durable cursor. The checkpoint is non-expiring and
retained across database generations. Pin removal releases its capacity
reservation and wakes a monitor-owned cursor catchup pass before live admission
resumes. Thus disk failure, a four-hour delay, or 10,000 newer rows cannot convert
adopted work into duplicate side effects.

The existing message-age rules remain reply gates for ordinary inbound rows.
At the first source observation, before FIFO waiting, the monitor compares the
row with that process's sampled startup high-water and, when usable, compares
the original send date with the current wall clock. A row at or below the startup boundary
uses the current two-hour recovery threshold. A later row uses the current
15-minute live threshold, including a delayed Apple Push row that receives a
fresh row ID. Under the source gate, the monitor first reserves bounded
non-evicting, non-expiring lifecycle capacity, then durably records the source
row/GUID, immutable lifecycle key, startup-boundary threshold class, observation
time, parsed original send time when available, defined age basis, the
age-basis-plus-two-hour recovery cutoff, and initial `reply_eligible` or
`stale_no_reply` disposition before the callback can wait in the FIFO or
acknowledge the observation. A missing or unparseable send date remains
`reply_eligible`, matching the current classifier, and uses observation time as
its age basis. The recovery cutoff therefore remains defined and matches what
the current classifier would apply to an already-present row with a usable send
date after restart, regardless of its saved live or recovery class. For an
undateable row, this intentionally narrows current restart behavior from
unbounded eligibility to two hours after observation. That conservative
divergence prevents arbitrarily late replies and is part of the design Cole must
approve. The durable record remains generation-neutral through continuity
validation, in-memory slot binding, and conversation repair. Generation and
replay identity are fields added to its value, not its key. Persistence failure
or capacity saturation performs no effect and keeps the source held for retry.
Capacity saturation stops only new first observations. Any row that already
owns a token can continue every lifecycle transition without another capacity
check.

FIFO delay never compares age again. A `reply_eligible` row proceeds through
normal repair, preparation, and agent work even when an older row delayed it
beyond the wall-clock threshold. Immediately after the state store opens,
startup samples one restart time before structural prefix bootstrap, bridge
probes, subscription, or work admission. It joins each lifecycle record by its
stable row/GUID identity before using a new startup high-water. For a
`reply_eligible` record that has not reached `adopted`, startup compares the
sampled restart time with its saved two-hour recovery cutoff once before source
subscription or work admission. An open cutoff preserves eligibility. An
expired cutoff atomically and permanently updates the same record to
`stale_no_reply`. Recovery always reconciles a stale pre-adoption record with
the model-hidden transcript before source commit: it suppresses any prepared
turn idempotently, including after a crash between the disposition update and
transcript cleanup. `adopted` and later states finish normal recovery because
agent work has already started. A
`stale_no_reply` row still takes FIFO order, continuity, prefix validation,
replay commit, contiguous cursor movement, structural checkpoint update, and
ownership cleanup, but performs no conversation repair, prompt, hook, tool, or
delivery work. Preparation atomically updates the same keyed value to
`prepared`, preserving the single capacity lease, age class, recovery cutoff, and
disposition. A crash exposes one complete old or new value at that key. The
transition never reserves a second unit, and the record is removed only after
replay commit. Crash before the record persists has performed no effect and may
use the new process's recovery classification. Crash after it persists must
preserve its class and recovery cutoff and may only apply the one-way restart
downgrade before adoption. The record is excluded from ordinary TTL and entry-count
pruning in every lifecycle state. Stops and reactions keep their separate
existing behavior.

Using the already sampled restart time, startup scans lifecycle records before
structural bootstrap, source subscription, or work admission. It restores their
capacity reservations and generation-neutral holds, applies the one-way recovery
cutoff downgrade to eligible pre-adoption records, and idempotently reconciles
hidden transcript cleanup before joining ordered replay by exact row/GUID. A
record missing its source row follows normal generation reconciliation and never
silently releases capacity, widens its saved threshold class, or upgrades a
no-reply disposition.

After marker restoration, any remaining replay holds are reconstructed from the
persisted cursor without creating another durable lifecycle record. For an
enrolled account, recovery removes the `IMESSAGE_RECOVERY_MAX_ROWS` floor clamp
and passes the persisted cursor directly to the proven ordered
`watch.subscribe` replay contract. The bridge
streams every later row in ascending order until the contiguous prefix is
resolved. No fixed lookback, result cap, age rule, or retry give-up may discard
source ownership or advance past the earliest unresolved row. A durable
`stale_no_reply`, discriminated permanent skip, or successful agent-path result
must be followed by replay commit before the row is crossed. Existing replay
keys make already committed rows harmless.

Retryable conversation repair is owned by the row-keyed reservation slot. It
schedules one abortable exponential-backoff retry with jitter per row, reusing
the same slot and account close blocker; there is no maximum-attempt give-up
while the monitor remains active. Successful repair transfers the blocker and
permanent skip releases it. Reservation and blocker ownership lives in a
gateway-process registry outside the restartable channel task. A channel-task
disconnect cancels its retry timer but leaves the blocker attached to every
possibly matching active run; the replacement task reattaches to that exact
reservation and resumes repair before live dispatch. Only durable transfer,
permanent disposition, or termination of the corresponding reply operation
releases it. Full process teardown may discard the in-memory registry because
the same teardown terminates those runs; startup reconstructs source work from
the persisted cursor and pins before admitting new live runs.

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
   require a source-backed local or bridge-provided database-instance generation,
   a transport guarantee of finite row/GUID identity on every cursor-advancing
   event, and lossless exact-row replay. Persist local generation with high-water/GUID
   continuity anchors. After the event reaches the generation-independent
   account FIFO head, validate one consistent source snapshot containing the
   event row/GUID, high-water and boundary evidence, and either a genuine
   immutable source generation ID or the complete ordered row/GUID bindings and
   digest through the committed cursor. The current local source has no
   immutable ID and must perform the full-prefix read-only scan before every
   admission. Treat a strict subset as committed-row deletion only when every
   retained binding matches, no unknown row exists at or below the old cursor,
   and all unresolved later identities remain present. Atomically replace the
   checkpoint and rewind a deleted tail to the highest retained row before
   resuming. Fence any changed binding, inserted or reused old-range row, missing
   unresolved identity, or scope mismatch. Keep a source
   without all capabilities current-path-only for the monitor
   generation; remote bridges remain there until they expose the same guarantees.
   Add an explicit structural-read capability probe for the configured database
   and account. Distinguish remote host, unsupported wrapper, permission denial,
   and unavailable database from a prefix mismatch, and keep every failing
   account current-path-only.
   Assert that the configured plugin-state store exposes
   `PluginStateKeyedStore.update` and prove one single-key old-or-new value
   transition before enrollment. The type marks this method optional, so absence
   keeps the account current-path-only rather than falling back to
   delete-plus-register.
   Before first enablement of a nonempty legacy cursor, require either a durable
   ordered full-prefix row/GUID commitment, an immutable source database
   identity recorded before those rows were crossed, or an authenticated
   operator-reviewed initial boundary. Reject a lone matching GUID at the cursor
   row as insufficient. An empty cursor may seed an empty prefix after recording
   the generation. Then scan oldest-first through the accepted cursor, reject any
   crossed row without stable cross-generation identity, and atomically seed
   generation, cursor, identity count, prefix hash, and binding proof. Leave
   immediate mode disabled on any bootstrap error.
3. On each identity-proven source enrolled in immediate admission, for every
   authenticated request accepted by one shared abort-decision helper, including
   `/stop`, bare abort phrases, localized triggers, and group-mentioned stop
   forms, enter one source-gate critical section before any await. Extract and
   reuse the downstream fast-abort path's exact structural-prefix stripping,
   group mention stripping, authorization, and `isAbortRequestText` order. Make
   the source gate and downstream handler consume the same decision so neither
   can independently reveal a stop the other missed.
   Do not let an accepted stop request enter ordinary steering. Pre-fence,
   install the FIFO ticket, generation-neutral hold, and bounded
   journal reservation before persistence. Post-fence, install a transient GUID
   handoff barrier that blocks catchup claim/commit without creating row
   ownership; join an existing catchup slot or no-op if it already committed.
   Under the gateway work-registry lock, snapshot the affected scope's durable
   gateway epoch and monotonic creation-sequence cutoff. Persist that minimal
   source-GUID target fence first, then keep the gate exclusive until the full
   journal is durable or failure clears the handoff with no effect. Give every
   stoppable target immutable epoch/sequence metadata and rebuild only targets at
   or below the fence. In the same work-registry transaction that captures the
   cutoff, install a scope creation fence that blocks pre-cutoff targets from
   creating queue, ACP, subagent, or other stoppable descendants. In the same
   snapshot, record every pre-cutoff source reservation and prepared identity
   whose session affinity matches or remains unresolved. Keep unresolved
   identities under the fence until normal affinity repair classifies them.
   Transfer proven nonmatches out. Give each match a durable prepared-record/pin
   `stopped_no_reply` disposition, commit its replay ownership without model or
   tool execution, and record that outcome in the stop journal. Wait new
   admission that could share the affected session through classification,
   matching dispositions, replay commit, and terminal tombstone publication. If the minimal fence itself fails, perform no effect and
   retain a process-global scope admission barrier. On process restart, complete
   a gateway-wide source recovery scan across the durable inventory of configured,
   disabled, unavailable, and previously enrolled journal-capable sources before
   any stoppable work admission. Exclude wholly current-path-only sources because
   they create no new journal state. Scan disabled enrolled sources read-only; keep the global
   barrier closed for unavailable sources. Never assign a fresh cutoff to an
   unfenced stop older than the current gateway epoch. Require an authenticated
   durable `no_effect` disposition or remain blocked. Add authenticated
   source-level retirement at the last committed cursor/checkpoint for a
   permanently unavailable source, explicitly abandoning all unseen rows and
   keeping it disabled. Require full scan, reviewed boundary, and fresh bootstrap
   before any returned source can re-enable. In the full journal, snapshot immutable reply-operation
   IDs, ACP session IDs, queued-work generation/cutoff, subagent IDs,
   abort-metadata target/version, pre-cutoff source reservation/prepared identity
   IDs plus current affinity state, and stable journal acknowledgment
   identity/target before mutation. Make every live, control, replay, and catchup
   stop path acquire one source-GUID/journal execution lease. Use
   `unstarted -> owned -> effects_complete -> replay_committed -> tombstone`,
   with owner gateway
   epoch, unique fencing token, and initial/recovery phase. Join any owned state
   only when that exact token is registered live. Atomically reclaim any owned
   state whose epoch is older or whose current-epoch token is conclusively
   unregistered; repeated recovery crashes use the same rule. Keep the winning
   token registered through replay commit and terminal tombstone publication. Require a
   token-bearing compare-and-swap for every hook-dispatch marker, outcome, frozen
   acknowledgment, delivery handoff, lifecycle transition, replay commit,
   tombstone publication, cursor/checkpoint crossing, and tombstone clear. A
   concurrent dispatcher joins a matching live owner and never executes
   effects. Journal persistence and lease ownership do not authorize effects.
   Before hooks, aborts, metadata mutation, or acknowledgment, take one
   consistent source snapshot that proves unchanged generation anchors, the
   exact row/GUID, and placement after the committed cursor/prefix. Without a
   genuine immutable generation ID, recompute and compare the complete committed
   row/GUID binding map and digest in that snapshot. This proof may bypass unrelated
   preparation but may not rotate generation or advance source state. On uncertainty, keep the journal fenced and defer to
   serialized continuity or replacement reconciliation. Classify a GUID inside
   the matched committed prefix as `historical_no_effect`, record no effect or
   acknowledgment, and clear only after durable prefix proof. Execute only a GUID
   proven after the matched prefix. Use exact-target idempotent
   effects, durably record each actual outcome, then durably freeze the derived
   acknowledgment payload/target. CAS acknowledgment `ready -> dispatching`
   before one existing iMessage send call. Record the complete returned receipt
   and optional external GUID on success, `failed` on returned failure, and
   `unknown_after_dispatch` after crash, timeout, or disconnect; never retry
   `dispatching` because the bridge has no reconciliation key. Treat success
   without a GUID and every other disposition as terminal for journal/source
   commit. Build
   the effect list from the existing iMessage fast-stop path only. Include its
   plugin `message_received` dispatcher as one coarse at-most-once effect and the
   existing internal dispatcher as a second. Keep the internal dispatcher's
   generic `message` then specific `message:received` ordering and shared mutable
   context. Mark each dispatcher effect `started` before launch through the
   existing fire-and-forget wrapper. Treat that durable marker as terminal
   handoff: do not await or record handler completion and do not gate stop
   effects, acknowledgment, replay commit, tombstone publication, or
   creation-fence release on
   it. On process-epoch recovery, keep `started` terminal and convert only a
   not-yet-started hook effect to `skipped_after_crash` without invoking it.
   Persist no hook arguments, configuration, handler IDs, or registration
   mappings. Do not add
   regular `command:stop` hooks that path currently bypasses. Start existing stop
   behavior against only those targets. The pre-fence row uses its FIFO hold for
   serialized continuity, replay, cursor, and checkpoint disposition, but no
   close blocker, turn, or pin. Post-fence catchup resumes sole row ownership
   after durable handoff. After every outcome and terminal acknowledgment
   disposition, atomically commit replay and compact the full journal to a
   bounded, non-evictable, non-expiring tombstone keyed by generation, row, and
   stable GUID. Release the runner token and creation fence after that tombstone
   is durable. Keep it through ordinary dedupe expiry and capacity pressure, and
   clear it only when the contiguous cursor and committed-prefix checkpoint
   cross the row. Its original bounded journal-capacity reservation remains
   charged until that clear; capacity exhaustion blocks a newer stop before any
   effect rather than evicting a tombstone. A duplicate or restart that finds
   the tombstone performs no stop effect or acknowledgment and only rejoins
   ordered source bookkeeping.
   Journal failure performs no effect,
   fails source bookkeeping closed, and resolves the row through ordered replay
   without re-resolving live work from that journal-less attempt. Put every other
   cursor-advancing event, including reactions, through the source mode gate and
   account FIFO with a generation-neutral hold before continuity inspection.
   The fenced handoff path uses no FIFO ticket or row hold; transition catchup
   exclusively owns the GUID and first classifies it against the matched prefix.
   Historical GUIDs become durable no-effect. A GUID after the prefix performs
   the exact recorded effects and compacts the journal to the same tombstone
   after outcomes, terminal acknowledgment disposition, and replay commit.
   Contiguous cursor/checkpoint crossing clears it. On
   journal failure, perform no effect and return ownership to ordered catchup
   while the source remains fenced.
   Ordinary events register the unknown-affinity close blocker; reactions do
   not. Only the FIFO head may inspect or rotate generation. After continuity, a
   reaction keeps its bound hold and FIFO ticket, atomically reserves bounded
   non-evictable capacity and persists a compact non-expiring
   generation/row/GUID committed marker, then attempts the existing
   ephemeral enqueue before releasing the ticket. Exclude markers from replay
   TTL/caps and retain them until contiguous cursor/checkpoint advancement
   crosses the GUID. Surface enqueue failure without undoing the at-most-once
   marker. Restart and generation reconciliation suppress enqueue for a marked
   GUID. Capacity or marker failure stops before enqueue with cursor and hold
   unchanged. Persist no reaction payload, turn, pin, or steer. On a proven local generation
   change, persist recovery-only mode and the old-generation ownership barrier,
   then pause live dispatch without separately releasing that event. Fence the
   source mode gate against new old-generation attachments and pause ordinary
   live subscription; callbacks that reach the fenced gate return without
   reservations because catchup owns their rows. Keep only control recognition
   needed to persist an authenticated stop journal without taking row ownership;
   catchup reconciliation must classify the GUID before any effect.
   Atomically transfer the trigger and all queued unassigned successors from the
   FIFO to that backlog with their lifecycle records, saved threshold classes,
   recovery cutoffs, and current dispositions,
   detach all of their unknown-affinity blockers from old runs, preserve marker
   capacity, convert their neutral holds into one source transition fence outside
   old cursor accounting and the old barrier, and wake those runs. The backlog
   is therefore bounded by events admitted before fencing.
   If transition persistence fails after replacement is proven, keep the
   in-memory fence and perform the same full backlog transfer before stopping
   dispatch. After the
   old barrier drains, scan the replacement's ordered stable GUIDs and require
   the exact ordered remaining GUID sequence from the old durable
   committed-prefix checkpoint. Use
   the matched replacement row as the only automatic replay floor. Before
   catchup classification, enumerate every live stop tombstone and reaction
   marker above the old cursor and require each stable GUID to match exactly one
   replacement row after that floor. Atomically rekey each marker to the
   replacement generation/row, preserving its capacity reservation and terminal
   suppression. A missing, duplicate, or before-prefix match blocks recovery for
   authenticated operator reconciliation. Only after all markers migrate may
   unclamped current-coalescer catchup become sole owner of replacement rows.
   Catchup honors saved threshold classes and dispositions after startup applies
   the one-way pre-adoption recovery-cutoff downgrade. A row the prior process never
   accepted is classified once when catchup first observes it against the new
   process's startup boundary. Age never discards source ownership.
   Match each backlog event by stable row/GUID to catchup ownership or reject it
   as stale before releasing its transition entry; never dispatch it independently.
   On transition-state write failure,
   restart detects the anchor mismatch and performs the same
   reconciliation. If no prefix matches, remain blocked for an authenticated
   operator-reviewed boundary. On runtime route capability loss without a
   database change, keep the existing cursor and provisional holds. Reopen only
   after ownership, reconciliation, and catchup drain and capability is proven.
   A runtime identity-contract violation fails the source closed, disables
   immediate mode, and never dispatches independently. On first observation of
   an ordinary event, synchronously reserve its generation-neutral hold and
   one bounded non-evicting, non-expiring lifecycle token under the source gate.
   Before FIFO waiting, compare its row with the sampled startup high-water and
   its send date with the current observation time. Under one immutable
   generation-neutral lifecycle key, persist row/GUID, boundary threshold class,
   observation time, parsed original send time when available, age basis,
   age-basis-plus-two-hour recovery cutoff, and initial `reply_eligible` or final
   `stale_no_reply` disposition. Match existing behavior by treating a missing
   or unparseable send date as initially eligible and using observation time as
   its age basis.
   Do not acknowledge or release the callback into the FIFO until persistence
   succeeds. Failure retains the hold for replay and performs no effect;
   saturation backpressures the source. A duplicate notification or retry joins
   the same record, class, recovery cutoff, and disposition.
   Ordinary events then use a per-account source-order gate with one slot keyed
   by `(accountId, dbInstanceId, rowid)`. At the FIFO head, atomically bind the
   neutral hold and lifecycle record to that slot, adding generation and replay
   identity to the value without changing its key. Continuity and prefix
   validation never recalculate age. A `stale_no_reply` row performs no
   conversation repair, hook, prompt, tool, or delivery work and retains its
   slot and marker through normal replay, cursor, and checkpoint commit. For a
   `reply_eligible` row with unknown affinity, register
   an account blocker against existing and subsequently attached run gates
   before the first repair await. While holding the slot, resolve/repair
   affinity and append the event's ticket to the resulting conversation lock and
   close predicate. Without another capacity reservation or check, snapshot
   complete immutable media, flush a model-hidden source-identified `prepared`
   transcript record, and atomically update the same keyed lifecycle value to
   `prepared` while preserving the threshold class, recovery cutoff, current
   disposition, generation binding, replay identity, and single capacity lease.
   Use the existing `PluginStateKeyedStore.update` single-key operation, not a
   delete-plus-register sequence or a new transaction API. It leaves exactly one
   complete old or new value across crash. This
   transition remains available when every shared-pool unit is occupied. Only
   after it succeeds may the account blocker narrow and the FIFO ticket release.
   Permanent skip releases the lifecycle token; retryable repair,
   transcript, media, or pin failure retains it for source retry or teardown. Do
   not await agent processing there. Different accounts remain concurrent.
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
   on mismatch. Make every model-history construction path exclude a prepared
   source record until its durable adoption marker exists.
6. Forward accepted structured turns directly to the existing
   `AgentSession.steer` path with a unique in-memory identity, atomic
   prepared/queued/draining/adopted/processed/terminal transitions, an adoption
   promise, and a final completion promise. Reuse the flushed `prepared`
   transcript record rather than appending again. After history/context
   preparation and queue drain own the turn, strictly promote its cursor-relative
   pin to `adopted`, then append and flush one idempotent source-identity-keyed
   adoption marker before the assistant cycle starts. The marker exposes the
   existing record to model history exactly once. Reject and abort on transition
   failure. Recovery completes a missing marker after pin promotion and never
   returns a marked record to prepared. Mark `processed` when that
   exact user cycle finishes, but keep replay ownership until run-level output
   handoff marks all covered identities `terminal`. Recovery of
   append-without-pin writes the `prepared` pin; recovery of a prepared pin
   resumes preparation/admission, and recovery of an adopted pin completes or
   verifies its adoption marker and resumes from the existing source-identified
   transcript turn without duplicate append.
   Ordinary cancellation may dequeue the identity only while queued, preserving
   its prepared transcript, pin, claim, and hold for re-admission. Do not add a
   second queue; keep agent-core turn processing unchanged apart from making its
   existing steering drain win before a normal stop-after-turn exit.
7. Add the atomic empty-and-close gate around unknown-affinity account
   reservations, pending same-conversation admission tickets, both existing
   steering/follow-up insertion paths, and their final empty check. Register the
   account reservation before repair and the ticket before payload preparation;
   atomically narrow, transfer, or release them on every disposition. Defer a
   normal `shouldStopAfterTurn` result when a reservation, ticket, or accepted
   identity already won the gate. Add an awaitable generation-change signal.
   Before empty queues wait on blockers, capture the gate generation and use the
   existing prompt-release fencing/merge path to release the session transcript
   lock. Sleep until any blocker/ticket transition, insertion, failure, abort, or
   teardown wakes the run, then reacquire the fenced lock, merge transcript
   updates without exposing unadopted prepared records, and recheck atomically.
   Never await a ticket while retaining the transcript lock needed by its
   prepared-record flush.
   On error, abort, or teardown, atomically close and reject all still-queued
   identities; settle already-draining identities from persistence or terminal
   failure. Keep the canonical final payload builder unchanged. After close,
   persist its payload or no-reply disposition through existing pending-delivery
   recovery with all covered source identities before marking pins terminal.
   Store unresolved account reservations in a gateway-process registry outside
   the restartable channel task. On channel restart, preserve their blockers and
   reattach the replacement monitor before live dispatch. Release only on
   durable transfer/disposition or corresponding reply-operation termination;
   full process teardown terminates those runs before dropping the registry.
8. Extend the existing recovery/catchup cursor hold-floor bookkeeping to install
   a generation-neutral `(accountId, fifoTicketId, observedRowid)` hold
   synchronously for every observed live row before the first await. Before
   continuity it blocks same-source cursor commits from passing the observation
   but does not join any generation ownership barrier. Only FIFO-head continuity
   may bind it to the proven
   `(accountId, dbInstanceId, rowid)` generation slot. A replacement transfers
   it from row-floor accounting into the source transition fence until catchup
   reconciles its stable identity.
   Scope every bound hold and cursor by the database-instance generation as well
   as account and row. Detect replacement as a new generation and keep old
   state isolated. Atomically persist each contiguous cursor advance with a
   non-expiring checkpoint containing every crossed ordered structural database
   row/GUID binding plus its count and cryptographic digest. Implement one
   versioned SQL source-row enumerator
   for bootstrap, incremental commit, per-admission proof, historical approval
   proof, catchup, and replacement matching. It selects every row in the
   Messages `message` table for the source account at or below the boundary,
   independent of parser acceptance or notification delivery, in source-row
   order. If the schema cannot distinguish the configured account, select every
   message-table row in that database. Store the enumerator version and selected
   scope variant with the checkpoint and require reviewed re-bootstrap when
   either cannot be reproduced or for any predicate migration. On startup,
   reconnect, and each FIFO-head continuity check, compare the current bindings
   with the checkpoint. When the current map is a strict subset with every
   retained binding unchanged and every unresolved later identity still present,
   atomically persist the subset and rewind a missing suffix to its highest
   retained row before subscription or replay continues. Encode an empty
   retained prefix as the explicit numeric replay floor `0`, never as an absent
   `since_rowid`, because omission means tail-only live mode. Carry it with
   explicit null checks rather than truthiness checks all the way into the
   subscription. Treat any unknown
   old-range row, changed binding, retained-row reordering, missing unresolved
   identity, or scope mismatch as generation uncertainty instead. A GUID-less row is
   retryable/blocked reviewed recovery,
   never a cursor-crossing permanent skip. Change conversation repair
   from nullable output to
   discriminated repaired/permanent-skip/retryable-failure output, retaining the
   hold for every RPC failure and clearing it only after a complete permanent
   result. Transfer repaired rows through replay claim into processing. Preserve
   the persistent dedupe result so an `inflight` duplicate retains the shared
   idempotent row hold and only a confirmed committed/permanently skipped row
   clears it.
   Otherwise clear only after terminal output handoff and replay commit both
   succeed; release a failed transient claim for retry without clearing its
   hold. Add an authenticated local reconciliation action for unmatched
   generations that records one explicit reviewed replacement boundary or
   abandons that generation; automated recovery cannot invoke it.
9. For enabled-account recovery, remove the
   `IMESSAGE_RECOVERY_MAX_ROWS` floor clamp and pass the persisted cursor
   directly to `watch.subscribe`. Gate enrollment on a bridge capability probe
   and fixture proving complete ordered delivery of more than 500 later rows
   from that cursor. Do not describe the clamp as pagination or borrow limits
   from the disabled legacy catchup subsystem. Keep the existing
   `IMESSAGE_STALE_INBOUND_THRESHOLD_MS` live threshold and
   `IMESSAGE_RECOVERY_MAX_AGE_MS` recovery threshold. Preserve the existing
   comparison against the sampled startup high-water to choose between them.
   Evaluate both that class and send-date age once at first observation, using
   the captured observation time. If the send date is missing or unparseable,
   preserve current non-stale behavior and choose observation time as the age
   basis. Persist the immutable threshold class, parsed original send time when
   available, defined age basis, and the age basis plus
   `IMESSAGE_RECOVERY_MAX_AGE_MS` cutoff, along with the initial disposition before FIFO
   waiting. On restart, immediately after
   opening plugin state and before structural bootstrap or any other probe,
   sample one restart time. Join existing lifecycle records before consulting
   the new startup boundary. Before source subscription or work admission,
   restore their capacity and neutral holds and compare the sampled restart time
   with each pre-adoption `reply_eligible` record's saved recovery cutoff once.
   Preserve an open cutoff. Atomically and permanently downgrade an expired
   record to `stale_no_reply` with the same single-key `update`. Reconcile every
   stale pre-adoption record by idempotently suppressing any hidden prepared
   transcript before source commit, including after a crash between disposition
   update and cleanup.
   Never downgrade for in-process FIFO
   delay, never upgrade a no-reply disposition, and never age out adopted or
   later work. Then join exact row/GUID replay or generation reconciliation.
   Persisted `stale_no_reply`
   performs no model, tool,
   hook, or delivery work, then commits replay, cursor, and checkpoint state
   normally. Persisted `reply_eligible` never ages out within the observing
   process. Do not let
   age or retry give-up discard the earliest unresolved row; only a durable
   disposition followed by successful replay commit may cross it.
10. Use one shared bounded lifecycle-capacity pool. Count each durable
   lifecycle record and each not-yet-persisted reservation exactly once across
   lanes. An ordinary row reserves its unit at first
   observation and updates the same non-expiring keyed record to `prepared`
   without another capacity check. A path without an observation record reserves one
   unit atomically before claim or dispatch. Saturation can reject only a new
   reservation and cannot stop an existing record from advancing. Before
   releasing source order, flush the exact source-identified turn and immutable
   media and strictly persist `prepared` under the record's immutable
   generation-neutral key. Store account generation, row/GUID, and replay
   identity in the value. Promote it to
   `adopted` after remaining preparation and before assistant/tool processing.
   Keep it through the user cycle, mark it `processed`, and durably hand off
   final payload/no-reply before marking `terminal` and committing replay.
   Reconcile
   append-without-pin, prepared turns, adopted turns, processed turns, and
   pending final delivery on restart. For transcript-free paths with an existing
   durable receipt,
   persist `adopted` before the effect and require the existing idempotent state
   or delivery receipt before `terminal`. Route every reaction through source
   FIFO and prefix validation first. Receipt-backed approval reactions use this
   adopted-pin/receipt path; general reactions use the sparse committed-GUID
   marker before their existing ephemeral enqueue. Any other receipt-free path
   keeps its existing effect semantics only after the same source-gate
   classification and its reviewed replay disposition.
   Replace the approval poller's direct handler call in immediate mode with the
   shared reaction-candidate admission function. Extend history results to expose
   a finite reaction source row and the real database reaction GUID. Keep any
   synthetic approval-matching key outside every source identity record. Join
   live and polled delivery in one real row/GUID slot before adopted-pin
   persistence or approval effect. Make submission return promptly as completed,
   pending, or rejected rather than awaiting FIFO ownership; only completed
   handling stops polling. For a proved row at or below the cursor, use a
   historical receipt-backed effect claim that does not move the cursor or
   checkpoint. Implement it as a distinct plugin-state record and capacity pool,
   excluded from ordinary pin crossing and below-cursor startup cleanup. On
   receipt confirmation, atomically mark terminal, delete the claim, and release
   capacity; on restart, reconcile adopted claims against the existing approval
   receipt before resume or finalization. Saturation returns pending without
   blocking ordinary source dispatch. Missing poll identity performs no effect
   without fencing a healthy source; an actual snapshot identity conflict uses
   normal continuity fencing. Gate account enrollment on a bridge capability
   check that proves history exposes the real reaction row and GUID.
   Serialize cleanup as atomic cursor plus committed-prefix checkpoint persist,
   ordinary replay refresh, then pin removal; retry cleanup failures. Apply
   account backpressure instead of
   eviction, and run cursor catchup before live admission resumes.
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
   existing row slot. Reuse the slot for every attempt. Channel-task teardown
   cancels its timers but retains blockers in the gateway-process registry for
   replacement-task reattachment. Release only after durable transfer/
   disposition, matching reply-operation termination, or full-process teardown
   after those runs terminate; retain the cursor floor for restart.
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
- a same-conversation ticket reserved before immutable media staging and history
  lookup prevents close and then transfers atomically into steering;
- a steer accepted before `shouldStopAfterTurn` is evaluated drains before the
  normal stop is honored;
- two concurrent arrivals preserve source order through durable `prepared`
  staging and admission;
- every live event installs a generation-neutral hold before waiting for the
  FIFO; unchanged continuity atomically binds it to the current generation,
  while replacement removes its reused row number from old cursor accounting
  and transfers it to the source transition fence outside the old-generation
  barrier;
- row N paused during attachment snapshot prevents row N+1 from completing a
  generation transition; after N's prepared transcript and pin are durable, N+1
  may transition and a crash recovers N from transcript plus N+1 from replay;
- prepared attachment bytes remain readable after the normal temporary media
  cleanup window and restart; recovery never relies on an expired staging path;
- a runtime event that violates the guaranteed row/GUID contract fails the source
  closed and no later valid event re-enters immediate mode around it;
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
- on an identity-proven immediate source, every authenticated request accepted by
  the shared abort decision, including `/stop`, a bare abort phrase, and a
  localized trigger, bypasses an unresolved anchorless data reservation for
  immediate durable journaling and never enters ordinary steering; effects begin
  only after a fast unchanged-generation/new-row proof or later reconciliation,
  then the row waits for its own FIFO continuity turn before committing
  replay/cursor/checkpoint state;
- a group message such as `@Puddles stop`, including the fixture's structural
  prefix and mention variants, produces the same shared normalized and
  authorized abort decision at the source gate and downstream handler, enters
  the journal once, and cannot execute an unjournaled fast abort;
- each pre-fence accepted stop request installs its neutral hold, FIFO ticket,
  and journal-capacity
  reservation inside the source gate before journal persistence can yield, so a
  successor cannot pass it on journal success or failure;
- each post-fence accepted stop request installs a transient GUID handoff under
  the source gate, so
  catchup cannot claim or commit that GUID before the journal becomes durable;
  journal failure performs no effect and returns sole ownership to catchup;
- an authenticated stop notification without a stable crash-replayable identity
  cannot occur on an enrolled source; a transport contract violation fails that
  source closed before any stop effect, while a source whose declared contract
  permits GUID-less stops remains wholly on the current coalescer and unchanged
  fast-stop path;
- the stop journal snapshots exact reply-operation IDs, ACP session IDs,
  queued-work generation/cutoff, subagent IDs, metadata target/version,
  pre-cutoff source reservation/prepared IDs with affinity state, and journal
  acknowledgment identity before mutation, persists each classification and
  actual effect outcome, and freezes the derived acknowledgment payload; crash
  after each classification or effect resumes only unfinished exact targets;
- stop acknowledgment CASes `ready -> dispatching` before one bridge send;
  returned success stores the complete receipt and optional external GUID,
  including `{ok: true}` without a GUID, while returned failure records failed;
  crash immediately after external send, timeout, or disconnect before commit
  recovers as `unknown_after_dispatch` without retry or duplicate, accepting
  possible loss in that window;
- a pre-cutoff reply operation racing journal persistence cannot create a later
  queue entry, ACP session, subagent, or other stoppable descendant after the
  scope creation fence; new scope admission waits until replay commit and
  terminal tombstone publication;
- an older prepared identity with unresolved affinity is included in the stop
  snapshot; if it later resolves to the affected session, it receives a durable
  `stopped_no_reply` disposition and commits replay without model or tool work,
  while a proven nonmatch transfers out unaffected;
- two source conversations sharing the default session cannot race around the
  cutoff: with older prepared input still resolving, a newer post-stop message
  waits, cannot clear session abort metadata, and starts only after the older
  matching identity is durably suppressed and the stop tombstone is published;
- row N remaining unresolved beyond ordinary dedupe TTL and capacity while stop
  row N+1 reaches replay commit leaves N+1's compact terminal tombstone
  non-expiring and non-evictable; restart replays from below N, finds the
  tombstone, performs no stop effect or acknowledgment for N+1, and removes it
  only after contiguous cursor/checkpoint crossing;
- database replacement while stop N+1's tombstone remains live matches that
  stable GUID after the exact committed prefix, atomically rekeys the tombstone
  to the replacement generation/row before catchup, suppresses the replacement
  row after ordinary dedupe expiry, and retains the marker until the replacement
  cursor/checkpoint crosses it;
- database replacement while a reaction marker remains above a blocked cursor
  matches its stable GUID after the exact prefix, atomically rekeys it before
  catchup, and never enqueues that reaction again even after ordinary dedupe
  expiry;
- a live stop tombstone or reaction marker that is missing, duplicated, or mapped
  before the replacement prefix blocks reconciliation and no replacement row
  executes until authenticated operator disposition;
- after a stop row has crossed the cursor and its ordinary dedupe and tombstone
  are gone, a same-path database replacement that replays that historical stop
  while newer work is active journals it but performs no hook, abort, queue,
  metadata, or acknowledgment effect; exact-prefix reconciliation marks it
  `historical_no_effect`, while a new stop after the matched prefix executes once;
- live control and catchup racing after catchup claim or during a stop effect
  share one GUID/journal execution lease; exactly one runner executes while the
  other joins completion, and crash recovery resumes from durable effect
  outcomes;
- crash immediately after `owned` persistence or between stop effects lets the
  next gateway epoch atomically reclaim the owned journal with a new fencing
  token; a second recovery crash and a conclusively unregistered same-epoch
  owner are reclaimed by the same rule, and the new runner resumes only
  unfinished effects;
- stale-token writes fail at every hook-dispatch marker, effect outcome,
  acknowledgment freeze/dispatch, lifecycle, replay commit, and journal
  compaction boundary; the winning token remains registered until terminal
  tombstone publication;
- iMessage fast-stop invokes the existing plugin `message_received` dispatcher
  once and the existing internal generic `message` plus specific
  `message:received` chain once in normal operation, preserving shared internal
  context and order;
- each durable hook-dispatch `started` marker is terminal before the unchanged
  fire-and-forget launch, so a never-resolving handler does not block stop,
  acknowledgment, replay commit, tombstone publication, or later scope admission;
- crash after a hook-dispatch effect is marked started never invokes that
  dispatcher again; process-epoch recovery marks only not-yet-started hook
  effects `skipped_after_crash` without persisting configuration, message
  context, handler IDs, or registration mappings;
- iMessage fast-stop journal recovery invokes no `command:stop` hook, matching
  the existing early-return path; a registered stop-hook fixture proves no new
  stop-hook side effect occurs;
- an accepted stop trigger as the first notification after same-path replacement
  becomes durable but performs no effect or acknowledgment until transition
  reconciliation classifies it; a GUID inside the matched committed prefix is
  `historical_no_effect`, while only a GUID after that prefix can clear queues,
  cancel ACP/subagents, change metadata, acknowledge, or abort work;
- stop-journal persistence or capacity failure performs no effect, fails source
  bookkeeping closed, and recovers only targets at or below the durable minimal
  gateway epoch/cutoff; minimal-fence failure plus process crash completes stop
  source recovery across enabled, disabled, and previously known sources before
  any newer cross-source work may start;
- restart with an unavailable previously enrolled journal-capable source keeps
  global stoppable admission closed; later source recovery never gives its unfenced
  pre-restart stop a new cutoff, and only an authenticated durable no-effect
  disposition can unblock it;
- authenticated retirement of a permanently unavailable source records its last
  committed cursor/checkpoint and explicit abandonment of every unseen row,
  opens global admission, leaves that source disabled, and rejects later
  re-enable until scan, reviewed boundary, and fresh bootstrap complete;
- on an enrolled source, every authenticated request accepted by the stop
  classifier after generation fencing persists its exact-effect journal and
  starts no effect without reconciliation; it uses no FIFO ticket, row hold, or
  backlog entry, catchup alone owns that GUID, historical prefix members become
  no-effect, and only a GUID after the prefix can execute and compact the journal
  to a terminal tombstone after effect completion, terminal acknowledgment
  disposition, and replay commit; only contiguous
  cursor/checkpoint crossing clears the tombstone, while journal
  failure performs no effect and leaves the row to ordered catchup;
- rows on different accounts continue admission concurrently while one account
  repairs an anchorless row;
- an embedded steer-capable route uses immediate admission, while CLI and
  capability-missing routes retain the current coalescer without a readiness
  hang;
- two conversations mapped to one session never cross-steer or cross-deliver;
- two identical text steers complete and cancel independently by identity;
- cancellation racing queue drain has exactly one winner: queued cancellation
  preserves exactly one model-hidden prepared transcript and pin for
  re-admission, while draining ownership promotes that same record to adopted,
  publishes one adoption marker, and processes it;
- prepared input is absent from every normal, retry, compaction, and recovery
  model-history load before adoption, including when two source conversations
  share one session; canceled re-admission remains hidden and then becomes
  visible exactly once only after the correct run adopts it;
- transcript append failure rejects only the matching completion, releases its
  replay claim for same-process retry, retains its cursor hold, and does not
  advance the cursor;
- a crash before durable preparation replays the source event; a crash after
  transcript flush but before the prepared pin reconciles that same record; a
  crash with a prepared pin resumes media/context/admission; a crash after pin
  promotion but before the adoption marker publishes that marker exactly once;
  a crash after adoption resumes the exact adopted turn; a crash after processing rebuilds
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
- restart with more than 500 newer rows passes the persisted cursor directly to
  `watch.subscribe`, receives every later row exactly once in order, and proves
  the 500-row floor clamp is absent;
- an unchanged database containing rows rejected by one parser version yields
  byte-identical structural row/GUID bindings and digest before and after a
  parser or notification-classifier upgrade; changing the versioned structural
  predicate or scope requires reviewed re-bootstrap and never enters replacement
  reconciliation;
- deleting a committed middle row in Messages.app leaves every retained
  row/GUID binding unchanged, atomically shrinks the checkpoint, keeps the
  cursor at the highest retained row, and admits the next valid event without
  generation fencing or operator action;
- deleting the committed suffix rewinds the cursor and checkpoint to the highest
  retained row; because the real Messages table uses `AUTOINCREMENT`, a synthetic
  source fixture explicitly inserts a reused next row ID to prove the generic
  defense observes and processes it once rather than leaving it below the old
  cursor;
- deleting every committed row stores an empty binding map and numeric replay
  floor `0`; an argument-capture assertion proves restart passes the numeric
  value `0` to the subscription through explicit null checks, and later rows
  replay instead of the cursor collapsing into absent tail-only mode;
- changing a retained row/GUID binding, inserting or reusing a row inside the
  still-committed range, deleting an unresolved above-cursor identity, or
  changing the stored scope variant fails continuity and enters reconciliation;
- a live row observed inside its 15-minute window persists `reply_eligible`,
  waits behind an older row's repair backoff for more than 20 minutes, then
  produces its normal agent turn and reply without recalculating age because the
  observing process never restarted;
- a Push-recovery burst with row IDs above the sampled startup high-water and
  original send dates beyond the live 15-minute threshold durably records
  `stale_no_reply` for every row, advances replay, cursor, and structural
  checkpoint state through the full burst, and produces zero hooks, model turns,
  tools, or deliveries;
- after lifecycle records for that stale burst are durable, crash partway
  through FIFO disposition and restart with a newly sampled high-water; every
  remaining row joins its saved live `stale_no_reply` choice, advances source
  state, and still produces zero hooks, model turns, tools, or deliveries;
- crash after a live row's `reply_eligible` record but before FIFO ownership,
  then restart 40 minutes after original send; recovery uses the saved two-hour
  cutoff, preserves the normal turn, and never narrows it to the live window;
- repeat with restart after the saved two-hour recovery cutoff; recovery
  atomically downgrades the pre-adoption row to `stale_no_reply`, idempotently
  suppresses any hidden prepared transcript, advances source state, and produces
  no hook, model, tool, or delivery effect;
- for both a missing and an unparseable send date, prove first observation stays
  eligible and saves observation time as the age basis; restart inside the
  resulting two-hour cutoff produces the normal turn, while restart after it
  downgrades to no-reply with zero agent or delivery effects;
- crash during first-observation persistence is atomic, so restart sees either
  the complete threshold class, optional original send time, defined age basis,
  recovery cutoff, and disposition or no accepted observation and no partial
  record;
- first-observation capacity saturation or persistence failure performs no
  agent or source-commit effect, keeps the generation-neutral hold, applies
  source backpressure, and never evicts older saved age state;
- fill the shared bound with `reply_eligible` observation records, then prove
  the FIFO head converts its existing token into `prepared`, commits, releases
  capacity, admits the backpressured next observation, and drains the full queue
  without a second reservation or restart;
- interrupt the single-key observation-to-prepared update at every persistence
  boundary and prove restart observes exactly one complete old or new value
  under the same key, counts one capacity unit, preserves the threshold class
  and recovery cutoff, and completes exactly once;
- without restarting, hold an eligible observation record beyond the dedupe
  store's four-hour TTL and through entry-count pruning, then prove its
  disposition, token, FIFO progress, and exact-once completion remain intact;
- restart restores every lifecycle record's capacity and neutral hold before
  structural bootstrap or subscription, applies the one-way recovery-cutoff
  downgrade before work admission, idempotently cleans a hidden prepared turn
  left by a crash after downgrade, then joins exact row/GUID replay; a record
  missing from the current source enters generation reconciliation and cannot
  release capacity, widen its threshold class, upgrade no-reply, or admit later
  work;
- an ordinary row at or below the sampled startup high-water uses the existing
  two-hour recovery threshold, while rows inside that window retain current
  recovery behavior;
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
- cursor advancement past N+1 atomically persists cursor plus committed GUID
  prefix checkpoint before ordinary replay refresh and pin removal, and failure
  after each step remains safe;
- an existing nonempty row-only cursor remains current-path-only when the only
  evidence is a matching stable GUID at the exact cursor row; automatic bootstrap
  requires a preexisting full-prefix commitment or immutable database identity,
  otherwise an authenticated operator must record the reviewed boundary;
- a same-path fork that preserves the cursor row's GUID but changes or inserts an
  earlier GUID cannot bootstrap automatically and marks no unseen row committed;
- a valid historical full-prefix commitment must match every ordered GUID through
  the cursor before automatic seeding; an empty cursor may seed only the empty
  prefix after current generation recording;
- bootstrap read failure, cursor past source, or any crossed GUID-less row leaves
  the account current-path-only without advancing its cursor;
- after successful bootstrap, an in-place fork that preserves cursor/high-water
  anchors and the observed event but changes or inserts any earlier committed
  row/GUID binding fails the per-admission full-prefix check, fences the source
  before model/tool work, and enters replacement reconciliation;
- a source with a claimed immutable generation ID may skip full-prefix scans only
  when fixture tests prove the ID changes for every replacement and historical
  mutation; the exact current local and remote fixtures do not qualify;
- a GUID-less live/catchup row blocks cursor and checkpoint advancement in
  reviewed recovery and is never treated as a cursor-crossing permanent skip;
- replacing the Messages database at the same local path with one that reuses
  row numbers creates a new generation with distinct holds, pins, capacity
  reservations, and cursors;
- restoring older database contents in place while preserving path, file
  identity, and the live subscription fails the next per-event
  high-water/GUID/row snapshot, atomically fences immediate admission, and
  rotates the generation;
- a remote bridge database replacement uses its new bridge-provided generation,
  while a bridge without that capability stays on the current coalescer;
- any source contract that permits an invalid ordinary row identity remains
  current-path-only from startup rather than mixing per-event modes;
- an earlier immediate row held mid-tool followed by a database generation
  change blocks reconciliation until the old source-drained barrier and latest
  committed-prefix checkpoint complete;
- the notification that discovers a generation change retains its source FIFO
  ownership, neutral hold, lifecycle capacity, threshold class, recovery cutoff, and
  current disposition but moves to the transition backlog and detaches its
  unknown-affinity blockers after the source gate is fenced, so old runs close
  and the ownership barrier can drain without admitting the replacement row;
- ordinary successors already waiting behind a generation-change trigger also
  move with their lifecycle records to the transition backlog and detach every
  old-run blocker; notifications racing after the fence return without data
  reservations under the paused live subscription, and catchup matches each
  admitted backlog row/GUID, applies only the allowed restart recovery-cutoff downgrade,
  and preserves the resulting disposition before releasing its transition entry;
- an indefinitely operator-blocked transition receives no ordinary live backlog
  growth while the paused subscription leaves every row recoverable from the
  unchanged source cursor;
- crash after generation transition persistence reconstructs recovery-only mode,
  the old barrier, and checkpoint reconciliation before live dispatch;
- transition persistence failure followed by crash detects the anchor mismatch
  on restart and performs the same checkpoint reconciliation without choosing
  the trigger or database minimum as a floor;
- transition persistence failure after replacement is proven keeps source
  dispatch fenced, transfers the trigger and queued successors to transition
  ownership, detaches all old-run blockers, and lets old ownership drain without
  processing a replacement event;
- a replacement containing the exact committed prefix plus unobserved rows
  before the trigger maps the checkpoint and replays every later row once;
- historical rows below a matched checkpoint remain suppressed after ordinary
  dedupe TTL expiry, while unresolved pinned GUIDs above it remain non-expiring;
- a replacement with missing, reordered, or divergent prefix GUIDs stays
  recovery-only and executes no model or tool until an authenticated operator
  records a reviewed boundary;
- a remote bridge without exact generation and lossless row replay remains
  current-path-only from startup, so it never creates a mixed immediate/fallback
  crash window;
- a continuity failure followed concurrently by valid-looking rows atomically
  admits no new immediate work until fallback drains, all prior claims, holds,
  and pins clear, and continuity is proven;
- replay commit failure after a terminal output handoff keeps fallback fenced
  through retry and prevents a later valid row from immediate admission;
- transient anchor repair retries in the same row slot with bounded backoff and
  no duplicate timer, then wakes close when repair succeeds;
- channel-task restart cancels repair timers but preserves blockers in the
  gateway-process registry while active runs survive; the replacement task
  reattaches before live dispatch and the blocked run cannot close early;
- full process teardown terminates corresponding runs before dropping in-memory
  blockers, and restart begins from the held cursor before new live admission;
- insertion immediately before empty-and-close wins and causes another cycle;
- insertion immediately after close is rejected and starts one later turn;
- empty queues plus a pending ticket await one signaled generation change
  without busy polling while the run releases its transcript lock through the
  existing prompt-release fence; preparation flushes, the run reacquires and
  merges without exposing an unadopted prepared record, then deterministically
  drains or closes;
- a ticket arriving after the final model stream but before close acquires the
  released transcript lock, flushes its prepared record, and wakes the run; a
  deterministic lock-contention fixture proves neither side waits on the other
  and final close occurs only after lock reacquisition and a full gate recheck;
- follow-up insertion has the same before/after-close behavior as steering;
- model error, abort, and terminal teardown reject every still-queued steering
  and follow-up identity so no completion, replay claim, or cursor hold hangs;
- the start-versus-steer race cannot create two active runs or lose a message;
- queue rejection, prompt failure, abort, timeout, restart, and transcript
  commit failure retain existing replay/cursor behavior;
- other commands, reaction payload shape, approvals, groups, echoes, catchup,
  and attachment caps retain current behavior;
- general reactions never enter active-run admission or pins, but do use the
  source FIFO, full prefix validation, continuity, hold, and atomic non-expiring
  committed-GUID marker before their existing ephemeral enqueue;
- receipt-backed approval reactions use that same source gate first, then persist
  the adopted pin before their existing idempotent approval transition and
  receipt; a database fork before either reaction kind fences the source before
  enqueue or approval effect;
- the independent approval-reaction poller submits through the same source-gate
  row/GUID slot as live delivery and never calls the approval handler directly in
  immediate mode; live and history payloads expose byte-identical real source
  identity, while the synthetic approval key never enters source state; a
  live/poller race produces one adopted pin, one approval transition, and one
  receipt;
- a polled reaction without a finite real source row and real database GUID
  performs no approval effect, returns rejected promptly, and does not fence a
  healthy enrolled source;
- a polled reaction behind an indefinitely blocked FIFO head or a fenced source
  returns pending or rejected promptly, releases the poller's in-flight guard,
  and later timer ticks continue to fetch and resubmit without duplicate slots;
- a polled approval reaction below the committed cursor validates exact
  row/GUID membership in the current full prefix, uses one receipt-backed
  historical effect claim outside the cursor-relative pin pool, releases that
  claim and its capacity on terminal receipt, and leaves cursor and checkpoint
  bytes unchanged;
- crash after historical claim persistence but before approval receipt
  confirmation preserves the claim across startup pin cleanup, then resumes or
  finalizes exactly once from the existing receipt and releases capacity;
- historical claim-pool saturation leaves ordinary source dispatch running,
  returns poll submission as pending, and recovers capacity when an existing
  claim reaches terminal;
- bridge replay capability tests start more than 500 rows behind high-water and
  prove unclamped `watch.subscribe` delivery from the exact persisted cursor;
  failure keeps the account wholly on the current coalescer;
- structural-read capability tests cover a supported local source, remote host,
  unsupported wrapper, database permission denial, and unavailable path; every
  failure reports the exact capability gap and keeps the account wholly on the
  current coalescer without entering replacement reconciliation;
- plugin-state capability tests prove the configured store exposes atomic
  single-key `update`; a store with the optional method absent keeps the account
  wholly on the current coalescer, and no path substitutes delete-plus-register;
- bridge history capability tests expose a tapback's real row and GUID; when
  either is unavailable, immediate enrollment stays disabled for the account
  rather than reporting a working poller;
- bootstrap, incremental cursor commit, per-admission rescan, historical
  reaction proof, catchup, and replacement matching enumerate the identical
  ordered row/GUID set with the same predicate version and scope, including a
  reaction row not surfaced by live notifications;
- reaction enqueue succeeds before the FIFO ticket releases in normal operation,
  so later source rows do not overtake it;
- an unresolved predecessor beyond replay TTL leaves the reaction's sparse marker
  non-expiring; restart suppresses that exact GUID while later source rows remain
  ordered, and contiguous cursor crossing eventually removes the marker;
- crash after reaction marker commit but before or after enqueue may lose the
  ephemeral event but restart never enqueues the marked GUID twice;
- reaction marker capacity or persistence failure performs no enqueue and
  retains its hold and FIFO ownership for retry;
- a reaction as the first row after same-path replacement triggers generation
  reconciliation before payload handling, and rollback pause leaves a reaction
  row behind the cursor for later lossless catchup;
- explicit message-tool sends retain normal tool semantics;
- rollback durably pauses new source dispatch without cursor advancement, drains
  accepted immediate and already queued fallback work through delivery, replay,
  and ownership cleanup, switches the same package to the current coalescer, and
  runs unclamped cursor catchup to the live row without binary downgrade; stale
  ordinary rows take their existing durable no-reply age disposition rather than
  being dropped or creating agent turns;
- restart during rollback reconstructs recovery-only mode before live dispatch,
  resumes the full drain and lossless current-coalescer catchup, and never asks an
  older capped/aged implementation to consume the retained backlog;
- recording transports fail unknown writes and no automated test delivers a
  live message.

Latency assertions compare source observation to initial run start and require
no fixed 7/15-second delay. They include the current local source's complete
read-only committed-prefix validation cost and synchronous first-observation
record write. They report p50 and p95 for each contribution and for total
observation-to-start time, separately from model time. The same measurements
cover a large structural-prefix fixture and a stale Push-recovery burst,
including per-row marker persistence, prefix validation, and full no-reply drain
time. The canary remains on the current coalescer if the complete path does not
improve deployed start latency. The test fixture controls model/tool completion
and the close race deterministically; it does not use sleeps as proof.

### Rollout and rollback

After approval, implementation, full managed validation, clean review, and
remote checks:

1. Land the disabled steering-admission strategy and cumulative regressions.
2. Promote the exact approved patch through
   `docs/openclaw-setup/patches/apply-and-deploy.sh` with `MINI_HOST` unset on
   the target Mac mini.
3. Verify exact-byte marker, recovery snapshot, gateway health, iMessage
   capability, and read-only no-delivery evidence.
4. Bootstrap and verify the existing cursor's ordered row/GUID bindings,
   predicate version, scope, and digest before enabling immediate admission.
5. Run the recording canary for a committed middle-row deletion, a committed
   suffix deletion plus row reuse, a stale Push-recovery burst with restart, and
   a live row delayed behind FIFO repair past 15 minutes. Also resume an eligible
   pre-adoption row once 40 minutes after original send and once beyond its saved
   two-hour recovery cutoff. Require automatic deletion repair, complete source
   advancement, zero stale or post-cutoff replies, and one normal reply for both
   the delayed in-process row and the 40-minute restart row.
6. Enable for one explicit canary conversation in final source-reply mode.
7. Observe content-free admission accepted/rejected counts, duplicate-run
   count, queue depth, and p95 initial-start latency.
8. Expand only after the canary shows no loss, duplicate reply, or ordering
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
the current coalescer and starts proven unclamped ordered replay from the
persisted cursor until it reaches a freshly sampled live high-water row and all
replay handlers commit. The 500-row floor clamp remains removed for this drain.
Existing lifecycle records keep their threshold class, recovery cutoff, and
current disposition. On rollback restart, eligible pre-adoption records apply
the same one-way recovery-cutoff downgrade before catchup. Rows first observed
by rollback catchup use that process's startup boundary and persist their class,
optional original send time, defined age basis, recovery cutoff, and initial
disposition before waiting. A stale disposition produces durable no-reply
without dropping source ownership.
New rows that arrive during replay extend the target or remain for normal live
handling.

Rollback remains configuration-only on the deployed package after this second
quiescent boundary. Binary downgrade is prohibited because predecessor
transcript readers do not understand model-hidden prepared records and adoption
markers, and the append-only transcript cannot migrate those pairs into one
legacy user entry at the adoption position without changing history. The
rollback fixture must prove restart on the same package reconstructs
recovery-only mode, completes catchup, preserves every adopted turn in model
order, and resumes the current coalescer without duplicate delivery. Package
replacement would require a separately designed and reviewed transcript
migration and is outside this feature.

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
  rollback drain, and keeps general reaction payloads ephemeral. Later review
  required every reaction row to pass source continuity and prefix validation
  before either sparse-marker enqueue or receipt-backed approval handling.
- The next independent review found continuity was only checked at monitor
  startup, reactions still appeared after reservation in operational text, and
  per-event identity fallback could be overtaken by later immediate input. The
  design now revalidates one consistent source snapshot before every live
  reservation, including the full committed prefix when no immutable generation
  ID exists, routes reaction effects after the source gate but outside active-run
  steering state, and uses a source-wide ordered fallback fence.
- The retained reviewer then found the fallback fence could reopen at
  `terminal`, before replay commit and ownership cleanup, and that the plan used
  an obsolete section contract. The fence now requires delivery/no-reply,
  successful replay commit, and release of every claim, hold, and pin. The plan
  now uses the current `Human section` and `Agent section` structure.
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
  package installed for lossless current-coalescer catchup. A later review
  prohibited older package replacement because transcript records are not
  backward compatible.
- The latest review found ordinary plugin-state pruning could silently evict
  pending fallback references. The design now reserves bounded non-expiring
  capacity atomically, excludes pending references from ordinary pruning, and
  stops source dispatch without cursor movement when full.
- A fresh complete-diff recheck found no actionable high-confidence issues.
  Implementation still must prove the planned crash, capacity, recovery,
  rollback, and integration behavior against actual APIs.
- Terminal review then found a generation-changing trigger could still be lost
  if its reference write failed. The design no longer uses fallback references.
  Eligible transports guarantee row identity and lossless replay; generation
  change persists a pre-trigger floor, while write failure is recovered by
  detecting the mismatch and replaying from before the new database minimum.
  Recheck then found a prior old-generation row could still be preparing when
  the transition persisted, and stale per-event identity fallback remained. The
  source slot now stays held until full text and immutable media are durably
  staged with a `prepared` pin. Runtime identity-contract violations fail the
  source closed and cannot take an independent path.
- The next review found continuity inspection still occurred before the
  preparation slot and cancellation tests still assumed pre-persistence queue
  entries. Ordinary events now enter a generation-independent account FIFO
  before continuity inspection, and only its head may rotate generation after
  predecessors are prepared. Queued cancellation preserves and re-admits the
  exact prepared record and pin.
- The following review found trigger-based replay could omit earlier replacement
  rows, while replay from the database minimum could duplicate expired history.
  Cursor commits now maintain a non-expiring ordered-GUID prefix checkpoint.
  Cross-generation replay starts only after an exact replacement prefix match;
  ambiguous databases fail closed for authenticated operator reconciliation.
- The next review found GUID-less permanent skips cannot join that checkpoint,
  existing production cursors need a checkpoint bootstrap, and an older rollback
  package cannot read generation-scoped cursors. GUID-less rows now block cursor
  advancement and enablement requires an oldest-first seed scan. The intermediate
  rollback design published a predecessor cursor, but later transcript review
  prohibited binary downgrade entirely. Recheck
  then found one stale repair sentence still allowed missing-GUID skips and
  reactions bypassed generation-safe cursor work. Missing message GUID now always
  blocks reviewed recovery. Reaction payload behavior remains unchanged, but its
  row uses FIFO, continuity, hold, replay commit, and cursor/checkpoint ordering.
- The next review found the row-only legacy cursor could bind to a same-path
  replacement during bootstrap and an in-flight reaction could vanish before
  commit. The intermediate correction required a durable GUID/row
  database-binding witness or operator-reviewed boundary. Reactions persist a bounded non-evictable GUID
  witness before payload handling and clear it only in atomic cursor commit.
- Recheck found three remaining races. A generation-change trigger could keep an
  old run blocked while waiting for that run to drain. An earlier bootstrap
  witness could survive a database fork below the legacy cursor. A prepared
  transcript turn could become model-visible before the correct run owned it.
  The source gate now detaches transition-trigger blockers while retaining the
  source hold, the intermediate bootstrap required exact cursor evidence, and
  prepared records remain hidden from every model-history path until a durable
  adoption marker makes the same record visible exactly once.
- Recheck found queued successors could still block old runs during generation
  transition, and a hold could not safely choose a database generation before
  serialized continuity inspection. Every pre-continuity event now receives a
  generation-neutral cursor hold. Fencing moves the trigger and all queued or
  later unassigned events into transition ownership, removes all old-run
  blockers, and leaves lossless catchup as the only replacement-row owner.
- Recheck found four remaining lifecycle gaps. Stop commands bypassed generation
  bookkeeping, neutral replacement holds could floor the old cursor, channel
  restart could drop blockers while runs survived, and a blocked transition
  could grow without bound. Stops now abort immediately with a durable exact-
  target receipt while their rows use serialized continuity. Replacement holds
  convert to a separate source fence outside old cursor accounting. Blockers
  survive channel-task restart in gateway-process ownership. Generation fencing
  pauses ordinary live ingestion and relies on lossless catchup.
- Recheck found post-fence callbacks were described both as catchup-owned and as
  new backlog entries. Only pre-fence tickets now transfer to the bounded
  transition backlog. Post-fence data callbacks take no reservation. A
  post-fence authenticated stop persists and performs its exact-target abort
  without row ownership, and catchup clears that receipt when it commits the
  matching GUID.
- Recheck found a stop whose receipt write failed could abort one operation and
  later replay against another without a durable target. The intermediate
  correction required a durable target before abort and made persistence failure
  perform no effect. The next review expanded that record to every stop effect.
- Recheck found an active reply operation was only one of the existing stop
  effects. The stop record is now a per-effect journal that snapshots immutable
  reply, ACP, queue-cutoff, subagent, metadata, and acknowledgment targets before
  any mutation. Recovery resumes unfinished idempotent effects only against
  those targets. Later review replaced retryable acknowledgment handoff with an
  explicit at-most-once terminal dispatch disposition.
- Recheck found journaling could be overtaken before row ownership, one
  implementation step still released blockers on channel restart, and transient
  effect outcomes could change the recovered acknowledgment. The source gate now
  installs a pre-fence hold or post-fence catchup handoff before journal
  persistence. Channel restart retains blockers in gateway ownership. The
  journal persists effect outcomes and freezes the final acknowledgment before
  delivery.
- Recheck found a control callback could race a catchup stop already executing,
  stop hooks were outside the journal, and the reaction witness could replay an
  event already consumed from memory. The intermediate correction gave every
  stop dispatcher one GUID-keyed execution lease and proposed journaled hooks;
  the later fast-path review removed hooks that iMessage never invokes. Reaction
  handling moved toward at-most-once enqueue, then the next review added the
  sparse marker needed while contiguous cursor advancement is blocked.
- Recheck found full stop-journal failure still lacked a durable target boundary,
  and a reaction behind a long-lived unresolved predecessor could outlive
  ordinary dedupe without crossing the contiguous cursor. Stop handling now
  writes a minimal gateway epoch/creation-cutoff fence first and blocks work
  admission if even that fence fails. Reactions now write a bounded non-expiring
  sparse committed-GUID marker before enqueue and retain it until contiguous
  cursor/checkpoint crossing.
- Recheck found restart could omit a disabled or unavailable source whose
  minimal stop fence failed, then later retarget its stop. The gateway
  pre-admission barrier now covers every configured and previously known
  stop-capable source. Unavailable sources remain blocking, and an unfenced
  pre-restart stop can only receive an authenticated durable no-effect
  disposition, never a fresh target cutoff.
- Recheck found a crashed journal runner had no reclaim transition and a
  permanently unavailable source could not identify individual stop rows for
  disposition. Journal runners now persist gateway-epoch fencing tokens and an
  older epoch is atomically reclaimable. An authenticated source-level
  retirement can abandon every unseen row after the last committed checkpoint,
  but keeps that source disabled until full scan and explicit re-bootstrap.
- Recheck found a second crash could strand the separate recovery state and
  several journal mutations were not explicitly fenced. Initial and recovery
  execution now share one reclaimable owned state. Older epochs and conclusively
  dead same-epoch tokens are atomically reclaimable, and every runner-owned
  journal mutation through terminal tombstone publication requires the winning
  fencing token.
- Recheck found the intermediate hook journal would add `command:stop` hooks that
  the existing iMessage fast-stop early return never invokes. The effect journal
  is now path-specific and excludes those hooks, preserving current iMessage
  command behavior.
- Recheck found pre-cutoff work could create descendants while the journal was
  being written, and the fast path does emit generic message-received hooks.
  Cutoff capture now atomically installs a scope creation/admission fence.
  Existing plugin and internal message-received handlers use stable at-most-once
  journal events, while `command:stop` hooks remain excluded.
- Recheck found current hook registries do not expose stable per-handler
  identities. The intermediate correction required explicit immutable unique
  IDs, snapshot the exact set, and blocked recovery rather than relying on order
  or function metadata. The next review added complete event coverage, payload
  freezing, and migration.
- Recheck found generic internal `message` handlers were omitted, hook arguments
  were not frozen, and existing registrations lacked an upgrade path. The
  intermediate proposal added a canonical payload and registration migration.
- Recheck found that per-handler recovery would break the shared mutable internal
  hook chain, persist unnecessary configuration secrets, and still leave
  directory and legacy identity ambiguity. Hook recovery is now coarse
  at-most-once best effort: the existing plugin dispatcher and ordered internal
  chain are separate effects marked started before invocation. A started effect
  is terminal; an unstarted one is skipped after process crash. No hook payload
  or registration metadata is persisted.
- Recheck found those dispatchers are currently fire-and-forget and must not
  become stop-critical. Their durable `started` marker is now terminal handoff;
  launch remains fire-and-forget and handler completion never gates stop,
  acknowledgment, replay commit, tombstone publication, or creation-fence
  release.
- A fresh complete-diff recheck found no actionable high-confidence issue.
  Implementation must still prove every planned lifecycle and crash boundary
  against the exact APIs and cumulative integration suite after Cole approves.
- Exact-candidate review then found the iMessage bridge cannot reconcile an
  acknowledgment sent immediately before a crash. Stop acknowledgment now marks
  `dispatching` before one send and never retries an unknown outcome. Recovery
  records `unknown_after_dispatch`, accepting possible loss in that crash window
  rather than duplicate delivery.
- Recheck found that bare and localized stop triggers accepted by the existing
  abort classifier could bypass the journal and enter ordinary steering. It also
  found that a successful bridge receipt may omit an external GUID. The design
  now routes every accepted stop trigger through the journal and treats the full
  successful receipt, with an optional GUID, as terminal. Validation now covers
  each trigger form, GUID-less success, timeout, and disconnect. Recheck is
  pending.
- Recheck found that a current-path-only bridge may emit a stop notification
  without the stable GUID required by the new journal. The new journal and its
  gateway recovery barrier are now limited to identity-proven sources enrolled
  in immediate admission. Sources that permit GUID-less stop rows keep their
  existing coalescer and fast-stop behavior together. A contract violation on an
  enrolled source fails closed before any effect. Validation covers both cases.
  Resolved in the final complete-diff recheck.
- Recheck found that downstream group mention stripping could reveal a stop after
  raw source-gate classification missed it. The design now requires one shared
  normalization and authorization helper, in the existing downstream order, and
  both source-gate and downstream handling consume its decision. Validation now
  includes group-mentioned stop forms. Resolved in the final complete-diff recheck.
- Recheck found that a stop row committed behind a predecessor held below the
  cursor could replay after the ordinary dedupe entry expired. The full stop
  journal now compacts after replay commit to a bounded, non-evictable,
  non-expiring terminal tombstone. Duplicates perform no effects or
  acknowledgment, and only contiguous cursor/checkpoint crossing clears the
  tombstone. Validation covers restart after the predecessor exceeds dedupe TTL
  and capacity. Resolved in the final complete-diff recheck.
- Recheck found that older prepared input could resolve into the stopped shared
  session only after the stop fence released, letting newer input clear the
  session cutoff first. The stop snapshot now includes all pre-cutoff source
  reservations and prepared identities with matching or unresolved affinity.
  The fence remains until each is classified, matching identities receive a
  durable no-reply disposition, and the terminal stop tombstone is published.
  Validation covers two conversations sharing the default session. Recheck is
  pending.
- Recheck found that an older binary cannot preserve model-hidden prepared
  records and adoption-marker ordering in its transcript reader. Rollback is now
  configuration-only on the deployed package. It drains ownership, catches up,
  restarts the current coalescer on the same package, and proves adopted turns
  remain in model order. Binary downgrade requires a separate transcript
  migration design and is prohibited here. Resolved in the final complete-diff recheck.
- Recheck found that a crossed historical stop could replay after database
  replacement and mutate current work before continuity classified it. Journal
  durability no longer authorizes effects. A fast consistent snapshot must prove
  unchanged generation and a row after the committed prefix, or effects wait for
  reconciliation. A GUID inside the matched prefix becomes
  `historical_no_effect` with no hook, abort, metadata, or acknowledgment.
  Validation covers replay after both tombstone and ordinary dedupe removal.
  Resolved in the final complete-diff recheck.
- Recheck found that a live stop tombstone above a blocked cursor remained keyed
  to the old generation and could be missed by replacement catchup.
  Reconciliation now matches every live tombstone by stable GUID after the exact
  committed prefix and atomically rekeys it before catchup classification.
  Missing, duplicate, or before-prefix matches fail closed. Validation covers
  replacement after ordinary dedupe expiry while the tombstone remains live.
  Resolved in the final complete-diff recheck.
- Recheck found that live reaction markers had the same generation/row migration
  gap and could enqueue again after replacement. Pre-catchup reconciliation now
  migrates both reaction markers and stop tombstones by stable GUID while
  preserving capacity and suppression. Missing, duplicate, or before-prefix
  matches fail closed. Validation covers replacement after ordinary dedupe
  expiry while a reaction marker remains above a blocked cursor. Recheck is
  pending.
- Recheck found that close could wait for a pending admission ticket while still
  holding the session transcript lock needed to flush that ticket's prepared
  record. The wait now captures gate generation, releases the lock through the
  existing prompt-release fence, reacquires and merges transcript changes, then
  rechecks before close. Prepared records remain hidden until adoption.
  Validation deterministically covers arrival after the final model stream and
  proves no lock cycle. Resolved in the final complete-diff recheck.
- Recheck found that even an exact matching GUID at a nonempty legacy cursor
  cannot prove the ordered prefix below it. Automatic bootstrap now requires a
  preexisting full-prefix commitment or immutable database identity recorded
  before cursor movement. The current row-only deployment requires an
  authenticated operator-reviewed initial boundary. Validation preserves the
  cursor-row GUID while changing an earlier row and requires immediate mode to
  remain disabled. Resolved in the final complete-diff recheck.
- Recheck found one stale acceptance criterion still allowed automatic bootstrap
  from that cursor-row GUID. It now uses the same full-prefix,
  immutable-identity, or operator-reviewed-boundary requirement and explicitly
  rejects a lone boundary GUID. Resolved in the final complete-diff recheck.
- Recheck found that post-bootstrap boundary anchors can also survive a database
  fork that changes an earlier committed row. Every admission on the current
  source now recomputes the complete ordered structural prefix through the
  cursor in one read-only snapshot before any model, tool, stop, or reaction
  effect. Only a source contract with a genuine immutable generation ID may skip
  that scan. Validation preserves all anchors while changing an earlier row and
  requires immediate admission to fence. Resolved in the final complete-diff
  recheck.
- Recheck found stale lifecycle text that could preserve early reaction handling
  ahead of source continuity. Every reaction row now passes FIFO and complete
  prefix validation before any effect. General reactions then persist the sparse
  marker and enqueue ephemerally; receipt-backed approval reactions persist an
  adopted pin before their existing idempotent transition. Validation forks the
  database before each kind and requires fencing before effect. Recheck is
  pending.
- Recheck found the independent approval poller still discovered history and
  called the approval handler outside ingress. In immediate mode the poller now
  submits a finite-row, stable-GUID candidate through the shared source slot.
  Live and polled delivery join one owner before adopted-pin persistence or
  approval effect, and discovery alone is never success. Validation covers a
  database fork, an older FIFO blocker, and a live/poller race. Resolved in the
  later complete-diff recheck.
- Recheck found that the poller candidate still used a synthetic GUID that
  differs from the live database GUID, and that awaiting FIFO ownership could
  hold the poller's in-flight guard forever. History must now expose the real
  reaction row/GUID, which is the only source identity. Poll submission returns
  completed, pending, or rejected promptly, and missing poll identity does not
  fence a healthy source. A verified historical row uses a receipt-backed effect
  claim without changing the cursor. The same pass normalized the plan to the
  current Human section and Agent section contract. Validation covers identical
  live/poll identity, continued timer ticks behind an indefinite blocker,
  historical rows below the cursor, and one shared prefix enumeration. Resolved
  in the later complete-diff recheck.
- Recheck found that a historical approval below the cursor still used an
  ordinary cursor-relative pin. It could never cross again, leaked bounded pin
  capacity during normal operation, and could be deleted by startup cleanup
  before receipt recovery. Historical approval now uses a separate effect-claim
  class and capacity pool. Receipt confirmation releases it without cursor
  movement, restart reconciles it against the existing approval receipt, and
  ordinary pin sweeps ignore it. Enrollment also requires proof that bridge
  history exposes the real reaction row/GUID. Validation covers crash recovery,
  terminal capacity release, saturation isolation, and unsupported bridge
  capability. Resolved in the final complete-diff recheck.
- The retained reviewer rechecked the complete stable diff after every poller
  and historical-claim correction. It found no actionable issues. It confirmed
  the current plan contract, one real reaction source identity, non-blocking
  poll submission, shared prefix enumeration, separate historical claim
  lifecycle, capacity release, and bridge capability gate. Residual proof for
  the real bridge response, stop latency, and gateway-wide restart barrier stays
  in implementation validation. The documentation candidate is ready for
  exact-commit terminal review.
- Fresh terminal review of the exact candidate found that prefix membership
  still depended on the disabled, parser-versioned catchup classifier and that
  the existing 500-row constant is a `since_rowid` floor clamp rather than a
  page size. The prefix now uses one versioned structural message-table
  predicate independent of parsing. Enrolled recovery removes the clamp and
  requires a bridge fixture proving complete ordered replay from the persisted
  cursor across more than 500 rows. The review also found and corrected two
  damaged implementation sentences. The retained reviewer rechecked the
  complete corrected diff against the source schema and runtime clamp and found
  no actionable issues.
- Fresh exact-commit terminal review found that whole-prefix count/hash equality
  treated routine deletion of any committed Messages row as a database fork,
  pausing iMessage until operator action. The checkpoint now stores exact
  row/GUID bindings, predicate version, and scope. A pure committed-row subset
  shrinks atomically, and a deleted suffix rewinds the cursor so later SQLite row
  reuse cannot be missed. Changed bindings, inserted old-range rows, missing
  unresolved identities, and scope changes still fence.
- The same terminal review found that removing age suppression would turn stale
  Apple Push-recovery rows with fresh row IDs into real agent replies. The
  current 15-minute live and two-hour recovery thresholds now produce durable
  `stale_no_reply` choices at first observation. These rows do no agent work but
  still commit replay, cursor, and checkpoint state.
- The retained reviewer found both terminal corrections sound with no actionable
  issues. Its residual proof notes are now explicit: age selection uses the real
  startup high-water comparison, an empty prefix uses numeric replay floor `0`,
  the row-reuse fixture forces an ID because the real schema uses
  `AUTOINCREMENT`, stale-burst latency runs against a large database, and
  structural source-read access has its own enrollment probe. The next recheck
  found those clarifications sound.
- Recheck found one sentence incorrectly called the startup high-water durable
  across a crash, which would move outage messages from the existing two-hour
  recovery window into the 15-minute live window. Restart now explicitly samples
  a new high-water before classifying undisposed rows. The empty-prefix fixture
  also captures the subscription argument and requires numeric `0` to survive
  explicit null checks. The retained reviewer rechecked the complete current
  diff and found no actionable issues.
- Fresh terminal review of commit `cae2598` found that classification still
  waited behind FIFO and continuity. Queue delay could make a live row stale,
  while restart could move an observed stale live row into the wider recovery
  window. Each ordinary row now records its immutable startup-boundary class,
  observation time, and `reply_eligible` or `stale_no_reply` choice at first
  observation. FIFO delay, restart, and generation reconciliation must honor
  that choice through terminal disposition.
- Retained complete-diff recheck found that the first correction could count an
  observation marker and its prepared pin as two units of the same capacity
  bound. A full eligible recovery burst could therefore block its own FIFO head
  permanently. Each ordinary row now reserves one non-expiring lifecycle token
  at first observation and converts the same record to `prepared` in place,
  without another reservation or capacity check. Saturation affects only new
  first observations. Validation fills the bound with eligible records and
  proves head progress and full drain, holds a marker beyond ordinary store TTL
  and pruning, and measures synchronous marker-write latency. Retained round 10
  complete-diff review found no actionable issues.
- The retained reviewer noted a residual proof gap because the
  generation-neutral marker becomes a generation-bound prepared-pin key. The
  design now requires one atomic store transaction that preserves the single
  capacity lease and exposes exactly one complete old or new record across
  crash. Validation interrupts every rekey boundary and proves exact-once
  recovery. One stale sentence about hold restoration now distinguishes restored
  marker holds from cursor-derived replay holds. Final complete-diff recheck is
  required because these clarifications changed the reviewed diff.
- Retained round 11 complete-diff recheck found no actionable issues. It
  confirmed the transactional rekey, single capacity lease, interruption
  fixture, and corrected hold restoration. The final wording now states that
  the durable marker remains generation-neutral through continuity validation,
  in-memory slot binding, and repair, with the prepared-pin transaction as the
  sole durable rekey point.
- Fresh terminal review of exact candidate `c298d28` found three actionable
  contradictions. Older architecture and criteria still required a second
  capacity reservation, the proposed cross-key marker rekey was unsupported by
  the existing store, and an eligible pre-adoption row could reply after an
  unbounded outage. The design now reserves once at observation, uses one
  immutable lifecycle key with atomic single-key value updates, and saves the
  original age deadline. Same-process queue delay preserves eligibility.
  Restart preserves an eligible row before its deadline and atomically
  downgrades it to durable no-reply after expiry. Complete-diff recheck is
  pending.
- Retained round 12 recheck found that the first outage bound incorrectly reused
  a live row's 15-minute threshold after restart, while current recovery would
  allow that row for two hours. Each record now saves original send time and the
  existing two-hour recovery cutoff. Restart samples time immediately after the
  state store opens, before structural bootstrap, preserves eligible
  pre-adoption work inside that cutoff, and downgrades only after it expires.
  Enrollment now proves the configured store exposes atomic single-key
  `update`, and restart idempotently cleans any hidden prepared transcript left
  by a crash after downgrade. Complete-diff recheck is pending.
- Retained round 13 complete-diff recheck found no actionable issues. It
  confirmed both age-window edges against the real monitor: an initially stale
  live row never upgrades, while an initially eligible row uses the existing
  two-hour recovery cutoff after restart. It also confirmed restart-time
  sampling, store-update capability gating, interrupted hidden-transcript
  cleanup, and the 40-minute and post-cutoff fixtures.
- Fresh terminal review of exact candidate `54724dd` found one remaining
  preparation paragraph that still reserved pin capacity and an undefined
  recovery cutoff when the optional source send date was missing or
  unparseable. Preparation now explicitly reuses the first-observation token
  without a capacity check. First observation keeps dateless input eligible,
  uses observation time as a defined age basis, and saves the normal two-hour
  recovery cutoff. Validation covers missing and malformed dates on both sides
  of that cutoff. Complete-diff recheck is pending.
- Retained round 14 complete-diff recheck found no actionable issues. It
  confirmed every ordinary reservation point, current initial behavior for
  missing and malformed dates, the defined observation-time fallback, and both
  restart fixtures. The Human and Agent design now state explicitly that current
  handling can replay undated rows without a time bound, while this proposal
  intentionally limits restart eligibility to two hours after observation.
  Final clarity recheck is pending because that approval-facing statement
  changed the reviewed diff.
- Retained round 15 complete-diff clarity recheck found no actionable issues. It
  confirmed the explicit undated-message tradeoff against the real age fence,
  the repaired compound terms, all prior capacity and restart corrections, and
  the complete plan structure.
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
