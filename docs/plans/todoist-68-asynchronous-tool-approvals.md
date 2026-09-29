# Asynchronous tool approvals

**Status:** Ready for review
**Issue:** [#68](https://github.com/coletaylor788/puddles/issues/68)
**Last updated:** 2026-08-12
**Owner:** Cole

## Human design

### Problem

Some tools can cause real-world effects. Sending email is the first example.
The model may prepare the call, but it must not approve the call or reach the
send credential directly. Cole needs to see every value that will be used,
approve or deny from his iPhone, and have the agent continue after the result.

OpenClaw already has generic tool approvals and native iMessage approval
delivery. The proposal should use them instead of creating another approval
service. Two current limits remain: the approval view does not show every final
parameter, and the existing wait keeps the agent run open for a short,
process-local decision.

### Outcome

The built-in OpenClaw approval remains the only approval authority. Trusted
configuration marks the send tool as protected, limits decisions to approve
once or deny, fixes Cole's direct iMessage conversation as the route, and keeps
the provider credential outside the model sandbox.

Cole receives the built-in approval in Messages on his iPhone. It shows the
exact recipients, subject, body, and options that would execute. A thumbs-up
approves that call once. A thumbs-down denies it. The existing iMessage poller
on the Mac receives the synchronized reaction, so this design needs no custom
phone app, hosted approval page, or new inbound network service.

An approved call executes with the reviewed values. A denied call returns a
denied result. Either result is delivered back to the originating agent, and the
agent resumes the suspended workflow.

### Approach

Start with configuration and existing facilities. Use the current trusted
tool-policy hook, built-in approval ID and resolver, native iMessage approval
adapter, GUID-bound reactions, and durable session delivery queue.

Add only three focused extensions:

1. Move protected approval to the final tool boundary and add a structured view
   of every effective parameter. The reviewed values become the executor input,
   so approval cannot release different arguments.
2. Add a durable deferred mode to the existing plugin approval manager. It
   stores the built-in approval, finalized arguments, origin, and expiry, returns
   a pending result to end the current run, and restores pending approvals after
   a gateway restart.
3. When the existing resolver receives the decision, consume that stored
   approval once. Approve invokes the protected executor. Deny records failure.
   The existing session delivery queue returns the terminal result and requests
   one continuation for the originating session.

Version 1 supports text email with ordinary scalar options. Attachment-bearing
calls fail closed unless an existing OpenClaw media facility can provide an
immutable content reference that is both displayed and passed unchanged to the
executor. This avoids inventing an attachment storage system as part of the
approval feature.

### Safety and rollout

The model sandbox is untrusted. The gateway process and logged-in Mac account
are trusted. The protected executor, provider credential, approval route, owner
allowlist, and decision handling remain in the trusted gateway. The sandbox has
no direct provider credential or alternate send path.

The model cannot choose the approver, route, wording, reaction meanings, or
approval policy. Approval is valid only for the finalized values stored under
the built-in approval ID. Missing, stale, unauthorized, duplicate, or malformed
decisions execute nothing.

This is design-only. No runtime, account, credential, message, or external
service changes are authorized. A future implementation starts disabled and
uses recording adapters for Messages and email. Rollback disables deferred
approvals while leaving ordinary built-in approvals unchanged.

## Agent details

### State

The strict recommendation is configuration plus three small changes at existing
OpenClaw seams:

1. structured final-parameter review;
2. durable deferred plugin approvals; and
3. terminal-result delivery through the existing session queue.

The built-in plugin approval manager remains the authority. The existing native
iMessage adapter remains the phone interface. The existing session delivery
queue remains the return and wake-up transport.

The previous proposal's separate operation subsystem, custom state machine,
admission quotas, rate limits, clock model, attachment staging service,
protected reaction index, cancellation fence, and bespoke rollback protocol are
not part of this design. They are not required by Cole's stated trust model or
the four required outcomes.

The pinned OpenClaw source is commit `12f9abf044`. This task changes only the
proposal. Implementation and deployment remain blocked pending approval.

### Scope and acceptance criteria

#### In scope

- Provider-neutral approval for a protected plugin tool, starting with text
  email.
- Existing trusted tool policy to require approval.
- Existing plugin approval ID, request, resolver, and decisions.
- Existing native iMessage prompt and GUID-bound reactions.
- Existing session delivery queue for terminal result and continuation.
- Final effective parameter display and binding.
- A durable non-blocking mode in the existing approval manager.
- Protected execution after approve and denied failure after deny.
- Durable result return and one resumed agent turn.

#### Out of scope

- A parallel broker, approval authority, resolver, or protocol.
- A hosted page, webhook, new listener, custom phone app, or native Mac app.
- Permanent approval for protected tools.
- Model-selected routes, approvers, decision meanings, or policy.
- Designing for compromise of the trusted gateway, Mac account, or owner phone.
- A new attachment store, previewer, scanner, quota system, or rate limiter.
- Generic approval for every tool.
- Implementation, deployment, test sends, account changes, or credential
  changes.

#### Acceptance criteria

A future implementation is acceptable only when:

1. Trusted configuration marks the tool protected and fixes one direct
   iMessage owner route.
2. The model sandbox cannot disable approval, select the approver, resolve the
   approval, access the provider credential, or invoke the protected executor
   directly.
3. Protected decisions are limited to `allow-once` and `deny`.
4. Approval occurs after all trusted parameter preparation and finalization.
5. The built-in approval view shows every effective parameter without hidden
   defaults or silent truncation.
6. The protected executor receives exactly the stored reviewed values.
7. Unsupported values, including mutable attachment inputs in version 1, fail
   before an approval prompt is sent.
8. The original tool call returns `pending` and releases the sandbox worker.
9. The existing approval manager persists the built-in approval ID, finalized
   values, origin, route correlation, and expiry.
10. Pending deferred approvals restore after gateway restart and expire
    fail-closed.
11. The existing iMessage adapter delivers the prompt and binds reactions to
    the concrete outbound message GUID.
12. Only an allowlisted actor's thumbs-up on that GUID maps to `allow-once`.
    Only thumbs-down maps to `deny`.
13. Missing, stale, unauthorized, duplicate, malformed, or conflicting
    decisions execute nothing.
14. The existing resolver consumes a deferred approval once. Approval invokes
    the protected executor with the stored values. Denial does not invoke it.
15. The terminal result is `sent`, `denied`, `expired`, or `failed`, with a
    provider receipt and timestamp on success when available.
16. A stable result key enqueues one trusted result through the existing session
    delivery queue for the originating session.
17. Queue retry cannot repeat the provider effect, duplicate the transcript
    result, or start a second continuation.
18. A busy session waits in the existing queue. A missing session retains the
    queue failure for operator recovery rather than rerouting to another
    session.
19. No new hosted service, public endpoint, inbound listener, or custom mobile
    application is introduced.
20. Automated tests use recording adapters and send no real message or email.

### Architecture and decisions

#### Confirmed built-in path

OpenClaw already provides the core path:

- a trusted `before_tool_call` policy can require plugin approval;
- the gateway creates a server-owned `plugin:` approval ID;
- `allowedDecisions` limits the accepted decisions;
- the resolver rejects a conflicting second decision;
- the iMessage channel declares native plugin approval support;
- native delivery requires a concrete outbound GUID before reaction binding;
- the reaction target records account, conversation, GUID, approval ID,
  decisions, and expiry;
- the iMessage poller authorizes the actor and resolves thumbs-up or thumbs-down;
  and
- the session delivery queue durably retries system-event and agent-turn
  delivery with idempotency keys.

These facilities stay in place. The design does not add another authority.

#### Gap 1: exact effective parameters

Current plugin approval rendering contains a title, description, severity, and
metadata. Approval can occur before later trusted parameter changes. A protected
effect needs one small boundary and payload extension:

1. Trusted policy marks the call protected.
2. Tool preparation, trusted hooks, reconciliation, and finalization complete.
3. The wrapper freezes the final arguments.
4. The built-in request stores structured reviewed values.
5. The native iMessage renderer displays those values with fixed labels.
6. `allow-once` passes the stored values to the registered protected executor.

The model does not supply the display text. The view uses inert formatting and
fails when the full supported value set cannot be represented without
truncation.

Version 1 email fields are recipients, subject, body, reply or thread options,
and other scalar send options. Attachments are accepted only when an existing
OpenClaw facility already supplies an immutable reference. Otherwise the tool
returns an unsupported-input failure before approval.

#### Gap 2: asynchronous non-blocking approval

Current plugin approval waits in the live run, defaults to 120 seconds, caps at
600 seconds, and stores pending approvals in memory. Add a deferred mode to the
existing approval manager rather than a separate broker.

The deferred record contains only what the built-in manager needs:

- approval ID and allowed decisions;
- finalized executor input;
- originating tool call, session, and task correlation;
- iMessage route and concrete GUID after delivery;
- expiry;
- current decision or terminal result; and
- a stable result-delivery key.

Creation stores the record before the original tool call returns `pending`.
Startup reloads unexpired records into the existing manager. Expiry uses the
stored absolute deadline and the trusted host clock. Ordinary immediate
approvals keep their current behavior and timeout.

The existing reaction target store remains the iMessage correlation mechanism.
No second protected-reaction database or custom phone protocol is needed.

#### Gap 3: execute, return, and resume

The existing resolver remains the decision entry point. For a deferred record:

- `deny` writes a terminal denied result without invoking the executor;
- `allow-once` atomically changes the record from pending to consumed, then
  invokes the registered protected executor with the stored values; and
- expiry writes a terminal expired result without invoking the executor.

The consume transition prevents a duplicate reaction or resolver retry from
starting a second provider call. If the provider supports an idempotency key,
use the built-in approval ID. If a provider call fails or its result is unknown,
record a failed result and do not retry the effect automatically.

After a terminal result is stored, enqueue a trusted system event and agent turn
through the existing session delivery queue. Use the approval ID as the stable
queue idempotency key. The result event carries the original tool correlation,
status, safe error, and provider receipt when available. The continuation prompt
states that the protected call is complete and must not be repeated.

The queue already owns persistence, retry, and busy-session ordering. The
session consumer records the stable result key before starting the continuation,
so redelivery is a no-op. This is a focused idempotency check at the existing
consumer seam, not a second workflow engine.

#### Trust boundary

Trusted:

- gateway process and logged-in Mac account;
- protected-tool configuration;
- approval manager and resolver;
- iMessage route and approver allowlist;
- provider credential and protected executor; and
- session delivery queue and consumer.

Untrusted:

- model output and tool arguments;
- sandbox code and environment;
- message-like text produced by the model; and
- repeated or malformed tool calls.

The sandbox receives only the protected tool schema and approval status. It has
no provider credential, resolver authority, direct executor route, or control
over iMessage approval configuration.

#### Work classification

| Class | Work |
|---|---|
| Configuration | Mark the email tool protected, set one direct iMessage owner route, use an explicit allowlist, and limit decisions to allow-once and deny |
| Reuse unchanged | Plugin approval ID and resolver, native iMessage delivery and GUID reactions, session delivery queue |
| Focused extension | Structured final arguments in the approval payload and iMessage renderer |
| Focused extension | Persistent deferred mode in the existing approval manager |
| Focused extension | Deferred executor consumption and idempotent terminal-result continuation |
| Not proposed | Parallel broker, custom phone protocol, hosted UI, new listener, new attachment service, quota or rate-limit framework |

#### Alternatives

| Alternative | Decision |
|---|---|
| Current built-in approval unchanged | Insufficient because it blocks the live run, expires quickly, loses pending state on restart, and does not show every final parameter |
| Built-in approval with focused extensions | Recommended because it preserves the current authority, phone path, and result transport |
| Separate approval broker | Rejected as duplicate machinery |
| Custom iMessage protocol | Rejected because native plugin approvals and GUID-bound reactions already exist |
| Hosted review page or phone app | Rejected because iMessage already provides the phone path without a new inbound service |
| Keep attachment support in version 1 | Rejected unless an existing immutable media reference can be reused |

#### Evidence

Pinned OpenClaw source:

- `src/infra/plugin-approvals.ts:15-51` defines plugin approval payloads and the
  current 120-second default and 600-second maximum.
- `src/plugins/hook-before-tool-call-result.ts:1-26` defines trusted hook
  approval results and closed decisions.
- `src/agents/agent-tools.before-tool-call.ts:164-190,687-935` defines current
  approval waits and the deferred live-run descriptor.
- `src/agents/agent-tools.before-tool-call.ts:1240-1539` shows the parameter
  preparation and finalization order.
- `src/gateway/server-methods/plugin-approval.ts:39-197` creates and resolves
  plugin approvals.
- `src/gateway/server-methods/approval-shared.ts:414-681` handles routing,
  decisions, and conflicting resolutions.
- `src/gateway/exec-approval-manager.ts:65-169` stores pending approvals in a
  process-local map.
- `src/infra/approval-view-model.ts:87-102` shows the current compact approval
  view.
- `extensions/imessage/src/channel.ts:307-323` registers native iMessage
  approval support.
- `extensions/imessage/src/approval-native.ts:331-443` renders plugin approvals.
- `extensions/imessage/src/approval-handler.runtime.ts:95-233` delivers prompts,
  requires a GUID, binds reactions, and updates resolved prompts.
- `extensions/imessage/src/approval-auth.ts:38-79` authorizes decision actors.
- `extensions/imessage/src/approval-reactions.ts:24-232` persists GUID-to-
  approval reaction targets.
- `src/infra/session-delivery-queue-storage.ts:39-113` defines durable,
  idempotent system-event and agent-turn queue entries.
- `src/infra/session-delivery-queue-recovery.ts:1-105` retries unacknowledged
  deliveries.

Current tests:

- `src/gateway/server-methods/plugin-approval.test.ts`
- `src/gateway/exec-approval-manager.test.ts`
- `src/gateway/approval-shared.test.ts`
- `extensions/imessage/src/approval-native.test.ts`
- `src/infra/session-delivery-queue-storage.test.ts`
- `src/infra/session-delivery-queue-recovery.test.ts`

Prior public plans:

- `docs/plans/027-imessage-approval-channel.md` describes the native iMessage
  approval path now present in source.
- `docs/plans/028-announce-via-session-delivery-queue.md` describes the durable
  session return path now present in source.

### Implementation

No implementation is authorized.

A future approved implementation has three phases.

#### Phase 1: configure and prove built-in reuse

- Configure one protected text-email tool.
- Fix one direct iMessage owner route and explicit allowlist.
- Limit decisions to `allow-once` and `deny`.
- Add recording fixtures that prove the current prompt, GUID reaction,
  authorization, resolution, and update path.

#### Phase 2: add final review and deferred mode

- Move protected approval to the final parameter boundary.
- Add structured reviewed arguments to the existing approval payload and
  iMessage renderer.
- Make the reviewed arguments the protected executor input.
- Add persistent deferred records to the existing approval manager.
- Return `pending` from the original tool call and restore unexpired records on
  restart.
- Reject unsupported attachment-bearing calls before approval.

#### Phase 3: execute and resume

- Let the existing resolver consume a deferred approval once.
- Invoke the protected executor only after `allow-once`.
- Store sent, denied, expired, or failed.
- Enqueue the trusted result and continuation through the existing session
  delivery queue with a stable idempotency key.
- Add the consumer-side duplicate check before starting the continuation.

### Validation

Future tests must use recording transports and providers.

Built-in reuse:

- trusted configuration requires approval and fixes the owner route;
- the server creates the only approval ID;
- only allow-once and deny are accepted;
- native iMessage delivery returns a concrete GUID;
- the allowlisted actor's thumbs-up approves and thumbs-down denies;
- wrong actor, wrong GUID, stale reaction, duplicate reaction, and conflicting
  decision execute nothing.

Exact values:

- approval runs after every trusted parameter change;
- every supported final field appears in the review;
- hidden, truncated, or changed fields fail;
- the executor receives the stored reviewed arguments;
- attachment-bearing input without an existing immutable media reference fails
  before delivery.

Asynchronous decision:

- the original tool call returns pending and releases the worker;
- pending approval survives gateway restart;
- expiry fails closed;
- ordinary immediate approvals keep current behavior.

Execution and continuation:

- approve invokes once with reviewed values;
- deny and expiry never invoke;
- duplicate resolution never starts another provider call;
- terminal success includes provider receipt and timestamp when available;
- one stable result enters the existing session queue;
- queue redelivery records one result and starts one continuation;
- busy sessions wait and missing sessions remain recoverable;
- no live message or provider effect occurs in automated tests.

Publication checks:

- the diff is documentation-only;
- the plan has exactly the required Human design and Agent details sections;
- the Human design contains no path, symbol, command, or commit ID;
- the document contains no em dash;
- public content contains no private repository or provider-specific deployment
  detail;
- issue 68 contains only the plan link, Summary, and Status;
- `git diff --check` passes.

### Rollout and rollback

This pull request changes documentation only. Publication rollback is a normal
documentation revert.

A future implementation starts disabled. First prove the unchanged built-in
approval and iMessage flow with recording adapters. Then enable structured
review and deferred mode for one text-email tool against a recording provider.
Only an explicit later deployment may enable a real provider credential.

Runtime rollback disables deferred protected approvals and the protected
executor. Existing pending deferred approvals become failed results delivered
through the normal session queue. Ordinary built-in approvals and native
iMessage approvals remain unchanged. An operation already handed to the
provider is not retried during rollback.

### Review log

- Source review confirmed that built-in plugin approvals, native iMessage
  approvals, and the session delivery queue are the correct reuse seams.
- Cole requested a strict minimality pass after the proposal accumulated
  machinery beyond the four required outcomes.
- The final design removes the parallel subsystem details and keeps only final
  parameter binding, deferred persistence, protected execution, and durable
  return and resume at existing seams.
- Per controlling direction, publication uses one local consistency read and no
  further independent review loop.

### Checklist

- [x] Read the current repository instructions and design workflow.
- [x] Confirm the pinned built-in plugin approval path.
- [x] Confirm native iMessage plugin approvals and GUID-bound reactions.
- [x] Confirm the existing durable session delivery queue.
- [x] Keep the trusted gateway and untrusted sandbox boundary.
- [x] Reduce the proposal to configuration and three focused extensions.
- [x] Remove custom broker, state-machine, quota, rate-limit, clock, attachment
  staging, and fencing machinery.
- [x] Keep only the four required outcomes and their direct safety conditions.
- [x] Preserve design-only scope and provider-neutral publication boundaries.
- [x] Prepare the final minimal proposal for Cole's review.
