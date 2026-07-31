# Asynchronous tool approvals

**Status:** Ready for review
**Issue:** [#68](https://github.com/coletaylor788/puddles/issues/68)
**Last updated:** 2026-07-30
**Owner:** Cole

## Human design

### Problem

High-impact tools such as email delivery need a hard approval boundary that no
model, prompt, alternate tool, or host-local operator client can bypass. Cole
must see the exact requested operation and every effective parameter, then
explicitly approve or deny it. Waiting may take hours, so neither a tool RPC nor
an agent turn can remain open. After a decision, the side effect and the
originating task must continue reliably across retries and gateway restarts.

OpenClaw already has useful pieces, but its current plugin approval path is not
that boundary. It waits inline, expires within ten minutes, stores pending state
in memory, carries only plugin-authored free text instead of a raw-versus-resolved
parameter view, permits timeout-to-allow, gives local CLI/operator clients
approval scope by default, and runs native plugins in the gateway process. The
current path therefore cannot safely hold credentials, render the authoritative
review page, authorize protected decisions, or provide durable asynchronous
resume without architectural changes.

### Outcome

Add a reusable "deferred approval job" capability in a later implementation.
The authoritative approval store and protected executor will run as a separate
local service under a separate OS identity. That service alone holds protected
credentials, immutable staged inputs, approval records, the owner-device public
key, the review-page TLS identity, and the ability to execute side effects.
Root-owned or separately administered private DNS and proxy configuration keeps
the gateway account from repointing either the signing hostname or the separate
attachment-download hostname. The sidecar directly serves both TLS origins. The
gateway may push request data and deliver notifications, but it cannot render or
intercept trusted review content, read approval content, approve, or execute
requests.

A protected tool call will create or reuse a durable immutable request and
return `pending_approval` immediately. Trusted runtime code will notify Cole by
iMessage. A link hint will identify the request, while Cole reviews it from the
authority's bookmarked HTTPS origin on a distinct hostname. That minimal page
reuses OpenClaw Control UI presentation patterns but is served and signed by the
authority, not the gateway. It displays the raw model arguments and complete
resolved execution envelope. Approve requires a signature from a pre-enrolled
WebAuthn credential scoped to that origin, requiring user verification for every
decision, pinned to the exact authority hostname rather than a shared parent
domain, and absent from the gateway host. Model-controlled attachment bytes
never render on that signing origin. Deny is also available there, with iMessage
tapback deny as a fail-safe convenience. Approval executes only the stored
envelope. Every terminal outcome, including cancellation, remains in the
authority store until the owning agent durably consumes it.

This reuses OpenClaw's hooks, iMessage integration, UI components, and session
delivery without building a standalone mobile or desktop app. A small
authority-hosted web surface is necessary to keep what Cole sees in the same
trust domain as what executes. Telegram is the preferred alternative
notification channel if a dedicated approval channel is later wanted.

### Approach

Use capability and identity isolation as the enforcement boundary:

1. The agent can call only a brokered request tool and has no credentialed
   shell, browser, raw provider API, network route, local approval scope, or
   readable credential/staging path that can perform the protected side effect.
   For email, the existing gateway-account Gmail credential and OAuth client
   configuration must be reduced to exactly `{gmail.readonly}` and no other
   scope. Any additional Gmail scope fails closed. This excludes direct send
   scopes plus indirect outbound/exfiltration scopes such as
   `gmail.settings.basic` and `gmail.settings.sharing`. Only sidecar-owned
   credentials may hold mutation or send-capable scopes.
2. The gateway adapter validates model-facing inputs and pushes serializable
   values and attachment bytes over a narrow submit RPC. The authority never
   reads caller-supplied filesystem paths.
3. The authority runs under a separate OS identity, owns a dedicated
   non-evicting database and content-addressed staging store, resolves all
   defaults and dynamic inputs, and hashes the complete execution envelope.
4. Once a stable trusted root-task identifier exists, duplicate submissions for
   that task, tool, and envelope reuse one record. Until then, and for
   trivially varied payloads, strict quotas and rate limits are the primary
   flood control.
5. Trusted runtime code notifies a fixed owner route that the model cannot
   select or edit, then the current agent run yields.
6. Cole opens the authority's bookmarked distinct HTTPS origin. Authority-served
   code fetches and safely renders every raw and effective parameter, then asks
   the enrolled off-host WebAuthn credential, with user verification required,
   to sign the record ID, digest, decision, and freshness challenge. Attachment
   bytes are available only as forced downloads from a separate origin that
   cannot invoke that credential and has the same gateway-inaccessible
   DNS/TLS/proxy ownership.
7. The authority atomically accepts one `allow-once` or `deny`. Approved work
   must be claimed and cross the provider boundary within an absolute execution
   deadline, then executes from the stored envelope after re-verifying
   staged-input digests. Recovery after that deadline may reconcile prior work
   but cannot initiate a new side effect without re-approval.
8. The authority stores the terminal result and repeatedly asks OpenClaw to
   deliver it until the owning agent's transcript records and acknowledges
   consumption. A periodic reconciler repairs interrupted notification,
   execution, and resume work without model polling.

### Safety and rollout

This task is proposal-only. It does not implement, deploy, configure, notify, or
send anything.

A later implementation must fail closed. Protected tools remain unavailable
until the separate OS identity, credential isolation, off-host approver key,
authority-owned HTTPS hostname and TLS key, private phone reachability, pairing,
root- or separately-owned DNS/proxy control, authenticated record reads, state
durability, and bypass audit are proven. Notification links are hints; the
bookmarked authority origin is the security cue and links never authorize
decisions. Host-local OpenClaw admin or approvals scope is explicitly
insufficient.

The gateway account must also be unable to access Tailscale LocalAPI or any
equivalent network-control socket that can issue certificates or reconfigure
routes for the signing or download hostnames.

Pending requests expire by default after 23 hours, or sooner per tool.
Approvals not claimed for execution within five minutes become
`approval_stale` and require a new signed approval. The same absolute deadline
prevents already-claimed work from starting a provider call after a long outage.
Duplicate decisions, payload mutation, stale pages, replay, unauthorized record
reads, Unicode display spoofing, attachment replacement, active attachment
content, and blind retry after ambiguous provider outcomes all fail closed.
Separate content policy must hard-block secrets that approval cannot override.
The authority uses nondecreasing trusted time so clock rollback cannot revive or
extend approvals, challenges, execution deadlines, cooldowns, or downloads.

For the first email rollout, credential isolation is incomplete until the
current gateway-account Gmail OAuth token is re-consented without
all scopes except exactly `gmail.readonly`, the old token is revoked, and the
gateway's code/configuration and normal consent instructions request only that
allowlist. Because `gmail.modify` itself authorizes send, routine archive,
read-state, star, importance, and configured user-label operations move to a
narrow sidecar RPC that exposes only hard-coded mailbox-label actions, never
arbitrary Gmail methods. Generic label operations accept user-created labels
only; `STARRED` and `IMPORTANT` are available only through dedicated reversible
fixed actions, while `TRASH`, `SPAM`, `CATEGORY_*`, and every other system label
remain unavailable.
The replacement RPC and its sidecar credential must be live and proven before
revocation. The cutover first inventories current behavior, stages and verifies
the replacement, routes triage through it, provisions the exact-read-only
gateway credential, and disables old mutation paths. Revoking the old token is
the final irreversible step. Before revocation, any failure aborts with the old
setup unchanged; afterward, failures are fixed forward in the sidecar only, so
mutation/send scope never returns to the gateway. A post-revocation sidecar
fault may cause a bounded triage outage; it must alert the operator and use a
tested sidecar-only recovery procedure rather than silently losing capability.
Settings scopes are also forbidden because vacation responses, forwarding,
send-as, and delegation can create outbound or exfiltration paths. Minting any
new mutation/send credential still requires Cole's interactive Google consent,
and the gateway must never prompt for those scopes.

Roll out first with a recording-only fake tool and pre-paired test device, then
a non-production adapter, and only then one low-volume protected tool. Rollback
disables intake and execution, cancels unclaimed work, preserves records for
reconciliation, and never restores an unapproved direct side-effect path.
Approval-feature rollback leaves the already-cut-over narrow mailbox-triage
sidecar running; that capability has its own fail-safe rollback boundary.

## Agent details

### State

Research, architecture synthesis, and all independent review rounds are
complete. Every accepted finding recorded in the review log is incorporated in
the current design. Final validation found no unresolved material defects and
confirmed the trust boundaries, state lifecycle, Gmail cutover ordering,
bounded post-revocation recovery, separate rollback boundaries, and reversible
mailbox-triage action set against the pinned OpenClaw and Puddles source.

Public tracking is complete. The Todoist tracking and ready-for-review result
comments point to issue 68, and the task remains open with the
`ready_for_review` label. Superseded non-public issue and pull-request tracking
are closed, and their remote review branch is deleted.

The proposal remains ready for review. This publication created no approval
runtime, notification integration, protected tool, configuration, credential,
or external side effect.

### Scope and acceptance criteria

In scope for the proposed later implementation:

- A configurable protected-tool registry for serializable side-effecting tools.
- A separate-identity local approval authority and executor.
- A dedicated durable approval database and immutable staging store.
- Exact disclosure of raw arguments and all effective execution parameters.
- Explicit per-call approve and deny signed by an enrolled off-host owner key.
- Existing-channel notification, beginning with iMessage.
- An authority-served HTTPS review page on a distinct hostname, reusing existing
  OpenClaw UI patterns without trusting gateway-served assets.
- A separate attachment-download origin that cannot invoke the approver
  credential and is routed and served inside the same administrative boundary.
- Device-authenticated record reads and single-use attachment download
  capabilities.
- Request deduplication, quotas, expiry, execution freshness, idempotency,
  reconciliation, observability, audit, retention, resume, rollout, and
  rollback.

Out of scope:

- Implementing or deploying the proposal in this task.
- A new standalone mobile or desktop application.
- Treating gateway-local CLI, operator, admin, or approvals scope as sufficient
  authority for a protected decision.
- Model-generated approval messages, model-mediated decisions, or model polling
  as a source of truth.
- Permanent `allow-always` for protected side effects.
- Approval as an override for non-overridable content or credential policy.
- Generic replay of arbitrary existing tools that depend on live closures,
  streams, browser state, or non-serializable hook context.

Acceptance requires that a future implementation:

1. confines protected credentials and execution to a separate OS identity and
   removes every autonomous alternate credentialed path available to the agent
   or gateway, including every Gmail scope and code/configuration path that can
   authorize send;
2. permits routine unapproved mailbox triage only through a sidecar
   `mailboxMutation` RPC whose fixed action schema cannot express send, draft,
   insert, trash, spam, settings, delegation, forwarding, or arbitrary provider
   calls; whose configured label actions accept user labels only; and whose
   dedicated reversible system-label actions are limited to archive, read-state,
   star, and importance;
3. rejects protected decisions authorized only by host-local OpenClaw
   operator/admin/approvals scope and requires a configured off-host owner key;
4. serves the review UI and record API from a distinct authority-owned HTTPS
   hostname whose TLS/signing keys, DNS, certificate issuance, and terminating
   proxy configuration are unavailable to the gateway, with equivalent
   protections for every attachment-download hostname;
5. displays raw model arguments and the complete versioned execution envelope,
   including resolved defaults, destinations, headers, options, and immutable
   attachment references and hashes;
6. binds a signed decision to the authoritative record ID, envelope digest,
   decision, owner identity, expiry, and one-time freshness challenge, with
   WebAuthn user verification required per decision, exact expected origin and
   RP ID verification, and server-side rejection when the authenticator UV flag
   is clear;
7. returns from the originating tool call without waiting for a human;
8. permits only authenticated `allow-once` or `deny`, with timeout and failure
   defaulting to no execution;
9. deduplicates repeated requests once a stable trusted task ID exists and
   always enforces
   per-owner, per-session, and per-tool pending quotas;
10. accepts uploaded attachment bytes but never reads model- or gateway-supplied
   filesystem paths with sidecar privileges;
11. executes approved work only from the stored envelope, re-verifies staged
    bytes immediately before the provider call, respects an absolute execute-by
    deadline across recovery, and never executes on denial;
12. prevents duplicate side effects or explicitly enters `execution_unknown`
   when provider acceptance cannot be proven;
13. keeps the authority record until a trusted agent-consumption acknowledgement
    is durable for each sequenced lifecycle event, re-enqueuing failed resume
    delivery as needed without releasing re-armable stale records;
14. survives restart, duplicate delivery, stale links, unavailable channels,
    execution interruption, session contention, and failed queue retries; and
15. keeps approval bodies and attachments on the local protected service rather
    than copying them into third-party notification channels.
16. never executes model-controlled attachment content in the WebAuthn relying
    party origin.
17. requires an authenticated owner-device session to read approval records and
    narrow single-use capabilities to download staged attachments.
18. uses a nondecreasing authority-controlled time source so backward clock
    movement cannot extend security deadlines.

### Architecture and decisions

#### Threat model and components

The protected boundary assumes model-controlled tool selection and content,
prompt injection, repeated calls, malformed payloads, stale decisions, gateway
restart, and an agent capable of invoking whatever local tools its profile
exposes. It does not claim safety after root compromise or arbitrary code
execution as the approval-service OS user.

Run/session/tool-call values supplied by trusted OpenClaw hook context are
trusted against model manipulation, not against compromise of the gateway OS
account. Even under gateway compromise, the sidecar still guarantees no
approval-gated side effect without an owner WebAuthn signature over its own
rendered envelope. `mailboxMutation` is the sole bounded exception: it permits
only reversible archive/read-state/star/importance/configured-user-label
operations and has independent sidecar-native caps, audit, and anomaly alerts.
Sidecar-native owner and wall-clock caps that do not depend on gateway-supplied
identity provide the flood boundary in that stronger threat case.

OpenClaw native plugins run in the gateway process and are not sandboxed
(`docs/plugins/architecture.md` and `docs/plugins/admin-http-rpc.md` in the
pinned checkout). Therefore the protected credential and approval authority
cannot live in a normal OpenClaw plugin.

The design has four components:

| Component | Trust and responsibility |
|---|---|
| Gateway request adapter | Validates model-facing schema, submits requests, returns pending status, and has no decision or execution credential |
| Approval authority/executor sidecar | Separate OS user; owns authoritative DB, staging, owner public key, provider credential, decisions, leases, execution, reconciliation, and audit |
| Authority-served review page | Reuses OpenClaw UI patterns but is served from a distinct sidecar-owned HTTPS hostname; renders authoritative records and requests an enrolled owner-device signature |
| Existing channel and resume adapters | iMessage sends fixed notifications; OpenClaw session delivery transports results but never owns their durability |

The sidecar exposes narrow authenticated local RPC:

- `submit` accepts a validated candidate envelope from the configured gateway
  identity plus uploaded attachment byte streams and may create notifications
  but cannot cause execution or name sidecar-readable paths;
- `mailboxMutation` accepts only a fixed action enum such as `archive`,
  `markRead`, `markUnread`, `star`, `unstar`, `markImportant`,
  `markNotImportant`, `applyConfiguredLabel`, or `removeConfiguredLabel`, plus
  bounded message/thread IDs. `archive` may only remove `INBOX`; read-state
  actions may only add/remove `UNREAD`; star actions may only add/remove
  `STARRED`; importance actions may only add/remove `IMPORTANT`; and configured
  label actions may only add/remove an explicit closed allowlist of user-created
  label IDs. Generic label actions categorically reject `INBOX`, `UNREAD`,
  `STARRED`, `IMPORTANT`, `TRASH`, `SPAM`, `CATEGORY_*`, every other system
  label, unknown labels, and any label whose application changes deletion or
  delivery state. No fixed action exists for `TRASH`, `SPAM`, or `CATEGORY_*`.
  It dispatches only to Gmail
  `users.messages.modify`/`users.threads.modify`/approved batch-modify forms,
  has independent rate limits and audit, and cannot name a provider method,
  supply a raw request body, or reach `messages.send`, `drafts.*`,
  `messages.insert`, `messages.import`, `messages.trash`, `settings.*`,
  forwarding, send-as, delegation, or label IDs outside policy;
- `get` returns a signed approval view only from the authority HTTPS origin;
- `get` additionally requires a device-authenticated viewer session scoped to
  the enrolled owner and requested record;
- `decide` requires the enrolled owner-device signature and consumes a one-time
  challenge;
- `quickDeny` accepts only a rate-limited gateway-relayed iMessage denial and may
  perform only `pending -> denied`; it cannot approve, re-arm, mutate an
  envelope, consume a signed challenge, or trigger execution;
- `status` is read-only and privacy-scoped; and
- no public `execute` method exists. Only the authority's internal state-machine
  worker can claim approved records. `mailboxMutation` is the sole explicitly
  unapproved mutation surface and is not a generic execution escape hatch.

Run the sidecar under a dedicated OS account. Its database, socket, staged
content, credential, and signing material must be unreadable and unwritable by
the gateway/agent OS account. The provider credential should use an OS keychain
or equivalent ACL bound to the sidecar identity. The gateway may hold only a
submit-client credential with no decision or execution capability.

The provider-neutral broker, protocol, tests, and documentation belong upstream
in OpenClaw or in this repository. Provider-specific credential and
configuration wiring remains outside this design.

#### Model-independent protected-tool boundary

`before_tool_call` is the broad interception point, but the security claim also
requires a profile-by-profile capability audit:

- the model-facing agent can call only the brokered protected tool;
- `exec`, browser automation, raw MCP/provider clients, local gateway RPC,
  diagnostics, file/log reads, and unrestricted network tools cannot reach the
  sidecar credential, decision key, socket methods, or provider send API;
- subagents, native harnesses, MCP HTTP callers, and direct gateway tool
  invocation all route through the protected adapter or lack the capability;
  and
- no compatibility fallback exposes the prior direct tool when the sidecar is
  disabled or unhealthy.

OpenClaw's `approvalMode: "defer"` is useful prior art but is consumed by the
native hook relay and retains live, non-serializable hook context. It is not a
durable replay mechanism. Do not persist or restore that context.

#### Protected-tool contract and immutable inputs

Only explicitly registered deferred executors are eligible. Each supplies:

- JSON Schema and semantic validation;
- canonicalization and resolution of defaults, aliases, and dynamic inputs;
- immutable snapshotting into the authority's content-addressed store;
- a deterministic safe review renderer;
- `execute(envelope, idempotencyKey)`;
- `reconcile(envelope, idempotencyKey)` for ambiguous outcomes; and
- a result codec suitable for durable agent delivery.

The content-addressed store is owned by the sidecar account. The gateway and
agent cannot mutate staged blobs. The gateway opens candidate files using its
own lesser privileges, rejects traversal and symlink escapes according to the
tool's file policy, and uploads bounded byte streams plus logical metadata. The
sidecar never opens a caller-provided path, so it cannot be confused into
reading its own credential, database, key, or other privileged file. The
envelope records each staged object's digest, size, MIME type, and logical name.
Immediately before the provider call, the executor reopens the object from the
protected store, recomputes its digest and size, compares both to the approved
envelope, and terminates with `input_integrity_failed` on mismatch.

For email, the execution envelope includes account, provider operation,
resolved `to`/`cc`/`bcc`, reply-to and thread identifiers, subject, body and
format, headers, scheduling/send options, stable provider/RFC message identity,
and each attachment reference. The approval view shows raw model arguments,
resolved envelope, attachment metadata and digests, and separate-origin forced
downloads so defaults, alias expansion, and staged content are inspectable
without executing attachment bytes on the signing origin.

#### Dedicated record store and privacy

Approval records use only a sidecar-owned SQLite database with transactional
writes. The gateway/agent account cannot read or mutate it. Do not use
`PluginStateKeyedStore` for authoritative state: it requires entry limits and
may evict the oldest record. It remains suitable only for ephemeral channel
hints such as iMessage reaction targets.

The durable record contains:

- opaque ID, schema and tool versions, current trusted run ID, optional future
  stable root-task ID, created time, pending expiry, approval freshness deadline,
  and retention deadline;
- owner, agent, session key, session ID, turn and tool-call IDs;
- canonical raw arguments;
- canonical execution envelope and SHA-256 digest;
- protected staged-input references and digests;
- request dedupe key and duplicate lineage;
- notification attempts and delivered message references;
- decision challenge, signed decision, resolver public-key fingerprint, and
  decision time;
- execution lease, idempotency key, attempt state, result/error, and provider
  reconciliation evidence, plus an absolute `executeByMs`; and
- monotonic lifecycle sequence, one stable event ID per emitted state, delivery
  attempts, transcript receipt, and agent-consumption receipt for each event;
  and
- terminal acknowledgement only after a truly terminal state is consumed.

Owner, session, run, agent, and tool-call identity used for quotas and
correlation comes only from trusted OpenClaw hook context, never model
arguments.

Payload rows and staged content use owner-only permissions on an encrypted local
volume. Audit logs contain IDs, hashes, states, timings, and actor fingerprints,
not message bodies or attachment bytes. When pending work expires, its envelope
and staged bytes move into the same seven-day terminal-retention window rather
than being deleted immediately. `approval_stale` follows pending retention and
keeps the envelope and staged bytes throughout its re-arm window, even after its
stale lifecycle event is consumed. After terminal retention ends, payload and
staged content are purged while a metadata-only audit record is retained.

All deadlines use authority-controlled nondecreasing time. The sidecar combines
its monotonic process clock with a persisted wall-clock high-water mark and
never accepts a lower observed wall time after restart. The gateway account
cannot change the host clock. Backward clock movement therefore cannot extend an
expiry, challenge, cooldown, execution deadline, or download capability.

#### Request deduplication and flood control

The model does not supply idempotency or intent keys. OpenClaw currently exposes
trusted `runId`, `sessionId`, and `sessionKey`, but no stable root-task ID that
survives a logical retry in a later run. Creating or identifying such an ID is a
phase-one prerequisite for cross-run deduplication. When present, the authority
computes a dedupe key over `owner + rootTaskId + tool + envelopeDigest` in one
transaction:

- if a matching record is pending, approved, or executing, return that record;
- if it succeeded in the same root task, return `already_executed`;
- if it was denied, expired, cancelled, approval-stale, failed, or unknown,
  return that status rather than silently minting a replacement; and
- a new identical side effect requires a new trusted root task or an explicit
  "approve duplicate send" decision that clearly references the prior result.

An expired record remains terminal and immutable, but it does not permanently
strand a never-executed request. From the signed authority page, Cole may approve
a renewal action only within the seven-day terminal-retention window while the
envelope and staged bytes remain intact. The action is bound to the expired
record ID, envelope digest, and a one-time challenge. The authority creates a
new linked pending record with a new ID and expiry; after payload purge renewal
is unavailable, and model resubmission alone cannot renew or clear the dedupe
block.

Renewal lineage has one active generation at a time. `approval_stale` is active:
it retains a live re-arm window, envelope, and staged bytes. Dedupe resolution
first returns the newest active pending, approved, approval-stale, or executing
descendant, then the newest terminal descendant, rather than an expired
ancestor. Database uniqueness is scoped to active generation within a lineage,
so renewal of an expired ancestor is rejected while any active generation,
including approval-stale, exists. A signed renewal may coexist with immutable
terminal ancestors but never with another active copy.

Per-owner, per-session, and per-tool pending caps plus notification rate limits
fail closed and return a structured `approval_capacity_exceeded` result. They
are the primary flood control across runs and for payloads varied by even one
byte; digest deduplication is only an optimization. No design claim relies on
model instructions not to retry.

A deny also starts an owner-and-tool cooldown. Near-identical or trivially
varied requests during the cooldown are suppressed or held without repeated
notifications, and any later review shows the denied-record lineage and elapsed
time. This limits serial approval-pressure attacks that stay below concurrent
pending caps. A legitimate distinct request remains visible, and Cole can inspect
and clear a cooldown from the signed authority page. Unsigned `quickDeny` uses a
shorter separately rate-limited cooldown, is marked distinctly in audit and
alerts, and cannot silently impose the full signed-denial cooldown.

In addition to gateway-derived quotas, the sidecar enforces absolute per-submit
identity, per-owner, and global wall-clock request and notification caps that do
not depend on session, run, agent, or tool-call values supplied by the gateway.

#### State machine, freshness, and execution

Transactional states:

```text
pending ---------> denied
       \---------> expired
       \---------> cancelled
       \---------> approved
approved --------> cancelled
         \-------> approval_stale
         \-------> executing
approval_stale --> pending (owner-signed re-arm)
               \-> cancelled
               \-> expired (re-arm window elapsed)
executing -------> executing (lease re-claim before execute-by deadline)
          \------> approval_stale (deadline passed; provider not called)
executing -------> succeeded
          \------> failed
          \------> input_integrity_failed
          \------> execution_unknown
```

Only the first valid decision wins. The `decide` transaction verifies the owner
device signature, one-time challenge, pending expiry, and displayed digest.
Approval sets a five-minute claim deadline. If no worker claims it by then,
`approval_stale` requires a fresh review and signature; it never executes after
a delayed multi-day recovery. The owner may sign a re-arm action that creates a
new challenge, resets pending expiry to at most 23 hours from re-arm, creates a
new best-effort reaction target, and returns the same immutable record to
`pending`. An unsolicited model resubmission only returns `approval_stale` and
cannot re-arm it.

`approval_stale` is re-armable, not terminal. Entering it starts a fresh
23-hour re-arm window and retains the full envelope and staged bytes under the
pending retention policy. If not re-armed, it transitions to `expired`; re-arm
resets pending expiry to at most 23 hours from that action.

The worker atomically claims an approved record with a lease and uses only the
stored envelope. At decision time, the authority records an absolute
`executeByMs` covering the claim window and maximum permitted pre-provider work.
A restart may recover an expired lease only after reconciling provider state. If
`now > executeByMs` and reconciliation proves the provider boundary was not
crossed, transition to `approval_stale`; if provider acceptance is possible but
unproven, transition to `execution_unknown`. Never start a provider call after
the deadline. Denial, expiry, cancellation, and stale approval can never
transition to execution.

Cancellation is available only to an owner-signed action or sidecar
administrative rollback. The model and gateway submit identity cannot cancel a
record; `quickDeny` is the sole unsigned terminal action and only denies pending
work. Cancellation from pending, approved, or approval-stale emits a terminal
sequenced lifecycle event and cannot be re-armed.

Exactly-once external effects cannot be guaranteed by local locking alone. A
provider response can be lost after acceptance. Providers with idempotency
retry using the same key. Other adapters reconcile before retry. For email, use
a stable RFC Message-ID or provider draft/message identifier and search sent
state before deciding whether retry is safe. If acceptance remains ambiguous,
enter `execution_unknown`, do not resend automatically, notify Cole, and resume
the agent with that uncertainty.

#### Decision identity and trusted review origin

Current OpenClaw local CLI/operator clients receive approvals scope by default,
and loopback Control UI clients may be auto-approved. Neither is valid for
protected-tool decisions.

The gateway-served Control UI cannot be the trusted review surface: a
gateway-writable UI bundle could display one envelope while requesting a
signature over another. The sidecar therefore serves a minimal review page and
record API from a distinct HTTPS hostname with a TLS private key unavailable to
the gateway account. Reuse Control UI components or patterns at build time, but
serve the reviewed immutable assets from the authority account. A distinct port
on the gateway hostname is insufficient because WebAuthn relying-party identity
is hostname-based.

Before enabling a protected tool:

- Cole's phone/browser is on the private tailnet or equivalent private path;
- private DNS resolves a dedicated authority hostname and its TLS identity is
  owned by the sidecar account;
- DNS records, certificate issuance, and any TLS-terminating proxy or private
  network route for the signing and download hostnames are managed by root or a
  separate administrative identity and cannot be reconfigured by the
  gateway/agent account;
- the sidecar account directly serves both hostnames using TLS keys unavailable
  to the gateway, with no gateway-controlled proxy termination;
- the gateway/agent account cannot access Tailscale LocalAPI, the `tailscaled`
  control socket, or an equivalent control plane capable of issuing hostname
  certificates or changing private routes; prefer a separate tailnet node or a
  sidecar-owned userspace network daemon if host permissions cannot prove this;
- Cole opens and bookmarks that fixed origin directly rather than trusting a
  model- or gateway-provided destination;
- a non-exportable WebAuthn credential is created on the phone, scoped to the
  exact authority hostname as RP ID, never a parent or registrable-domain suffix
  shared with gateway or download hosts, configured with
  `userVerification: "required"` for every decision, and its public key
  fingerprint is enrolled directly in the sidecar's owner configuration;
- the gateway host has no copy of the private key; and
- an end-to-end readiness test proves the phone can fetch authority-served
  assets and records, inspect, sign, and deny a fake request away from the mini.

The iMessage link is a navigation hint containing only an opaque request
identifier and optional anti-enumeration nonce. Cole verifies the bookmarked
authority hostname before deciding. The link is not a bearer approval token.
The sidecar issues a fresh decision challenge. The browser signs the request ID,
envelope digest, decision, challenge, and expiry. The WebAuthn challenge is the
cryptographic hash of those fields; the decision is not accepted as an unsigned
sibling field. On every assertion, the sidecar verifies the exact expected
`clientDataJSON.origin` and `authenticatorData.rpIdHash` for the full authority
hostname and rejects the assertion if the authenticator-data user-verification
flag is clear. Host-local gateway credentials, gateway-served UI code, sibling
hosts, and attachment-download hosts cannot invoke that credential.

New owner credentials may be enrolled only through sidecar-account or root
administrative access, never through gateway approval scope. Enroll at least two
independent credentials, such as Cole's phone and a hardware security key, so
loss of one does not permanently block approvals.

If the phone is unpaired, off-tailnet, or the authority is unreachable, the
notification states "approval unavailable" and the record remains pending until
expiry. There is no insecure fallback. Telegram may later be enrolled as a
separate off-host approver, but only if its decision callback is bound to the
same full-payload review and owner-signature rules.

#### Safe full-parameter presentation

The authority creates a signed presentation model from the canonical record and
serves immutable review assets from its own origin. The page reuses OpenClaw
Control UI patterns. Fetching any record requires a short-lived,
device-authenticated owner session and per-record authorization. The page:

- show raw arguments and resolved execution envelope side by side;
- show canonical JSON without truncation;
- render all model strings as inert text, never HTML or executable links;
- expose escaped code points for bidi controls, zero-width characters,
  newlines, and other non-printing content;
- show internationalized domains in both Unicode and punycode;
- normalize and prominently display actual recipient addresses and other
  security-sensitive destinations;
- highlight raw-versus-resolved changes and duplicate-send lineage;
- show attachment logical name, declared MIME type, size, digest, and a forced
  download link; and
- display the exact digest covered by the owner signature.

The approval action always fetches the latest record and signs its current
digest. A stale browser page, mismatched digest, expired challenge, or changed
envelope cannot approve.

Staged attachment bytes are never rendered inline on the authority/WebAuthn
origin. Downloads use a separate hostname with no approver credential, cookies,
or authority API access. After an authenticated viewer requests a download, the
authority issues an unguessable, single-use capability bound to owner, record
ID, attachment digest, and a short expiry. The download origin rate-limits and
atomically consumes that capability before serving bytes, prevents concurrent
double redemption and enumeration, suppresses token-bearing
referrers and application logs, and sets `Content-Disposition: attachment`,
`X-Content-Type-Options: nosniff`, a fixed non-negotiated `Content-Type`, and a
restrictive `Content-Security-Policy: sandbox`. An implementation may instead
use an opaque-origin sandbox only if tests prove active HTML, SVG, XHTML,
scripts, and content-sniffing cannot reach the signing origin or request a
credential. The signing page itself shows metadata and digest only.

#### Presentation and notification flow

1. The gateway validates model-facing syntax and submits the candidate to the
   authority.
2. The authority resolves and snapshots the full envelope, deduplicates, stores
   the record, and returns:

   ```json
   {
     "status": "pending_approval",
     "approvalId": "...",
     "resumable": true,
     "expiresAt": "..."
   }
   ```

3. Trusted runtime code sends a fixed iMessage containing tool, owner-safe
   summary, expiry, request ID, digest prefix, and authority-origin link hint.
4. Cole opens the bookmarked authority origin; authority-served code fetches and
   renders the authority record.
5. Approve, Deny, or Re-arm requires WebAuthn user verification and produces the
   owner-device signature consumed by the authority. `allow-always` is
   unavailable.
6. iMessage tapback deny is best-effort and fail-safe. The current persistent
   reaction target has a 24-hour TTL and 1,000-entry cap, so protected pending
   expiry defaults to 23 hours and the authority review page remains the only guaranteed
   decision path. Tapback approve is disabled.

The notification never includes full sensitive bodies or attachments. The model
cannot select its recipient, wording, link, or decision actions.
Any summary field derived from model content is rendered as inert,
strictly length-bounded text with bidi, zero-width, control, and URL-like content
removed; it is never used as the review source of truth.
An unsigned or gateway-relayed quick deny can be abused only for denial of
service, not execution; this fail-safe tradeoff is accepted and anomalous deny
rates trigger an operator alert. It reaches only the dedicated `quickDeny` RPC;
the signed `decide` RPC is never relaxed.

#### Notification options

| Option | Decision UX | New work | Fit |
|---|---|---:|---|
| iMessage plus authority page | Existing notification/tapback path; signed approve/deny on trusted page | Minimal sidecar page using existing UI patterns and owner-device signing | Recommended: Cole's current channel, no standalone native app |
| Telegram plus authority page | Native buttons and long polling | Bot enrollment and same owner-signature binding | Best alternative dedicated channel |
| Slack or Discord plus authority page | Native callbacks and rich messages | Workspace/app setup and signature binding | Strong but larger operational footprint |
| WhatsApp, Matrix, Signal, or QQ | Existing OpenClaw approval-capable channels | Account setup and signature binding | Viable, no current advantage |
| SMS, LINE, or Microsoft Teams | Existing OpenClaw channels; no verified protected-decision advantage | Account/channel setup plus authority page | Notification-only candidates |
| Self-hosted ntfy | HTTP notification actions | New adapter/service; actions still need owner signature | Useful push transport, unnecessary now |
| Pushover | Acknowledge only | New adapter plus web flow | Notification-only and inferior |
| Email | Reply parsing or links | Polling and fragile correlation | Poor primary decision channel |
| Todoist | Checkbox/comment/label overload | Webhook and semantic conventions | Ambiguous security UX; do not use |
| Local notification/Shortcuts | Local actions only; no dependable remote Messages buttons | GUI tooling or app | Does not reach Cole reliably away from mini |
| Standalone mobile/desktop app | Complete control | Highest | Unnecessary; use the sidecar-hosted web page |

iMessage can support notification and best-effort denial, but it does not supply
native third-party approve/deny buttons. Apple actionable notifications require
an app-owned notification category, and local Shortcuts/notifications do not
solve remote Mac mini approval.

#### Durable resume and reconciliation

The authority record is the resume source of truth. OpenClaw's
`session-delivery-queue` is only a transport: it can exhaust retries and
ultimately fall back to an in-memory system event.

After denial, expiry, cancellation, stale approval, execution success, failure,
integrity failure, or unknown outcome, the authority creates a self-contained
lifecycle event with its own stable ID and a monotonic sequence number within
the approval record. The gateway adapter enqueues it for the originating
session. The event includes approval ID, sequence, state, decision, tool,
result/error, root-task or current run correlation, and an instruction not to
regenerate the side effect.

Delivery is not complete when the queue callback succeeds. A trusted gateway
hook must:

1. durably append the result event ID to the target session transcript;
2. schedule the corresponding agent turn;
3. record an authority receipt when the turn consumes that event; and
4. record terminal acknowledgement after the turn completes or durably records
   its own continuation.

Until each event's consumption is acknowledged, the sidecar reconciler retains
it and re-enqueues with backoff after stalled, exhausted, or failed delivery.
Acknowledging an `approval_stale` event does not release the record, envelope, or
staged content and does not prevent a later sequenced event after re-arm. Event
ID, sequence, and transcript checks prevent duplicate or out-of-order agent
turns. If the original session no longer exists, route the complete event to the
stable owning agent session and approval inbox. Repeated agent-turn failure
becomes an operator alert, not silent loss.

Heartbeat wake may reduce latency but is never the durability mechanism. An
optional read-only `approval_status(id)` tool may expose state to the model but
cannot decide, mutate, rearm, or execute.

#### Research evidence

Primary pinned OpenClaw references:

- `docs/plugins/plugin-permission-requests.md`
- `docs/plugins/architecture.md`
- `docs/plugins/admin-http-rpc.md`
- `docs/web/control-ui.md`
- `docs/gateway/configuration-reference.md`
- `src/agents/agent-tools.before-tool-call.ts`
- `src/gateway/exec-approval-manager.ts`
- `src/gateway/method-scopes.ts`
- `src/gateway/server-methods/plugin-approval.ts`
- `src/gateway/server-methods/approval-shared.ts`
- `src/infra/plugin-approvals.ts`
- `src/plugin-state/plugin-state-store.ts`
- `src/state/openclaw-state-db.ts`
- `src/infra/session-delivery-queue-storage.ts`
- `src/infra/session-delivery-queue-recovery.ts`
- `src/infra/system-events.ts`
- `extensions/imessage/src/approval-native.ts`
- `extensions/imessage/src/approval-reactions.ts`
- `extensions/imessage/src/approval-reaction-poller.ts`
- `ui/src/ui/views/exec-approval.ts`
- `ui/src/ui/controllers/exec-approval.ts`

Relevant Puddles plans:

- Plan 014, egress approval;
- Plan 027, iMessage approval channel; and
- Plan 028, session-delivery queue for agent wake-up.

External channel documentation:

- Slack: https://docs.slack.dev/interactivity/handling-user-interaction/
- Discord: https://docs.discord.com/developers/components/reference
- Telegram: https://core.telegram.org/bots/api
- Pushover: https://pushover.net/api
- ntfy: https://docs.ntfy.sh/publish/
- Apple actionable notifications:
  https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types

### Implementation

No implementation is authorized. If Cole later approves the proposal, use
separate reviewable phases:

1. **Boundary and feasibility spike:** prove separate-OS-user isolation,
   byte-only submit RPC, distinct authority HTTPS hostname and TLS ownership,
   gateway-inaccessible DNS/certificate/proxy control, separate active-content
   download origin, authenticated read paths, gateway-tampered-asset resistance,
   off-host WebAuthn enrollment and per-call user verification, phone
   reachability, stable root-task IDs, full `before_tool_call` coverage, session
   transcript consumption receipts, sequenced stale/re-arm delivery, trusted
   time, Tailscale LocalAPI isolation, and provider
   idempotency/reconciliation.
   For Gmail, inventory the existing gateway token, OAuth client,
   source/configuration, consent instructions, registered gateway tools,
   `archive_email`/`add_label` parameter space, system-label resolution, and
   observed label usage. Derive the fixed action set and closed user-label
   allowlist from that inventory, then prove the replacement sidecar credential
   and narrow mutation path can be staged before revocation.
   Decide whether provider-neutral work belongs upstream or in public `puddles`.
2. **Authority core:** add the dedicated non-evicting schema, transactional
   state machine, dedupe/quotas, content-addressed staging, digest binding,
   owner signatures, freshness, leases, reconciliation, retention, and
   metadata-only audit behind a disabled flag.
3. **Narrow mailbox mutation and credential-cutover rehearsal:** preserve archive,
   read-state, star, importance, and configured user-label operations through
   the hard-allowlisted `mailboxMutation` RPC.
   Use a dedicated sidecar credential handle, action enum, label allowlist,
   rate limits, and audit; prove no input can select any send, draft, insert,
   trash, settings, forwarding, send-as, delegation, or arbitrary Gmail method.
   Build and rehearse this ordered cutover while approval intake and protected
   execution stay disabled: stage the sidecar credential and RPC; validate every
   inventoried triage action on safe fixtures; route routine triage through the
   sidecar and verify it; provision and verify the distinct gateway OAuth client
   with a scope set equal exactly `{gmail.readonly}`; disable old mutation tools
   and remove every other scope from gateway source, configuration, and setup
   instructions, explicitly including `mail.google.com`, `gmail.send`,
   `gmail.compose`, `gmail.modify`, `gmail.insert`,
   `gmail.addons.current.action.compose`, `gmail.settings.basic`, and
   `gmail.settings.sharing`; then revoke the old token as the final irreversible
   step. Execute the real credential cutover only at rollout step 6, after the
   later fake-approval, recovery, and test-adapter phases pass. Any failure
   before revocation aborts and leaves the prior credential and routing
   unchanged. No cutover step may remove or disable the old path before the
   replacement is proven and serving. Any sidecar failure after revocation is a
   bounded, alerted outage repaired through the tested sidecar-only recovery
   procedure; never restore mutation/send scope to the gateway.
4. **Recording tool:** connect a fake side-effect tool through the gateway
   submit adapter. Its executor records envelopes only and returns
   `pending_approval` immediately.
5. **Decision surface:** serve the minimal review UI and record API from the
   sidecar's distinct hostname, reusing OpenClaw UI patterns while keeping
   immutable assets, record data, and phone signatures in the authority trust
   domain. Add iMessage link hints and best-effort deny reactions.
6. **Durable resume:** add result event IDs, transcript append receipts,
   consumption acknowledgements, session fallback, and reconciler re-enqueue.
7. **First provider adapter:** add one credential-isolated non-production
   adapter with immutable input staging and provider-specific idempotency or
   reconciliation.
8. **Controlled enablement:** enable one owner and one tool only after the full
   lifecycle, security review, bypass audit, pairing rehearsal, and rollback
   pass.

Do not retrofit arbitrary synchronous tools by serializing live hook context.
Do not place the authority, credential, or owner decision key in a native
OpenClaw plugin.

### Validation

This proposal was checked against current local OpenClaw and Puddles source,
current repository plans, and authoritative channel documentation. Every
recorded review round in the review log was completed and every finding was
incorporated. Final independent validation found no unresolved material defects,
and the repository change is documentation-only.

A later implementation requires committed tests in the shared managed lifecycle
using recording fakes. The matrix must cover:

- separate-user file, socket, keychain, process, and network isolation;
- sidecar-owned distinct HTTPS hostname, TLS key isolation, bookmarked-origin
  behavior, gateway attempts to repoint DNS, reconfigure proxying, or reissue a
  certificate, gateway-tampered UI assets, and wrong-origin WebAuthn attempts;
- gateway/agent denial of access to Tailscale LocalAPI, `tailscaled` control
  sockets, certificate issuance, Serve/proxy configuration, and equivalent
  private-network control surfaces;
- the same DNS, certificate, TLS-key, proxy, route, and direct-sidecar-serving
  protections for every attachment-download hostname;
- proof that gateway-local CLI/operator/admin/approvals scope cannot resolve a
  protected request;
- owner-key enrollment, theft resistance, revocation, signature verification,
  required WebAuthn user verification, challenge replay, stale challenge,
  decision-field tampering outside the signed challenge, wrong-origin credential
  request, and credential rotation;
- exact authority-host RP ID registration and exact `clientDataJSON.origin` and
  `authenticatorData.rpIdHash` verification; sibling gateway/download origins
  under the same parent domain cannot request or replay an assertion;
- assertions with the WebAuthn user-verification flag clear are rejected
  server-side even when origin, RP ID hash, and signature are otherwise valid;
- all agent profiles and invocation surfaces, including subagents, native
  harnesses, MCP HTTP, direct gateway calls, browser, exec, diagnostics,
  file/log reads, and disabled-sidecar fallback;
- raw/effective parameter completeness, canonicalization stability, digest
  mismatch, schema migration, and raw-versus-resolved highlighting;
- bidi, zero-width, newline, homoglyph, IDN/punycode, HTML, and link spoofing;
- active HTML/SVG/XHTML/sniffable attachments cannot execute on the authority
  origin or request an approval credential; forced-download headers and
  separate-origin isolation remain effective;
- unauthenticated, cross-owner, stale-session, and enumerated record reads fail;
  download capabilities are scoped, unguessable, short-lived, single-use, rate
  limited, and absent from referrer and application logs;
- byte-only attachment ingestion, refusal to open caller paths, gateway-side
  traversal/symlink handling, sidecar-privileged-path attempts, staged-object
  access denial, content replacement, size mismatch, digest mismatch,
  separate-origin forced download, and cleanup;
- active duplicate reuse, retry after every terminal state, same-task duplicate
  success, explicit duplicate-send review, quotas, and notification flood
  control;
- owner-signed renewal of an expired never-executed record creates one new
  linked pending record only during terminal retention; dedupe returns the
  newest active lineage generation (including approval-stale), rejects renewal
  while any active generation exists, and unsigned/model resubmission cannot
  renew it;
- sidecar-native wall-clock caps survive forged gateway session/run identity;
  signed-denial and quick-deny cooldowns are distinct, observable, clearable,
  and do not suppress legitimately distinct requests;
- authorized approve, unauthorized host-local decision, deny, expiry,
  signed cancellation, administrative rollback cancellation, approval freshness
  lapse, owner-signed re-arm, unsolicited stale resubmission, quick-deny method
  confinement and rate limits, stale page, forged link, CSRF, simultaneous
  decisions, and `allow-always` rejection;
- pending, approved, and approval-stale cancellation each emit and deliver one
  terminal sequenced event that the agent durably consumes;
- immediate non-blocking tool return and no lingering tool promise or agent turn;
- executor crash before claim, after claim, before provider call, after provider
  acceptance, and before result persistence, including recovery before and after
  the absolute execute-by deadline;
- recovery after claim and after execute-by must not call the provider when
  reconciliation proves no prior call, and must become `execution_unknown` when
  prior acceptance is ambiguous;
- provider-idempotent retry, provider reconciliation, and
  `execution_unknown` without blind resend;
- gateway and sidecar restart in every state, expired lease recovery, concurrent
  approvals, queue contention, queue retry exhaustion, missing original session,
  transcript receipt, consumption acknowledgement, repeated agent-turn failure,
  and reconciler repair;
- acknowledged `approval_stale`, owner-signed re-arm, and later terminal outcome
  produce correctly ordered, separately acknowledged sequence events while
  retaining staged content until the truly terminal state;
- owner-signed re-arm is bound to record ID, immutable envelope digest, and a
  one-time challenge;
- iMessage target TTL/cap behavior, unavailable channel, unpaired phone,
  off-tailnet phone, expired deep link, and no insecure fallback;
- notification summaries strip or neutralize bidi, zero-width, controls, and
  URL-like model content and remain strictly bounded;
- proof denial, expiry, stale approval, integrity failure, and capacity failure
  never call the provider;
- proof execution uses the stored envelope and protected bytes exactly;
- the prior gateway Gmail token is revoked; `tokeninfo` confirms its replacement
  scope set equals exactly `{gmail.readonly}` and fails on any additional scope;
  gateway source/configuration and normal consent flow request only that
  allowlist; and only distinct sidecar OAuth clients and identity can access
  mutation/send capability;
- using a dedicated test account and non-deliverable fixtures, direct
  `users.messages.send` and `users.drafts.send` attempts with the gateway
  credential fail with `403 insufficient scope` before any external mutation;
- using the same safe test-account method,
  `users.settings.updateVacation`, `users.settings.filters.create`,
  `users.settings.updateAutoForwarding`, forwarding-address creation, send-as,
  and delegation attempts with the gateway credential fail for insufficient
  scope;
- `mailboxMutation` accepts only its fixed actions and configured label IDs,
  dispatches only to approved modify endpoints, rate-limits and audits calls,
  and rejects method-name injection, raw bodies, extra fields, send/draft/insert/
  import/trash/settings/forwarding/send-as/delegation requests, and unknown
  labels without reaching Gmail;
- `mailboxMutation` rejects `applyConfiguredLabel` or
  `removeConfiguredLabel` for `TRASH`, `SPAM`, `INBOX`, `UNREAD`, `STARRED`,
  `IMPORTANT`, `CATEGORY_*`, every other system label, unknown labels, and
  arbitrary labels; only dedicated fixed actions may touch
  `INBOX`/`UNREAD`/`STARRED`/`IMPORTANT`, no fixed action touches any other
  system label, and only explicitly configured user-created label IDs reach
  Gmail;
- fixed archive, read-state, star, and importance actions change only their
  named reversible labels and preserve every inventoried routine triage
  behavior;
- phase-one inventory covers the registered Gmail tool surface, parameter
  space, system-label resolution, and observed label use; replacement
  acceptance is measured against that inventory;
- cutover ordering proves the sidecar replacement and exact-read-only gateway
  credential before the old token can be revoked; a pre-revocation failure
  leaves the prior credential and routing unchanged; old-token revocation is the
  final irreversible step; and a post-revocation fault has a tested sidecar-only
  fix-forward path;
- fault injection at every cutover boundary proves no cutover step disables the
  old path before the replacement is proven and serving, a pre-revocation abort
  restores the old path, post-revocation sidecar failure raises an alert and
  follows the tested bounded fix-forward recovery procedure, and
  approval-feature rollback leaves `mailboxMutation` and its credential
  available;
- retention expiry, metadata-only audit, payload purge, backup behavior, and
  rollback with pending and executing records; and
- backward wall-clock jumps, restart, and clock skew cannot extend or revive
  pending expiry, execution deadline, WebAuthn challenge, cooldown, or download
  capability;
- a large forward clock jump fails closed, raises an operator alert, and has a
  documented sidecar-admin recovery procedure that cannot revive expired work;
- simultaneous redemption of one download capability yields exactly one
  successful response;
- the full repository-managed integration pool, with no live message delivery
  or external mutation.

### Rollout and rollback

No rollout occurs in this task.

Future rollout order:

1. approval intake, protected-tool execution, and the production sidecar
   disabled by default;
2. separate test OS identity, fake credential, recording executor, and
   pre-enrolled test browser key in the managed environment;
3. fake approvals through the authority-served review page and iMessage
   recording adapters;
4. restart, spoofing, flood, isolation, ambiguous-result, retention, and
   rollback exercises;
5. one test-only provider adapter with non-production credentials;
6. deploy the production sidecar for `mailboxMutation` only, complete the
   ordered Gmail triage and credential cutover rehearsed in implementation
   phase 3, after rollout steps 2-5 have passed, and keep approval intake and
   protected execution disabled;
7. phone pairing and away-from-mini readiness rehearsal, including one
   attachment-bearing request reviewed through the separate download origin;
8. one low-volume real protected tool for Cole, with the old gateway token
   already revoked, the replacement gateway token restricted exactly to
   `{gmail.readonly}`, routine triage operating through only the narrow sidecar
   RPC, and all autonomous alternate send paths removed;
9. broader registration only after observed stability.

Operational readiness requires durable counters for records by state, oldest
pending age, dedupe hits, quota rejections, notification failures, stale
approvals, expired leases, integrity failures, ambiguous execution, resume
delivery/consumption failures, quick-deny rates, and reconciler repairs.
Alert on anomalous deny rates and approval-stale rates.

Approval-feature rollback disables new approval submissions and executor
claims, removes the protected tool from every agent profile, rejects new
decisions, cancels pending and approved-but-unclaimed and approval-stale
records, emits their cancellation events, lets already executing work reconcile
rather than retry blindly, preserves records through the retention window,
purges staged content on schedule, and restores the prior disabled approval
configuration. It does not disable `mailboxMutation`, its sidecar credential, or
routine triage.

`mailboxMutation` has a separate rollback runbook. Before old-token revocation,
cutover abort restores unchanged prior routing and credentials. After
revocation, faults trigger an operator alert and the tested bounded
sidecar-only fix-forward procedure unless another narrow, non-send-capable
triage path has already been proven. Neither rollback exposes the original
direct side-effecting tool, restores mutation/send scope to the gateway, or
transfers a protected credential to the gateway account.

### Review log

- 2026-07-30: Created the required two-part design before product research.
- 2026-07-30: Researched current OpenClaw approval, iMessage, Control UI,
  persistence, and resume facilities plus external channel options.
- 2026-07-30: Recommended iMessage notification plus an existing-Control-UI
  review surface and a durable deferred-job lifecycle.
- 2026-07-30: Independent adversarial review found three blocking issues:
  in-process credential isolation was impossible, host-local operator scope
  could self-approve, and request flooding could mint independent side effects.
  It also found seven durability, staging, reachability, staleness, rendering,
  and reaction-lifetime gaps. All findings were accepted and remediated in the
  full design.
- 2026-07-30: Fresh independent recheck found three remaining trust-boundary
  issues in the gateway-served review UI, authority database ownership, and
  staged-input ingestion, plus four channel, deduplication, evidence, and
  rollback accuracy issues. All were accepted and remediated. Final clean
  recheck followed.
- 2026-07-30: Final clean-room review found an active-attachment same-origin
  signing bypass plus WebCrypto user-presence, stale re-arm, and quick-deny RPC
  gaps. All were accepted and remediated.
- 2026-07-30: Terminal review found an executing-record freshness bypass,
  gateway-reconfigurable authority routing, and unauthenticated record/download
  reads. All were accepted and remediated with an absolute execution deadline,
  separately administered hostname infrastructure, authenticated views, and
  single-use download capabilities. Final clean recheck is pending.
- 2026-07-30: Clean audit found that attachment-download routing lacked the
  signing origin's administrative isolation and that stale events conflicted
  with re-arm and retention. It also identified guarantee-scoping and recovery
  hardening opportunities. All were incorporated across trust, event,
  retention, notification, time, cooldown, and validation design. Terminal
  verification followed.
- 2026-07-30: Terminal verification found no blocking defects. It identified
  exact WebAuthn RP/origin verification and cancellation resume delivery as
  non-blocking omissions. Both were remediated, along with concrete Tailscale,
  forward-clock, re-arm-signature, and attachment-rehearsal validation.
- 2026-07-30: Final verification found no blocking defects. It identified
  server-side WebAuthn UV enforcement, the concrete existing Gmail credential
  split, review-status wording, and expired-request renewal as final
  non-blocking gaps. All were incorporated. Final confirmation is pending.
- 2026-07-30: Final confirmation found no blocking defects. It identified
  expired-renewal retention/dedupe ambiguity and incomplete Gmail OAuth-client
  separation. Both were remediated with a bounded renewal lineage and distinct
  gateway/sidecar OAuth configuration. Closeout confirmation is pending.
- 2026-07-30: Closeout confirmation found that `gmail.modify` still authorizes
  send and that approval-stale was missing from active lineage rules. The Gmail
  gateway is now limited to scopes that cannot send, all message mutation moves
  behind the sidecar or is removed, and approval-stale is active for dedupe and
  uniqueness. Final audit is pending.
- 2026-07-30: Final audit found the gateway scope design still left routine
  mailbox mutation undefined and omitted Gmail settings-based outbound paths.
  The gateway token is now exactly `gmail.readonly`; routine triage uses a
  hard-allowlisted, audited sidecar RPC that cannot express send; and all extra
  Gmail scopes fail closed. Clean closeout is pending.
- 2026-07-30: Clean closeout found a destructive system-label bypass in the
  narrow mailbox RPC, an overbroad compromised-gateway invariant, and stale
  review-count evidence. Label actions now accept configured user labels only,
  the invariant explicitly excludes the bounded reversible triage RPC, and
  validation follows the complete review log. Final confirmation is pending.
- 2026-07-30: Closeout confirmation found no blocking defects and one
  rollout-order ambiguity: revoking `gmail.modify` before the narrow
  replacement existed would temporarily break routine triage. The replacement
  is now proven and routed before old-token revocation. Final confirmation
  followed.
- 2026-07-30: Final confirmation found that the replacement omitted current
  star/importance triage and that its cutover, rollout, rollback, and abort
  semantics were incomplete. Dedicated reversible star/importance actions now
  preserve compatibility; phase-one inventory defines the acceptance baseline;
  the old token is revoked only after the replacement is live and proven; and
  approval rollback leaves narrow triage running. Clean confirmation is
  pending.
- 2026-07-30: Clean confirmation found no blocking defects and one impossible
  absolute availability invariant after irreversible token revocation. The
  guarantee now covers safe cutover ordering; post-revocation sidecar failure
  is an alerted, bounded, tested fix-forward outage. Phase 3 rehearses the
  cutover and rollout step 6 executes it after prerequisite exercises. Final
  validation is pending.
- 2026-07-30: Final validation found no unresolved material defects. It confirmed
  safe Gmail cutover ordering, bounded alerted fix-forward recovery, separate
  approval rollback, fixed reversible triage actions, user-label-only generic
  actions, and proposal-only scope. The proposal is ready for review.
- 2026-07-30: Independent public-relocation review found no actionable findings.
  It verified documentation-only scope, required plan structure, preservation
  of the completed source design, public issue metadata, whitespace, and the
  absence of private or stale tracking references.
- 2026-07-30: Terminal publication review found that `State` duplicated the
  review chronology instead of describing only the current proposal. The state
  was condensed without removing design decisions or the complete review log.
- 2026-07-30: Fresh complete-diff recheck confirmed the state correction and
  found no remaining actionable issues.
- 2026-07-30: Recorded confirmation that the tracking migration is complete.
  Todoist now points to public issue 68 and remains open for review; superseded
  non-public issue and pull-request tracking are closed and their remote review
  branch is deleted.
- 2026-07-30: Independent tracking-closeout review found that the review-log and
  checklist wording implied this documentation worker performed the external
  tracking mutations. The wording now records the coordinating confirmation
  without claiming those mutations; a fresh complete-diff recheck found no
  actionable issues.

### Checklist

- [x] Create public issue 68 with the required minimal ledger shape.
- [x] Record confirmation that Todoist tracking and review-result comments point
      to public issue 68, the task remains open with `ready_for_review`, and
      superseded non-public tracking is retired.
- [x] Create the plan before product research.
- [x] Research current OpenClaw and repository-native facilities.
- [x] Compare notification and decision channels, including iMessage.
- [x] Finalize the recommended architecture and alternatives.
- [x] Define implementation, validation, rollout, and rollback guidance.
- [x] Complete initial independent design review and remediate all findings.
- [x] Complete fresh independent recheck and remediate all findings.
- [x] Complete final independent recheck and remediate all findings.
- [x] Complete clean independent recheck and remediate all findings.
- [x] Complete final clean independent recheck and remediate all findings.
- [x] Complete terminal verification and remediate all findings.
- [x] Complete final verification and remediate all findings.
- [x] Confirm the latest corrections and remediate all findings.
- [x] Complete closeout confirmation and remediate all findings.
- [x] Complete final audit and remediate all findings.
- [x] Complete clean closeout and remediate all findings.
- [x] Complete final confirmation with no unresolved material findings.
- [x] Confirm the final diff is proposal-only.
- [x] Confirm the public diff is documentation-only and publication-safe.
- [x] Complete independent review of the public diff.
- [x] Complete tracking-closeout review and correct external-mutation ownership.
- [x] Update issue 68 to Ready for review.
