# Asynchronous tool approvals

**Status:** Ready for review
**Issue:** [#68](https://github.com/coletaylor788/puddles/issues/68)
**Last updated:** 2026-07-30
**Owner:** Cole

## Human section

### Design

Some tool calls can cause serious or irreversible effects. Sending email is the
first example. The agent should be able to prepare such a request, but it should
not be able to carry it out until Cole has seen the exact action and approved it.
The approval boundary must still hold if a prompt is malicious, the model picks
another tool, or a local operator client has broad gateway access.

OpenClaw's current approval feature does not provide that boundary. It waits
inside the active tool call, keeps pending state in memory, and expires quickly.
It shows plugin-written text rather than both the original request and the final
values that will execute. It can also treat a timeout as approval, and local
clients may already have approval rights. Native plugins run inside the gateway
process, so they cannot safely hold a credential that the gateway must never
use.

The recommendation is a durable approval service that runs separately from the
gateway. It owns the protected credential, approval records, staged attachments,
and execution worker. The gateway can submit a request, but it cannot read or
change the protected record, approve it, or execute it. The agent also loses
every alternate route to the protected effect, including direct credentials,
raw provider access, and unrestricted tools that could reach those resources.

When the agent calls a protected tool, the gateway sends the request to the
approval service. The service resolves defaults, snapshots attachments, and
creates an immutable description of exactly what would run. It returns
"pending approval" immediately, so the tool call and agent turn do not stay open
while Cole decides.

iMessage is the notification channel, not the approval authority. A fixed,
trusted sender tells Cole that a request is waiting and provides a navigation
hint. The model cannot choose the recipient, wording, link, or available
actions. A tapback may offer a quick deny because a forged denial can only stop
work. A tapback can never approve.

Cole reviews the request on a small approval page served by the separate
approval service. The page shows both the model's original arguments and every
resolved value, including recipients, headers, options, and attachment hashes.
Cole uses a previously enrolled device credential and must verify each decision.
The signature covers the request, the final values, the decision, and a fresh
challenge. Approval is always for one request. There is no permanent
"always allow" option.

The approval page uses its own fixed HTTPS hostname. The gateway cannot control
that hostname, its certificate, or its web content. Attachments are never opened
inside the approval page. They can only be downloaded from a second hostname
that has no access to the approval credential. This separation prevents a
malicious attachment or gateway-controlled page from asking for a valid
approval signature.

If Cole approves, the service executes only the stored values and rechecks every
staged attachment first. If Cole denies, the request can never execute. Missing,
expired, duplicated, changed, or invalid decisions all fail closed. An approval
also has a short execution window, so a service restart days later cannot revive
old authority.

The approval service keeps the final result until OpenClaw records it in the
right conversation and the resumed agent turn confirms that it consumed the
event. A repair loop retries interrupted delivery after restarts. The model does
not poll for decisions, and OpenClaw's delivery queue is only transport, not the
source of truth.

This design reuses OpenClaw's tool hooks, iMessage support, interface patterns,
and session delivery. It avoids a new mobile or desktop app. The tradeoff is one
small protected web service and stricter local identity and network setup.
Telegram is the best alternative notification channel if a dedicated approval
channel becomes desirable. Other chat and push services add more setup without
improving the approval boundary.

Email requires one additional cutover. The gateway's Gmail access must become
read-only because several broader scopes can send or redirect mail. Routine
archive, read-state, star, importance, and approved user-label actions move to a
separate narrow service that cannot express sending, drafting, deletion,
forwarding, delegation, or arbitrary provider calls. That replacement must be
working before the old credential is revoked. After revocation, recovery stays
inside the protected service and never restores send-capable gateway access.

### Status

This is a design-only proposal. It changes no runtime, credential,
configuration, notification, or external service. The readability revision is
complete, and the proposal is ready for Cole to review. Implementation remains
blocked until Cole explicitly approves it.

## Agent section

### Current state

The design is complete and provider-neutral. It covers the trust boundary,
request lifecycle, review identity, durable resume, email credential split,
validation, rollout, and rollback. All accepted independent review findings are
incorporated.

Public tracking is on issue 68. External task tracking points to that issue and
remains open for review. Superseded non-public tracking is retired. This plan
does not implement or deploy any part of the design.

### Scope

The proposed implementation includes:

- a registry of serializable tools that require deferred approval;
- a separate-identity approval authority and executor;
- a dedicated transactional database and immutable staging store;
- a review page served by the authority on a dedicated HTTPS hostname;
- a separate attachment-download hostname;
- exact display of raw arguments and resolved execution values;
- one-time signed approve, deny, re-arm, renewal, and cancellation actions;
- iMessage notification and best-effort quick deny;
- request deduplication, quotas, expiry, execution freshness, reconciliation,
  audit, retention, durable resume, and rollback; and
- a narrow mailbox-triage service needed to remove send-capable Gmail access
  from the gateway.

This proposal does not include:

- implementation, deployment, credential changes, notifications, or test sends;
- a new mobile or desktop application;
- gateway-local operator, admin, or approval rights as decision authority;
- model-written approval messages or model polling as a source of truth;
- permanent approval for protected effects;
- approval as an override for secret or content policy; or
- generic replay of arbitrary tools that depend on live closures, streams,
  browser state, or other non-serializable context.

### Acceptance criteria

A future implementation is acceptable only when it:

1. Keeps protected credentials, records, staged data, decisions, and execution
   under a separate OS identity.
2. Removes every alternate protected path from the agent and gateway, including
   direct credentials, raw APIs, unrestricted network clients, browser
   automation, shell access, and compatibility fallbacks.
3. Allows unapproved mailbox triage only through fixed reversible archive,
   read-state, star, importance, and configured user-label actions.
4. Rejects host-local OpenClaw operator, admin, or approval rights as authority
   for a protected decision.
5. Serves review data and immutable web assets from an authority-owned hostname
   whose DNS, certificate, TLS key, proxy, and route cannot be changed by the
   gateway account.
6. Applies the same administrative separation to every attachment-download
   hostname.
7. Shows raw model arguments beside the complete versioned execution envelope,
   including resolved defaults, destinations, headers, options, and attachment
   hashes.
8. Binds every signed decision to the record, envelope digest, decision, owner,
   expiry, and one-time challenge.
9. Requires WebAuthn user verification and exact origin and relying-party
   identity checks for every signed action.
10. Returns from the original tool call immediately with a durable pending
    result.
11. Permits only one signed approval or denial, with all timeout and failure
    cases defaulting to no execution.
12. Deduplicates repeated requests when a stable trusted root-task identity is
    available and always enforces owner, session, tool, submitter, and global
    quotas.
13. Accepts attachment bytes, never privileged reads of caller-supplied paths.
14. Executes only the stored envelope, rechecks staged bytes immediately before
    the provider call, and respects an absolute execution deadline across
    recovery.
15. Uses provider idempotency or reconciliation to prevent duplicates and enters
    an explicit unknown state rather than retrying an ambiguous effect.
16. Keeps each lifecycle event until transcript receipt and trusted agent
    consumption are durable.
17. Survives restart, duplicate delivery, stale links, unavailable channels,
    interrupted execution, contention, and exhausted delivery retries.
18. Keeps full approval bodies and attachments on the protected local service,
    not in third-party notification channels.
19. Never executes model-controlled attachment content on the approval origin.
20. Requires an authenticated owner-device session to read a record and a
    short-lived single-use capability to download an attachment.
21. Uses nondecreasing authority-controlled time so clock rollback cannot extend
    an expiry, challenge, cooldown, execution window, or download capability.
22. Keeps secret and content policy non-overridable even after approval.

### Threat model and trust boundary

The protected boundary assumes malicious model output, prompt injection,
repeated and varied requests, malformed payloads, stale decisions, gateway
restart, and access to every tool exposed in the agent profile. It does not
claim safety after root compromise or arbitrary code execution as the approval
service's OS user.

Trusted OpenClaw run, session, and tool-call identifiers are trusted against
model manipulation. They are not trusted after gateway-account compromise. The
authority therefore enforces its own owner, submitter, global, and wall-clock
caps. Even with a compromised gateway account, an approval-gated effect still
requires an owner signature over the authority's own immutable envelope.

The narrow mailbox-triage service is the one bounded exception. It allows only
reversible archive, read-state, star, importance, and configured user-label
changes. It has independent limits, audit, and anomaly alerts. It cannot send or
create another outbound path.

Native OpenClaw plugins run in the gateway process and are not a security
boundary. The approval credential, record store, owner keys, and executor must
not live in a normal native plugin.

### Components

| Component | Responsibility |
|---|---|
| Gateway request adapter | Validates model-facing input, uploads bounded bytes, submits a candidate, and returns pending status. It has no decision or execution credential. |
| Approval authority and executor | Runs as a separate OS user and owns records, staging, owner public keys, protected credentials, decisions, leases, execution, reconciliation, and audit. |
| Authority review page | Serves immutable assets and authoritative records from a dedicated HTTPS hostname and requests owner-device signatures. |
| Attachment download service | Serves forced downloads from a separate hostname after consuming a narrow single-use capability. |
| Notification adapter | Sends a fixed iMessage hint and accepts only a rate-limited quick deny. |
| Resume adapter | Delivers sequenced result events to OpenClaw and reports transcript and consumption receipts. |

The authority exposes a narrow authenticated local protocol:

- `submit` accepts a validated candidate and uploaded attachment streams. It can
  create a pending record but cannot execute it.
- `mailboxMutation` accepts only fixed reversible mailbox actions and bounded
  message or thread identifiers.
- `get` returns one record only to an authenticated owner-device session.
- `decide` accepts an owner-signed decision and consumes a one-time challenge.
- `quickDeny` can only move a pending record to denied. It cannot approve,
  re-arm, change an envelope, or execute.
- `status` is read-only and privacy-scoped.
- There is no public execution operation. Only the authority's internal worker
  can claim approved work.

The authority database, socket, staging store, credential, and signing material
are unreadable and unwritable by the gateway account. The provider credential
uses an identity-bound keychain or equivalent ACL. The gateway holds only a
submit credential.

The gateway account must not control private DNS, certificate issuance, TLS
termination, private routes, or network-control sockets for either review
hostname. If host permissions cannot prove that separation, deployment must use
a separate private-network node or a network daemon owned by the authority.

### Protected-tool contract and immutable inputs

Only registered deferred executors are eligible. Each executor defines:

- JSON Schema and semantic validation;
- canonicalization and resolution of defaults, aliases, and dynamic inputs;
- immutable snapshot rules;
- a deterministic safe review renderer;
- execution with an idempotency key;
- reconciliation for ambiguous provider outcomes; and
- a durable result codec.

The gateway opens candidate files with its lower privileges, rejects traversal
and symlink escapes under the tool's file policy, and uploads bounded byte
streams with logical metadata. The authority never opens a caller-provided
path. Each staged object records a digest, size, MIME type, and logical name.
Immediately before an effect, the executor reads the protected copy again and
rechecks its digest and size. A mismatch ends in `input_integrity_failed`.

For email, the immutable envelope includes the account, operation, resolved
`to`, `cc`, and `bcc` addresses, reply and thread identifiers, subject, body,
format, headers, scheduling and send options, stable message identity, and every
attachment reference. The review page shows the original arguments, resolved
envelope, attachment metadata, hashes, and forced-download links.

### Record store, privacy, and time

Authoritative records live in a sidecar-owned transactional SQLite database.
The bounded plugin state store is suitable only for short-lived channel hints
because it may evict old entries.

Each record contains:

- opaque record, schema, tool, owner, agent, session, run, turn, and tool-call
  identifiers;
- creation, pending expiry, approval freshness, execution, and retention times;
- canonical raw arguments and the versioned execution envelope;
- envelope and staged-object hashes;
- deduplication key and renewal lineage;
- notification attempts and delivered message references;
- decision challenge, signature, owner-key fingerprint, and decision time;
- execution lease, idempotency key, absolute execute-by time, attempt state,
  result, error, and reconciliation evidence; and
- monotonic event sequence, stable event IDs, delivery attempts, transcript
  receipts, consumption receipts, and final acknowledgement.

Identity used for quotas and correlation comes from trusted runtime context, not
model arguments. Payloads and staged data use owner-only permissions on an
encrypted local volume. Audit records contain identifiers, hashes, states,
timings, and actor fingerprints, not message bodies or attachment bytes.

Pending expiry moves payloads into a seven-day terminal retention window.
`approval_stale` keeps its envelope and staged bytes through its re-arm window.
After retention, payloads are purged and only metadata audit remains.

All deadlines use a nondecreasing authority clock made from monotonic process
time and a persisted wall-clock high-water mark. Backward clock movement cannot
extend authority. A large forward jump fails closed, alerts the operator, and
requires an administrative recovery that cannot revive expired work.

### Deduplication and pressure controls

The model never supplies an idempotency or intent key. Current trusted run and
session identities do not survive every logical retry. A stable trusted
root-task identity is therefore a prerequisite for cross-run deduplication.

With that identity, the authority computes a key from owner, root task, tool,
and envelope digest in one transaction:

- a matching active record returns the existing record;
- a matching success in the same task returns `already_executed`;
- a matching denied, expired, cancelled, stale, failed, or unknown record
  returns that state; and
- another identical effect requires a new trusted task or an explicit signed
  duplicate review that shows the previous result.

An expired record remains immutable. During the seven-day retention window,
Cole can sign a renewal bound to that record and digest. Renewal creates one new
linked pending record. It is unavailable after payload purge, and model
resubmission cannot renew anything.

Only one generation in a renewal lineage may be active. Pending, approved,
`approval_stale`, and executing records all count as active. Lookup returns the
newest active descendant before any terminal ancestor.

Per-owner, per-session, per-tool, per-submitter, and global caps fail closed.
Notification limits and wall-clock request limits do not depend on
gateway-supplied identity. These controls, not hash deduplication, are the main
defense against varied payload floods.

A signed denial starts an owner-and-tool cooldown. Near-duplicate requests are
suppressed or held without repeated notifications. Cole can inspect and clear
the cooldown from the signed page. Quick deny uses a shorter, separately limited
cooldown and is clearly distinguished in audit and alerts.

### Decision and execution lifecycle

The authority uses these transactional states:

```text
pending -> denied | expired | cancelled | approved
approved -> cancelled | approval_stale | executing
approval_stale -> pending | cancelled | expired
executing -> executing | approval_stale | succeeded | failed
executing -> input_integrity_failed | execution_unknown
```

Only the first valid decision wins. Decision processing verifies the
owner-device signature, one-time challenge, pending expiry, current record, and
displayed digest.

Pending requests expire after 23 hours by default, or sooner for a tool.
Approval creates a five-minute claim window and an absolute execute-by time. If
work is not safely claimed in time, it becomes `approval_stale`. It never
executes after delayed recovery.

Entering `approval_stale` starts a re-arm window of at most 23 hours. Cole may
sign a re-arm action during that window. Re-arm uses the same immutable record,
a new challenge, a new pending window of at most 23 hours, and a new
best-effort notification target. Model resubmission cannot re-arm it. If the
re-arm window ends, the record expires.

The executor atomically claims approved work with a lease. Restart recovery must
first reconcile provider state. If the execute-by time has passed and no
provider call occurred, the record becomes stale. If prior acceptance cannot be
proved or disproved, it becomes `execution_unknown`. The executor never starts
a provider call after the deadline.

Only an owner-signed action or administrative rollback can cancel pending,
approved, or stale work. Cancellation emits a durable terminal event and cannot
be re-armed. The gateway and model cannot cancel. Quick deny is the only
unsigned terminal action and applies only to pending work.

Local locking cannot guarantee exactly-once external effects. Providers with an
idempotency facility reuse one key. Other adapters reconcile before retry. An
email adapter uses stable provider or message identity and searches sent state.
Ambiguous acceptance never causes blind resend.

### Trusted review and decision identity

Gateway-local clients and loopback interfaces may already receive broad
approval rights. They are not valid identities for protected decisions.

The review page must not be served by the gateway. A gateway-controlled page
could display one request while asking for a signature over another. The
authority serves minimal reviewed assets and record data from a distinct HTTPS
hostname with a TLS key unavailable to the gateway. A different port on the
gateway hostname is not enough because WebAuthn identity is hostname-based.

Before enablement:

- the owner's phone or browser reaches the authority over a private path;
- root or another administrative identity controls DNS, certificates, proxying,
  and routes for both review hostnames;
- the authority serves both hostnames directly with protected TLS keys;
- the gateway cannot access the network-control plane that could issue
  certificates or change routes;
- Cole opens and bookmarks the fixed authority origin directly;
- a non-exportable WebAuthn credential is created off-host for the exact
  authority hostname with user verification required;
- its public key fingerprint is enrolled directly in authority configuration;
- at least two independent owner credentials are enrolled for recovery; and
- an end-to-end readiness test proves remote review, signing, and denial of a
  fake request.

The iMessage link contains only an opaque record identifier and optional
anti-enumeration value. It is not an approval token. The authority issues a
fresh challenge. The browser signs the record ID, envelope digest, decision,
challenge, and expiry. The server verifies the exact origin, relying-party hash,
signature, and user-verification flag.

New owner credentials require authority-account or root administration.
Gateway approval rights can never enroll them. If the device is unpaired,
off-network, or cannot reach the authority, the notification says approval is
unavailable and the record remains pending until expiry. There is no weaker
fallback.

### Safe presentation and attachments

Fetching a record requires a short-lived authenticated owner session and
per-record authorization. The authority builds the presentation from its
canonical record. The page:

- shows original and resolved values side by side;
- shows canonical JSON without truncation;
- renders model strings as inert text, never HTML or active links;
- exposes bidirectional, zero-width, newline, and other hidden code points;
- shows internationalized domains in Unicode and punycode;
- normalizes and highlights actual security-sensitive destinations;
- highlights original-to-resolved changes and duplicate lineage;
- shows attachment name, declared type, size, and digest; and
- displays the exact digest covered by the owner signature.

The page always fetches the current record before signing. A stale page,
mismatched digest, expired challenge, or changed envelope cannot approve.

Attachment bytes never render on the WebAuthn origin. After authenticated
request, the authority issues an unguessable short-lived capability bound to
owner, record, attachment digest, and one download. The download service
atomically consumes it, blocks concurrent reuse and enumeration, omits tokens
from referrers and logs, carries no approval cookies, and has no authority API
access. It forces download with a fixed non-negotiated content type, no sniffing,
and a restrictive sandbox policy. Any alternative sandbox must prove that
active HTML, SVG, XHTML, scripts, and content sniffing cannot reach the signing
origin or request a credential.

### Notification flow

1. The gateway validates input and submits a candidate.
2. The authority resolves values, snapshots inputs, deduplicates, stores the
   record, and returns pending status.
3. Trusted runtime code sends a fixed iMessage with tool name, a safe bounded
   summary, expiry, opaque record ID, digest prefix, and navigation hint.
4. Cole opens the bookmarked authority origin and reviews the authoritative
   record.
5. Approve, deny, re-arm, renewal, and cancellation require a signed
   owner-device action.
6. An iMessage tapback may call only quick deny. Tapback approval is disabled.
7. The authority executes approved work or records a terminal no-execution
   result.
8. The authority delivers a sequenced event until OpenClaw records and consumes
   it.

The notification excludes full bodies and attachments. The model cannot choose
the route, wording, link, or decision actions. Any model-derived summary is
short, inert text with control characters and URL-like content removed.

The current persistent iMessage reaction target lasts 24 hours and has a
1,000-entry cap. The default pending window is therefore 23 hours. The signed
review page remains the only guaranteed decision path. Quick deny accepts a
denial-of-service risk in exchange for fail-safe behavior; anomalous rates
alert the operator.

### Channel alternatives

| Option | Assessment |
|---|---|
| iMessage plus authority page | Recommended. It reuses the current channel, supports a safe quick deny, and requires no new app. |
| Telegram plus authority page | Best dedicated-channel alternative. Native buttons help navigation, but signed review remains required. |
| Slack or Discord plus authority page | Strong callback support, but larger workspace and application overhead. |
| WhatsApp, Matrix, Signal, or QQ | Viable OpenClaw channels with no present advantage. |
| SMS, LINE, or Microsoft Teams | Reasonable notification channels, but no verified protected-decision advantage. |
| Self-hosted ntfy | Useful push transport, but still needs the signed authority page. |
| Pushover | Acknowledgement-oriented and weaker than the recommended flow. |
| Email | Fragile correlation and a poor primary channel for approving email. |
| Todoist | Ambiguous approval semantics and unsuitable security UX. |
| Local notifications or Shortcuts | Do not provide dependable remote approval from the Mac mini. |
| New mobile or desktop app | Maximum control at the highest implementation and maintenance cost. Not justified. |

Apple actionable notification buttons require an app-owned notification
category. iMessage alone cannot provide a trustworthy third-party approve
button. This is why the web review surface remains necessary.

### Durable resume and reconciliation

The authority record is the resume source of truth. OpenClaw session delivery is
transport only because its retries can exhaust and its final fallback may be
memory-only.

Every denial, expiry, cancellation, stale approval, success, failure, integrity
failure, or unknown outcome creates a self-contained event with a stable ID and
monotonic sequence. It includes record ID, state, decision, tool, result or
error, task or run correlation, and an instruction not to regenerate the effect.

Delivery is complete only after trusted runtime code:

1. durably appends the event ID to the target transcript;
2. schedules the correct agent turn;
3. sends the authority a receipt when that turn consumes the event; and
4. records final acknowledgement after the turn completes or durably saves its
   continuation.

Until consumption is acknowledged, the authority retains and re-enqueues the
event with backoff. Acknowledging `approval_stale` does not release its record
or block a later event after re-arm. Stable IDs, sequence checks, and transcript
receipts prevent duplicate or out-of-order turns.

If the original session is gone, delivery falls back to the stable owning-agent
session and approval inbox. Repeated turn failure alerts the operator. Heartbeat
wake may reduce latency but is not a durability mechanism. An optional
read-only status tool may show state but cannot decide, mutate, re-arm, or
execute.

### Gmail credential and mailbox-triage boundary

The gateway Gmail credential and OAuth client must have exactly
`gmail.readonly`. Any additional scope fails closed. Forbidden scopes include
full mail access, send, compose, modify, insert, add-on compose, settings, and
sharing scopes. Settings access is forbidden because vacation replies,
forwarding, send-as, and delegation can create outbound or exfiltration paths.

The sidecar uses a different OAuth client and refresh token. Only it may hold a
mutation or send-capable credential. Minting that credential requires
interactive owner consent and never occurs through the gateway.

Routine triage uses `mailboxMutation` with this fixed action set:

- archive by removing only `INBOX`;
- mark read or unread by changing only `UNREAD`;
- star or unstar by changing only `STARRED`;
- mark important or not important by changing only `IMPORTANT`; and
- apply or remove only configured user-created labels.

Generic label actions reject `INBOX`, `UNREAD`, `STARRED`, `IMPORTANT`,
`TRASH`, `SPAM`, every `CATEGORY_*` label, every other system label, unknown
labels, and any label that changes deletion or delivery state. No fixed action
exists for trash, spam, category changes, send, draft, insert, import, settings,
forwarding, send-as, delegation, or an arbitrary provider method.

The RPC accepts only its fixed enum, bounded message or thread IDs, and a closed
user-label allowlist. It dispatches only to approved message, thread, or batch
modify operations. It rejects raw request bodies, method names, extra fields,
and unknown labels before contacting Gmail. It has independent limits, audit,
and alerts.

### Implementation phases

No implementation is authorized. If Cole approves this design, use separate
reviewable phases.

1. **Boundary and feasibility.** Prove separate-user isolation, byte-only
   submission, authority-owned HTTPS identities, gateway-inaccessible network
   control, safe attachment downloads, authenticated reads, tamper-resistant
   review assets, off-host WebAuthn, phone reachability, stable root-task
   identity, complete tool interception, transcript consumption receipts,
   trusted time, and provider reconciliation. Inventory the current Gmail
   credential, OAuth client, consent flow, registered tools, triage parameter
   space, system-label handling, and observed label use.
2. **Authority core.** Add the non-evicting schema, state machine, quotas,
   deduplication, immutable staging, digest binding, owner signatures,
   freshness, leases, reconciliation, retention, and metadata-only audit behind
   a disabled flag.
3. **Mailbox triage and cutover rehearsal.** Build the fixed triage service with
   a distinct credential, action enum, label allowlist, limits, and audit. Prove
   that no input can select sending or another forbidden action. Rehearse the
   entire credential cutover while protected approval remains disabled.
4. **Recording tool.** Connect one fake effect whose executor records envelopes
   and returns pending immediately.
5. **Decision surface.** Serve the review page and record API from the authority
   hostname. Add iMessage hints and quick deny.
6. **Durable resume.** Add stable result events, transcript receipts,
   consumption acknowledgement, fallback routing, and reconciliation.
7. **First provider adapter.** Add one credential-isolated non-production
   adapter with immutable staging and idempotency or reconciliation.
8. **Controlled enablement.** Enable one owner and one low-volume tool only
   after lifecycle tests, security review, bypass audit, pairing rehearsal, and
   rollback all pass.

Do not serialize live hook context to retrofit arbitrary synchronous tools. Do
not place the authority, protected credential, or owner decision key in a native
OpenClaw plugin.

### Validation

The proposal has been checked against current OpenClaw and repository source,
related plans, and authoritative channel documentation. A future implementation
must add committed recording-based tests to the repository-managed integration
pool. No automated test may send a message or mutate a live account.

#### Isolation and authority

Tests must prove:

- separate-user file, socket, keychain, process, and network isolation;
- gateway denial for authority data, credential, key, execution, network
  control, certificate issuance, DNS, proxy, and route changes;
- identical protection for review and attachment hostnames;
- gateway-local operator, admin, and approval rights cannot decide;
- every agent profile and invocation surface either uses the broker or lacks the
  capability, including subagents, native harnesses, MCP calls, browser, shell,
  diagnostics, file reads, and disabled-sidecar fallback; and
- owner enrollment, theft resistance, revocation, rotation, recovery
  credentials, and away-from-host readiness.

#### WebAuthn and review presentation

Tests must cover:

- exact hostname registration, exact origin and relying-party verification,
  required user verification, signature validation, and rejection when the
  authenticator user-verification flag is clear;
- challenge replay, stale challenge, changed decision fields, wrong origin,
  sibling host, stale page, CSRF, simultaneous decisions, and permanent-allow
  rejection;
- complete original and resolved values, canonicalization stability, schema
  migration, digest display, and original-to-resolved highlighting;
- bidirectional text, zero-width text, newlines, homoglyphs, punycode, HTML, and
  link spoofing; and
- unauthenticated, cross-owner, stale-session, and enumerated record reads.

#### Attachments

Tests must cover:

- byte-only ingestion and refusal to open caller paths;
- traversal, symlink, privileged-path, size, digest, replacement, and cleanup
  failures;
- inaccessible staged objects from the gateway account;
- active HTML, SVG, XHTML, scripts, and sniffable content never executing on
  the signing origin or requesting an approval credential;
- forced-download headers, fixed content type, no approval cookies, no authority
  API access, and separate-origin isolation; and
- capabilities that are scoped, unguessable, short-lived, single-use, limited,
  absent from referrers and logs, and successful for only one concurrent
  redemption.

#### Lifecycle and pressure

Tests must cover:

- reuse of active duplicates and behavior after every terminal state;
- same-task success, explicit duplicate review, renewal, lineage uniqueness,
  newest-generation lookup, and rejection of model-driven renewal;
- owner, session, tool, submitter, and global quotas;
- sidecar-native owner, submitter, global, notification, quota, and cooldown
  limits remaining effective while the gateway forges and rotates run and
  session identities;
- varied-payload floods, notification limits, signed-denial cooldown, quick-deny
  cooldown, legitimate distinct requests, and operator clearing;
- approve, deny, expiry, signed cancellation, administrative cancellation,
  stale approval, signed re-arm, unsolicited resubmission, quick deny, forged
  links, and simultaneous decisions;
- the stale re-arm window starting on entry, expiring within 23 hours, and
  becoming terminal without reviving or releasing the wrong lineage;
- one ordered event for cancellation from pending, approved, and stale states;
- immediate tool return with no open promise or agent turn;
- a recording provider receiving exactly the approved stored envelope and
  protected staged bytes, byte for byte, with no transient or unapproved input;
- crashes before claim, after claim, before provider call, after provider
  acceptance, and before result persistence;
- recovery on both sides of the absolute execution deadline;
- idempotent retry, provider reconciliation, and unknown outcome without blind
  resend;
- restart in every state, lease recovery, concurrent approvals, queue
  contention, exhausted retries, missing sessions, transcript receipts,
  consumption receipts, failed turns, and reconciler repair;
- stale event acknowledgement followed by re-arm and a later ordered event;
- signed re-arm bound to record, digest, and a one-time challenge;
- iMessage target retention and capacity, unavailable channel, unpaired or
  off-network device, expired link, and no insecure fallback;
- safe bounded notification summaries; and
- denial, expiry, stale approval, integrity failure, and capacity failure never
  reaching the provider.

#### Gmail boundary and cutover

Using a dedicated test account and non-deliverable fixtures, tests must prove:

- the old gateway token is revoked;
- the replacement gateway scope set equals exactly `gmail.readonly`;
- source, configuration, and normal consent request no other scope;
- direct send, draft send, vacation reply, filter, forwarding, send-as, and
  delegation attempts fail for insufficient scope before mutation;
- gateway and sidecar OAuth clients, refresh tokens, and identities are
  distinct;
- the triage service accepts only its fixed actions and configured user labels;
- it dispatches only approved modify operations;
- it rejects method injection, raw bodies, extra fields, send, draft, insert,
  import, trash, settings, forwarding, send-as, delegation, unknown labels, and
  all disallowed system labels before reaching Gmail;
- fixed archive, read-state, star, and importance actions change only their
  named reversible labels;
- every inventoried routine triage behavior remains available;
- the replacement and read-only gateway credential are proven before old-token
  revocation;
- pre-revocation failure leaves old credentials and routing unchanged;
- revocation is the final irreversible cutover step;
- post-revocation failure alerts and follows the tested protected-service
  recovery path; and
- approval rollback leaves narrow mailbox triage running.

#### Time, retention, and rollback

Tests must cover:

- payload retention, metadata-only audit, purge, backup, and restore;
- rollback with pending, approved, stale, and executing records;
- backward clock movement, restart, skew, and large forward jumps;
- expiration of pending records, challenges, cooldowns, execution windows, and
  downloads without revival; and
- the full repository-managed integration lifecycle with recording adapters and
  no live delivery or mutation.

### Rollout and rollback

No rollout occurs during this design task. A later rollout follows this order:

1. Keep approval intake, protected execution, and production sidecar disabled.
2. Create an isolated test identity with fake credentials, a recording executor,
   and a pre-enrolled test browser key.
3. Exercise fake approvals through the authority page and recording iMessage
   adapter.
4. Pass restart, spoofing, flood, isolation, ambiguous-result, retention, and
   rollback tests.
5. Add one non-production provider adapter.
6. Deploy the production sidecar for narrow mailbox triage only. Complete the
   rehearsed Gmail credential cutover while approval intake and protected
   execution remain disabled.
7. Pair the phone and rehearse remote review, including one attachment through
   the separate download hostname.
8. Enable one low-volume protected tool for Cole after the old gateway token is
   revoked, the gateway token is exactly read-only, routine triage uses only the
   narrow service, and every alternate send path is gone.
9. Register more tools only after observed stability.

The Gmail cutover order is strict. Inventory current behavior, stage and verify
the replacement, route triage through it, verify the distinct read-only gateway
credential, disable old mutation paths, remove every extra scope from source and
setup guidance, and revoke the old token last. Before revocation, any failure
restores unchanged prior routing and credentials. After revocation, failure is a
bounded alerted outage repaired only in the protected service. Send-capable
gateway access never returns.

Operational readiness requires durable counts for records by state, oldest
pending age, deduplication hits, capacity rejection, notification failure,
stale approval, expired lease, integrity failure, unknown execution, resume
failure, quick deny, and reconciliation repair. Anomalous deny and stale rates
must alert.

Approval rollback:

- disables new submissions and executor claims;
- removes the protected tool from every agent profile;
- rejects new decisions;
- cancels pending, approved but unclaimed, and stale records;
- emits and delivers cancellation events;
- reconciles already executing work without blind retry;
- preserves records through retention and purges staged data on schedule; and
- restores the disabled approval configuration.

Approval rollback does not disable mailbox triage. That service has a separate
runbook. Before Gmail token revocation, its rollback restores prior routing and
credentials. After revocation, it alerts and fixes forward inside the protected
service unless another narrow non-send triage path has already been proven.
Neither rollback restores the direct protected tool, returns send-capable access
to the gateway, or transfers a protected credential to the gateway account.

### Risks and tradeoffs

- **Gateway compromise can cause denial of service.** It can flood submission or
  relay quick denies, but quotas, cooldowns, alerts, and signed approval prevent
  execution.
- **The protected service is operationally significant.** Failure after Gmail
  revocation can pause routine triage. The accepted response is bounded,
  alerted, protected-service recovery, not restoration of unsafe access.
- **Exactly-once effects depend on provider support.** Ambiguous outcomes become
  explicit unknown states and require reconciliation.
- **Remote review depends on private reachability and owner credentials.** There
  is no insecure fallback when the phone, network, or authority is unavailable.
- **A trusted review page adds deployment work.** That cost is necessary because
  gateway-served content cannot safely describe the action being signed.
- **Quick deny can be forged by a compromised gateway.** This can stop work but
  cannot authorize it. The fail-safe tradeoff is intentional.
- **A stable root-task identity may require upstream work.** Until it exists,
  quotas are the primary defense against cross-run duplicates.
- **The model may vary payloads to evade hash reuse.** Absolute sidecar-native
  limits and cooldowns remain effective.
- **Root or approval-service compromise is outside the claim.** The design
  protects against the model and gateway account, not total host compromise.

### Evidence

Primary OpenClaw evidence:

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

Related repository plans cover egress approval, iMessage approval, and session
delivery wake-up:

- Plan 014, egress approval;
- Plan 027, iMessage approval channel; and
- Plan 028, session-delivery queue for agent wake-up.

External channel evidence:

- Slack: https://docs.slack.dev/interactivity/handling-user-interaction/
- Discord: https://docs.discord.com/developers/components/reference
- Telegram: https://core.telegram.org/bots/api
- Pushover: https://pushover.net/api
- ntfy: https://docs.ntfy.sh/publish/
- Apple actionable notifications:
  https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types

### Review summary

The completed design review ended with no unresolved material findings.
Independent reviews materially changed the design in four areas:

1. **Trust boundary.** Credentials, records, staging, review content, owner keys,
   and execution moved out of the gateway process. Host-local approval rights
   were rejected. DNS, TLS, proxy, route, and attachment-host control were also
   isolated.
2. **Decision safety.** Reviews added exact-origin WebAuthn verification,
   required user verification, device-authenticated reads, safe canonical
   rendering, separate attachment downloads, execution freshness, signed re-arm
   and renewal, and durable cancellation.
3. **Durability and abuse resistance.** Reviews added transactional state,
   immutable staging, digest rechecks, deduplication lineage, quotas, cooldowns,
   nondecreasing time, absolute execution deadlines, sequenced resume events,
   and explicit unknown outcomes.
4. **Gmail cutover.** Reviews corrected unsafe scope assumptions, limited the
   gateway to exact read-only access, preserved routine reversible triage
   through a fixed service, closed system-label escapes, and established safe
   pre-revocation rollback and post-revocation recovery.

The public relocation and tracking closeout were independently reviewed. The
readability rewrite removes repetitive review chronology while retaining every
material decision, requirement, phase, test boundary, rollout rule, risk, and
current completion state.

The readability review compared the complete old and new plans. It restored
explicit download-origin isolation, exact evidence links, forged-identity cap
tests, byte-for-byte execution proof, the bounded stale re-arm window, and the
clean design-review conclusion. A fresh complete comparison found no actionable
issues and no lost material content.

### Checklist

- [x] Research current OpenClaw approval, iMessage, review UI, persistence, and
      resume behavior.
- [x] Compare notification and decision channels.
- [x] Define the separate authority, credential, review, attachment, and network
      trust boundaries.
- [x] Define immutable input handling and complete review presentation.
- [x] Define deduplication, quotas, cooldowns, trusted time, and retention.
- [x] Define decision, execution, reconciliation, cancellation, renewal, and
      durable resume lifecycles.
- [x] Define the exact Gmail read-only gateway boundary and fixed mailbox-triage
      service.
- [x] Define implementation phases, validation, rollout, rollback, risks, and
      operational signals.
- [x] Complete independent design review and incorporate all material findings.
- [x] Publish the proposal under public issue 68.
- [x] Record confirmation of completed external tracking migration.
- [x] Rewrite the proposal for the current Human and Agent writing contract.
- [x] Confirm the work remains design-only.
- [x] Complete independent readability and material-loss review.
- [x] Confirm the final plan and issue shapes and publication checks.
