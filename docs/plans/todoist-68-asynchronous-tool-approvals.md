# Asynchronous tool approvals

**Status:** Ready for review
**Issue:** [#68](https://github.com/coletaylor788/puddles/issues/68)
**Last updated:** 2026-07-31
**Owner:** Cole

## Human section

### Design

Some agent tools can cause serious or irreversible effects. Sending email is the
first example. The agent should be able to prepare an email, but the model should
not be able to send it until Cole has reviewed the exact transaction on his
iPhone and approved it.

The important trust boundary is between the model-controlled sandbox and the
trusted gateway on the Mac. The sandbox is untrusted. The gateway process and
the logged-in macOS account that runs it are trusted. Provider credentials,
Keychain access, authenticated browser state, host tools, and the actual email
executor stay outside the sandbox. The sandbox gets only a narrow submission
tool. It cannot call the provider directly or select another route around
approval.

The submission tool returns a durable pending result immediately. It does not
hold the agent turn open. The trusted gateway resolves every default, snapshots
attachment bytes, applies non-overridable policy, and stores an immutable record
of the exact operation. The record includes the original arguments, every final
recipient and option, the complete body, attachment metadata and hashes, its
expiry, and the originating agent, session, task, turn, and tool call.

The gateway then sends a canonical approval review to Cole through iMessage.
This reuses the Messages account already synchronized between the Mac and
Cole's iPhone. Large reviews are split into numbered parts. Every part carries
the same record identifier and digest. Only after all detail parts have been
sent does the gateway send one fixed final decision bubble. Model text cannot
choose the recipient, wording, decision symbols, approver list, or final target.

Cole reads the review in Messages on his phone. A thumbs-up Tapback on the final
decision bubble approves once. A thumbs-down Tapback denies. The Tapback is the
primary experience because Messages attaches it to one exact message and the
current OpenClaw iMessage support already correlates reactions with the
outbound message identifier. The final bubble warns that the first accepted
Tapback is final. Changing or removing it later cannot reverse the decision.

An explicit inline reply to that same final bubble is the fallback for someone
who wants a more deliberate action. It includes a short code from the fixed
decision bubble. A general reply, a reply to another message, or a bare yes is
not a decision. This fallback needs a small extension because the current
generic approval reply is tied to an approval identifier, not the exact replied
message.

The iPhone does not connect to a new service on the Mac. Apple carries the
iMessage and synchronizes the Tapback or reply back to Messages on the Mac. The
trusted gateway polls the existing local Messages transport and validates the
configured approver identity, direct conversation, exact final message
identifier, record and digest, decision mapping, freshness, and pending state.
No new TCP or UDP listener, public endpoint, custom mobile app, DNS name, TLS
certificate, reverse proxy, or firewall opening is introduced.

The gateway also prevents model-facing message tools from editing, unsending,
reacting to, or replying to any active review bubble. Before a decision is
accepted, it verifies that every displayed part still matches the stored
canonical text. A model can imitate the visible wording, but that message has no
registered review identifier and cannot authorize execution.

The first valid decision wins in one database transaction. Missing, late,
ambiguous, replayed, changed, removed, wrongly addressed, or unauthorized
responses cause no execution. There is no permanent approval. Approval also
cannot override secret, content, attachment, or destination policy.

If approved, the trusted executor claims the stored record and sends exactly
those values. It uses provider idempotency and reconciliation. An uncertain
provider outcome becomes an explicit unknown result instead of a blind retry.
For email, success records the provider receipt or message identifier and
provider timestamp.

The terminal result is part of the tool workflow, not just a notice to Cole.
The gateway records sent, denied, expired, failed, or execution unknown before
delivery. It emits a trusted result to the originating agent and keeps
redelivering until the correct transcript records it and one resumed agent turn
durably acknowledges it. A busy session waits. A missing session uses a
protected task inbox and the owning agent. Stable identifiers prevent a second
provider effect or a second continuation.

This design accepts a privacy tradeoff. The complete approved email values are
sent through iMessage and may remain in Messages history and synchronized
storage. Secret policy rejects credentials and tokens before any review message
is sent. Attachment bytes are never sent or rendered for approval. The phone
shows only immutable attachment names, types, sizes, hashes, and scan results.
If that is not enough to make a safe decision, the request is denied or allowed
to expire.

OpenClaw's existing approval feature remains useful transport, but it is not the
complete solution. Its current manager waits on short-lived in-memory state,
loses pending approvals on restart, and renders a generic tool request rather
than a durable final execution envelope. The proposal keeps its iMessage
allowlist, exact message correlation, reaction polling, and delivery code, then
adds durable records, canonical review, execution, reconciliation, and agent
continuation.

### Status

This is a design-only proposal. The trusted-gateway and iPhone approval
architecture is complete, independently reviewed, and ready for Cole to review.
It changes no runtime, credential, configuration, message, account, or external
tracker. Implementation remains blocked until Cole explicitly approves the
design.

## Agent section

### State

The provider-neutral design is complete and ready for review. It replaces the
prior native review application with a durable approval subsystem inside the
trusted OpenClaw gateway. All
model-controlled execution remains inside the untrusted sandbox. The trusted
gateway and its logged-in macOS account own approval state, Messages transport,
provider credentials, execution, reconciliation, audit, and continuation.

The primary phone decision is an allowlisted iMessage Tapback on one exact final
decision message. A thumbs-up maps only to `allow-once`; a thumbs-down maps only
to `deny`. An exact inline reply with `APPROVE <short-code>` or
`DENY <short-code>` is the deliberate fallback. It must reply to the same final
message GUID. Generic `/approve` commands are not accepted for protected tools.

This revision adds no approval-specific network listener or separately hosted
service. It reuses the existing trusted gateway and local Messages transport.
Messages and provider connections still make their normal outbound
connections, and the existing gateway may retain listeners required by its
unrelated runtime. The precise claim is that this feature adds no TCP or UDP
listener, public route, DNS, TLS, reverse proxy, or firewall opening.

Public tracking is on issue 68. The work is design-only. It does not implement,
deploy, send, approve, execute, mutate an account, merge the pull request, or
change external task tracking.

### Scope and acceptance criteria

The proposed implementation includes:

- a durable registry of serializable protected tools;
- a narrow sandbox-facing submission tool that returns `pending`;
- a trusted in-gateway broker, executor, reconciler, and continuation worker;
- a transactional SQLite database and immutable attachment staging;
- non-overridable secret, content, destination, and attachment policy;
- canonical full-value iMessage review through a fixed owner route;
- digest-linked multipart delivery and one final decision GUID;
- allowlisted Tapback approval or denial plus an exact-reply fallback;
- atomic first-decision handling, expiry, quotas, deduplication, leases,
  idempotency, reconciliation, retention, audit, and recovery;
- terminal provider evidence and exactly-once semantic agent continuation; and
- closed read-only and reversible mailbox capabilities that never expose a raw
  provider client or credential to the sandbox.

This proposal does not include:

- implementation, deployment, credential changes, notifications, or test sends;
- a native approval app, Notification Center decision UI, Touch ID decision,
  Secure Enclave decision key, XPC authority, or separate OS identity;
- a hosted page, public or private web service, DNS name, TLS certificate,
  reverse proxy, or opened firewall port;
- a new TCP or UDP listener;
- a custom iOS app or direct APNs integration;
- group, SMS, wildcard, model-selected, or `allow-always` approval;
- approval from generic chat text, a model-authored message, or a reaction to
  any message other than the final registered GUID;
- inline waiting, live closures, or in-memory-only pending state;
- approval as an override for policy; or
- generic replay of tools that depend on live streams, browser state, or other
  non-serializable context.

#### Acceptance criteria

A future implementation is acceptable only when it:

1. Treats all model-controlled sandbox code and content as untrusted while
   treating the gateway process and its logged-in macOS account as trusted.
2. Keeps provider credentials, Keychain access, authenticated browser state,
   provider network clients, host tools, approval records, and executors outside
   the sandbox.
3. Proves that every sandbox profile and invocation surface either uses the
   protected submission tool or lacks every credential, session, executable,
   permission, host path, and provider client needed to create the effect.
4. Gives the sandbox only closed schema submission and read-only status. It
   cannot choose the approval route, renderer, wording, approver, decision
   mapping, message target, execution adapter, credential, or continuation.
5. Returns `pending` immediately and persists the complete request before the
   original turn can end. No approval depends on a live promise or in-memory
   waiter.
6. Stores raw arguments beside a versioned resolved execution envelope,
   immutable attachment bytes, hashes, policy result, origin correlation, and
   expiry.
7. Sends every permitted raw and resolved parameter through one canonical
   direct iMessage review. Values are complete, inert, unambiguous, and never
   silently truncated or redacted.
8. Splits an oversized review only within fixed limits. Every part has the
   record ID, envelope digest, part number, part count, and expiry.
9. Sends and durably records all detail-part GUIDs before sending the fixed
   final decision bubble. It reserves every detail GUID from model-facing
   Messages actions as each send completes. Partial, reordered, duplicated,
   unknown, or GUID-less delivery never registers a positive decision target.
10. Registers exactly one final GUID, direct conversation, account, configured
    approver set, envelope digest, decision mapping, and expiry in durable state.
11. Requires an explicit non-wildcard approver allowlist, a direct iMessage
    route, and the expected iMessage service. Groups, SMS, and wildcard
    approvers fail closed.
12. Accepts only thumbs-up for `allow-once` and thumbs-down for `deny` on the
    final GUID. Every other reaction is ignored.
13. Optionally accepts only an exact inline reply to that final GUID with the
    matching one-time short code and one closed decision word.
14. Validates normalized approver handle, account, direct conversation, target
    GUID, record, digest, current state, freshness, and allowed decision before
    one atomic transition.
15. Makes the first valid decision final. Reaction changes, removals, duplicate
    events, delayed sync, replay, and a second decision cannot alter it.
16. Serializes the complete review-bundle send and model-facing Messages
    actions on one account lane. It durably reserves every concrete detail and
    final GUID from model actions before releasing that lane, then verifies all
    current message text against stored hashes and arms owner decisions only
    after every reservation commits. Recovery completes this ordering before
    model-facing Messages actions resume.
17. Denies every model or sandbox request to react, reply, edit, unsend, or
    otherwise act on any reserved review part or active decision target. It
    re-verifies every review part immediately before accepting a decision. An
    edit, unsend, missing part, text mismatch, or unregistered lookalike fails
    closed.
18. Defaults every missing, ambiguous, stale, unauthorized, malformed,
    unavailable, or expired condition to no execution.
19. Allows no permanent approval. Approval cannot waive secret, content,
    destination, attachment, or provider policy.
20. Accepts attachment bytes and logical metadata, never a caller-controlled
    host path. It rechecks staged bytes and hashes immediately before execution.
21. Never sends attachment bytes through Messages or renders active attachment
    content in an approval surface. Unsupported review needs fail closed.
22. Executes only the stored envelope within a short absolute window and under
    a durable lease.
23. Uses provider idempotency or reconciliation. An ambiguous provider outcome
    becomes `execution_unknown` and never causes a blind resend.
24. Commits one terminal result before any result event. Email `sent` includes
    the provider message or receipt ID and provider timestamp.
25. Emits only `sent`, `denied`, `expired`, `failed`, or `execution_unknown` as
    the trusted terminal tool result. Errors are bounded and content-free.
26. Persists a stable sequenced result event and continuation outbox keyed by
    the original task, tool call, and approval lineage.
27. Redelivers until the intended transcript stores the event and one resumed
    turn completes or writes a durable continuation checkpoint.
28. Queues behind a busy session, uses a protected task inbox when the session
    is missing or replaced, and starts no more than one semantic continuation.
29. Reconciles every crash window. If a resumed turn may have crossed another
    side-effect boundary without a durable commit, it enters
    `continuation_unknown` and does not replay blindly.
30. Adds no approval-specific TCP or UDP listener, public endpoint, mobile app,
    webhook, DNS, TLS, reverse proxy, or firewall rule.
31. Keeps automated and live-target validation read-only or behind
    deny-by-default recording adapters. It never sends a real message or mutates
    a live account during tests.
32. States the residual boundary honestly. Host, gateway-account, Messages
    account, provider-account, Keychain, root, and device compromise are outside
    the guarantee. This design protects against the untrusted model and sandbox,
    not a compromised trusted host.

### Architecture and decisions

#### Threat model and boundary

The attacker controls model output, prompts, tool arguments, attachment
contents, sandbox processes, repeated submissions, and timing. The design also
handles stale or replayed Messages events, delayed phone synchronization,
gateway restart, host reboot, partial delivery, process interruption, provider
timeouts, and session replacement.

The gateway process and logged-in macOS account are trusted. This clarification
removes the need for a separate approval OS identity, signed native review app,
Touch ID decision key, or XPC authority. It also narrows the security claim.
Arbitrary code execution as the trusted account, control of Messages or the
owner's phone, root compromise, provider-account compromise, and theft of a
host credential are outside the guarantee.

The sandbox boundary prevents direct sending because:

- provider refresh tokens and API credentials exist only in the host Keychain
  or another host-only credential store;
- the sandbox cannot read that store or inherit credential-bearing
  environment variables;
- authenticated provider clients and browser sessions run only in trusted host
  code;
- host filesystem, shell, browser, and raw network bridges exposed to the
  sandbox cannot reach the protected account;
- the only sandbox-visible mutation entry point is the closed approval
  submission tool; and
- the trusted executor consumes only a broker-owned immutable record after an
  accepted decision.

This does not claim to stop all Internet communication or all possible
exfiltration by a sandbox. It prevents protected effects through the configured
account and provider. Broader sandbox egress policy remains a separate control.

#### Components

| Component | Responsibility |
|---|---|
| Sandbox submission tool | Validates a closed request schema, streams bounded attachment bytes, submits once, and returns durable pending status. |
| Trusted approval broker | Resolves the request, applies policy, owns records and staging, renders review parts, sends iMessage, validates decisions, schedules execution, and reconciles recovery. |
| Messages adapter | Uses the existing local iMessage transport to send canonical review parts, obtain GUIDs, poll reactions, and receive exact inline-reply metadata. |
| Content scanner | Parses hostile attachment bytes in a fresh credential-free sandbox with no network, Keychain, provider client, broker database, or write access to staged content. |
| Protected executor | Uses the host-only provider credential to execute the immutable envelope under a lease and idempotency key. |
| Continuation worker | Inserts the trusted terminal result, schedules one resumed turn, tracks transcript and consumption receipts, and repairs interrupted handoffs. |
| Read and triage adapters | Expose only closed read-only or reversible mailbox operations. They never expose a token, raw provider method, arbitrary request body, or send operation to the sandbox. |

All components except scanner workers can live in the existing trusted gateway
process for version 1. They remain separate modules and capabilities so a
sandbox tool cannot acquire a raw executor handle through confused dispatch.
The scanner stays process-isolated because parsing attacker-controlled bytes in
the trusted gateway would weaken the sandbox boundary.

#### Immutable record and review envelope

Each protected executor defines:

- input schema and semantic validation;
- canonicalization and default resolution;
- immutable snapshot rules;
- non-overridable policy;
- deterministic plain-text review rendering;
- execution under a stable idempotency key;
- provider reconciliation; and
- a bounded terminal-result codec.

For email, the envelope includes account, operation, final `to`, `cc`, and
`bcc`, reply and thread identifiers, subject, complete body, format, allowed
headers, scheduling and send options, stable message identity, and attachment
references. It stores the original values beside the resolved values so changed
defaults and aliases are visible.

The broker accepts attachment bytes, not privileged host paths. Each staged
object records a logical name, declared and detected type, size, digest, scanner
version, and closed scan verdict. A fresh scanner process receives bounded bytes
or a read-only descriptor. It has hard memory, CPU, wall-time, process,
recursion, decompression, and output limits. Missing, malformed, timed-out,
uncertain, or unsupported scanning fails closed.

Secret and content policy runs after resolution and staging and again before
execution. Credentials, tokens, forbidden destinations, and disallowed content
are rejected before any review message is sent. Approval never overrides this
result.

The canonical renderer uses fixed labels and quotes all model-controlled text.
It exposes control characters, newlines, bidirectional text, zero-width text,
and Unicode domain forms. It never interprets HTML, Markdown, links, or
attachment content. Every value line has an unambiguous fixed prefix, so
model-controlled text cannot create a control header or approval instruction.
The final decision bubble contains no model-controlled text.

#### iMessage phone flow

Version 1 uses one configured direct iMessage route to the owner. The broker
loads its account, target, normalized owner handle aliases, and decision mapping
from trusted configuration. The protected approver set is explicit and may be a
strict subset of the channel's broader inbound `allowFrom` list. It refuses
wildcard `*`, group targets, SMS fallback, non-owner authorized senders, absent
approvers, and model-supplied routing.

The review renderer prefers one message. If the complete values exceed the
single-part limit, it emits at most 16 parts of at most 3,000 UTF-8 bytes each.
A tool may set a smaller bound. A review that cannot fit those limits fails
before delivery. Every part begins with fixed fields:

```text
Protected tool review
Record: <opaque short id>
Digest: <full envelope digest>
Part: <n>/<count>
Expires: <absolute time>
```

Before sending the first review part, the broker acquires the same per-account
Messages action lane used by every model-facing reaction, reply, edit, unsend,
and raw Messages action. It keeps the lane through the complete review bundle.
The broker sends parts sequentially. For each send it stores the exact text
hash, attempt, result, GUID, conversation, and time, resolves the GUID to the
concrete direct chat, and commits a durable reservation that blocks
model-facing actions against that part. A numeric row ID, `ok`, `unknown`,
missing GUID, or ambiguous chat is not sufficient. After a timeout it first
reconciles the local Messages database by exact target, text, and send window.
An ambiguous outcome becomes `delivery_unknown`; it is not blindly resent and
cannot arm approval.

Only after every detail part has one concrete GUID does the broker send the
fixed final bubble:

```text
Decision for record <short id>
Digest: <full envelope digest>
Review parts: 1-<count>
Expires: <absolute time>
👍 Approve once
👎 Deny
First accepted decision is final.
Reply fallback: APPROVE <short-code> or DENY <short-code>
```

The final send follows the same reconciliation and reservation rule. While
still holding the lane, the broker resolves the final GUID to the same concrete
direct chat and commits its durable reservation. It then reads every detail and
final message by GUID and verifies current text, chat, order, and hash against
the canonical bundle. It releases the lane only after all reservations and the
complete-bundle verification commit.

The broker then arms one durable target row containing the final GUID, all
normalized GUID forms, account, concrete chat row and conversation identifiers,
allowed owner handle aliases, record, digest, short-code hash, allowed
decisions, and expiry. A handle-only target or a GUID that cannot be tied to one
direct chat remains reserved but unarmed. A crash after any review-part send is
reconciled and reserved before model-facing Messages actions are enabled on
restart. An owner reaction that arrives before arming remains in Messages
history and is processed after the target becomes active.

The database row is authoritative. The current bounded reaction-target store may
remain a delivery cache, but cache eviction or restart cannot remove the broker
record.

Apple documents that a Tapback is attached to one specific message and that a
user may later change or remove it. Messages in iCloud can synchronize messages
and reactions between the iPhone and Mac when both use the same Apple Account
and the feature is enabled. The mini receives the synced reaction through its
existing local Messages bridge and polling. No service on the mini accepts an
inbound Internet connection.

The decision handler verifies:

- the configured iMessage account and direct conversation;
- a normalized sender handle in the explicit non-wildcard approver set;
- the exact final GUID, including accepted prefixed and normalized forms;
- the broker target row, record, envelope digest, and pending state;
- every detail and final GUID still exists in the expected chat with exact
  canonical text, order, and hash and no edit or unsend state;
- the closed reaction or reply mapping;
- current time before expiry; and
- a single atomic `pending_decision` transition.

An observed `is_from_me` reaction is acceptable only when Messages reports a
normalized handle that is explicitly configured as an approver. This supports
the same Apple Account appearing on the phone and Mac without treating every
local reaction as authorized.

Tapback is primary because the current source already provides approver
authorization, GUID-only target binding, thumbs-up and thumbs-down mapping,
reaction polling, persistent target lookup, and suppression after successful
resolution. The protected flow narrows that support to `allow-once` and `deny`
and makes broker persistence authoritative.

The exact inline reply is a fallback. Current inbound payloads expose the
replied-to GUID, but the generic approval command does not require it. The
smallest extension intercepts a closed reply before model dispatch, verifies
`reply_to_guid` against the final target row, verifies the short code and actor,
and calls the same atomic resolver. A generic `/approve`, bare `yes`, copied
short code, or reply to another message cannot resolve a protected request.

The first successful conditional database update wins. A later Tapback change,
Tapback removal, duplicate poll result, inline reply, or command has no effect.
If a Tapback is removed before the poller observes it, no decision exists. If it
is accepted before removal, the decision remains final as the fixed message
warns.

The host-wide Messages action policy reserves every active detail and final
GUID. Model-facing tools cannot react, reply, edit, unsend, or invoke a raw
Messages action against them. The broker also rejects events known to have been
initiated by a model-facing local action. A lookalike approval message has no
broker review row and is ignored. This control is required because a phone
Tapback synchronized under the same Apple Account may legitimately appear as
`is_from_me`; secrecy of the GUID is not the boundary.

Phone offline, Messages sync delay, disabled Messages in iCloud, transport
failure, unavailable polling, or an expired target leaves the request pending
until it expires. The model cannot switch channels or extend time. The owner can
submit a fresh request through a new workflow after expiry, but no old approval
is revived.

#### Privacy and attachment review

iMessage encrypts message content to receiving devices, but routing metadata is
not encrypted. Messages in iCloud key handling also depends on backup and
Advanced Data Protection settings. The design does not depend on Apple being
unable to recover synchronized content. The privacy statement is simply that
full review values leave the Mac through the owner's configured Messages
account and may persist on devices, in backups, and in synchronized history.

No credential or secret is allowed into that review. Audit logs contain record
IDs, hashes, states, actor fingerprints, provider evidence identifiers, and
timings, not message bodies or attachment bytes. Local payloads and staged bytes
use owner-only permissions and bounded retention.

Attachment bytes never enter Messages. Approval shows immutable metadata,
digest, and scan result only. It does not send a file, thumbnail, HTML preview,
Quick Look object, or provider link. Version 1 has no approval-time attachment
viewer. If metadata is insufficient, the safe choices are deny, expiry, or a
separately designed inspection flow.

#### Durable state, limits, and time

Authoritative state uses a transactional SQLite database, not the current
in-memory approval manager or an evicting channel cache. Each record contains:

- tool, owner, origin, task, agent, session, run, turn, and tool-call lineage;
- raw arguments, resolved envelope, schema version, and digest;
- staged object metadata, hashes, scanner version, and policy result;
- deduplication and provider idempotency keys;
- all deadlines and the host boot identity;
- review part hashes, attempts, GUIDs, conversation, and final target;
- decision actor, source, target GUID, time, and first-winner transition;
- execution lease, attempts, provider evidence, and reconciliation;
- terminal result and safe error class; and
- event sequence, transcript receipt, continuation outbox, turn claim,
  consumption receipt, and final acknowledgement.

Defaults are:

- pending approval expiry of 23 hours;
- execution claim and provider start within 5 minutes after approval;
- review limit of 16 parts at 3,000 UTF-8 bytes each;
- no more than 1,000 active decision targets;
- per-owner, per-session, per-tool, per-task, and global pending quotas;
- separate message delivery and decision rate limits; and
- seven days of terminal payload retention before body and staged-byte purge.

A tool may choose shorter or smaller limits. It may not choose larger limits
without a new reviewed policy.

Within one boot, deadlines use continuous time that includes sleep. The broker
also stores boot identity and a wall-clock high-water mark. Reboot, backward
clock movement, large forward jumps, or uncertain downtime expires pending
decisions and unclaimed approvals. Claimed execution reconciles provider state.
No clock anomaly extends an approval, decision target, lease, or cooldown.

Deduplication uses trusted task, agent, session, tool-call lineage, tool, and
envelope digest. An identical active request returns the same pending record. A
completed effect returns `already_executed`. A terminal denial, expiry, failure,
or unknown state is returned rather than silently creating another generation.
Varied-payload floods are bounded by quotas and notification cooldowns.

`already_executed` is a submission-time deduplication response that points to
the prior terminal record. It is not a terminal state, does not emit another
terminal event, and does not start another continuation.

#### Decision, execution, and result lifecycle

The broker uses these states:

```text
submitted -> preparing
preparing -> pending_delivery | failed
pending_delivery -> pending_decision | failed | expired
pending_decision -> approved | denied | expired | failed
approved -> executing | expired | failed
executing -> sent | failed | execution_unknown
```

`preparing` resolves defaults, stages bytes, scans content, applies policy, and
creates the canonical envelope. `pending_delivery` durably sends and reconciles
review parts. Only complete delivery and final target registration reaches
`pending_decision`.

The first valid owner decision moves `pending_decision` to `approved` or
`denied`. Approval creates a five-minute absolute execution deadline. The
executor claims it with a lease, rechecks record state, policy, staged hashes,
and time, then calls the provider with the stored idempotency key.

A crash before provider submission returns the lease for safe recovery. A crash
after possible submission reconciles provider state before any retry. Proven
acceptance becomes `sent`. Proven rejection or pre-acceptance failure becomes
`failed`. An outcome that cannot be proved either way becomes
`execution_unknown`.

Administrative disable or rollback moves any non-executing record to `failed`
with a closed cancellation class through the declared transition for its state.
The public terminal vocabulary remains `sent`, `denied`, `expired`, `failed`,
and `execution_unknown`.

For email:

- `sent` includes record ID, envelope digest, provider message or receipt ID,
  provider acceptance timestamp, and completion time;
- `denied` and `expired` state that no provider call occurred;
- `failed` includes a bounded safe error class and evidence that the provider
  did not accept the send when that evidence exists; and
- `execution_unknown` includes the last attempt time and bounded reconciliation
  evidence with an instruction not to regenerate or retry.

Bodies, attachment bytes, tokens, raw provider responses, and sensitive errors
never enter the terminal event.

#### Durable agent return and continuation

The broker record is the result source of truth. OpenClaw session delivery is
transport. Existing session-delivery queue behavior is useful for waking a busy
agent, but dispatch acknowledgement does not prove transcript insertion,
result consumption, or completion of a resumed workflow.

Every terminal result creates one internal event with:

- stable event ID, record ID, sequence, outcome, tool, and envelope digest;
- original task, agent, session instance, run, turn, tool-call, and lineage;
- safe provider evidence such as receipt ID and timestamp; and
- an internal instruction to continue beyond the pending tool without
  regenerating or replaying it.

The event uses trusted internal provenance that sandbox text cannot claim. In
the same transaction that stores the terminal result, the broker inserts a
continuation outbox row keyed by the original protected tool call and lineage.
Only the first terminal result can claim that key.

The continuation worker uses:

```text
received -> transcript_recorded -> turn_pending -> turn_claimed
turn_claimed -> turn_pending | continuation_committed | continuation_unknown
continuation_unknown -> turn_pending | continuation_committed
continuation_committed -> broker_acknowledged
```

It inserts `received` idempotently, appends the structured tool result to the
intended transcript or protected task inbox, and records the exact transcript
position. The same durable transition to `turn_pending` creates an outbox item
for one internal agent turn with a stable idempotency key and expected session
instance.

The normal session lane queues behind busy work. A crash before enqueue leaves
`turn_pending`. A crash after enqueue resubmits the same idempotency key.
Transcript presence alone never proves the continuation ran.

Consumption is durable only when the resumed turn completes or writes a
recoverable continuation checkpoint that preserves all remaining work before a
later side effect can be lost. The commit stores the resumed-turn ID, event ID,
transcript position, checkpoint or completion, and idempotency scope for later
tools and deliveries.

If a crash may have occurred after a later effect but before that commit,
recovery enters `continuation_unknown`, blocks replay, and alerts. A protected
operator repair can move it only with durable evidence. No consumption receipt
or broker acknowledgement is sent while the state is uncertain.

If the original session is busy, the event waits. If it was reset, rotated, or
deleted, the worker writes to the owning task's protected inbox and targets the
owning agent's current main session with the original correlation. If no session
exists, the inbox retains the event until one is available. A status reader may
show state but cannot decide, execute, acknowledge, or create another
continuation.

The broker redelivers until it has both transcript and consumption receipts.
Stable event IDs prevent duplicate transcript entries. Stable resumed-turn IDs,
leases, and continuation keys prevent two active continuations. Duplicate or
out-of-order transport cannot change the terminal result or repeat the provider
effect.

#### Existing OpenClaw reuse and required extension

Current iMessage support already provides:

- native exec and plugin approval delivery;
- approvers derived from `channels.imessage.allowFrom`;
- direct approver messages and rejection of unconfigured group routing;
- canonical `allow-once`, `allow-always`, and `deny` decision metadata;
- thumbs-up, infinity, and thumbs-down reaction mappings;
- outbound GUID recovery and refusal to bind numeric or placeholder IDs;
- persistent reaction target lookup keyed by account, conversation, and GUID;
- normalized prefixed and unprefixed reaction GUID handling;
- reaction polling from local Messages history;
- authorization of normalized sender handles, including explicitly allowlisted
  `is_from_me` reactions; and
- binding cleanup after successful resolution so a changed Tapback does not
  fire again.

The protected flow reuses those mechanisms but requires:

- durable non-evicting broker records instead of the in-memory approval manager;
- complete raw and resolved protected-tool envelopes;
- deterministic multipart rendering and delivery reconciliation;
- a new per-account Messages action lane and reserved-GUID policy through which
  every model-facing reaction, reply, edit, unsend, and lower-level mutation
  entry point must pass;
- fixed direct route and non-wildcard owner approvers;
- only `allow-once` and `deny`;
- durable restoration of pending poll targets from broker rows after restart;
- atomic digest-bound decision resolution against broker state;
- exact `reply_to_guid` and short-code validation for the reply fallback;
- broker-owned execution and provider reconciliation; and
- durable terminal result and semantic continuation.

The current generic `/approve <id> <decision>` parser authorizes the sender but
does not bind the reply to the final message GUID. It remains available for
ordinary OpenClaw approvals but must not resolve these protected records.

The current approval manager keeps pending entries in a process-local map,
waits on a promise, and retains resolved entries only briefly. Current bounded
reaction recovery scans recent chats and messages after restart. Those are
useful best-effort facilities, not the authoritative recovery design. The
broker must enumerate its own pending final GUID rows and drive exact scoped
polling until expiry.

#### Channel choices

| Option | Phone experience and network shape | Trust, privacy, and setup | Decision |
|---|---|---|---|
| iMessage Tapback | Review appears in Messages on iPhone. The phone reaction synchronizes to the Mac. No new listener or app. | Reuses current allowlist, GUID correlation, polling, and Messages account. Full review data enters Messages history. | Primary version 1 choice. |
| Exact iMessage inline reply | Reply to the final bubble with a closed decision and short code. No new listener or app. | More deliberate than a Tapback, but needs a small exact-GUID parser extension. | Version 1 fallback. |
| Generic iMessage reply | A bare yes or generic approval command. | Easier to mis-correlate and not bound to the final message GUID. | Prohibited for protected tools. |
| Notification Center and native Mac app | Approval stays on the Mac, not the phone. No network listener. | Does not meet the phone requirement and adds app signing, UI, and recovery work. | Not selected. |
| Custom iOS app with APNs | Native phone UI through outbound APNs provider requests. | Requires an iOS app, entitlements, device token, provider credential, app lifecycle, and additional service logic. | Not selected for version 1. |
| Telegram long polling | Gateway holds an outbound HTTPS poll. No webhook or inbound listener. | Good phone UX, but Telegram sees approval content and the bot token, account, update offset, and sender identity become security dependencies. | Viable later alternative only after a separate privacy decision. |
| Slack Socket Mode | Gateway opens an outbound WebSocket. No public HTTP endpoint. | Requires a Slack app, workspace installation, app-level token, bot credential, event acknowledgements, and trust in workspace administration. | Viable later alternative only after a separate privacy decision. |
| Hosted review page | Browser connects to an HTTPS service on or near the Mac. | Adds the listener, DNS, TLS, proxy, firewall, and web security burden Cole rejected. | Rejected. |

Telegram and Slack credentials would belong only to the trusted broker, never
the sandbox. They avoid inbound ports but do not remove trusted local state,
execution, recovery, or continuation. They also disclose review data to another
provider and require separate phone-account recovery. They are not enabled as
automatic fallback when iMessage is unavailable.

Apple provides the iMessage transport used by Messages, but not a public general
bot callback API. The design relies on the existing local Messages integration
and synchronized device state. A disabled or delayed synchronization path fails
closed.

#### Gmail capability boundary

The sandbox receives no Gmail token, OAuth client secret, authenticated browser
session, raw API method, generic HTTP client with host credentials, or
send-capable host tool.

The trusted gateway may host three closed capabilities:

- read-only mail access using a read-only credential;
- fixed reversible triage for archive, read state, star, importance, and
  configured user labels; and
- approved send execution through the broker.

The triage provider scope may technically permit sending even though the
sandbox-facing adapter cannot express send. The token therefore remains
host-only and protected. The adapter accepts only a closed action enum, bounded
message or thread IDs, and configured user-label IDs. It rejects raw methods,
request bodies, extra fields, arbitrary labels, drafts, send, insert, import,
trash, spam, forwarding, vacation replies, filters, send-as, delegation, and
settings before any provider call.

The broker send credential may be separate from read and triage credentials.
All credentials remain outside the sandbox and are loaded only by the trusted
host capability that needs them. Any old generic route that exposed a
send-capable provider client to sandbox tools must be removed before enablement.
Rollback never restores such a route.

#### Risks and tradeoffs

- **The gateway account is trusted.** This is simpler and matches the actual
  deployment, but gateway-account or host compromise is outside the guarantee.
- **Tapback is easy to use and easier to do accidentally.** The fixed final
  bubble, exact GUID, clear finality warning, and `allow-once` mapping reduce
  ambiguity. The exact inline reply is available for a more deliberate action.
- **Phone synchronization is best effort.** Offline devices, disabled Messages
  in iCloud, bridge failure, or delayed sync can cause expiry. They cannot cause
  execution.
- **Multipart review cannot prove what the owner read.** Numbering, a common
  digest, complete GUID registration, and one final bubble make omissions
  visible. Approval still represents the owner's judgment after review, not
  cryptographic proof of attention.
- **Full review values leave the Mac.** They may persist in Messages history,
  synchronized storage, and backups. Secret policy blocks credentials, but
  ordinary email content is disclosed to that channel.
- **Attachment review is metadata-only.** This avoids active content on the
  signing path, but some requests will be impractical to approve from the phone.
- **Messages is not a public bot API.** The design depends on the existing local
  bridge and Apple's synchronized Messages behavior. Upgrades require
  compatibility tests.
- **Exactly-once provider effects depend on provider evidence.** Ambiguous
  acceptance becomes `execution_unknown`.
- **Agent continuation uses at-least-once transport with idempotent
  consumption.** It guarantees one semantic continuation, not one network
  packet.
- **A stable trusted task identity is required for cross-run deduplication.**
  Until every source provides it, quotas and tool-call lineage are the primary
  controls.
- **The model can vary payloads to evade hash reuse.** Absolute quotas,
  notification cooldowns, and owner denial limits still apply.

#### Evidence

Current OpenClaw source:

- `extensions/imessage/src/approval-native.ts`
- `extensions/imessage/src/approval-handler.runtime.ts`
- `extensions/imessage/src/approval-auth.ts`
- `extensions/imessage/src/approval-reactions.ts`
- `extensions/imessage/src/approval-reaction-poller.ts`
- `extensions/imessage/src/monitor/types.ts`
- `extensions/imessage/src/send.ts`
- `src/auto-reply/reply/commands-approve.ts`
- `src/gateway/exec-approval-manager.ts`
- `src/gateway/server-methods/approval-shared.ts`
- `src/infra/session-delivery-queue-storage.ts`
- `src/infra/session-delivery-queue-recovery.ts`

Source and tests establish that current iMessage approval:

- uses explicit approvers from `allowFrom`, while wildcard `*` must be
  specifically prohibited by this design;
- maps thumbs-up to `allow-once`, infinity to `allow-always`, and thumbs-down to
  `deny`;
- binds a reaction only when outbound delivery returns a real GUID;
- probes normalized and prefixed target GUID forms;
- validates the reaction actor through the approval allowlist;
- accepts an `is_from_me` reaction only through that same explicit actor check;
- clears target bindings after successful resolution so a later changed
  reaction does not resolve again;
- stores reaction targets with a default 24-hour TTL and 1,000-entry cap;
- can scan 50 recent chats and 30 messages per chat with a 10-second request
  timeout during bounded restart discovery; and
- exposes `reply_to_guid` in inbound iMessage payloads, although the generic
  approval command does not currently require it.

Current gateway approval state is process-local. Its own error guidance says
pending approvals are cleared after restart. This is the principal durability
gap.

Related repository plans:

- Plan 014 for protected egress policy;
- Plan 027 for the earlier iMessage approval channel; and
- Plan 028 for durable session-delivery wake-ups.

Plan 027's broad plain-reply design is superseded for protected effects.
Current source now supports exact Tapback GUID correlation, which is safer and
more reusable. Plan 028 remains useful transport prior art but does not provide
end-to-end transcript and consumption acknowledgement.

Authoritative Apple documentation:

- Tapbacks attach to a specific message and can be changed or removed:
  https://support.apple.com/guide/iphone/react-with-tapbacks-iph018d3c336/ios
- inline replies target a specific message:
  https://support.apple.com/en-us/104974
- Messages in iCloud synchronizes Messages between configured devices:
  https://support.apple.com/guide/icloud/set-up-messages-mm0de0d4528d/icloud
- iMessage encrypts content per receiving device, uses APNs for delivery, and
  does not encrypt routing metadata:
  https://support.apple.com/guide/security/how-imessage-sends-and-receives-messages-sec70e68c949/web
- Messages in iCloud key protection depends on backup and Advanced Data
  Protection configuration:
  https://support.apple.com/en-us/102651

Alternative-channel documentation:

- Apple push app and provider requirements:
  https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns
  and
  https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
- Telegram long polling:
  https://core.telegram.org/bots/api#getting-updates
- Slack Socket Mode:
  https://docs.slack.dev/apis/events-api/using-socket-mode

### Implementation

No implementation is authorized. If Cole approves the design, use these phases.

1. **Recovery snapshot first.** Extend the complete recovery snapshot before
   changing state schema, tools, credentials, Messages routing, approver
   configuration, provider adapters, or continuation. Capture packages,
   configuration, gateway jobs, state databases, Messages account and route,
   provider credential references, Keychain ACL posture, tool inventories,
   queues, and feature flags. Restore the snapshot in an isolated fixture.
2. **Boundary inventory.** Build a committed inventory of every primary agent,
   subagent, sandbox profile, MCP tool, browser tool, shell tool, native plugin,
   host bridge, provider client, credential source, and compatibility fallback.
   Enumerate every Messages reaction, reply, edit, unsend, message action,
   lower-level bridge call, and raw mutation entry point. Route each through the
   shared per-account action lane and reserved-GUID policy. Prove the sandbox
   cannot reach a protected effect or bypass a review reservation.
3. **Broker core.** Add the non-evicting schema, immutable records and staging,
   canonicalization, scanner protocol, policy, quotas, deduplication, time,
   leases, idempotency, reconciliation, retention, audit, and recovery behind a
   disabled flag.
4. **Recording approval tool.** Connect one fake protected effect. Return pending
   immediately. Render complete canonical review bundles and record all delivery
   attempts through deny-by-default Messages adapters.
5. **iMessage phone path.** Reuse native delivery, approver normalization, GUID
   recovery, reaction mapping, and polling. Add multipart records, final-target
   persistence, broker-backed restart polling, `allow-once` and `deny` narrowing,
   atomic resolution, and exact inline-reply fallback.
6. **Durable continuation.** Add terminal result events, transcript receipts,
   continuation rows and outbox, stable resumed-turn IDs, busy-lane queueing,
   missing-session inbox, consumption acknowledgement, and ambiguous-turn
   repair.
7. **Provider adapter.** Add one non-production recording email adapter, then a
   credential-isolated provider adapter with provider idempotency or
   reconciliation. Keep all delivery and mutation adapters recording-only.
8. **Capability cutover.** Stage host-only read, triage, and protected-send
   capabilities. Remove raw provider methods, tokens, authenticated sessions,
   and send-capable compatibility routes from every sandbox surface.
9. **Controlled enablement.** After full lifecycle, adversarial, recovery, and
   rollback review, enable one owner and one low-volume protected tool. Keep
   `allow-always`, groups, SMS, alternate channels, and arbitrary tools disabled.

Do not retrofit arbitrary synchronous tools by serializing closures or live
runtime objects. Do not let model output construct review messages or decision
targets. Do not use the existing in-memory approval manager as durable state.

### Validation

The current design research covers present OpenClaw source, Plans 027 and 028,
and authoritative Apple documentation. A future implementation must add
committed recording-based regressions to the repository-managed integration
pool. Automated tests must not send real iMessages, call live mutation
endpoints, or change live accounts.

#### Sandbox and credential boundary

Tests must prove:

- every primary agent, subagent, sandbox profile, MCP tool, browser tool, shell
  tool, native plugin, diagnostic surface, host bridge, direct provider client,
  and fallback is in a committed inventory;
- each surface either submits through the broker or lacks the credential,
  Keychain access, environment secret, authenticated browser session, host
  filesystem path, executable, network client, permission, and tool capability
  required for the protected effect;
- new or unclassified surfaces fail startup or feature enablement closed;
- sandbox attempts to read Keychain, process environment, provider state,
  broker database, staged bytes, host browser profiles, and credential files
  fail;
- direct provider calls, browser automation, raw HTTP, SMTP, shell, alternate
  tools, compatibility fallbacks, encoded arguments, and prompt-injected routes
  cannot send through the configured account;
- tool names, routes, messages, approvers, reaction mapping, provider adapter,
  credential selector, and execution method are not model inputs;
- model-facing Messages actions cannot react, reply, edit, unsend, or target any
  active detail or final review GUID, even when the model can send ordinary
  conversation messages through the same gateway;
- every public, plugin, host-tool, lower-level bridge, compatibility, and raw
  Messages mutation entry point appears in a committed inventory and is forced
  through the same per-account lane and reserved-GUID check;
- forged fixed-template messages and copied approval text remain unregistered
  and cannot resolve a broker record;
- read and triage adapters reject raw methods, bodies, extra fields, forbidden
  labels, and every send-like operation before provider contact; and
- secrets in direct, encoded, resolved, or attachment-borne form fail before
  Messages delivery and provider execution.

#### Canonical record and attachments

Tests must prove:

- stable canonicalization and digest across restart, Unicode, object ordering,
  defaults, aliases, schema versions, and equivalent inputs;
- exact original and resolved values with no security-relevant truncation,
  redaction, hidden field, or renderer mismatch;
- control characters, bidirectional text, zero-width text, newlines, homoglyphs,
  punycode, HTML, Markdown, links, and prompt-like instructions remain inert and
  visible;
- the final decision bubble contains no model-controlled text;
- byte-only attachment ingestion and refusal to open caller-supplied host paths;
- traversal, symlink, privileged-path, size, digest, replacement, and cleanup
  failures;
- scanner isolation from network, Keychain, provider credentials, broker state,
  staging writes, unrelated files, and decision handling;
- hard byte, memory, CPU, wall-time, process, recursion, decompression, and
  output limits against malformed media, parser exploits, hangs, crashes,
  nested archives, and zip bombs;
- malformed, oversized, injected, stale-version, cross-record, or uncertain
  scanner output fails closed; and
- no attachment bytes, thumbnails, previews, links, or active content enter the
  Messages approval flow.

#### iMessage identity, delivery, and decision

Tests must cover:

- one configured direct iMessage route and explicit normalized approver handles;
- rejection of wildcard `*`, group, SMS, wrong service, wrong account, wrong
  conversation, wrong sender, and absent approvers;
- phone and Mac handles that normalize from phone, email, service-prefixed, and
  explicitly allowlisted `is_from_me` forms;
- complete single-part review and bounded multipart review;
- part byte limits, count limits, stable numbering, common digest, exact expiry,
  text hashes, and deterministic rendering;
- send success, timeout, recovered GUID, numeric row ID, `ok`, `unknown`,
  missing GUID, duplicate result, wrong target, partial delivery, reordering,
  and ambiguous delivery;
- final message sent only after all detail GUIDs are durable;
- per-account Messages action serialization across the complete review-bundle
  send, every GUID reconciliation and reservation, full-bundle verification, and
  decision arming;
- no model-facing reaction, reply, edit, unsend, or raw Messages action running
  between any review GUID creation and its durable reservation;
- crash after any detail or final send but before reservation or arming, with
  startup reconciliation and reservation completing before model-facing
  actions resume;
- readback of every detail and final message before arming and before accepting
  a decision, with exact GUID, chat, order, canonical text, hash, and
  edit-or-unsend state;
- edit, unsend, deletion, substitution, reordering, or hash mismatch on any
  review part failing closed with zero provider calls;
- owner reaction before arming remaining observable and resolving only after
  the target is active;
- target registration only after the final GUID is concrete and all part records
  are complete;
- resolution of the final GUID to one concrete direct chat row and conversation,
  with handle-only or ambiguous chat identity remaining unarmed;
- one authoritative target row containing account, concrete chat identity, GUID
  forms, owner aliases, record, digest, code hash, decisions, and expiry;
- target cap, TTL, expiry cleanup, broker restart, Messages bridge restart,
  gateway restart, and restoration of exact scoped polling from broker rows;
- phone offline, delayed synchronization, Messages in iCloud disabled, poll
  delay, target outside recent history, and later recovery before expiry;
- exact prefixed and normalized GUID matching;
- thumbs-up to `allow-once`, thumbs-down to `deny`, and rejection of infinity,
  arbitrary emoji, text reactions, numeric choices, and unsupported variants;
- exact inline `APPROVE <short-code>` and `DENY <short-code>` only when
  `reply_to_guid` matches the final message;
- rejection of generic `/approve`, bare yes or no, copied code, non-reply text,
  reply to a detail part, and reply to an unrelated message;
- denial of model-requested local reactions, replies, edits, unsends, and raw
  Messages actions against every reserved detail or final GUID;
- rejection of locally initiated model actions that reappear through Messages
  synchronization as allowlisted `is_from_me` events;
- lookalike approval prompts, model-authored decision instructions, and
  unregistered GUIDs making zero state changes;
- stale, early, replayed, duplicate, changed, removed, and delayed reactions;
- removal before observation producing no decision;
- change or removal after accepted resolution leaving the first decision final;
- simultaneous approve and deny producing one atomic winner;
- target cleanup after resolution without losing audit; and
- every unavailable, malformed, unauthorized, stale, or ambiguous case making
  zero provider calls.

#### State, execution, and pressure

Tests must cover:

- every state transition and rejection of every undeclared transition;
- immediate pending return with no live promise or blocked turn;
- crash before and after record insert, staging, policy, each review part, final
  target registration, decision transition, lease claim, provider request,
  provider acceptance, terminal write, and outbox insert;
- continuous time through sleep and fail-closed reboot, wall rollback, uncertain
  downtime, and large forward jump;
- active duplicate reuse, completed-effect detection, terminal-state reuse, and
  no model-driven revival;
- `already_executed` returning the prior terminal record without creating a
  sixth terminal state, result event, provider call, or continuation;
- owner, task, session, tool, and global quotas;
- varied-payload floods, target cap, delivery limits, denial cooldown, alert
  suppression, and legitimate distinct work;
- recording executor receiving exactly the stored envelope and staged hashes;
- policy and integrity recheck immediately before provider execution;
- approval expiry, execution deadline, lease expiry, and no late provider call;
- provider idempotency, reconciliation, proven no-accept retry, and ambiguous
  acceptance without blind resend; and
- denial, expiry, policy failure, integrity failure, capacity failure,
  delivery failure, and rollback making zero provider calls.

#### Trusted result and continuation

Tests must cover:

- terminal result and provider evidence committed before event delivery;
- exact `sent`, `denied`, `expired`, `failed`, and `execution_unknown` shapes;
- provider receipt ID and timestamp for the recording email adapter;
- content-free errors with no body, attachment, token, or raw response;
- rejection of sandbox text that pretends to have trusted internal provenance;
- one continuation key per original tool call and approval lineage;
- stable event ID, sequence, transcript position, continuation row, outbox row,
  turn ID, and consumption receipt;
- original session idle, busy, locked, restarted, reset, rotated, deleted, and
  unavailable;
- protected task inbox fallback and later owning-agent delivery;
- queue retry, queue exhaustion, broker redelivery, repair-loop restart,
  transcript receipt loss, consumption receipt loss, and acknowledgement loss;
- crashes before and after transcript insert, outbox insert, enqueue, queue
  acknowledgement, turn claim, prompt assembly, checkpoint, completion,
  consumption receipt, and broker acknowledgement;
- an existing transcript event with incomplete continuation state rescheduling
  safely instead of suppressing the only resumed turn;
- stable resumed-turn IDs and later tool, message, media, and provider
  idempotency;
- explicit `continuation_unknown` after an ambiguous later side effect;
- one model-visible tool result and one semantic continuation despite duplicate
  packets, duplicate queue entries, reordering, and every crash window; and
- resumed processing beyond the protected tool without regenerating the
  provider effect or repeating a later delivery.

#### Gmail capability cutover

Using hermetic recording OAuth and Gmail fixtures, tests must prove:

- read credentials are exactly read-only;
- read, triage, and protected-send credentials and client roles are distinct or
  otherwise closed to only their declared host capability;
- the sandbox cannot read any credential or select a raw provider client;
- triage accepts only archive, read state, star, importance, and configured user
  labels;
- triage dispatches only the named reversible provider mutations;
- raw methods, bodies, extra fields, send, draft, insert, import, trash, spam,
  forwarding, vacation reply, filter, send-as, delegation, settings, unknown
  labels, and disallowed system labels fail before provider contact;
- replacement capabilities are ready before any old generic send route or token
  is revoked;
- revocation is the final irreversible cutover step; and
- rollback never restores direct send-capable sandbox access.

No automated test revokes a real token, changes a real label, sends a real
message, or calls a live mutation endpoint. Live-target checks are limited to
read-only configuration, scope, identity, route, queue, and access-denial
inspection.

#### No-listener, retention, and rollback

Tests must cover:

- process and host inspection showing no new approval-specific AF_INET or
  AF_INET6 listener, DNS record, TLS key, proxy route, firewall rule, webhook,
  or inbound dependency;
- existing local Messages and gateway runtime behavior without claiming the
  whole host has no unrelated listener;
- disabled APNs, Telegram, Slack, generic iMessage, group, SMS, and alternate
  decision paths;
- payload retention, Messages delivery metadata, staged-byte purge,
  metadata-only audit, backup, and restore;
- rollback with preparing, partial delivery, pending, approved, executing,
  unknown, terminal, and undelivered-continuation records;
- drain-only terminal result and continuation repair before unloading candidate
  workers;
- snapshot restoration of packages, configuration, schema, tools, credential
  references, queues, routes, and preexisting host permissions; and
- the full repository-managed integration lifecycle using recording adapters
  with zero live delivery or mutation.

### Rollout and rollback

No rollout occurs during this design task. A later rollout follows this order:

1. Keep approval intake, provider execution, iMessage delivery, and production
   credentials disabled.
2. Extend and fixture-test the complete recovery snapshot before any schema,
   tool, credential, Messages route, allowlist, provider, or continuation change.
3. Stage the broker with fake credentials, recording executor, recording
   Messages adapter, recording session delivery, and deny-by-default unknown
   operations.
4. Prove the full sandbox invocation inventory, durable state, multipart
   delivery, exact decisions, phone-sync simulations, execution reconciliation,
   continuation, restart, flood handling, retention, and rollback.
5. Stage the trusted host capabilities, state schema, Messages route, approver
   configuration, audit, metrics, and alerts while every protected effect stays
   disabled.
6. Validate replacement read and triage capabilities and remove every raw
   provider route from sandbox profiles.
7. Provision the protected send credential in host-only storage. Verify the
   broker alone can invoke the executor. Revoke or retire any old generic
   send-capable route last.
8. Pause intake, drain in-flight sandbox work, take a final snapshot, attest the
   exact tool and credential inventory, and perform one atomic feature cutover.
9. Enable one owner and one low-volume email tool. The first real phone approval
   is an explicit owner-initiated rollout action, never an automated test.
10. Expand only after observed stability. Keep alternate channels, groups, SMS,
    `allow-always`, and arbitrary protected tools disabled.

Operational readiness requires durable metrics for records by state, oldest
pending age, part delivery failure, unknown GUID, target count, invalid actor,
wrong GUID, stale decision, duplicate decision, approval latency, expired lease,
policy or integrity failure, provider unknown, undelivered result, continuation
failure, and repair age. Submission floods and repeated invalid decisions alert
without exposing bodies.

Approval rollback:

- disables new submissions and executor claims;
- removes the protected tool from every sandbox profile;
- prevents new decision target registration;
- moves preparing, partial-delivery, pending, and approved but unclaimed work to
  terminal `failed` or `expired` with no provider call;
- reconciles executing work before any retry;
- persists every terminal result and continuation row;
- keeps the broker result emitter and continuation worker in drain-only mode
  until transcript and consumption receipts are complete;
- migrates any undrainable continuation to the tested recovery path before
  unloading the candidate worker;
- restores snapshotted packages, configuration, schema compatibility, tools,
  credential references, Messages routes, allowlists, queues, and preexisting
  host permissions;
- preserves terminal records through retention and purges staged bytes on
  schedule; and
- verifies no new listener, webhook, alternate route, orphaned target, or
  sandbox-visible credential remains.

If rollback occurs after an old generic send route was revoked, it does not
restore that unsafe route. Read and narrow triage remain available through their
tested host capabilities. Provider send stays disabled until the broker is
repaired or another approved protected path is deployed.

All automated rollout and rollback validation uses recording adapters. Live
checks are read-only. Real iMessage delivery and provider effects occur only as
explicit owner actions after controlled enablement.

### Review log

Earlier review established the durable protected-tool record, immutable
attachments, non-overridable policy, execution freshness, provider
reconciliation, quotas, retention, Gmail capability cutover, terminal evidence,
and exactly-once semantic continuation. Those decisions remain where they still
protect the untrusted sandbox and asynchronous workflow.

This revision corrects the trust model. The gateway process and its logged-in
macOS account are trusted. The model sandbox is not. Separate gateway and
authority users, a native approval app, Touch ID decision signatures, XPC
authority, Notification Center approval, and a hosted web surface no longer
solve the stated problem and are removed.

Current source review confirms that OpenClaw already has most of the iMessage
phone mechanism: explicit approver allowlists, direct approver delivery,
GUID-only reaction binding, normalized GUID lookup, reaction polling, thumbs-up
and thumbs-down mapping, and cleanup after resolution. It also confirms the
remaining gaps: pending gateway approval state is in memory, bounded restart
discovery is best effort, generic approval replies are not bound to
`reply_to_guid`, and current rendering does not store the complete immutable
provider envelope.

Apple documentation confirms that Tapbacks attach to one message, can be changed
or removed, inline replies target one message, and Messages in iCloud can
synchronize phone and Mac state. Apple also documents the iMessage encryption
and metadata boundary. The design therefore recommends a Tapback on one final
GUID, makes the first accepted decision final, provides an exact inline-reply
fallback, and states the Messages privacy tradeoff.

Independent high-threshold review found no actionable material defects. It
verified the trusted gateway boundary, current iMessage source claims,
allowlist and GUID correlation, reaction semantics, restart gaps, multipart
delivery, attachment isolation, no-listener scope, provider reconciliation, and
agent continuation. Its highest-value residual question was the instant between
final message creation and the model-action reservation. The design now
serializes both operations on one Messages action lane, commits the reservation
before releasing that lane, and completes crash recovery before model-facing
Messages actions resume. It also clarifies that `already_executed` points to a
prior result and is not a sixth terminal outcome.

The first complete-current-diff re-review found one material gap: the
model-action reservation protected
the final decision bubble but not the detail bubbles that carry the exact
transaction. A model-facing edit or unsend could therefore make the phone show
different values from the immutable envelope. The design now holds the shared
Messages lane across the whole bundle, reserves every detail and final GUID,
verifies every current message and hash before arming, and repeats that
verification before accepting a decision. Validation now requires every edit,
unsend, missing part, reordering, or mismatch to fail closed.

The final complete-current-diff re-review verified the corrected whole-bundle
reservation, readback, crash ordering, source claims, trust boundary,
provider lifecycle, continuation, structure, and publication safety. It found
no actionable material defects. Two non-blocking clarity gaps were also closed:
the design now names the new shared Messages lane as required implementation
work across every mutation entry point, and the state diagram declares the
administrative `failed` transitions already used by rollback.

### Checklist

- [x] Re-read current repository instructions and the safe design workflow.
- [x] Re-read the full proposal, issue 68, current OpenClaw source, and Plans 027
      and 028.
- [x] Correct the trust model to trusted gateway and account versus untrusted
      model sandbox.
- [x] Trace current iMessage native approval, approver authorization, outbound
      GUID recovery, reaction persistence, polling, removal handling, and tests.
- [x] Verify Apple Tapback, inline reply, Messages synchronization, encryption,
      and cloud key-handling constraints.
- [x] Replace the native Mac review app with concrete iPhone approval through
      the existing Messages transport.
- [x] Define Tapback as primary and exact inline reply as fallback.
- [x] Define full raw and resolved multipart review, final GUID registration,
      attachment metadata, and delivery reconciliation.
- [x] Define the sandbox credential, Keychain, provider client, host tool, and
      executor boundary.
- [x] Reserve every active detail and final GUID from model-facing Messages
      actions and reject unregistered lookalike approval messages.
- [x] Make full-bundle GUID creation, durable model-action reservation, current
      text verification, and decision arming an ordered crash-safe sequence.
- [x] Keep `already_executed` as a deduplication pointer rather than a terminal
      result or second continuation.
- [x] Preserve immutable records, policy, scanning, quotas, deduplication, time,
      execution, reconciliation, retention, and Gmail capability safety.
- [x] Preserve terminal provider evidence, trusted result delivery, busy and
      missing-session handling, and one semantic continuation.
- [x] Rework implementation phases, validation, rollout, rollback, risks,
      alternatives, and evidence for the phone design.
- [x] Update issue 68 after the plan to mark the phone-approval revision in
      progress.
- [x] Complete independent high-threshold review and fix every actionable
      finding.
- [x] Rewrite the full Human and Agent sections to the final present state and
      mark Ready for review.
- [x] Confirm exact headings, no em dash, public-safety checks, and a
      documentation-only diff before publication.
