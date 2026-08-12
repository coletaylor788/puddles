# Asynchronous tool approvals

**Status:** Ready for review
**Issue:** [#68](https://github.com/coletaylor788/puddles/issues/68)
**Last updated:** 2026-08-12
**Owner:** Cole

## Human design

### Problem

Some agent tools can cause serious or irreversible effects. Sending email is the
first example. The model should be able to prepare a call, but it must not be
able to approve that call or reach the protected executor directly. Cole must be
able to review every effective value from his phone, approve that exact call
once or deny it, and let the agent continue after the result arrives.

OpenClaw already provides generic tool approvals and sends them through
iMessage, but the current view shows only a short summary. Its wait also remains
tied to the live agent run, lasts at most ten minutes, and is lost when the
gateway restarts. Those limits do not support a complete review or a durable
asynchronous workflow.

### Outcome

OpenClaw's built-in approval path remains the only authority. A trusted policy
stops a protected tool before execution. The gateway creates the approval ID,
limits the decisions, routes the request to Cole's phone, accepts one decision,
and returns the outcome to the protected operation. The earlier separate
approval broker and custom phone protocol are superseded.

Cole sees the complete final call in Messages on his iPhone. A thumbs-up on the
unchanged registered prompt approves that call once, and a thumbs-down denies
it. The existing iMessage poller receives the synced reaction on the Mac without
a public endpoint, new inbound port, hosted service, or custom phone app. After
execution, denial, or expiry, a trusted result reaches the originating agent and
starts no more than one continuation turn.

### Approach

The protected policy runs only after tool preparation, trusted changes, and
final argument cleanup. It freezes one structured snapshot of the exact values
that would execute. Attachments may come only from bounded uploaded bytes or
resources the sandbox is already allowed to read. The gateway stages those
bytes under their content digest before review. Approval can release only that
snapshot and those staged bytes to a registered protected executor. If the
complete review cannot fit safely on the selected channel, the call fails before
an approval is sent.

A new durable protected-operation mode stays inside the built-in approval
framework. Before phone delivery, the gateway stores the built-in approval ID,
frozen operation, origin, 23-hour expiry, and execution state. The original tool
call records a normal pending result and ends. A later valid decision claims the
registered operation once and runs it outside the model sandbox.

The prompt becomes actionable only after the gateway stores its exact account,
conversation, message identifier, text digest, and expiry. A valid decision
must carry matching evidence for that prompt and owner. Edited, unsent, copied,
or unregistered prompts cannot approve anything. After restart, the gateway
looks up the exact message identifier instead of relying on a recent-message
scan. The model cannot choose the route, wording, approver, reaction mapping, or
decision.

The later outcome is a distinct trusted terminal event, not a second result for
the old tool call. The existing durable session queue delivers that event at
least once. An idempotent consumer records it once and starts no more than one
continuation. If a crash makes provider execution or continuation uncertain,
the operation reports an unknown state and does not retry blindly.

### Safety and rollout

The gateway and logged-in Mac account are trusted. The model-controlled sandbox
is not. Provider credentials, network access, the protected executor, approval
policy, durable operation store, and phone route stay outside the sandbox.
Capacity limits bound pending work, staged storage, and request rate. Same-boot
gateway restart recovers pending approval. Host reboot, backward clock movement,
or uncertain downtime expires it rather than extending it.

This is a design-only proposal. Independent review and publication checks are
complete, and the proposal is ready for Cole's review. No runtime,
configuration, credential, message, account, or external service has changed.
Implementation remains blocked until Cole approves the design. Rollout will
start with recording-only adapters and a single protected email tool. Rollback
stops new operations, fences every pre-invocation record, preserves terminal
delivery, and never retries an uncertain provider effect.

## Agent details

### State

The recommendation is to extend OpenClaw's built-in plugin approval framework.
The gateway remains the only approval authority. Existing trusted policy hooks,
server-generated approval IDs, allowed decisions, resolver APIs, native
iMessage delivery, GUID-bound reactions, expiry updates, and same-run execution
remain in place.

The prior custom broker and custom iMessage protocol are superseded. Version 1
does not add a second approval ID, second resolver, native app, hosted approval
page, public endpoint, new listening port, DNS name, TLS setup, reverse proxy,
or custom phone app.

Two core gaps still require code:

1. The protected approval must run at the final execution boundary and show one
   frozen structured snapshot of every effective parameter.
2. Long-lived approval needs a durable protected-operation record, executor
   claim, terminal event, and idempotent continuation consumer.

The second gap is new runtime infrastructure. It is not configuration and it is
not already provided by the session delivery queue. It remains inside the
built-in plugin approval authority and reuses the existing queue as at-least-once
transport.

The existing iMessage adapter needs only protected-tool restrictions and support
for the structured review, durable delivery activation, and authenticated
decision evidence. It must not be replaced or removed.

The pinned OpenClaw source is commit `12f9abf044`. Public tracking remains issue
68 and pull request 71. The work is design-only and must not be merged or
implemented as part of this task.

### Scope and acceptance criteria

#### In scope

- Provider-neutral approval for protected OpenClaw plugin tools, with send email
  as the first tool.
- A trusted final-boundary policy that requires built-in plugin approval.
- Reuse of built-in plugin approval requests, IDs, decisions, resolver, native
  channel routing, and iMessage phone reactions.
- A structured, inert review of every effective parameter.
- One frozen approved snapshot that is also the executor input.
- Only `allow-once` and `deny` for protected tools.
- A durable protected-operation mode for long waits and restart recovery.
- A normal `pending` result for the original tool call.
- A separate trusted terminal event and one semantic continuation.
- iPhone decisions through the existing iMessage channel with no new inbound
  network service.
- Recording-only tests for channels and provider effects.

#### Out of scope

- Implementation, deployment, account changes, credential changes, or test
  sends.
- A parallel approval authority, ID, resolver, or phone protocol.
- Generic approval for every tool without a trusted protected-tool definition.
- `allow-always` for protected tools.
- Model-selected routes, approvers, wording, reaction mappings, or timeouts.
- Approval by group message, wildcard sender, SMS fallback, unregistered
  reaction, or generic chat text.
- A hosted page, webhook, new TCP or UDP listener, or custom mobile application.
- Active rendering of attachment content on the phone.
- Blind retry after an uncertain provider outcome or continuation.
- Replacing a completed transcript tool result with another result later.
- A provider-specific delegated CLI permission system as the public approval
  authority.

#### Acceptance criteria

A future implementation is acceptable only when it:

1. Treats the gateway process and logged-in Mac account as trusted and all
   model-controlled sandbox code and content as untrusted.
2. Keeps provider credentials, authenticated provider clients, protected
   executors, approval policy, routing, and decision handling outside the
   sandbox.
3. Gives the sandbox no direct route to the protected provider effect.
4. Uses trusted policy to mark a tool call as protected. The model cannot disable
   the policy or choose an easier policy.
5. Defers the built-in approval request until preparation, trusted policy,
   ordinary hooks, parameter reconciliation, and finalization are complete.
6. Freezes the final executor input before building the approval view.
7. Uses the existing plugin approval ID, request, resolver, and decision types.
   It creates no parallel approval identity or resolver.
8. Stores one bounded structured snapshot of every effective parameter with the
   built-in approval and durable operation record.
9. Shows all snapshot values without silent truncation, hidden defaults, active
   markup, or executable attachment content.
10. Rejects a request before delivery when its complete safe review does not fit
    the verified channel limit.
11. Lets `allow-once` release only the stored snapshot to a registered protected
    executor.
12. Makes `deny`, expiry, malformed decisions, unauthorized decisions, stale
    decisions, missing state, and unregistered tools execute nothing.
13. Excludes `allow-always` from protected-tool decisions.
14. Records a normal `pending` result for the original tool call and ends that
    run without holding a sandbox worker.
15. Never tries to append another result with the original tool-call ID.
16. Persists the approval ID, frozen operation, origin, expiry, channel
    correlation, and state before the original run reports `pending`.
17. Survives gateway restart without losing, allowing, duplicating, or extending
    the pending operation.
18. Uses a trusted protected approval lifetime of 23 hours. A tool may choose a
    shorter value but never a longer value without reviewed policy.
19. Reserves admission capacity before attachment staging or prompt delivery.
    Trusted per-session, per-owner, and global limits cover pending count,
    staged bytes, and request rate.
20. Deduplicates only a retry with the same trusted submission ID and generation.
    A separate tool call gets its own operation, prompt, terminal event, and
    continuation.
21. Persists the server-generated ID, frozen snapshot, prompt text digest, and a
    non-actionable delivery state before sending the iMessage prompt.
22. Reconciles the send to one exact outbound GUID and conversation before
    atomically making the prompt actionable. Unknown or ambiguous delivery never
    activates approval and is never blindly resent.
23. Converts internal `delivery_unknown` to a terminal `failed` result and
    delivers that result to the originating agent.
24. Uses monotonic elapsed time within one boot plus durable boot identity and a
    wall-clock high-water mark. Same-boot gateway restart recovers pending
    approval. Boot-identity change, backward movement, or unprovable downtime
    expires it and creates a terminal event.
25. Reuses the existing native iMessage plugin approval runtime.
26. Uses a fixed direct iMessage route and explicit non-wildcard owner allowlist.
27. Sends a deterministic built-in approval view that includes the approval ID,
    complete reviewed snapshot, expiry, and closed reaction meanings.
28. Accepts only thumbs-up as `allow-once` and thumbs-down as `deny` on the
    registered outbound message GUID.
29. Extends protected resolution with authenticated decision evidence containing
    actor, account, direct conversation, target GUID, prompt digest, and approval
    ID. Evidence-less resolution cannot approve a protected operation.
30. Reads the prompt by GUID before resolution and validates its exact text
    digest plus unedited and not-unsent state.
31. Validates the normalized actor, account, direct conversation, target GUID,
    approval ID, allowed decision, active state, and expiry.
32. Ignores lookalike messages, reactions to another message, wrong actors,
    wrong conversations, groups, SMS, changed reactions after resolution,
    duplicates, and stale reactions.
33. Stores protected reaction bindings in a dedicated durable index that generic
    approval text and the bounded shared reaction cache cannot write, evict, or
    replace.
34. Resolves protected reaction lookup from that durable index on every event.
    The shared reaction cache may mirror protected bindings but is never
    authoritative.
35. Prevents model-facing Messages actions from reacting to, replying to,
    editing, or unsending an active protected approval message.
36. Makes the first valid decision final with one conditional state change.
37. Stages attachment bytes in immutable content-addressed storage before
    approval and verifies size and digest again immediately before execution.
38. Accepts attachments only as bounded uploaded bytes or handles resolved
    inside an existing authorized sandbox or media root. It rejects raw host
    paths, traversal, symlinks, non-regular files, and source changes during
    staging.
39. Claims an approved protected operation once and durably records invocation
    intent before calling the provider.
40. Uses the stable operation ID plus effect digest as the provider idempotency
    key when available. Two separate approved operations with identical effects
    remain distinct provider calls, while a retry of one operation reuses its
    key.
41. Without provider idempotency, any crash after durable invocation intent and
    before a proven provider result becomes `execution_unknown`.
42. Never retries an uncertain provider effect.
43. Provides a gateway-authenticated compare-and-set administrative cancellation
    from `prepared`, `pending_delivery`, `pending`, and `allowed` without
    invocation intent to terminal `failed`.
44. Administrative cancellation atomically prevents executor claims, expires
    the built-in manager projection, removes reaction bindings, releases
    admission capacity and staged references, and creates the terminal event.
45. Stores exactly one terminal operation result: `sent`, `denied`, `expired`,
    `failed`, or `execution_unknown`.
46. Includes the provider receipt or message ID and provider timestamp in a
    successful email result when available.
47. Creates a separate trusted terminal event with a new event ID and the
    original approval, operation, tool-call, session, and task correlation.
48. Uses the existing session delivery queue as at-least-once transport, not as
    the operation source of truth.
49. Makes event insertion and continuation consumption idempotent with durable
    compare-and-set transitions.
50. Starts no more than one semantic continuation for a terminal event.
51. Queues behind a busy session. A missing or replaced session retains a
    visible durable result and does not reroute it to an unrelated transcript.
52. Marks an ambiguous continuation crash window `continuation_unknown` and
    does not replay blindly.
53. Adds no public endpoint, inbound network listener, custom phone app, or
    separately hosted approval service.
54. Runs automated validation only through deny-by-default recording adapters.
    Tests never send a real message or create a live provider effect.

### Architecture and decisions

#### Confirmed built-in behavior

The pinned source contains two approval systems:

| System | Purpose | Current behavior |
|---|---|---|
| Exec approvals | Gate shell and host command execution | Command-oriented display and separate allowlist behavior |
| Plugin approvals | Gate a model tool call before invocation | Generic request ID, closed decisions, native channel delivery, held call, and same-run continuation |

This proposal uses plugin approvals. Sending email is a protected plugin tool,
not a shell command.

A trusted `before_tool_call` policy can return `requireApproval`. The gateway
creates a `plugin:` UUID, validates decisions against `allowedDecisions`, and
rejects a conflicting second resolution. The current request shows a title,
description, severity, and metadata. It does not show all effective parameters.

The current agent path requests approval and waits for a decision in the same
run. `twoPhase` returns the approval ID and route early, but the same promise
still waits. The default timeout is 120 seconds and the maximum is 600 seconds.
Pending records live in a process-local map, so a restart loses them.

After `allow-once`, the same run invokes the tool. After `deny` or a fail-closed
timeout, the same run receives a blocked result and can continue. This immediate
path remains valid for ordinary short approvals. It does not satisfy the
long-lived protected-operation requirement.

OpenClaw also has an in-memory deferred approval descriptor for a native hook
relay. It postpones requesting plugin approval until a later live provider
permission boundary and rejects rewritten arguments. It depends on the same
running process and is not durable operation recovery.

#### Existing native iMessage approval

The iMessage channel already registers `imessageApprovalCapability`. Its native
runtime declares both `exec` and `plugin` event kinds. It:

- evaluates native approval route eligibility;
- supports an originating direct conversation or configured approver direct
  messages;
- renders built-in exec and plugin approval prompts;
- sends the prompt through the existing iMessage transport;
- requires a concrete outbound message GUID before reaction binding;
- stores account, conversation, message GUID, approval ID, allowed decisions,
  and expiry in the reaction target store;
- polls synchronized reactions from local Messages history;
- authorizes the actor against configured approvers;
- calls the built-in approval resolver;
- removes reaction binding after resolution or cancellation; and
- sends resolved or expired updates as replies to the approval message.

The reaction target store is persistent but bounded. It is delivery correlation,
not the approval source of truth. Current plugin approval state remains
process-local.

Several other channels also implement the native approval interface. No new
phone channel should be added merely to gain generic approvals. iMessage is the
recommended existing path because it is already the configured owner channel
and requires no new account, app, token, or hosted service.

#### Built-in elements retained

| Existing facility | Decision |
|---|---|
| Trusted before-tool-call policy | Retain for classification and policy |
| Deferred approval descriptor | Extend so approval occurs after finalization |
| Server-generated plugin approval ID | Retain as the only approval identity |
| `allowedDecisions` | Set to `allow-once` and `deny` |
| Gateway request, list, wait, and resolve APIs | Retain |
| First-decision conflict handling | Retain and back protected records durably |
| Fail-closed timeout behavior | Retain |
| Same-run execution and result path | Retain for immediate approvals |
| Approval view model | Extend with structured reviewed values |
| Native channel capability routing | Retain |
| iMessage native runtime and reaction binding | Retain |
| Session delivery queue | Retain as at-least-once terminal-event transport |
| Session lanes and queue idempotency keys | Retain for wake-up delivery |

#### Final-boundary reviewed snapshot

Current approval can happen before ordinary hook parameter changes,
reconciliation, and `finalizeBeforeToolCallParams`. A protected effect cannot
use that ordering.

The protected path changes the order:

```text
prepare tool input
-> run trusted policy and ordinary hooks
-> reconcile adjusted parameters
-> finalize tool parameters
-> freeze protected operation snapshot
-> reserve admission capacity
-> allocate built-in approval ID
-> persist non-actionable pending_delivery record
-> send and reconcile approval prompt
-> activate built-in approval
```

Trusted policy marks the call as protected and supplies its closed review and
executor policy. It does not display or approve pre-final values. The existing
deferred approval descriptor carries that policy marker to the wrapper's final
execution boundary.

The final snapshot contains:

- schema version;
- protected tool and operation;
- final provider profile identifier;
- all final recipients and destination fields;
- full subject and body values;
- all send, reply, thread, format, and scheduling options;
- attachment names, detected types, sizes, immutable digests, and scan results;
- policy result;
- approval expiry; and
- a stable effect digest over the reviewed values and staged object digests.

The snapshot is the executor input. The executor does not accept later model
arguments. The review view is data, not model-authored Markdown or HTML.
Channel renderers use fixed labels and inert quoting. Control characters,
bidirectional controls, zero-width characters, and line boundaries are visible.
Secrets are rejected before approval delivery.

Version 1 supports only reviews that fit the selected channel's verified,
untruncated single-message bound. The full encoded prompt is measured before
sending. Larger calls fail closed. This avoids a custom multipart protocol.

Attachment bytes never enter the approval prompt. The review shows immutable
metadata and digests. The tool accepts bounded uploaded bytes or a logical
resource handle that the existing sandbox or media-root resolver authorizes. It
never accepts a raw host path.

For an authorized handle, the gateway resolves beneath the approved root, opens
with no symlink following, requires a regular file, checks descriptor identity
and size before and after the copy, and rejects traversal, symlink swaps, device
files, and source changes. It stages the bounded bytes in owner-only
content-addressed storage keyed by the reviewed digest before approval. A
protected executor accepts only that immutable object and rechecks size and
digest immediately before execution. Mismatch or missing content fails closed.
If metadata is not enough to approve safely, the owner denies the call.

#### Immediate and durable modes

Ordinary plugin approvals keep the current immediate mode. The live run waits,
then executes or receives a blocked result.

Protected asynchronous tools use durable mode. This requires a new serializable
protected-operation registry and executor registry inside the built-in plugin
approval subsystem. It is explicitly new infrastructure.

The operation record contains:

- built-in approval ID and current approval state;
- protected tool and executor registry key;
- trusted submission ID and generation;
- frozen final snapshot and effect digest;
- agent, task, session, run, turn, and original tool-call correlation;
- route, iMessage account, conversation, prompt GUID, and expiry;
- canonical prompt text digest and delivery activation state;
- decision actor, decision, and time;
- invocation intent, claim, attempt, and provider evidence;
- terminal operation result;
- terminal event ID;
- transcript event receipt;
- continuation claim, turn ID, completion receipt, and unknown state; and
- retention and cleanup time.

Admission control runs before attachment staging and before approval delivery.
Version 1 defaults are:

- at most 5 pending protected operations per session;
- at most 20 pending protected operations per owner;
- at most 100 pending protected operations globally;
- at most 64 MiB of staged bytes per owner;
- at most 256 MiB of staged bytes globally;
- at most 10 new protected requests per owner in 10 minutes; and
- at most 100 new protected requests globally in 10 minutes.

A deployment may set smaller limits. Raising them requires reviewed
configuration and must remain below the reaction-target store's 1,000-entry
capacity. Capacity reservation is transactional. A rejected request stages no
bytes and sends no prompt.

The trusted agent runtime assigns one stable submission ID and generation before
the tool wrapper starts. A retry with that same pair returns the existing
operation and creates no new prompt. A separate tool call receives a different
submission ID even when its reviewed effect is identical. It therefore gets its
own operation, prompt, terminal event, and continuation.

The effect digest excludes approval ID, submission ID, tool-call ID, timestamps,
and expiry. It binds only the reviewed provider effect and staged content. It is
used for display correlation and audit, not to merge callers or as a provider
idempotency key by itself.

Terminal, expired, and failed records release pending capacity. Staged bytes use
digest reference counts and are deleted when no active or retained record
references them.

The original run receives one normal tool result:

```text
status: pending
approval_id: <built-in approval id>
```

That result completes the original tool call and may tell the agent to continue
other independent work. It is never replaced.

The protected operation uses these states:

```text
prepared -> pending_delivery
pending_delivery -> pending | delivery_unknown | expired
delivery_unknown -> failed
pending -> allowed | denied | expired
allowed -> executing
executing -> sent | failed | execution_unknown
denied | expired | sent | failed | execution_unknown -> event_pending
event_pending -> event_recorded -> continuation_pending
continuation_pending -> continuation_claimed
continuation_claimed -> complete | continuation_unknown
```

This is a new persistent operation state machine. It is justified by the
non-negotiable delayed execution and restart requirements. It lives under the
existing plugin approval ID and resolver rather than duplicating them.

A separate gateway-authenticated administrative transition may move
`prepared`, `pending_delivery`, `pending`, or `allowed` without durable
invocation intent to `failed -> event_pending`. The conditional update first
sets a cancellation fence that prevents any new executor claim. In the same
transaction it records terminal failure and resource-release work. Recovery
then expires the built-in manager projection, removes native reaction bindings,
releases admission capacity and staged references, and delivers the terminal
event. Once invocation intent exists, administrative cancellation cannot claim
that no provider call occurred and must not rewrite the execution state.

On same-boot gateway restart, the registry restores protected pending approvals
into the built-in manager with their original IDs and remaining expiry. It
restores iMessage reaction correlation from the operation record when the
bounded shared cache is missing. No restart extends an expiry.

Protected approval expiry is 23 hours from durable record creation. This fits
inside the existing 24-hour iMessage reaction-target lifetime. The plugin
approval timeout clamp is extended only for durable protected mode. Ordinary
plugin approvals keep the current 120-second default and 600-second maximum.
Within one boot, expiry uses continuous monotonic elapsed time that includes
sleep. The record also stores boot identity and a wall-clock high-water mark.
Same-boot gateway restart reconstructs remaining time from durable clock
evidence. Host boot-identity change, backward wall-clock movement, a large
forward jump, or downtime that cannot be bounded safely expires pending
delivery and pending decisions and creates the normal terminal expired event.
No clock anomaly extends approval.

#### Decision and execution

Protected configuration fixes one direct iMessage account, target, and explicit
owner allowlist. Wildcard approvers, groups, SMS fallback, origin routing to an
untrusted participant, and model-supplied routes are rejected.

After admission and staging succeed, the protected request path allocates the
server-generated built-in approval ID and commits `pending_delivery`, the frozen
snapshot, canonical prompt text and digest, route, and 23-hour expiry before it
invokes native delivery. Current built-in request creation must be split or
given a pre-delivery persistence callback so it cannot deliver first. The prompt
is non-actionable until delivery returns or reconciliation finds one exact
outbound GUID in the expected conversation with the exact digest. Missing,
ambiguous, edited, or unknown delivery becomes `delivery_unknown` or expires.
It is not blindly resent.

After the authoritative GUID is stored, one transaction changes the operation
to `pending` and registers reaction correlation. A reaction received before
activation remains in Messages history and may be processed only after the
record becomes active.

`delivery_unknown` creates the public terminal status `failed` with a bounded
delivery-unknown error class, releases reserved capacity and staged-byte
references, and moves to `event_pending`. The originating agent therefore
receives a terminal result instead of waiting forever.

The existing iMessage prompt includes the built-in approval ID and reaction
instructions. The structured view adds the complete final snapshot. Only
thumbs-up and thumbs-down are offered. The existing persistent reaction target
binds the exact outbound GUID to the built-in approval ID and allowed decisions.

Protected bindings are also written to a dedicated durable index keyed by
account, concrete conversation, and GUID. Generic approval text registration and
the shared 1,000-entry reaction cache cannot write, evict, or replace this
index. Protected reaction lookup checks this index on every event. The shared
cache is only an acceleration layer for protected records.

The iMessage monitor adds exact-GUID history lookup for protected bindings. It
queries the stored account and conversation for the authoritative GUID and
returns current text, edit or unsend state, and reactions without a recent
message-count limit. Startup and every protected reaction resolution use this
lookup. A missing GUID, unavailable mutation state, text mismatch, or ambiguous
reaction fails closed. The ordinary 30-message recovery scan remains unchanged
for non-protected approvals.

The generic resolver currently accepts an approval ID, decision, and sender.
Protected operations require an extended resolver input with authenticated
decision evidence. Ordinary approvals keep their current resolver contract.

Protected decision evidence contains:

- built-in approval ID and decision;
- normalized actor;
- iMessage account and concrete direct conversation;
- reacted-to message GUID;
- canonical prompt digest; and
- observed reaction event identity and time.

The decision path validates:

- configured account and direct conversation;
- normalized actor in the explicit owner allowlist;
- exact registered target GUID;
- exact current prompt text and digest, with no edit or unsend state;
- built-in approval ID and durable operation record;
- allowed reaction mapping;
- current `pending` state; and
- current time before expiry.

A protected resolver call without complete evidence fails closed. A conditional
record update makes the first valid decision final. A later reaction change,
removal, duplicate poll event, generic command, or second decision cannot change
it.

The model may be able to use ordinary Messages actions. Those actions must
consult the active protected approval GUID set. They reject reaction, reply,
edit, and unsend against an active prompt. A model-authored lookalike has no
registered built-in approval and cannot resolve an operation.

After `allow-once`, the executor registry resolves the protected tool from a
trusted key. It receives only the stored snapshot and one stable operation ID.
The operation stores durable invocation intent before the provider call.

When the provider supports idempotency, the key is a versioned composite of the
stable operation ID and effect digest. Retries of one operation reuse the key.
Two separately approved operations use different keys even when their effect
digests match.

There is no transaction across local storage and a remote provider. Therefore:

- before invocation intent, recovery may retry the local claim;
- after invocation intent, retry is allowed only when the provider proves the
  same idempotent operation;
- without provider idempotency, a crash or timeout before a proven result becomes
  `execution_unknown`; and
- `execution_unknown` never causes a blind retry.

For email:

- `sent` includes the provider message or receipt ID and provider timestamp;
- `denied` and `expired` prove that no provider call occurred;
- `failed` contains a bounded safe error and proof of pre-acceptance failure
  when available; and
- `execution_unknown` states that acceptance could not be proved.

#### Trusted result and continuation

The terminal outcome does not reuse the old tool-call ID. The operation registry
creates a distinct trusted event with:

- stable event ID and operation ID;
- built-in approval ID and snapshot digest;
- original tool, tool-call, agent, task, session, and run correlation;
- one terminal status;
- safe provider receipt and timestamp when available; and
- an internal continuation instruction that forbids repeating the protected
  operation.

The existing session delivery queue is at-least-once transport. Enqueue
idempotency prevents duplicate queue rows, but delivery can repeat after a crash
before acknowledgement. The session consumer must therefore be idempotent.

The operation registry and session consumer use durable compare-and-set
transitions:

1. Store the terminal result and event before enqueue.
2. Enqueue a trusted system event with a stable event idempotency key.
3. Record the event in the target session only if that event ID is absent.
4. Create a continuation claim with one stable turn ID.
5. Start a turn only if no active or completed claim exists.
6. Mark complete only after the turn durably records event consumption or a
   recoverable continuation checkpoint.
7. A crash that may have crossed another side-effect boundary before completion
   becomes `continuation_unknown` and is not replayed blindly.

The session queue does not currently provide these compare-and-set transcript
and turn APIs. They are part of the durable-operation extension.

A busy session keeps the event queued. If the original session was replaced or
is unavailable, the operation remains visibly pending for its owning agent. It
does not guess a new transcript or send ordinary chat text. Operator recovery
may attach it only with durable evidence and the same owning task.

The transport is at least once. The result event is recorded once. At most one
semantic continuation is claimed. Strict cross-system exactly once is not
claimed.

#### Trust boundary and bypass resistance

The attacker controls model output, prompts, tool arguments, attachment
contents, repeated requests, and sandbox timing.

Trusted gateway configuration controls:

- which tools are protected;
- how defaults and policy overrides are resolved;
- the protected executor registry;
- provider credentials and authenticated clients;
- the approval route and owner allowlist;
- structured review rendering;
- allowed decisions and expiry;
- the iMessage account and direct target; and
- terminal event delivery and continuation.

The sandbox receives a closed tool schema and read-only operation status. It has
no provider token, Keychain access, authenticated browser session, raw provider
client, unrestricted host command, writable approval store, or resolver
credential.

The design protects the configured provider account from the model sandbox. A
compromised gateway process, logged-in Mac account, Messages account, owner
phone, provider account, host administrator, or channel credential is outside
the guarantee.

#### Delegated CLI permissions

The CLI documentation Cole referenced describes generic permissions for shell,
file-write, and MCP tool calls. Interactive prompts support allow once, allow
for the running session, and deny. The Agent Client Protocol also exposes a
client permission callback.

OpenClaw has a native hook relay that can defer a trusted plugin approval until
one live provider permission boundary. This is useful reuse for tools that run
inside that delegated CLI session. It remains process-local, blocks that live
session while the permission is open, and does not provide the durable
protected-operation lifecycle required here.

The public send-email approval remains in OpenClaw's provider-neutral plugin
approval layer. A provider-specific permission callback is not the authority.

#### Configuration, extension, and new infrastructure

| Work class | Required work |
|---|---|
| Configuration | Mark the email tool protected, fix a direct iMessage owner route, use an explicit allowlist, and limit decisions to allow-once and deny |
| Existing facility | Plugin approval IDs and resolver, native iMessage delivery, GUID-bound reactions, expiry updates, and session delivery queue |
| Small extension | Add structured reviewed values to the approval payload and iMessage view; block model actions on active protected prompt GUIDs |
| Core boundary change | Move protected approval to the final parameter boundary |
| New required infrastructure | Durable protected-operation and executor registries, trusted submission identity, admission quotas, pre-delivery activation, protected reaction index and exact-GUID lookup, authenticated decision evidence, authorized immutable attachment staging, fail-closed clock accounting, restart recovery, trusted terminal-event projection, and continuation compare-and-set APIs |
| Out of scope | Parallel approval authority, custom phone protocol, hosted UI, permanent approval, active attachment preview |

#### Alternatives

| Alternative | Decision |
|---|---|
| Prior custom broker and custom iMessage authority | Rejected. Built-in approval IDs, resolver, and native iMessage already exist. |
| Current blocking plugin approval unchanged | Rejected for asynchronous protected effects. It waits in the live run, expires within ten minutes, and loses state on restart. |
| Current plugin approval plus title and description only | Rejected. It cannot show every effective email value. |
| Existing iMessage native approval | Recommended and retained. It already handles plugin prompts and GUID-bound phone reactions. |
| Another native channel | Not needed. It adds another account and credential without removing the durability gap. |
| Generic text reply | Not needed in version 1. Existing GUID-bound reactions are smaller and safer. |
| Delegated CLI permission callback | Retained for delegated CLI tools, but not used as the provider-neutral protected-tool authority. |
| Hosted web approval page | Rejected. It adds service hosting and inbound security work. |
| Native phone or Mac approval app | Rejected. Existing iMessage delivery is enough. |
| Permanent approval | Rejected for protected tools. |
| Keep the original run alive | Rejected. It does not satisfy delayed phone approval or restart recovery. |

#### Evidence

Pinned OpenClaw source:

- `src/infra/plugin-approvals.ts:15-51` defines plugin approval payloads, records,
  and the 120-second default and 600-second maximum.
- `src/plugins/hook-before-tool-call-result.ts:1-26` defines trusted hook
  approval results and closed decisions.
- `src/plugins/trusted-tool-policy.ts:317-318` freezes the first trusted policy
  that requires approval.
- `src/agents/agent-tools.before-tool-call.ts:164-190,687-935` defines current
  approval waits and the in-memory deferred descriptor.
- `src/agents/agent-tools.before-tool-call.ts:1240-1396` shows approval can occur
  before ordinary hook parameter overrides.
- `src/agents/agent-tools.before-tool-call.ts:1411-1539` shows preparation,
  reconciliation, finalization, and live closure execution.
- `src/gateway/server-methods/plugin-approval.ts:39-197` creates plugin approval
  requests, delegates delivery, and resolves decisions.
- `src/gateway/server-methods/approval-shared.ts:414-681` handles routing,
  two-phase responses, decision checks, and conflicting resolutions.
- `src/gateway/exec-approval-manager.ts:65-169` stores pending records in a
  process-local map and expires them with process timers.
- `src/infra/approval-view-model.ts:87-102` renders title, description, severity,
  and metadata but no effective parameters.
- `extensions/imessage/src/channel.ts:307-323` registers the existing iMessage
  approval capability.
- `extensions/imessage/src/approval-native.ts:331-443` renders plugin approvals
  and declares native runtime support for exec and plugin events.
- `extensions/imessage/src/approval-handler.runtime.ts:95-233` delivers prompts,
  requires an outbound GUID, binds reactions, and updates resolved or expired
  prompts.
- `extensions/imessage/src/approval-auth.ts:38-79` resolves configured approvers
  and authorizes decision actors.
- `extensions/imessage/src/approval-reactions.ts:24-232` persists bounded
  GUID-to-approval reaction targets.
- `src/infra/session-delivery-queue-storage.ts:39-113` defines idempotent,
  SQLite-backed system-event and agent-turn queue entries.
- `src/infra/session-delivery-queue-recovery.ts:1-105` restores and retries
  deliveries before acknowledgement.
- `src/agents/session-transcript-repair.ts:584-650` moves matching tool results
  next to calls and drops duplicate or orphaned results.
- `src/agents/sessions/session-manager.ts:2345-2368` appends messages only at the
  current transcript leaf.
- `src/agents/harness/native-hook-relay.ts:683-735,1385-1436` defers policy
  approval to a later live permission boundary and rejects rewritten params.

Current tests:

- `src/gateway/server-methods/plugin-approval.test.ts` covers two-phase requests,
  route selection, and resolution conflicts.
- `src/gateway/exec-approval-manager.test.ts` covers record creation, timeout,
  and allow-once consumption.
- `src/gateway/approval-shared.test.ts` covers visibility and ID-prefix lookup.
- `src/agents/agent-tools.before-tool-call.embedded-mode.test.ts` covers the
  current in-memory deferred descriptor.
- `extensions/imessage/src/approval-native.test.ts` and handler tests cover
  plugin rendering, routing, GUID delivery, and reaction binding.
- `src/infra/session-delivery-queue-storage.test.ts` and recovery tests cover
  durable queue idempotency and retry.
- `src/agents/session-transcript-repair.test.ts` covers duplicate and orphaned
  tool-result repair.

Official CLI and protocol documentation:

- [About the CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli)
  documents interactive tool permissions.
- [CLI configuration](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli)
  documents allow and deny tool policy.
- [Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
  documents synchronous permission hooks, modified arguments, and timeout
  behavior.
- [ACP server reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server)
  documents delegated CLI server mode.
- [Agent Client Protocol tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls)
  documents the client permission callback and allow or reject outcomes.

Prior public plans:

- `docs/plans/027-imessage-approval-channel.md` records the iMessage native
  approval design that is now present in the pinned source.
- `docs/plans/028-announce-via-session-delivery-queue.md` records the durable
  session wake-up design that is now present in the pinned source.

### Implementation

No implementation is authorized.

A future approved implementation should be split into four phases.

#### Phase 1: prove and configure built-in reuse

- Add recording fixtures for the existing plugin approval manager and native
  iMessage runtime.
- Prove plugin prompt delivery, concrete GUID binding, owner authorization,
  thumbs-up allow-once, thumbs-down deny, expiry, and resolved updates.
- Configure the protected route as one explicit direct owner conversation with
  no wildcard or group fallback.
- Limit protected decisions to `allow-once` and `deny`.
- Add a model-facing Messages action guard for active protected prompt GUIDs.

#### Phase 2: final reviewed snapshot

- Extend the deferred approval descriptor to carry protected policy until final
  parameter finalization.
- Move protected approval request creation after prepare, policies, hooks,
  reconciliation, and finalization.
- Add structured reviewed values to the built-in plugin approval payload and
  view model.
- Freeze the snapshot and make it the registered executor input.
- Stage only bounded uploaded bytes or authorized no-follow resource handles
  under their content digest, then reverify before execution.
- Reject secrets, unsafe rendering, unsupported attachment review, and
  oversized prompts before delivery.
- Add focused tests for every parameter mutation point and substitution attempt.

#### Phase 3: durable protected operation

- Add the serializable protected-operation and executor registries inside the
  plugin approval subsystem.
- Add transactional per-session, per-owner, and global admission, byte, and rate
  limits before staging or delivery.
- Add trusted submission IDs so retries of one call deduplicate without merging
  separate callers.
- Add a separate effect digest and reference-counted staged-byte cleanup.
- Persist built-in approval IDs, snapshots, origin, expiry, decision, execution
  intent, terminal result, event, and continuation state.
- Add a 23-hour protected-mode timeout without changing ordinary approval
  limits.
- Persist non-actionable delivery state and canonical prompt digest before send.
- Reconcile one exact outbound GUID before activating decisions.
- Add a dedicated durable protected reaction index outside the shared evicting
  cache.
- Add exact-GUID iMessage history lookup with text, edit, unsend, and reaction
  state.
- Convert delivery unknown to terminal failed and deliver it to the agent.
- Add monotonic boot-time expiry, durable boot identity, and a wall-clock
  high-water mark.
- Add authenticated protected-decision evidence to the existing resolver.
- Return a normal `pending` result and end the original run.
- Restore pending approvals and iMessage correlation after restart.
- Add atomic decision and execution claims.
- Add the authenticated pre-invocation administrative cancellation fence and
  resource cleanup.
- Derive provider idempotency from operation ID plus effect digest, or fail to
  `execution_unknown`.
- Project a distinct trusted terminal event.
- Add idempotent event-recording and continuation-claim APIs to the session
  runtime.
- Reuse the session delivery queue as at-least-once transport.
- Add tests for every crash window, duplicate delivery, busy session, missing
  session, continuation unknown, and dead-letter recovery.

#### Phase 4: first protected tool

- Add the email protected-tool schema and final policy.
- Keep provider credentials and the executor outside the sandbox.
- Accept only bounded uploaded bytes or existing authorized sandbox or media
  handles. Add no-follow descriptor staging, race checks, metadata, and digest
  handling without active previews.
- Add provider receipt handling and terminal statuses.
- Run the full managed test environment with recording transports.
- Keep the feature disabled until the exact candidate passes rollback tests.

### Validation

#### Source and design checks

- Confirm every current-behavior statement against pinned commit
  `12f9abf044`.
- Confirm existing iMessage native plugin approval behavior through source and
  tests.
- Confirm delegated CLI claims against the linked official documentation.
- Verify that the final proposal distinguishes configuration, existing reuse,
  small extension, core boundary change, and new required infrastructure.
- Verify that no parallel approval ID, resolver, or custom phone protocol
  remains.

#### Future focused tests

Built-in approval and phone path:

- trusted policy marks the tool protected;
- model input cannot disable policy or select routing;
- server creates the only approval ID;
- only `allow-once` and `deny` are offered and accepted;
- existing iMessage native runtime delivers the plugin prompt;
- durable protected authority exists before prompt delivery;
- delivery without a concrete GUID fails closed;
- delivery timeout reconciles one exact prompt and never resends ambiguously;
- prompt activation occurs only after GUID and digest storage;
- exact account, conversation, target GUID, and actor correlation;
- protected resolver rejects evidence-less decisions and generic commands;
- edited, unsent, substituted, or digest-mismatched prompts fail closed;
- thumbs-up allow-once and thumbs-down deny;
- wrong sender, wildcard, group, SMS, lookalike, wrong GUID, stale reaction,
  duplicate reaction, reaction change, and removal;
- model-facing actions cannot mutate or decide an active protected prompt;
- generic approval text cannot write or evict protected reaction bindings;
- flooding the shared 1,000-entry cache does not remove protected lookup;
- restart recovery finds the exact GUID after more than 30 newer messages;
- exact-GUID lookup returns text, edit, unsend, and reaction state;
- timeout and restart fail closed;
- a decision after 600 seconds and before 23 hours succeeds across restart;
- a decision at or after 23 hours fails;
- same-boot gateway restart preserves pending approval;
- host reboot, backward wall-clock movement, and unbounded downtime expire
  closed and emit one terminal event;
- no live message leaves a recording transport.

Final snapshot:

- approval occurs after preparation, every policy and hook change,
  reconciliation, and finalization;
- every final email field is shown;
- omitted, hidden, truncated, reordered, or changed values fail;
- unsafe control characters render visibly;
- secrets are rejected before delivery;
- attachment bytes never render or leave through the channel;
- attachment bytes are staged immutably before approval and rehashed before
  execution;
- raw host paths, traversal, symlinks, symlink swaps, device files, unauthorized
  roots, and source changes fail before staging;
- unsupported or oversized reviews fail before sending;
- the executor receives the exact frozen snapshot.

Durable operation and execution:

- admission rejects over-limit requests before staging or delivery;
- retrying one trusted submission returns the same operation without another
  prompt;
- separate calls with identical effects keep separate correlation and results;
- separate identical approved calls use different provider idempotency keys and
  each execute once;
- retries of one operation reuse one provider idempotency key and execute once
  total;
- per-session, per-owner, and global pending quotas hold under concurrency;
- staged-byte quotas hold under concurrency and digest references clean up;
- request rate limits prevent phone spam;
- original tool call records one `pending` result;
- no later result reuses the original tool-call ID;
- pending state survives same-boot gateway restart;
- host reboot expires pending state and emits one terminal event;
- clock changes do not extend approval;
- first valid decision wins after restart;
- unregistered executors fail closed;
- administrative cancellation closes prepared, delivery, pending, and approved
  but unclaimed operations;
- cancellation and execution claims race through one compare-and-set boundary;
- an operation with invocation intent cannot be cancelled as pre-invocation;
- one durable invocation intent exists;
- crash before invocation intent retries safely;
- crash after invocation intent yields `execution_unknown` without proven
  provider idempotency;
- denial and expiry never call the provider;
- delivery unknown becomes a terminal failed event;
- terminal result commits before event enqueue;
- provider receipt and timestamp reach the trusted event;
- no live provider mutation occurs in tests.

Terminal event and continuation:

- queue transport may redeliver after a crash;
- duplicate event delivery records one transcript event;
- one continuation claim and stable turn ID exist;
- busy sessions queue;
- missing or replaced sessions retain visible durable state;
- a continuation crash before claim retries safely;
- a crash after possible later effects yields `continuation_unknown`;
- no replay repeats the protected effect or starts a second semantic
  continuation.

#### Publication checks

- The diff changes documentation only.
- The plan has exactly `## Human design` and `## Agent details`.
- The Human design section has exactly `### Problem`, `### Outcome`,
  `### Approach`, and `### Safety and rollout`.
- The Agent details section has the eight required subsections in order.
- The Human section contains no file path, symbol, command, or commit ID.
- The document contains no em dash.
- Public content contains no private repository, private deployment identity,
  credential, or prohibited provider claim.
- Issue 68 contains only the plan link, one Summary paragraph, and one Status
  paragraph.
- `git diff --check` passes.
- Independent review finds no high-confidence factual, safety, or minimality
  defect.

### Rollout and rollback

This pull request changes documentation only. Publication rollout is the exact
independently reviewed commit on the existing non-draft pull request. Rollback
is a documentation revert.

A future implementation must start disabled. It first extends recording
fixtures for the existing plugin approval manager, existing iMessage runtime,
new protected-operation registry, session queue, session consumer, and provider
client. No automated test may deliver a real message or email.

Enablement order:

1. Prove the unchanged built-in plugin approval and iMessage path in recording
   fixtures.
2. Deploy final-boundary snapshot support with protected asynchronous tools
   disabled.
3. Deploy the durable registry, event projection, and continuation consumer with
   recording executors.
4. Prove admission limits, trusted-retry deduplication, separate-call
   correlation, protected reaction-store isolation, exact-GUID recovery,
   authorized no-follow attachment staging, staged-byte cleanup, pre-delivery
   durability, delivery reconciliation, same-boot recovery, host reboot expiry,
   fail-closed clock handling, 23-hour expiry, authenticated decision evidence,
   cancellation, unknown execution, duplicate delivery, continuation unknown,
   and rollback.
5. Enable the email adapter against a recording provider.
6. Validate complete approve, deny, expire, restart, and continuation cycles.
7. Enable one real owner route and protected tool only after explicit approval
   and a separate deployment plan.

Rollback order:

1. Stop accepting new protected asynchronous operations.
2. Keep durable operation and terminal records readable.
3. Disable new executor claims, then use one gateway-authenticated
   compare-and-set transition to move `prepared`, `pending_delivery`, `pending`,
   and `allowed` records without invocation intent to terminal failed and
   `event_pending`. Atomically expire manager projections, remove reaction
   bindings, release capacity and staged references, and preserve terminal
   delivery. Do not call the approval decision resolver or weaken decision
   evidence.
4. Do not retry executing, unknown, or uncertain-continuation records.
5. Deliver already committed terminal events through the durable queue.
6. Remove protected-operation and final-snapshot feature flags.
7. Preserve the existing iMessage approval capability for ordinary exec and
   plugin approvals.
8. Restore configuration and code through the repository's configured rollback
   path.
9. Verify that no protected executor route remains reachable from the sandbox.

Rollback must never convert a pending, denied, expired, failed, or unknown
operation into approval. It must not lose a committed result or repeat a
provider effect.

### Review log

- 2026-08-12: The custom approval authority and phone protocol were superseded.
  Pinned source and official documentation confirmed that built-in plugin
  approvals, native iMessage delivery, and the session delivery queue are the
  correct reuse seams.
- Independent review corrected the final-parameter boundary, transcript and
  continuation model, durable authority ordering, decision evidence, timeout
  and clock behavior, admission limits, retry identity, reaction-store
  isolation, restart rules, cancellation, and rollback.
- Final review added authorized no-follow attachment staging and authoritative
  exact-GUID iMessage recovery. No actionable review findings remain.
- The resulting proposal keeps OpenClaw's built-in approval authority and phone
  adapter, then adds only the structured final snapshot and durable protected
  operation, terminal-event, and continuation lifecycle they do not provide.

### Checklist

- [x] Read the current public repository instructions.
- [x] Read the current safe feature development contract.
- [x] Trace the pinned approval, policy, iMessage, reaction, session-delivery,
  timeout, persistence, restart, and continuation paths.
- [x] Read and distinguish the official delegated CLI permission model.
- [x] Remove the redundant custom approval authority and phone protocol.
- [x] Rewrite the full Human and Agent sections around built-in reuse.
- [x] Complete independent high-threshold review and remediate every actionable
  finding.
- [x] Add authorized attachment-source staging and exact-GUID iMessage recovery.
- [x] Run final structural, readability, leakage, and documentation checks.
- [x] Prepare the complete design-only candidate for publication.
