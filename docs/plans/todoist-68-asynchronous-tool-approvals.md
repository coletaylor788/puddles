# Asynchronous tool approvals

**Status:** Ready for review
**Issue:** [#68](https://github.com/coletaylor788/puddles/issues/68)
**Last updated:** 2026-07-31
**Owner:** Cole

## Human section

### Design

Some tool calls can cause serious or irreversible effects. Sending email is the
first example. The agent should be able to prepare such a request, but it should
not be able to carry it out until Cole has seen the exact action and approved it.
The boundary must still hold against malicious prompts, alternate tools, and
broad local gateway clients. OpenClaw's current approval feature is not enough:
it blocks the active call, keeps short-lived state in memory, can approve on
timeout, and shows plugin-written text rather than the exact final action.
Plugins also share the gateway process, so they cannot safely hold a credential
that the gateway must never use.

The recommendation is an on-demand native macOS authority and review app with no
network listener or hosted web service. A separate protected identity owns the
records, staged files, policy, provider credentials, execution, and recovery.
The gateway may submit a request through authenticated local communication, but
it cannot read or edit the record, approve it, or execute it. Every other route
to the protected effect is removed. The gateway must also run outside Cole's
login identity. Otherwise code in that same graphical session could interfere
with the review experience, and the stronger isolation claim would not be true.

The protected tool returns "pending approval" immediately. The authority
resolves defaults, snapshots attachment bytes, and stores an immutable version
of exactly what would run. Notification Center alerts Cole and opens the signed
native review app. The notification itself cannot decide. The app shows the
original arguments beside every final recipient, option, header, value, and
attachment hash. Text is inert, and active attachment content never enters the
signing process. Any preview uses a separate isolated viewer.

Cole approves or denies inside the app. Touch ID or another enrolled owner
credential unlocks a protected key for one fresh signature over the exact
record, final values, decision, and expiry. Device unlock or identity checking
alone is not approval. There is no permanent allow option. Missing, expired,
changed, duplicated, or invalid decisions fail closed. Approval also cannot
override secret or content policy. If approved, the authority executes only the
stored values within a short window and reconciles any uncertain provider
outcome rather than blindly retrying.

The authority records the terminal result before returning it to the originating
agent. Email results include sent or failed state plus a provider receipt,
provider time, or reconciliation evidence. Denial, expiry, failure, and unknown
execution are equally explicit. A stable signed tool-result event is retried
until the correct transcript stores it and one resumed agent turn durably
continues beyond the pending tool. Busy sessions wait. Missing sessions fall
back to the owning agent and a protected inbox. Duplicate delivery cannot repeat
the provider effect or resume the workflow twice. OpenClaw carries the event but
is not its source of truth.

iMessage remains a fixed best-effort notice and quick-deny path. It never
approves because a reply or tapback does not prove review of the exact record.
The deny-only path may stop work but cannot authorize it. Remote approval is not
part of the first version. Telegram long polling and Slack Socket Mode avoid
inbound ports, but they expose approval metadata to another provider and replace
the local signing boundary with provider account trust. Apple push normally
requires a mobile app and push-provider lifecycle. Any remote mode therefore
needs a separate design decision.

Trusted local software is still unavoidable. It must preserve asynchronous
state, protect credentials, execute approved work, reconcile uncertain results,
and resume the agent after restart. The native design removes DNS, TLS, reverse
proxy, firewall, and hosted-service work, not that local responsibility.

Email also needs a careful credential cutover. The gateway becomes exactly
read-only. Routine reversible mailbox triage moves to a separate service with a
closed interface and its own identity and lifecycle. Its provider token may
technically permit sending, so compromise of that service or token is outside
the guarantee. The narrow interface, not the provider scope, prevents normal
triage requests from sending. The replacement must work before the old gateway
credential is revoked, and rollback never restores send-capable gateway access.

### Status

This is a design-only proposal. It changes no runtime, credential,
configuration, notification, or external service. The no-listening-port native
architecture and durable return to the originating agent are complete and ready
for Cole to review. Implementation remains blocked until Cole explicitly
approves it.

## Agent section

### State

The provider-neutral design is complete and ready for review. It recommends an
on-demand native macOS authority and review app instead of an HTTPS approval
service. The approval subsystem opens no TCP or UDP listener. Notification
Center alerts the owner, authenticated local IPC carries authority-signed
records, and a per-decision protected signature authorizes one approve or deny
action.

Terminal provider results are first-class. The authority persists the outcome
and evidence, redelivers a signed sequenced event until OpenClaw records it, and
requires a resumed agent turn to acknowledge consumption. This preserves
asynchronous continuation without trusting OpenClaw transport as authority.

Public tracking is on issue 68. External task tracking points to that issue and
remains open for review. Superseded non-public tracking is retired. This plan
does not implement, deploy, notify, send, mutate an account, or change external
tracking.

### Scope and acceptance criteria

The proposed implementation includes:

- a registry of serializable tools that require deferred approval;
- gateway adapters under a non-login OS identity with separate submit,
  deny-only, and fixed mailbox-triage capabilities;
- an on-demand approval authority and executor under a different protected OS
  identity;
- a root-owned, signed native review app in the owner's login session;
- launchd-managed activation and authenticated XPC or Mach-service IPC;
- a dedicated transactional database and immutable staging store;
- exact display of raw arguments and resolved execution values;
- one-time protected signatures for approve, deny, re-arm, renewal, and
  cancellation;
- Notification Center alerting and iMessage best-effort notice and quick deny;
- request deduplication, quotas, expiry, execution freshness, reconciliation,
  audit, retention, durable agent continuation, and rollback; and
- a narrow independently managed mailbox-triage service needed to remove
  send-capable Gmail access
  from the gateway.

This proposal does not include:

- implementation, deployment, credential changes, notifications, or test sends;
- an HTTPS approval page, DNS name, TLS certificate, reverse proxy, or opened
  firewall port;
- a TCP or UDP listener for the approval subsystem;
- a remote approval channel in version 1;
- gateway-local operator, admin, or approval rights as decision authority;
- model-written approval messages or model polling as a source of truth;
- permanent approval for protected effects;
- approval as an override for secret or content policy; or
- generic replay of arbitrary tools that depend on live closures, streams,
  browser state, or other non-serializable context.

#### Acceptance criteria

A future implementation is acceptable only when it:

1. Keeps the gateway, authority, mailbox-triage service, and graphical owner
   session in separate trust roles. The gateway, authority, and triage service
   use different OS identities, and the gateway identity is not Cole's login
   identity.
2. Keeps protected credentials, records, staged data, policy, decisions,
   execution, and reconciliation under the authority identity. The triage
   service owns only its separate triage credential and fixed reversible state.
   That credential is protected as provider-level send-capable when no narrower
   provider scope exists.
3. Removes every alternate protected path from the agent and gateway, including
   direct credentials, raw APIs, unrestricted network clients, browser
   automation, shell access, and compatibility fallbacks.
4. Allows unapproved mailbox triage only through an independently authenticated
   service with fixed reversible archive, read-state, star, importance, and
   configured user-label actions.
5. Rejects host-local OpenClaw operator, admin, or approval rights as authority
   for a protected decision.
6. Starts the authority and review app on demand and adds no approval-subsystem
   TCP or UDP listening socket, DNS, TLS, reverse proxy, or firewall rule.
7. Uses mutually authenticated local IPC with code-signing, UID, protocol,
   capability, size, sequence, and replay checks for submit, notify, deny-only,
   owner, resume, and triage roles.
8. Gives the gateway's approval path only a submit capability. A separate
   deny-only role may move pending work to denied, and a separate triage role may
   invoke only fixed reversible mailbox operations. Neither role can read
   approval records, approve, enroll keys, cancel, re-arm, execute protected
   work, or acknowledge results.
9. Shows raw model arguments beside the complete versioned execution envelope,
   including resolved defaults, destinations, headers, options, and attachment
   hashes.
10. Binds every decision signature to the authority-signed record, envelope
    digest, decision, owner, expiry, and one-time challenge.
11. Uses a Secure Enclave or equivalently protected non-exportable key with a
    fresh owner-authentication prompt for every signing operation. A successful
    LocalAuthentication check alone is not a decision.
12. Makes Notification Center a navigation surface only. No notification button,
    reply, dismissal, or unlock can approve or deny.
13. Returns from the original tool call immediately with a durable pending
    result and no live promise or blocked agent turn.
14. Permits only one signed approval or denial, with all timeout and failure
    cases defaulting to no execution.
15. Deduplicates repeated requests when a stable trusted root-task identity is
    available and always enforces owner, session, tool, submitter, and global
    quotas.
16. Accepts attachment bytes, never privileged reads of caller-supplied paths.
17. Executes only the stored envelope, rechecks staged bytes immediately before
    the provider call, and respects an absolute execution deadline across
    recovery.
18. Uses provider idempotency or reconciliation to prevent duplicates and enters
    `execution_unknown` rather than retrying an ambiguous effect.
19. Stores a terminal result before delivery. For email, `sent` includes the
    provider message or receipt ID and provider timestamp. Failure includes a
    content-free error class and reconciliation evidence.
20. Delivers an authority-signed, stable, sequenced tool-result event through a
    durable event-keyed continuation outbox. It redelivers until transcript
    receipt and a completed or durably checkpointed resumed turn are recorded.
21. Resumes the suspended workflow beyond the protected tool exactly once,
    recovers every incomplete handoff after a crash, queues behind a busy
    session, and uses a defined fallback when the original session is missing.
22. Keeps full approval bodies and attachments on the protected host, not in
    Notification Center, iMessage, or third-party remote channels.
23. Never renders active attachment content in the signing process. Any preview
    runs in a separate sandbox with no signing key, decision IPC, credential, or
    network access.
24. Uses continuous time within one boot and fails closed across reboot,
    backward clock movement, or uncertain downtime so no expiry, challenge,
    cooldown, execution window, or preview capability can be extended.
25. Keeps secret and content policy non-overridable even after approval.
26. States the residual boundary honestly. It does not claim protection after
    root compromise, authority compromise, owner-login compromise, Accessibility
    control of the review app, or arbitrary code execution in Cole's GUI session.

### Architecture and decisions

#### Threat model and trust boundary

The protected boundary assumes malicious model output, prompt injection,
repeated and varied requests, malformed payloads, stale decisions, gateway
restart, gateway-account compromise, and access to every tool exposed in the
agent profile. It prevents those conditions from using the protected credential
or creating a protected effect without one owner-signed decision over an
authority-owned immutable envelope.

The claim requires the gateway to run outside Cole's login session. A process
with arbitrary code execution as the same logged-in user can target application
state, present deceptive windows, invoke Accessibility, or interfere with the
review experience. Code signing, key ACLs, and per-operation Touch ID reduce
risk but do not turn same-user processes into a hard security boundary. Root,
authority-account, triage-account or triage-token, and owner-login compromise
remain outside the guarantee.

Trusted OpenClaw run, session, and tool-call identifiers are trusted against
model manipulation. They are not trusted after gateway-account compromise. The
authority therefore enforces owner, submitter, global, and wall-clock caps that
do not depend on gateway-supplied identity. A compromised gateway can submit
noise or suppress delivery, but it cannot approve or execute.

The agent-facing transcript cannot remain cryptographically trustworthy after
arbitrary gateway code execution because the gateway constructs model input.
The authority still signs every result and keeps the effect state authoritative.
The resume adapter verifies that signature in normal operation. The design
claims trusted provenance against model and prompt manipulation, transport
failure, replay, and ordinary plugin compromise, not against a gateway process
that can fabricate the agent's entire context.

Two bounded exceptions do not create positive approval authority. The deny-only
role can stop pending work and therefore accepts a denial-of-service risk. The
independent mailbox-triage service allows only reversible archive, read-state,
star, importance, and configured user-label changes. Both have separate
capabilities, replay controls, limits, audit, and anomaly alerts. Neither can
approve, execute a protected effect, or create another outbound path.

Native OpenClaw plugins run in the gateway process and are not a security
boundary. The approval credential, record store, owner keys, policy, and
executor must not live in a normal native plugin.

#### Components and identities

| Component | Identity and responsibility |
|---|---|
| Gateway request adapter | Runs with the gateway under a dedicated non-login account. It validates model-facing input, uploads bounded bytes, submits a candidate, and returns pending status. It has no read, decision, acknowledgement, or execution capability. |
| Approval authority and executor | Runs on demand under a separate protected account. It owns records, staging, policy, owner public keys, provider credentials, decisions, leases, execution, reconciliation, events, and audit. |
| Content scanner | Runs each untrusted scan in a fresh credential-free sandbox under a separate least-privileged identity. It receives bounded bytes, has no network or authority access, and returns only a bounded closed result. |
| Native review app | A root-owned signed app that runs only in the owner's graphical login. It verifies authority-signed review bundles, renders inert values, requests one fresh owner authentication, signs one decision, and has no provider credential. |
| Notification helper | App-owned code in the graphical session with a notify-only launchd Mach service. It accepts only authority-signed bounded alert data from the authenticated authority peer, displays a fixed alert, and opens the review app. |
| Attachment viewer | A separate sandboxed process with no decision key, authority mutation capability, provider credential, or network access. It receives bounded verified bytes or a read-only descriptor, never an authority path. |
| iMessage and quick-deny adapter | Sends a fixed bounded notice. Its separate deny-only capability can move one correlated pending record to denied. It cannot read the record, approve, re-arm, cancel, execute, or acknowledge. |
| Mailbox-triage service | Runs as a separate protected non-login identity and launchd job. It owns a distinct provider token and exposes only fixed reversible mailbox operations. Its provider scope may technically send, so the closed RPC and protected identity are the boundary. It has no approval database, owner key, decision method, executor credential, or executor access. |
| Resume adapter | Verifies authority-signed events, writes stable transcript receipts, schedules one trusted agent turn, and returns consumption receipts. It has no execution or decision capability. |

The authority database, IPC endpoints, staging store, policy, credential, and
signing material are unreadable and unwritable by the gateway account. The
provider credential uses an identity-bound keychain or equivalent ACL. The
gateway receives the submit, deny-only, and triage capabilities through
different endpoints whose server policies recognize the exact client identity
and role. Possession of one capability never authorizes another.

The installed review app and helper are root-owned and not writable by the
gateway or login user. The owner's private decision key is non-exportable,
bound to that app's signing requirement, and gated by fresh per-operation owner
authentication. Key enrollment, revocation, and recovery require a protected
administrative path outside the gateway.

#### On-demand activation and local IPC

The primary transport is a launchd-managed XPC or Mach service. Mach activation
starts the authority when a valid client connects. The graphical helper uses the
appropriate per-user launchd domain. An authority connection to its registered
notify-only Mach service starts it to post a notification. A notification action
starts or focuses the review app. No approval component binds an Internet or
datagram socket.

Each XPC listener has a closed protocol and a separate peer policy:

- the submit listener accepts only the exact gateway code-signing requirement,
  expected gateway UID, protocol version, and submit entitlement;
- the quick-deny listener accepts only the exact fixed iMessage or deny-relay
  requirement, expected UID, protocol version, and deny-only entitlement. It
  accepts a bounded opaque record reference, trusted reaction correlation,
  nonce, and sequence, and can perform only an idempotent `pending -> denied`
  transition under independent rate limits;
- the owner listener accepts only the exact installed review-app requirement,
  expected logged-in owner UID, protocol version, and owner entitlement;
- the resume listener accepts only the exact resume-adapter requirement and can
  exchange events and receipts but cannot submit, decide, or execute;
- every request has a bounded serialized size, closed allowed-class set, opaque
  capability, fresh nonce, monotonic sequence, and record-scoped operation;
- server-side authorization uses the authenticated connection, never a claimed
  UID, bundle ID, process ID, path, or entitlement in the message body; and
- disconnect, interruption, malformed objects, version mismatch, unexpected
  method, replay, or uncertain peer identity fails closed.

The notification helper exposes a separate notify-only Mach or XPC listener in
the graphical user's launchd domain. It accepts only the exact authority
code-signing requirement, authority UID, notify protocol version, and notify
entitlement. The authority sends an authority-signed payload containing only an
opaque record ID, fixed tool label, bounded inert summary, expiry, digest prefix,
notification sequence, and template version. The helper verifies the peer,
signature, sequence, sizes, and closed fields before posting or replacing one
local notification. It cannot fetch record contents, decide, quick-deny, invoke
triage, acknowledge results, or call the executor.

Cross-domain Mach activation is a feasibility gate, not an assumption. The
prototype must prove that the protected authority can activate the registered
per-user helper while it is stopped. A process that can resolve the Mach service
may cause launchd to start the helper before the listener authenticates it. The
helper therefore performs no notification, record access, durable mutation, or
other authority action until peer and payload checks pass.

Unauthorized connections must be rejected immediately and their launch impact
bounded with launchd throttling, one small process, strict startup resource
limits, idle exit, bounded audit, and alert suppression. They may cause limited
local denial of service but cannot post an alert or reach a decision method. If
the required launchd domains cannot connect with enforceable method-level peer
identity, or if unauthorized launch cost cannot be bounded, the implementation
must stop and revise the design. It must not add a network listener, polling
daemon, writable shared file, or unauthenticated notification bridge as a
workaround.

Mailbox triage is not another authority method. Its independent launchd service
has a separate listener that accepts only the exact gateway requirement,
expected gateway UID, triage protocol version, and triage entitlement. Requests
contain only a closed action enum, bounded message or thread IDs, an optional
configured user-label ID, nonce, and sequence. The service cannot route a
request to authority decision or execution code. It remains installed and
available when approval intake, UI, and executor jobs are rolled back.

On supported macOS versions, the listener applies a code-signing requirement
directly to each XPC connection. Implementation must also bind the expected UID
and role. PID-only checks are insufficient because identifiers can be reused.
Lower-level audit-token or peer-signing checks may supplement the public
code-signing API but must not replace it with home-grown parsing.

A protected Unix-domain socket is a fallback only if a cross-identity XPC
feasibility test fails. That fallback still opens no network port, but it is a
local socket listener and must be described that way. It requires a
root-created non-symlink directory, strict owner and mode, peer credentials,
message authentication, framed size limits, nonce and sequence replay defense,
atomic endpoint replacement, and safe cleanup. XPC is preferred because launchd
activation and peer signing requirements reduce custom protocol work.

#### Notification and native review

Local actionable notifications require an application, registered notification
categories, and a notification-center delegate established during application
launch. The system returns selected actions to that application. The
`authenticationRequired` notification option only requires device unlock before
callback delivery. It does not prove review of the complete transaction and
does not sign a record digest.

The only approval-notification action is `Review`. It opens or focuses the
native app for an opaque record ID. Dismissal does nothing. Approval, denial,
cancellation, renewal, and re-arm are unavailable from Notification Center.
Implementation must prove that the helper is activated reliably when stopped,
that the authority-to-helper peer and payload are authenticated, that the
delegate is ready before callback delivery, and that unavailable notification
permission leaves records pending and produces an operator-visible inbox signal.

The app fetches one current authority-signed review bundle over its authenticated
owner connection. Its pinned authority public key verifies the bundle before
display. The bundle includes the record ID, schema version, original arguments,
resolved envelope, attachment metadata and hashes, lineage, expiry, decision
challenge, and bundle digest.

The app:

- shows original and resolved values side by side;
- shows canonical data without security-relevant truncation;
- renders model strings as inert text, never HTML, Markdown links, or a WebView;
- exposes bidirectional, zero-width, newline, and hidden code points;
- shows internationalized domains in Unicode and punycode;
- normalizes and highlights actual destinations and all changed values;
- shows attachment name, declared type, size, digest, and scan result; and
- displays the exact digest that the decision will sign.

Immediately before signing, the app refetches the record and requires a fresh
challenge. It creates a new authentication context with no reuse window and asks
the Security framework to use the protected private key for one signature.
LocalAuthentication success by itself never changes authority state. The
signature operation must cover the canonical record ID, envelope digest,
decision, owner key, challenge, and expiry. The authority verifies all fields
and consumes the challenge transactionally.

The preferred key is Secure Enclave backed with private-key usage and current
biometric-set or equivalent owner-presence access control. Enrollment changes,
key invalidation, failed authentication, unavailable biometry, cancellation, or
lockout fail closed. A separately enrolled recovery credential may be used, but
the gateway cannot enroll it and no password-only silent fallback exists.

#### Protected-tool contract and immutable inputs

Only registered deferred executors are eligible. Each executor defines:

- JSON Schema and semantic validation;
- canonicalization and resolution of defaults, aliases, and dynamic inputs;
- immutable snapshot rules;
- authority-owned secret and content policy over canonical values and staged
  bytes;
- a deterministic safe review renderer;
- execution with an idempotency key;
- reconciliation for ambiguous provider outcomes; and
- a durable result codec.

The gateway opens candidate files with its lower privileges, rejects traversal
and symlink escapes under the tool's file policy, and uploads bounded byte
streams with logical metadata. The authority never opens a caller-provided path.
Each staged object records a digest, size, MIME type, and logical name.
Immediately before an effect, the executor reads the protected copy again and
rechecks its digest and size. A mismatch ends in `input_integrity_failed`.

The authority evaluates non-overridable secret and content policy after all
values are resolved and bytes are staged. It evaluates the same protected inputs
again immediately before the provider call. Policy rules and configuration are
authority-owned and unavailable to the gateway, but parsers never run with the
authority's identity or credentials.

Each untrusted content scan runs in a fresh credential-free sandbox under a
separate least-privileged identity. The authority passes bounded verified bytes
or a read-only descriptor, never an authority path. The scanner has no network,
keychain, provider credential, database, staging-write, owner IPC, decision IPC,
or unrelated filesystem access. It has hard input, memory, CPU, wall-time,
process, recursion, decompression, and output limits. Timeout or limit breach
kills the worker.

Scanner output is untrusted. The authority accepts only a bounded versioned
schema with a closed verdict enum, validates it independently, and binds the
scanner version and result digest into the record. Scanner text cannot select a
policy, destination, tool, or provider input. A denial, missing rule set,
scanner crash, timeout, malformed result, uncertain classification, unavailable
sandbox, or version mismatch fails closed. An owner signature cannot waive this
policy.

For email, the immutable envelope includes the account, operation, resolved
`to`, `cc`, and `bcc` addresses, reply and thread identifiers, subject, body,
format, headers, scheduling and send options, stable message identity, and every
attachment reference. Review shows the original arguments, resolved envelope,
attachment metadata, hashes, and scan outcomes.

#### Attachment review

Attachment bytes never render in the review app or any process that can use the
decision key. Version 1 may show metadata and scan results only. If content
preview is necessary, the app starts a separate sandboxed viewer after it has
verified the authority signature and digest.

The viewer:

- receives a bounded verified byte stream or read-only descriptor, never an
  authority filesystem path;
- has no decision key, owner IPC, provider credential, clipboard export,
  Accessibility permission, network access, or ability to mutate staged bytes;
- renders each supported type in a fresh process with memory, time, output, and
  recursion limits;
- treats HTML, SVG, XHTML, scripts, macros, external references, and active media
  as hostile and never loads them in the signing process;
- provides metadata-only fallback when safe preview is unavailable; and
- exits before the review app requests the fresh signing authentication.

The review app always rechecks the current bundle after the viewer closes.
Preview output is advisory. The signed authority digest and protected staged
bytes remain the execution source of truth.

#### Record store, privacy, time, and pressure

Authoritative records live in an authority-owned transactional SQLite database.
A bounded plugin state store is suitable only for short-lived channel hints
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
  result, provider evidence, error class, and reconciliation evidence; and
- monotonic event sequence, stable event IDs, delivery attempts, transcript
  receipts, consumption receipts, and final acknowledgement.

Payloads and staged data use owner-only permissions on an encrypted local
volume. Audit records contain identifiers, hashes, states, timings, and actor
fingerprints, not message bodies or attachment bytes. Notification Center and
chat notices contain only a fixed tool label, safe bounded summary, expiry,
opaque record ID, and digest prefix.

Pending expiry moves payloads into a seven-day terminal retention window.
`approval_stale` keeps its envelope and staged bytes through its re-arm window.
After retention, payloads are purged and only metadata audit remains.

While the host remains in one boot session, deadlines use an OS continuous-time
source that includes sleep. The authority also persists the boot identity and a
wall-clock high-water mark. Process-monotonic time alone is insufficient because
it cannot measure downtime across reboot.

At startup, a changed boot identity, wall time below the high-water mark, or any
case where elapsed downtime cannot be bounded invalidates outstanding
authorization-bearing time. Pending records expire. Approved but unclaimed work
becomes `approval_stale`. Claimed work reconciles provider state before becoming
failed or `execution_unknown`. Challenges and preview capabilities expire.
Cooldown release remains blocked until trusted time is re-established. A large
forward jump also fails closed and alerts. Protected administrative recovery may
restore trusted time and permit a new owner-signed re-arm, but it cannot revive
an old approval or extend an old deadline.

The model never supplies an idempotency or intent key. A stable trusted
root-task identity is a prerequisite for cross-run deduplication. With that
identity, the authority computes a key from owner, root task, tool, and envelope
digest in one transaction:

- a matching active record returns the existing record;
- a matching success in the same task returns `already_executed`;
- a matching denied, expired, cancelled, stale, failed, or unknown record
  returns that state; and
- another identical effect requires a new trusted task or an owner-signed
  duplicate review that shows the previous result.

An expired record remains immutable. During retention, Cole can sign a renewal
bound to that record and digest. Renewal creates one new linked pending record.
Only one generation in a lineage may be active. Model resubmission cannot renew
or re-arm a record.

Per-owner, per-session, per-tool, per-submitter, and global caps fail closed.
Notification limits and wall-clock request limits do not depend on
gateway-supplied identity. These controls, not hash deduplication, defend against
varied-payload floods. A signed denial starts an owner-and-tool cooldown. Quick
deny uses a shorter separately limited cooldown and is visible in audit.

#### Decision, execution, and result lifecycle

The authority uses transactional states:

```text
pending -> denied | expired | cancelled | approved
approved -> cancelled | approval_stale | executing
approval_stale -> pending | cancelled | expired
executing -> executing | approval_stale | sent | failed
executing -> input_integrity_failed | execution_unknown
```

Only the first valid decision wins. Decision processing verifies the review-app
peer, owner signature, one-time challenge, pending expiry, current record,
authority bundle signature, and displayed digest.

Pending requests expire after 23 hours by default, or sooner for a tool.
Approval creates a five-minute claim window and an absolute execute-by time. If
work is not safely claimed in time, it becomes `approval_stale` and never runs
after delayed recovery.

Entering `approval_stale` starts a re-arm window of at most 23 hours. Cole may
sign a re-arm during that window. Re-arm keeps the immutable record, uses a new
challenge, creates a new pending window of at most 23 hours, and sends a new
best-effort notice. Model resubmission cannot re-arm it. When the re-arm window
ends, the record expires.

The executor atomically claims approved work with a lease. Restart recovery
first reconciles provider state. If the execute-by time passed and no provider
call occurred, the record becomes stale. If prior acceptance cannot be proved or
disproved, it becomes `execution_unknown`. The executor never starts a provider
call after the deadline.

Only an owner-signed action or administrative rollback can cancel pending,
approved, or stale work. Cancellation emits a durable terminal event and cannot
be re-armed. The gateway and model cannot cancel. Best-effort quick deny is the
only unsigned terminal action and applies only to pending work.

Local locking cannot guarantee exactly-once external effects. Providers with an
idempotency facility reuse one key. Other adapters reconcile before retry. Email
uses stable provider or message identity and searches sent state. Ambiguous
acceptance never causes blind resend.

Before any agent notification, the authority commits the terminal state and an
immutable result object. For email:

- `sent` contains the authority record ID, provider message or receipt ID,
  provider acceptance timestamp, envelope digest, and completion time;
- `failed` contains the record ID, safe error class, failure time, and any proof
  that the provider did not accept the send;
- `execution_unknown` contains the record ID, last attempt time, reconciliation
  evidence, and an instruction not to regenerate or retry; and
- `denied`, `expired`, `cancelled`, `approval_stale`, and
  `input_integrity_failed` state that no provider call is authorized.

Provider bodies, tokens, raw errors, and sensitive response data never enter the
transcript. The event reads as a trusted tool result rather than a user request.

#### Durable return and agent continuation

The authority record is the source of truth. OpenClaw's session-delivery queue
is useful transport, but it has bounded retries and acknowledges dispatch rather
than proving that the model consumed an event.

Every terminal result creates a canonical event with:

- authority event ID, record ID, sequence, outcome, tool, and envelope digest;
- original agent, session, session instance, run, turn, and root-task
  correlation;
- safe result fields such as provider receipt ID and timestamp;
- a clear instruction to continue from the suspended protected-tool workflow
  without regenerating or replaying the effect; and
- an authority signature over the complete event.

The resume adapter keeps a durable continuation row and outbox keyed by the
original protected tool call and approval lineage, not merely by one event. Its
states are:

```text
received -> transcript_recorded -> turn_pending -> turn_claimed
turn_claimed -> turn_pending | continuation_committed | continuation_unknown
continuation_unknown -> turn_pending | continuation_committed
continuation_committed -> authority_acknowledged
```

The adapter verifies the signature and inserts `received` idempotently. It then
appends the event ID and structured tool result to the intended transcript or
trusted session inbox. Only after that append is durable does it record
`transcript_recorded`. The same local transaction that advances to
`turn_pending` creates an outbox item for one `agentTurn`, keyed by the event ID
and expected session instance when available.

A dispatcher leases the outbox item and enqueues the turn. A crash before
enqueue leaves `turn_pending`. A crash after enqueue but before local
confirmation causes the dispatcher to submit the same idempotency key again.
OpenClaw queue deduplication and the adapter's event row make both paths safe.
Queue acknowledgement alone never deletes or completes the continuation row.

The queued turn uses trusted internal provenance and the normal session lane. A
busy session therefore waits instead of racing its transcript lock. Starting to
assemble model input may advance the leased claim, but it is not consumption and
does not acknowledge the authority.

Consumption becomes durable only after the resumed turn completes or writes a
recoverable continuation checkpoint that proves the event was accepted and
preserves the remaining workflow before any later side effect can be lost. That
commit records the stable resumed-turn ID, event ID, transcript position, model
turn or continuation checkpoint, and deduplication scope for later tool calls
and deliveries. It advances the row to `continuation_committed`.

If the process crashes or the turn fails before that commit, the lease expires
and the outbox returns to `turn_pending`. Recovery reconciles the transcript,
queue, session lane, and resumed-turn ledger before scheduling again. It never
treats the existing transcript event as proof that the continuation ran. If a
turn may have crossed an external side-effect boundary but its commit is
unknown, recovery enters `continuation_unknown`, blocks blind replay, and alerts
for repair. No automatic transition leaves `continuation_unknown`. A protected
operator repair may return it to `turn_pending` only with durable proof that no
later side effect occurred, or advance it to `continuation_committed` only with
durable proof that the remaining workflow completed or was safely checkpointed.
Until then, no consumption receipt or authority acknowledgement is sent.

Only `continuation_committed` produces the consumption receipt and final
acknowledgement to the authority. The authority redelivers until it has both the
transcript receipt and that receipt. OpenClaw retry exhaustion moves its local
queue entry aside but does not complete the adapter row or authority delivery.
The authority and adapter repair loops retry with backoff and alert after a
bounded failure budget.

Stable event IDs prevent duplicate transcript entries. Stable resumed-turn IDs,
leases, and the continuation ledger prevent two active turns. Duplicate events
may refresh acknowledgement and incomplete outbox work, but they cannot change
authority state or execute the approved effect again. They do not suppress
recovery of an incomplete turn. Out-of-order events wait until the prior
sequence is present unless the authority marks the gap terminal.

Only one terminal outcome may arm semantic continuation for an original
protected tool call and lineage. `approval_stale`, approval, re-arm, notification
failure, and other nonterminal changes update the authority record and local
approval inbox without creating an `agentTurn`. If re-arm later ends in `sent`,
denied, expired, cancelled, failed, integrity failure, or unknown execution,
that terminal event uses the one continuation.

An owner-signed renewal after an already terminal expiry creates a linked new
record, but the expired tool call has already consumed its continuation.
Renewal outcomes therefore go to the owning-agent approval inbox as
owner-initiated follow-up status and cannot start a second continuation of the
old workflow. A new agent workflow must explicitly adopt that result before
acting on it.

If the original session is busy, the normal lane queues the event. If its
instance changed, the adapter does not append to the replacement transcript
silently. It writes the signed result to the stable owning-agent approval inbox,
targets the owning agent's current main session, and labels the original
correlation. If no owning session exists, the inbox and operator alert retain
the event until one is available. The model may read status but cannot decide,
mutate, re-arm, acknowledge, or execute through a status tool.

This is semantic workflow continuation, not revival of a suspended JavaScript
stack. The original call returned pending. The trusted result starts a new agent
turn with enough durable correlation and checkpointing to continue beyond that
call exactly once. Later protected tools, user delivery, and other external
effects use the resumed-turn ID as part of their idempotency scope so crash
recovery cannot repeat them silently.

#### Channel choices

| Option | Network shape | Trust and privacy | Decision |
|---|---|---|---|
| Notification Center plus native review app | Local notification and Mach/XPC only | Full record stays local. Notification opens review but never decides. | Recommended for version 1. |
| iMessage notice and quick deny | Existing fixed Messages transport | Best-effort and privacy-bounded. Reply or tapback lacks digest-bound owner proof. | Keep for notice and fail-safe deny only. |
| Telegram long polling | Authority makes outbound HTTPS `getUpdates` requests; no webhook or inbound listener | Telegram stores updates for up to 24 hours. Bot token and account identity become security dependencies. Full review in chat leaks transaction data. | Optional later mode with a separately approved weaker trust model. |
| Slack Socket Mode | Authority opens an outbound WebSocket with an app-level token; no public HTTP endpoint | Slack workspace, app, bot, and platform become dependencies and see approval metadata. | Optional later mode with the same weaker-boundary warning. |
| Apple push notifications | Outbound APNs provider connection, but also a mobile app, entitlement, device token, and provider credential | Strong native phone UX is possible only after building and operating the app and provider lifecycle. | Not chosen because it recreates the app and service burden. |
| Plain iMessage approve | Existing message transport | Sender and reaction correlation do not bind a complete authority record, digest, or fresh owner key operation. Gateway compromise can observe or influence transport. | Prohibited. |
| Unix-domain-socket native UI | Local socket, no network port | Can work with strict peer credentials and message authentication, but adds protocol and filesystem attack surface. | Fallback only if XPC feasibility fails. |
| Hosted HTTPS review page | Inbound HTTPS, DNS, TLS, proxy, and firewall or private-network setup | Can support remote WebAuthn but creates the hosting burden Cole rejected. | Superseded by this native design. |

Telegram's Bot API offers long polling and webhooks as mutually exclusive update
methods. Long polling avoids an inbound listener, but the authority must own and
protect the bot token, update offset, sender and chat allowlist, one-time
callback state, and outbound stream. Telegram identity is not equivalent to the
local Secure Enclave decision key.

Slack Socket Mode replaces a public HTTP endpoint with an outbound WebSocket and
an app-level token. It still requires a Slack app, workspace installation, event
acknowledgement, bot credentials for replies, and trust in Slack account and
workspace administration.

Neither remote channel is enabled merely because it has buttons. A future
proposal must decide whether to disclose complete canonical values to that
provider or add a different trusted remote review surface. It must also define
credential recovery, account compromise, replay, phone loss, provider outage,
and local fallback. Until then, remote callbacks may quick-deny only.

#### Gmail credential and mailbox-triage boundary

The gateway Gmail credential and OAuth client must have exactly
`gmail.readonly`. Any additional scope fails closed. Forbidden scopes include
full mail access, send, compose, modify, insert, add-on compose, settings, and
sharing scopes. Settings access is forbidden because vacation replies,
forwarding, send-as, and delegation can create outbound or exfiltration paths.

The protected executor uses a different OAuth client and refresh token for
approved sending. The mailbox-triage service uses a third OAuth client and token
under its separate OS identity. It receives the narrowest provider scope that
supports the fixed reversible operations and never receives the executor's
credential. Gmail's label-mutation scope is provider-level send-capable, even
though the triage RPC cannot express send. Process isolation, token ACLs, the
closed RPC, and the absence of model-controlled content in triage requests are
therefore mandatory parts of the boundary. Compromise of the triage identity or
token is outside the approval guarantee. Minting either protected credential
requires interactive owner consent and never occurs through the gateway.

Routine triage accepts only:

- archive by removing `INBOX`;
- mark read or unread by changing `UNREAD`;
- star or unstar by changing `STARRED`;
- mark important or not important by changing `IMPORTANT`; and
- apply or remove configured user-created labels.

Generic label actions reject `INBOX`, `UNREAD`, `STARRED`, `IMPORTANT`,
`TRASH`, `SPAM`, every `CATEGORY_*` label, every other system label, unknown
labels, and labels that change deletion or delivery state. No fixed action
exists for trash, spam, category changes, send, draft, insert, import, settings,
forwarding, send-as, delegation, or an arbitrary provider method.

The triage RPC accepts only its fixed enum, bounded message or thread IDs, and
closed user-label allowlist. It dispatches only approved message, thread, or
batch modify operations. It rejects raw request bodies, method names, extra
fields, and unknown labels before contacting Gmail. It has independent peer
authentication, replay defense, limits, audit, alerts, launchd lifecycle, and
recovery. It cannot call or load protected send-executor code.

#### Risks and tradeoffs

- **The native app is still trusted software.** Removing network hosting removes
  DNS, TLS, and exposed-service work. It does not remove the local authority,
  graphical app, code-signing, enrollment, update, and recovery lifecycle.
- **Same-user compromise is a residual risk.** The gateway must not run as
  Cole's login user. Arbitrary code or Accessibility control in the owner
  session remains outside the guarantee.
- **Notification delivery is best effort.** Disabled permissions or launch
  failures leave records pending and visible in the local inbox. They never
  cause approval.
- **Remote approval is not in version 1.** Outbound-only chat modes avoid
  inbound ports but add provider trust, privacy exposure, account recovery, and
  weaker transaction binding.
- **Gateway compromise can cause denial of service.** It can flood submissions
  or relay quick denies, but quotas, cooldowns, alerts, and signed approval
  prevent execution.
- **Protected local services are operationally significant.** Authority failure
  can pause approvals and sending. Independent triage-service failure can pause
  routine mailbox changes. Its provider token is send-capable even though its
  RPC is not, so triage identity or token compromise is outside the guarantee.
  Each service recovers inside its own protected identity and never restores
  unsafe gateway access.
- **Exactly-once effects depend on provider support.** Ambiguous outcomes become
  explicit unknown states and require reconciliation.
- **Agent continuation is at-least-once transport with idempotent consumption.**
  The design produces one transcript event and one semantic continuation, not
  exactly-once packet delivery.
- **A stable root-task identity may require upstream work.** Until it exists,
  quotas are the primary defense against cross-run duplicates.
- **The model may vary payloads to evade hash reuse.** Authority-native absolute
  limits and cooldowns remain effective.

#### Evidence

Current OpenClaw evidence:

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

The current session-delivery queue persists `agentTurn` and `systemEvent`
payloads, hashes stable idempotency keys, retries with backoff, and moves
exhausted entries to a failed queue. Plan 028 documents using that queue to wake
an agent after asynchronous work. This proposal reuses that transport but adds
authority-owned redelivery, signed result events, transcript uniqueness, and
consumption receipts because queue acknowledgement alone is not end-to-end
proof.

Related repository plans:

- Plan 014, egress approval;
- Plan 027, iMessage approval channel; and
- Plan 028, session-delivery queue for agent wake-up.

For protected effects, this plan supersedes the approval mechanics in Plans 014
and 027. Their content-policy and iMessage transport research remains useful,
but implementations must not use native-plugin authority, positive tapback
approval, plain-message approval, or `allow-always`.

Authoritative platform evidence:

- Apple local notification handling and callbacks:
  https://developer.apple.com/documentation/usernotifications/handling-notifications-and-notification-related-actions
- Apple notification action authentication:
  https://developer.apple.com/documentation/usernotifications/unnotificationactionoptions/authenticationrequired
- Apple LocalAuthentication policy evaluation:
  https://developer.apple.com/documentation/localauthentication/lacontext/evaluatepolicy(_:localizedreason:reply:)
- Apple Secure Enclave key protection:
  https://developer.apple.com/documentation/security/protecting-keys-with-the-secure-enclave
- Apple Secure Enclave token identity:
  https://developer.apple.com/documentation/security/ksecattrtokenidsecureenclave
- Apple key access-control flags:
  https://developer.apple.com/documentation/security/secaccesscontrolcreateflags
- Apple XPC services:
  https://developer.apple.com/documentation/xpc/creating-xpc-services
- Apple XPC peer code-signing requirements:
  https://developer.apple.com/documentation/foundation/nsxpcconnection/setcodesigningrequirement(_:)
- Apple push registration and provider requests:
  https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns
  and
  https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
- Telegram Bot API update methods:
  https://core.telegram.org/bots/api#getting-updates
- Slack Socket Mode:
  https://docs.slack.dev/apis/events-api/using-socket-mode

### Implementation

No implementation is authorized. If Cole approves this design, use separate
reviewable phases.

1. **Boundary and feasibility.** Prototype cross-identity launchd activation,
   XPC peer signing and UID enforcement, Notification Center delivery when the
   app is stopped, root-owned app updates, Secure Enclave signing with a fresh
   prompt, key recovery, isolated attachment scanning and viewing, and zero
   approval-subsystem network listeners. Prove the current gateway can run under
   a dedicated non-login identity. Define the exact residual same-user boundary.
2. **Resume feasibility.** Use a recording authority event to prove stable
   transcript insertion, one `agentTurn`, busy-lane behavior, missing-session
   fallback, consumption receipt, repair after queue exhaustion, and one
   semantic continuation after restart.
3. **Recovery snapshot.** Extend the deployment snapshot before changing any
   identity or credential. Capture packages, configuration, launchd jobs, UIDs,
   app signatures, IPC endpoints and ACLs, trusted policy, database and staging
   locations, notification state, Gmail routing, OAuth-client identities, and
   the preexisting keychain and permission posture. Restore it in an isolated
   fixture.
4. **Authority core.** Add the non-evicting schema, state machine, quotas,
   deduplication, immutable staging, sandboxed scanner protocol, policy,
   signatures, freshness, leases, reconciliation, retention, events, and
   metadata-only audit behind a disabled flag.
5. **Native decision surface.** Add the signed app, launchd registration,
   notification helper, inert renderer, per-decision protected signing, key
   enrollment and revocation, and isolated viewer.
6. **Mailbox triage.** Build the independent fixed triage service with a distinct
   OS identity, launchd job, OAuth client and credential, authenticated endpoint,
   action enum, label allowlist, replay defense, limits, audit, and recovery.
   Prove that no input can select sending or another forbidden action and that
   approval rollback leaves this service intact.
7. **Recording tool.** Connect one fake effect whose executor records envelopes,
   terminal provider evidence, and result events while every delivery adapter is
   deny-by-default.
8. **Durable continuation.** Add signed result verification, session inbox,
   transcript and consumption receipts, queue repair, fallback routing, and
   reconciliation.
9. **First provider adapter.** Add one credential-isolated non-production
   adapter with immutable staging and idempotency or reconciliation.
10. **Controlled enablement.** Enable one owner and one low-volume tool only
    after lifecycle tests, security review, bypass audit, identity migration,
    key recovery rehearsal, and rollback all pass.

Do not serialize live hook context to retrofit arbitrary synchronous tools. Do
not place authority state, protected credentials, or owner decision keys in a
native OpenClaw plugin. Do not implement positive tapback approval, approval
through plain iMessage, notification-button approval, or `allow-always`.

### Validation

The proposal has been checked against current OpenClaw and repository source,
Plans 027 and 028, and authoritative Apple, Telegram, and Slack documentation. A
future implementation must add committed recording-based tests to the
repository-managed integration pool. No automated or live-target test may send
a message, approve a real effect, or mutate a live account.

#### Identity, IPC, and no-listener boundary

Tests must prove:

- separate gateway, authority, and owner-login identities and file, database,
  keychain, process, policy, and staging isolation;
- a committed integration inventory of every agent profile and invocation
  surface, including primary agents, subagents, native harnesses, MCP tools,
  browser tools, shell tools, diagnostics, direct provider clients, raw network
  clients, and compatibility or disabled-authority fallbacks;
- each inventoried surface either routes the protected effect through the
  authority or provably lacks the credential, executable, API, permission,
  network route, and tool capability needed to create that effect;
- startup and configuration validation failing closed when a new or unclassified
  profile, tool, plugin, client, fallback, credential, route, or invocation
  surface could reach the protected effect;
- the complete invocation-surface inventory and bypass assertions running in
  the committed repository-managed integration pool for every protected tool;
- the gateway account cannot modify the root-owned app, launchd definitions,
  peer requirements, authority public key pin, decision key ACL, or viewer
  sandbox;
- exact code-signing, UID, entitlement, role, and protocol checks for every XPC
  peer;
- separate submit, notify, quick-deny, owner, resume, and triage capabilities,
  with a complete method-to-role matrix and no capability confusion;
- the authenticated authority cold-starting the stopped per-user notification
  helper through its registered notify-only Mach service;
- an unauthorized connection being rejected before any notification, record
  access, durable mutation, or authority action, even though launchd may already
  have started the helper;
- launch storms, repeated invalid peers, idle exit, startup resource limits,
  launchd throttling, bounded audit, and alert suppression containing the
  unauthorized-activation denial-of-service risk;
- rejection of forged authority peers, signatures, sequences, record IDs,
  template versions, summaries, fields, and oversized notification payloads;
- notify-only peers being unable to fetch records, decide, quick-deny, invoke
  triage, acknowledge, or execute;
- unavailable authenticated method access or unbounded unauthorized launch cost
  failing the feasibility gate rather than falling back to a network listener,
  polling daemon, shared writable file, or unauthenticated bridge;
- quick deny accepting only a correlated opaque pending record, applying an
  idempotent pending-to-denied transition, enforcing independent quotas and
  replay checks, and returning no record contents;
- quick-deny peers being unable to read, approve, cancel, re-arm, execute,
  acknowledge, enumerate, or invoke triage;
- triage peers being unable to submit approval records, quick-deny, read
  authority state, decide, execute protected work, or acknowledge results;
- rejection of PID reuse, self-claimed identity, unsigned clients, ad hoc
  signatures, sibling apps, wrong UIDs, stale app versions, injected classes,
  oversized frames, unexpected methods, replayed nonces, sequence rollback, and
  confused-deputy role changes;
- interruption, invalidation, malformed reply, partial request, timeout, and
  launch failure all fail closed;
- any Unix-socket fallback resists symlink replacement, path takeover, unsafe
  permissions, peer spoofing, framing ambiguity, replay, and concurrent cleanup;
- process and host inspection finds no new approval-subsystem AF_INET or
  AF_INET6 listening socket, DNS record, TLS key, proxy route, firewall rule, or
  inbound network dependency; and
- outbound provider, Telegram, or Slack connections cannot create an inbound
  route to an approval operation.

#### Notification, review, and owner signing

Tests must cover:

- notification permission granted, denied, and revoked; helper stopped at
  delivery; callback during cold launch; delegate registration order; duplicate
  alerts; stale record IDs; and no-notification fallback;
- every notification action, unlock callback, dismissal, forged local
  notification, deep link, Apple Event, URL open, and direct app launch being
  unable to decide;
- authority bundle signature validation, wrong authority key, stale bundle,
  changed fields, changed digest, wrong owner, wrong record, and expired
  challenge;
- exact original and resolved values, canonicalization stability, schema
  migration, digest display, and changed-value highlighting;
- bidirectional text, zero-width text, newlines, homoglyphs, punycode, HTML,
  Markdown, link spoofing, and renderer truncation;
- one fresh authentication context per decision, zero reuse, owner cancellation,
  lockout, unavailable biometry, changed enrollment, invalidated key, wrong key,
  signature replay, changed decision, simultaneous decisions, and permanent
  approval rejection;
- proof that LocalAuthentication success without the protected digest signature
  changes no state; and
- recovery-key enrollment, theft resistance, revocation, rotation, and gateway
  denial.

#### Attachments

Tests must cover:

- byte-only ingestion and refusal to open caller paths;
- traversal, symlink, privileged-path, size, digest, replacement, and cleanup
  failures;
- inaccessible staged objects from the gateway and owner-login accounts;
- scanner isolation from the authority UID, database, keychain, credentials,
  staging writes, owner and decision IPC, unrelated files, and network;
- byte-only or read-only-descriptor scanner input with no authority path;
- scanner input, memory, CPU, wall-time, process, recursion, decompression, and
  output limits, including parser exploits, zip bombs, nested archives, hangs,
  crashes, and forced worker restart;
- rejection of malformed, oversized, injected, stale-version, cross-record, and
  uncertain scanner output, with scanner text unable to select policy or
  execution fields;
- missing scanner, unavailable sandbox, timeout, limit breach, version mismatch,
  or uncertain verdict making zero provider calls;
- active HTML, SVG, XHTML, scripts, macros, external resources, malformed media,
  and sniffable content never rendering in the signing process;
- viewer absence of decision key, owner IPC, provider credential, network,
  clipboard export, Accessibility permission, and staged-write access;
- byte, descriptor, memory, process, recursion, time, and output limits;
- viewer crash, hang, compromise simulation, stale preview, changed staged bytes,
  and signing only after viewer exit and bundle refetch; and
- metadata-only fallback when safe preview is unsupported.

#### Lifecycle, execution, and pressure

Tests must cover:

- reuse of active duplicates and behavior after every terminal state;
- same-task success, explicit duplicate review, renewal, lineage uniqueness,
  newest-generation lookup, and rejection of model-driven renewal;
- owner, session, tool, submitter, and global quotas;
- authority-native limits remaining effective while the gateway forges and
  rotates run, session, process, and claimed-user identities;
- varied-payload floods, notification limits, signed-denial cooldown, quick-deny
  cooldown, legitimate distinct requests, and operator clearing;
- approve, deny, expiry, signed cancellation, administrative cancellation,
  stale approval, signed re-arm, unsolicited resubmission, quick deny, and
  simultaneous decisions;
- the stale re-arm window starting on entry, ending within 23 hours, and becoming
  terminal without reviving or releasing the wrong lineage;
- immediate tool return with no open promise or agent turn;
- a recording provider receiving exactly the approved stored envelope and
  protected staged bytes, byte for byte;
- direct, encoded, resolved, and attachment-borne secrets being denied even
  after valid approval, with missing or uncertain policy making zero provider
  calls;
- crashes before claim, after claim, before provider call, after provider
  acceptance, and before terminal-result persistence;
- recovery on both sides of the absolute execution deadline;
- idempotent retry, provider reconciliation, and unknown outcome without blind
  resend; and
- denial, expiry, stale approval, integrity failure, and capacity failure never
  reaching the provider.

#### Trusted result and continuation

Tests must cover:

- state and provider evidence committed before any terminal or status event is
  emitted;
- `sent`, `denied`, `expired`, `failed`, `cancelled`,
  `input_integrity_failed`, `approval_stale`, and `execution_unknown` result
  shapes;
- correct provider receipt ID and timestamp for a recording email adapter;
- content-free errors with no body, token, attachment, or raw provider response
  entering events or transcripts;
- authority-signature validation and rejection of forged, modified, stale,
  cross-owner, cross-tool, and out-of-sequence events;
- one continuation key per original tool call and lineage, with the first
  terminal outcome claiming it transactionally;
- `approval_stale`, approval, re-arm, and notification failure updating the
  inbox without scheduling an `agentTurn`;
- stale then re-arm then `sent`, and stale then re-arm then denied, producing
  only one semantic continuation at the terminal outcome;
- owner-signed renewal after terminal expiry delivering follow-up status without
  resuming the expired tool call a second time;
- original session idle, busy, locked, restarted, reset, deleted, rotated, and
  unavailable;
- exact transcript insertion, stable event-ID uniqueness, durable
  continuation-row and outbox transitions, outbox leases, `agentTurn`
  idempotency, expected-session checks, owning-agent inbox fallback, and later
  delivery when no session exists;
- queue retry, queue exhaustion, authority redelivery, repair-loop restart,
  transcript receipt loss, consumption receipt loss, and acknowledgement loss;
- crashes before and after transcript append, state advance, outbox creation,
  enqueue, queue acknowledgement, turn claim, prompt assembly, continuation
  checkpoint, completion, consumption receipt, and authority acknowledgement;
- an existing transcript event with missing or incomplete continuation state
  rescheduling safely instead of suppressing the only resumed turn;
- consumption remaining unacknowledged until the turn completes or durably
  checkpoints all remaining work;
- lease expiry, transcript and queue reconciliation, stable resumed-turn IDs,
  later-tool and delivery idempotency, and explicit `continuation_unknown`
  rather than blind replay after an ambiguous side effect;
- one model-visible trusted tool result and one semantic continuation despite
  duplicate packets, duplicate queue entries, crash at every handoff, and
  out-of-order sequences;
- resumed processing beyond the protected tool with no regenerated effect,
  duplicate provider call, duplicate user delivery, or second continuation; and
- an explicit alert and retained inbox item when the resumed turn repeatedly
  fails.

#### Gmail boundary and cutover

Using hermetic recording OAuth and Gmail fixtures that never contact an external
account, tests must prove:

- simulated old-token revocation is requested only after replacement readiness;
- the replacement gateway scope set equals exactly `gmail.readonly`;
- source, configuration, and normal consent request no other scope;
- direct send, draft send, vacation reply, filter, forwarding, send-as, and
  delegation attempts fail before mutation;
- gateway, protected executor, and mailbox-triage OAuth clients, refresh tokens,
  and OS identities are distinct;
- the triage identity cannot read the protected send credential, approval
  database, owner keys, executor IPC, or staged approval data;
- triage accepts only fixed actions and configured user labels;
- triage dispatches only approved modify operations;
- method injection, raw bodies, extra fields, send, draft, insert, import,
  trash, settings, forwarding, send-as, delegation, unknown labels, and
  disallowed system labels are rejected before Gmail;
- fixed archive, read-state, star, and importance actions produce only their
  named reversible label changes in the recording fixture;
- every inventoried routine triage behavior remains available;
- triage launchd, endpoint, audit, credential, recovery, and health checks remain
  available while approval intake, decision UI, and executor jobs are disabled
  or rolled back;
- pre-revocation failure leaves old credentials and routing unchanged;
- revocation is the final irreversible cutover step;
- post-revocation failure alerts and follows isolated triage-service recovery;
  and
- approval rollback leaves narrow mailbox triage running.

No automated test revokes a real token, changes a real label, or calls a live
Gmail mutation endpoint. Live-target validation is limited to read-only
configuration, scope, identity, endpoint health, and access-denial checks.

#### Retention, channels, and rollback

Tests must cover:

- payload retention, metadata-only audit, purge, backup, and restore;
- rollback with pending, approved, stale, executing, unknown, and undelivered
  result records;
- drain-only rollback retaining authority result emission, continuation outbox,
  and resume IPC until every terminal event has transcript and consumption
  receipts;
- a failed drain migrating continuation state to a tested recovery daemon before
  any original result-delivery job or endpoint unloads;
- continuous time across sleep; process restart in one boot; changed boot
  identity; wall-clock rollback while stopped; uncertain downtime; clock skew;
  and large forward jumps;
- reboot or uncertain time expiring pending records and challenges, making
  approved work stale, reconciling claimed work, and blocking cooldown release
  until trusted-time recovery;
- expiry without revival for pending records, challenges, cooldowns, execution
  windows, and viewer capabilities;
- iMessage notice, quick deny, unavailable transport, stale reaction, target
  retention, and no positive decision;
- disabled Telegram, Slack, and APNs decision paths in version 1;
- optional outbound-only channel prototypes creating no inbound listener and
  giving the gateway no channel credential; and
- the full repository-managed integration lifecycle with recording adapters and
  no live delivery or mutation.

### Rollout and rollback

No rollout occurs during this design task. A later rollout follows this order:

1. Keep approval intake, protected execution, notifications, and production
   credentials disabled.
2. Extend and fixture-test the complete recovery snapshot before changing
   identities, jobs, app installation, keys, IPC, Gmail routing, or permissions.
3. Create isolated test identities with fake credentials, a recording executor,
   signed test app, test decision key, and deny-by-default delivery adapters.
4. Prove launchd activation, peer authentication, no new network listener,
   protected signing, attachment isolation, terminal results, continuation,
   restart, spoofing, flood handling, retention, and rollback.
5. Stage the production gateway identity, authority identity, root-owned app,
   approval launchd jobs, role-specific IPC policies, stores, audit, and alerts
   while every protected effect remains disabled.
6. Build and validate the separate mailbox-triage identity, launchd job,
   endpoint, OAuth client, credential, audit, and recovery while the old gateway
   credential and routing remain unchanged.
7. Route routine triage through the independent service. Verify the replacement
   gateway credential is exactly read-only, remove every alternate send path,
   and revoke the old token last.
8. Enroll at least two owner recovery credentials through the protected
   administrative path. Rehearse notification denial, app loss, key
   invalidation, and recovery with recording effects only.
9. Enable one owner and one low-volume protected tool after all local,
   integration, security, and rollback gates pass.
10. Register more tools only after observed stability. Remote approval remains
    disabled until a separate trust and privacy decision approves it.

Operational readiness requires durable counts for records by state, oldest
pending age, deduplication hits, capacity rejection, notification failure,
invalid peer, signing failure, stale approval, expired lease, integrity failure,
unknown execution, undelivered result, resume failure, quick deny, and
reconciliation repair. Anomalous deny, submission, and stale rates alert.

Approval rollback:

- disables new submissions and executor claims;
- removes the protected tool from every agent profile;
- rejects new decisions;
- cancels pending, approved but unclaimed, and stale records;
- persists and delivers cancellation results;
- puts the authority reconciler, result emitter, continuation outbox, and resume
  adapter into drain-only mode;
- reconciles executing work without blind retry and persists every terminal
  result;
- keeps authority event IPC and resume IPC available until every cancellation,
  execution, and unknown-outcome event has transcript and consumption receipts;
- retains and retries undelivered terminal events with the normal repair and
  alert policy;
- durably migrates any continuation that cannot drain to a tested recovery
  daemon before the original resume adapter can unload;
- unloads approval intake, decision, scanner, viewer, and executor jobs first,
  then unloads result-delivery jobs and removes their IPC only after the drain or
  migration is proven complete;
- disables the review app and revokes candidate-added decision keys only after
  no pending decision or continuation depends on them;
- restores snapshotted packages, configuration, identities, ACLs, policy,
  routing, stores, jobs, and preexisting permission posture;
- preserves records through retention and purges staged data on schedule; and
- verifies no approval-subsystem listener or orphaned credential remains.

Approval rollback does not unload, disable, restore over, or remove the
mailbox-triage identity, job, endpoint, audit, or credential after Gmail
revocation. That service has a separate runbook and snapshot. Before revocation,
triage cutover failure restores prior routing and credentials. After revocation,
it alerts and fixes forward inside the isolated triage service unless another
narrow non-send path is already proven. No rollback restores direct protected
tools, send-capable gateway access, or a protected credential to the gateway
account.

All live-target validation and rollback checks are read-only. Every message,
notification action, provider effect, and mailbox mutation uses deny-by-default
recording adapters until controlled enablement. No test may deliver a real
message or mutate a live account.

### Review log

Earlier independent review established the separate credential and execution
boundary, immutable input handling, one-time decision binding, safe rendering,
attachment isolation, execution freshness, reconciliation, nondecreasing time,
quotas, cancellation, renewal, durable result delivery, and the exact Gmail
read-only cutover. The readability review then removed repeated chronology
without dropping those decisions.

This revision replaces the hosted HTTPS and WebAuthn surface with an on-demand
native macOS design. Research confirmed that local notification actions call
back into an app and that device-unlock gating is not a transaction signature.
The design therefore uses notifications only to open the app. Research also
confirmed that LocalAuthentication alone is not a digest-bound decision, so the
app must perform a protected signature over the current authority record after
fresh owner authentication.

XPC and launchd provide the preferred no-network-listener activation path.
Peer code-signing requirements, role-specific endpoints, UID checks, and replay
defense protect the local protocol. The design explicitly requires gateway,
authority, and GUI identity separation and records that arbitrary owner-session
compromise remains outside the claim.

OpenClaw source and Plan 028 show that the session-delivery queue is suitable for
waking a busy agent but does not prove transcript insertion or model
consumption. The revised design adds authority-owned redelivery, event
signatures, stable transcript IDs, consumption receipts, missing-session
fallback, and one semantic continuation.

Independent continuation review found that transcript insertion and queueing
were not one recoverable handoff. The design now uses a durable continuation row
and outbox, leased dispatch, stable resumed-turn IDs, and acknowledgement only
after completion or a durable continuation checkpoint. Follow-up review added
an explicit `continuation_unknown` state with evidence-gated repair, keyed
continuation to the original tool call and lineage so nonterminal stale events
cannot wake it twice, and made reboot or uncertain downtime invalidate
authorization-bearing time.

Final attachment-boundary review found that preview isolation did not also
protect the authority from hostile content parsers. Scanning now runs in fresh
credential-free, network-denied, resource-bounded sandboxes under a separate
identity. The authority treats every scanner result as untrusted and fails
closed on parser, sandbox, schema, version, or resource failure.

Terminal IPC review found that quick deny and routine mailbox triage had required
mutations but no declared peer roles. The design now has separate submit,
deny-only, owner, resume, and triage capabilities. Quick deny is an explicit
fail-safe denial-of-service exception. Mailbox triage has its own OS identity,
launchd job, OAuth client, credential, endpoint, audit, recovery, and rollback
lifecycle and no approval authority access.

Clean-room review corrected three final operational claims. Gmail's mutation
scope is itself provider-level send-capable, so the triage token is protected
accordingly and triage identity or token compromise is outside the guarantee.
Approval rollback now keeps result emission and resume delivery in drain-only
mode until every terminal event is acknowledged or durably migrated. Gmail
revocation and label-change validation now uses hermetic recording fixtures;
live-target checks remain strictly read-only.

Final activation review found that the notification helper had no declared
authority-to-helper trigger. It now exposes a notify-only launchd Mach service
that authenticates the authority and verifies a signed bounded alert payload.
Cold launch across the authority and graphical launchd domains is an explicit
feasibility gate with no insecure fallback. Follow-up corrected the launch
lifecycle claim: launchd may start the helper before peer checks, so the design
guarantees no pre-authentication side effect and bounds unauthorized launch
cost instead of claiming authority-only process activation.

Final completeness review restored a committed integration inventory for every
agent profile and invocation surface, including subagents, MCP, browser, shell,
diagnostics, direct clients, and fallbacks. Each surface must use the authority
or provably lack every capability needed for the protected effect. The Human
Design was also tightened to decision-level architecture so operational detail
remains in the Agent section.

Telegram long polling and Slack Socket Mode avoid inbound ports through
outbound-only connections, but they add provider-held metadata, credentials, and
account trust. Apple push notifications require a mobile app, entitlement,
device token, and provider lifecycle. All three remain outside version 1.

The complete native revision passed independent high-threshold review focused on
IPC spoofing, same-user compromise, notification bypass, decision-key binding,
continuation durability, attachment isolation, no-listener accuracy, remote
channel tradeoffs, credential scope, rollback drainage, invocation-surface
bypasses, and launchd activation. The release-candidate review found no remaining
actionable issues.

### Checklist

- [x] Re-read current repository instructions and the safe design workflow.
- [x] Re-read the full proposal, issue 68, current OpenClaw source, and Plans 027
      and 028.
- [x] Research local actionable notifications, LocalAuthentication, Secure
      Enclave key use, launchd, XPC, APNs, Telegram long polling, and Slack Socket
      Mode.
- [x] Replace hosted web, DNS, TLS, proxy, firewall, and download-origin
      assumptions with a no-network-listener native design.
- [x] Define separate gateway, authority, triage, GUI, scanner, viewer,
      notification, and resume identities and capabilities.
- [x] Define authenticated submit, notify, deny-only, owner, resume, and triage
      IPC roles with closed methods, replay controls, and independent lifecycles.
- [x] Define authenticated on-demand notification-helper activation with signed
      bounded payloads and no insecure fallback.
- [x] Require committed integration coverage for every agent profile, invocation
      surface, direct client, and fallback that could bypass approval.
- [x] State the provider-level capability and residual risk of the protected
      mailbox-triage token.
- [x] Define Notification Center as alert-only and native inert review as the
      sole version 1 decision surface.
- [x] Bind every decision to a protected per-operation signature over the exact
      authority record.
- [x] Define immutable input, attachment, policy, deduplication, quota, time,
      execution, reconciliation, renewal, cancellation, and retention rules.
- [x] Isolate hostile attachment scanning from authority credentials, state, IPC,
      network, and filesystem access with bounded fail-closed workers.
- [x] Define terminal provider evidence, authority-signed result events,
      transcript receipt, consumption receipt, busy-session handling,
      missing-session fallback, and one semantic continuation.
- [x] Compare iMessage, APNs, Telegram long polling, Slack Socket Mode, XPC, Unix
      sockets, and hosted HTTPS review.
- [x] Preserve the exact Gmail read-only gateway boundary and fixed reversible
      mailbox-triage service.
- [x] Define implementation phases, validation, rollout, recovery snapshot,
      rollback, risks, and operational signals.
- [x] Keep result delivery in drain-only mode through rollback and make every
      Gmail mutation or revocation test hermetic.
- [x] Keep the work design-only and provider-neutral.
- [x] Keep the Human Design concise while preserving the present recommendation,
      tradeoffs, iMessage role, review flow, isolation, and durable continuation.
- [x] Complete independent high-threshold review and fix every actionable
      finding.
- [x] Confirm exact document and issue shapes, no em dash, public-safety checks,
      documentation-only diff, and existing PR checks.
