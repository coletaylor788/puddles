# Plan 030: Secure Apple Notes sharing

**Status:** Design only, awaiting explicit prototype approval
**Issue:** None
**Last updated:** 2026-07-30

## Human section

### Design

A dedicated Apple account receives shared notes from people who already have an
authenticated direct-message binding. Automatic intake starts only when the
messaging service proves that the final complete direct-message composition has
exactly one row, and that row contains only one supported collaboration link
with no preview or companion content. A timer cannot prove completeness.
Sharing then uses a short confirmation exchange in that same conversation. The
invitation stays tied to the completion proof through acceptance and reading. A
later companion item cancels or quarantines the action and blocks the note from
reads. The system accepts the invitation through a separate Notes service,
records the note and the sender's grant, then exposes bounded list and read
tools. Version one cannot edit notes because a whole-body write could overwrite
a collaborator's newer changes.

Access follows the existing direct-message relationship. The top tier can read
every active grant. The household tier can read household and friend grants.
Each friend can read only notes granted through that friend's exact sender
partition. A forwarded link does not carry a higher trust level because the
authenticated conversation that receives the link defines the grant.

The design keeps message intake, model work, Apple applications, policy, and
note acceptance in separate security domains. It also gives each friend
separate conversation and execution state. Durable journals, bounded attachment
spools, replay barriers, and careful recovery keep crashes and rollback from
repeating actions or losing control records. After a crash, even a complete
staged attachment copy is deleted, confirmed absent, and copied again instead of
being promoted. Apple does not provide supported interfaces for several
required invitation and identity operations, so those facts must be proven with
disposable accounts and recording adapters before implementation is approved.

### Status

The provider-neutral design is complete for review. It defines provider-proven
single-row proposal admission, read-only access, grant rules, invitation
confirmation, service isolation, durable recovery, attachment limits, relay
controls, validation, rollout, and rollback.

No prototype or implementation work is approved or started. A prototype-only
approval can authorize disposable proof work. Its results must update this
design before a separate approval can authorize implementation.

## Agent section

### State

- Lifecycle state: design only.
- Approval gates: first stop for explicit disposable prototype approval. After
  prototype evidence updates this plan, stop again for explicit implementation
  approval.
- Production impact: none. No account, service, permission, invitation, message,
  note, or deployment changes are authorized by this update.
- V1 capability: accept, list, and read shared Apple Notes. V1 has no create,
  append, update, delete, move, participant management, or account-wide
  membership removal tool.
- Primary safety reason for read-only scope: Notes exposes whole-body writes
  without a supported conflict-safe compare-and-set operation. A write can
  overwrite collaborator edits that the caller has not seen.

### Scope and acceptance criteria

- A dedicated Apple ID accepts and reads collaboration invitations received
  through already authenticated, exact direct-message bindings.
- One authenticated source text row can create one pending proposal only when
  immutable messaging-provider evidence proves that the provider-final
  composition contains exactly that one complete row and its entire content is
  exactly one allowlisted Apple collaboration link with no preview metadata,
  attachment, companion row, or other content.
- The trusted transport, not a model, generates and sends an immutable challenge
  containing a cryptographically random 128-bit code. It replies to the exact
  source row.
- The same exact peer confirms by replying to that exact challenge in the same
  direct-message thread. The reply body must contain only the saved code phrase.
- Confirmation is consumed before ordinary model processing and creates one
  short-lived isolated turn with only invitation acceptance and content-free
  response generation available.
- A deterministic Notes broker accepts the invitation, causally maps it to one
  stable Apple note ID, and atomically records the canonical note identity and
  an independent sender grant.
- List and read operations reauthorize every returned resource from trusted
  runtime identity and the grant registry.
- Top-tier callers can read all active grants. Household callers can read
  household and friend grants. Friend callers can read only grants in their
  exact sender partition.
- Each friend has isolated transcript, session, memory, workspace, browser,
  process, and subagent state.
- Friend web access and owner relay cannot cross peer or policy boundaries.
- Raw ingress, split-message composition, action tickets, relay tickets,
  cursors, replay barriers, attachment state, and recovery metadata are durable.
- Attachment admission and cleanup preserve reserved space for text, cursor,
  sentinel, and other control progress.
- Rollback never restores live journal or spool state from an older snapshot.
- Every automated test uses disposable state and fake or recording adapters.
  Automated live checks are read-only and never send messages, accept
  invitations, change notes, or alter memberships.
- Implementation remains blocked until prototype-only work is separately
  approved, every prototype gate has a recorded pass or approved design change,
  this plan is updated, and implementation receives a second explicit approval.

Out of scope for V1:

- Proving the cryptographic owner of an Apple note.
- Using Contacts groups to classify a sender.
- Trusting a tier asserted in message text, a forwarded link, note content, a
  model response, or an untrusted process.
- Reading unregistered notes or browsing the dedicated Apple account outside
  active grants.
- Note or folder writes of any kind.
- General browser automation for invitation acceptance.
- Group chats, command-line callers, cron jobs, subagents, delegated callers, or
  wildcard/default identities as invitation grantors.

### Architecture and decisions

**Grant model**

- Deployment-owned policy maps each authenticated direct-message binding to one
  of three classes: top, household, or friend. Policy is read-only to all runtime
  services.
- The authenticated sender is the policy grantor. The design does not claim
  that the sender is the cryptographic Apple owner or sharer.
- A top grant is visible only to the top tier. A household grant is visible to
  the top and household tiers. A friend grant is visible to the top and
  household tiers, and to the friend whose exact sender partition created it.
- A viable collaboration link forwarded by another person is classified from
  the receiving direct-message binding. Link contents and prior delivery do not
  raise the receiving sender's tier.
- Canonical note identity and authorization grants are separate records. One
  canonical note can retain multiple independent grants.
- Revoking one grant cannot remove account-wide membership while any other
  active grant, unresolved acceptance intent, relay reference, or registered
  resource reference still depends on that membership.

**Proposal and confirmation protocol**

- Eligibility requires immutable completion evidence received through the
  authenticated messaging-provider ingress. The evidence binds the exact
  account, channel, peer, direct-message thread, source member key, provider
  event ID, provider composition key, provider finality marker and order
  boundary, complete ordered row inventory, cardinality of exactly one, raw body
  digest, row kind, and complete metadata inventory.
- The evidence must prove one complete source text row whose entire body is
  exactly one supported allowlisted Apple collaboration URL. Empty text,
  multiple links, non-Apple links, mixed text, attachments, previews, URL text
  accompanied by preview metadata, composed or split multi-row input, companion
  rows, and group input are ineligible.
- Missing, malformed, altered, duplicated, or replayed completion evidence
  denies. A local coalescing or composition timeout is never evidence of
  completeness and cannot create a proposal or challenge. A messaging provider
  that cannot attest finality, the complete ordered inventory, and exact
  one-row cardinality is ineligible for automatic proposals.
- The ingress journal stores the immutable completion evidence, exact source
  member key, provider composition key and generation, contradiction latch, and
  normalized authenticated route before proposal creation.
- Any late row or metadata linked to the same provider composition key
  permanently invalidates the proposal evidence. Before confirmation
  consumption and again before grant commit, the journal rechecks that no
  companion or preview appeared. It closes an unconsumed proposal and challenge,
  cancels an unexecuted action, or quarantines a UI-crossed intent without
  activating a grant. A contradiction discovered after grant commit advances
  the composition generation and sets its latch in one transaction, which makes
  every linked grant immediately fail read authorization pending reconciliation.
- Final confirmation authorization and transition to `ui_crossing` occur in one
  journal transaction under the composition key. The transaction verifies the
  provider-final evidence, exact one-row inventory, unchanged composition
  generation, and clear contradiction latch, then records the generation fence.
- Contradiction ingestion serializes on the same composition record. If it wins
  before the `ui_crossing` transaction, no UI action can start. If it arrives
  after the fence, it durably sets the contradiction latch and advances the
  composition generation. Terminal grant commit is a compare-and-set that
  requires the original generation and a clear latch. A failed compare-and-set
  quarantines any UI-crossed intent and activates no grant.
- At most one pending proposal exists per exact peer. The deployment has at most
  100 pending proposals globally. A proposal expires after ten minutes and
  cannot be extended or reset.
- The trusted transport generates a 128-bit random code and persists the exact
  fixed challenge phrase before delivery. The model never sees or writes the
  challenge.
- Challenge delivery is an immutable reply anchored to the exact source row.
  Failure to establish the reply anchor fails closed and does not create an
  ordinary conversational prompt.
- A valid confirmation comes from the same account, channel, exact peer, agent,
  session, route, and direct-message thread. It replies to the exact challenge
  member key and contains only the exact code phrase. URLs, attachments, extra
  text, alternate whitespace, alternate casing, quoting, edits, reactions, and
  alternate threads deny.
- The transport atomically consumes a valid confirmation before ordinary model
  processing. Expired, rejected, replayed, or already consumed confirmations
  never become model input.

**Isolated acceptance turn**

- Confirmation creates a short-lived isolated turn. Its immutable manifest
  exposes only a zero-argument invitation-acceptance action and content-free
  response generation.
- Runtime context seals the proposal key, source member key, confirmation member
  key, immutable completion-evidence key and digest, provider composition key
  and generation fence, exact account, channel, peer, agent, session, route,
  policy generation, nonce, and expiry.
- The acceptance action has no caller-controlled arguments. It obtains the URL
  and all authority from sealed trusted context.
- After final authorization, the acceptance service acquires a lease on the
  sealed policy generation before broker IPC. It holds that lease through
  terminal acceptance and grant commit, or through durable quarantine after any
  UI crossing. A policy change cannot overtake the leased operation.
- Missing or mismatched context denies. Cron, group, command-line, subagent,
  delegated, wildcard, default, synthetic, or replayed context denies.
- The turn cannot list notes, read content, browse, use memory, call another
  tool, spawn a process or subagent, or emit user-controlled content.

**Deterministic Notes acceptance broker**

- The broker runs under a dedicated Notes GUI identity. It accepts only
  authenticated, bounded IPC from the acceptance service.
- Before intent creation, the broker verifies its local OS build, Notes build,
  pinned helper version and digest, and approved UI profile against the
  deployment-owned matrix for the leased policy generation. It rechecks them
  immediately before UI action. Unknown, changed, or mismatched versions deny
  without opening Notes.
- Before any UI action, it validates the original URL and every redirect against
  exact Apple HTTPS host, path, port, and redirect rules. It rejects credentials
  in URLs, fragments used as authority, non-HTTPS schemes, unexpected hosts,
  excessive redirects, oversized responses, and DNS or address-policy failures.
- Before opening Notes, one transaction records an accepting intent, sealed
  context digest, normalized invitation identity, and a bounded baseline of
  stable shared-note IDs visible to the dedicated account.
- A version-pinned, least-privilege helper opens the validated invitation in
  Notes, performs the exact version-specific acceptance action, and reports
  terminal UI completion through authenticated broker-owned observation. It
  cannot accept a second prompt, choose another note, or treat window opening as
  success. No general browser or caller-selected application is used.
- After UI completion, the broker must causally map the invitation to exactly
  one stable Apple note ID and corroborate it against the bounded shared-note
  delta. Zero candidates, multiple candidates, unstable identity, unexplained
  pre-existing membership, or a delta outside the baseline window fails closed
  for reconciliation.
- If the normalized invitation identity already maps to one canonical note and
  current Notes membership still matches that registry record, the broker
  records a grant-only intent and skips UI acceptance. It atomically adds the
  sender grant to that canonical note. An unknown invitation that merely appears
  to reference a pre-existing note cannot use this path and remains fail-closed.
- The broker atomically stores canonical note identity, invitation evidence,
  acceptance outcome, and an independent grant from the authenticated sender
  only through the terminal composition-generation compare-and-set. Note content
  is not stored as invitation evidence.
- On startup and before new acceptance, the broker reconciles every unfinished
  UI-crossing intent. It never repeats UI action until durable evidence proves
  that the prior attempt did not cross the UI boundary.
- Account-wide membership removal is a separate fenced administrative
  operation. It is unavailable while any grant or reference remains.

**Read path**

- List and read tools derive caller identity from authenticated runtime context.
  No tool argument can select an account, tier, sender partition, policy
  generation, registry, or route.
- Every listed and read note is reauthorized against current deployment policy,
  the canonical registry, and an active grant. Each grant binds its immutable
  completion-evidence key, composition key, and accepted composition generation.
  Authorization requires the current generation to match and the contradiction
  latch to remain clear. A materialized grant status is not authority and may
  not bypass this join.
- Authorization is checked again after retrieval. That transaction acquires a
  short composition-generation read lease held through terminal bounded response
  release. Contradiction ingestion serializes on the same composition record, so
  either the read lease completes first under the still-valid generation or the
  contradiction commits first and the read denies.
- Responses bound result counts, page size, continuation lifetime, body bytes,
  title bytes, and total response bytes. Continuations are opaque, authenticated,
  policy-generation-bound, caller-bound, and short-lived.
- Text is normalized to a documented Unicode form. Control characters,
  malformed encodings, deceptive structure, and unsupported rich objects are
  handled deterministically.
- All note fields are data-marked at the trusted boundary and passed through
  prompt-injection filtering before model exposure. Note content remains
  untrusted even when the grantor is trusted.
- Errors reveal no note title, body, participant, path, Apple account detail, or
  cross-partition existence.

**Service and policy isolation**

- The non-GUI gateway, model worker, Messages GUI service, PIM GUI service, and
  Notes GUI broker/helper run in separate security domains with distinct
  credentials, storage, process controls, and authenticated bounded IPC.
- Messages and PIM GUI services use distinct macOS UIDs. Same-UID endpoints are
  not treated as isolation because they can reach the same files and TCC grants.
- The Notes GUI identity is distinct from both Messages and PIM identities and
  has only the permissions needed for the dedicated Notes account and pinned
  helper.
- The model worker cannot reach host files, PIM, Messages, Notes, policy,
  journals, registries, or GUI services directly.
- Each IPC endpoint authenticates both ends, binds requests to a service role,
  limits message and stream sizes, applies deadlines, rejects replay, and fails
  closed on unknown fields or methods.
- Deployment-owned policy is immutable during a generation. Runtime services
  receive only the minimum read-only view they need.

**Per-friend isolation, web proxy, and owner relay**

- Each friend gets a separate transcript, session key, memory store, workspace,
  browser profile, process boundary, and subagent namespace. No default or
  fallback namespace exists.
- Friend public-web access uses an authenticated HTTP/HTTPS proxy bound to the
  exact peer. The proxy resolves and connects itself, revalidates each redirect,
  and denies private, loopback, link-local, multicast, local, metadata, Unix
  socket, non-public, and policy-reserved destinations.
- DNS answers are pinned for the connection and checked again on redirect and
  reconnect. Host headers, TLS server names, IP literals, alternate numeric
  forms, user information, and proxy chaining cannot bypass destination policy.
- Owner relay creates an opaque, random, single-use ticket. The ticket is bound
  to the exact originating friend, origin event, policy generation, and exact
  delivered owner message.
- A reply can return only when the messaging transport proves that it is the
  provider-anchored owner reply to that delivered message. Free text containing
  a ticket is not authority.
- Return delivery revalidates current owner policy, friend policy, origin
  status, ticket status, and route. A policy-generation lease is acquired before
  release and held through terminal friend delivery or durable terminal failure.
- Revocation, expiry, duplicate owner replies, wrong anchors, wrong routes,
  stale generations, and missing origin rows deny without exposing cross-peer
  data.

**Durable journal and replay ownership**

- One durable journal owns raw ingress rows, immutable provider completion
  evidence, composition keys, generations, UI-crossing fences, contradiction
  latches, split-message composition, cursor floor, proposals, challenge and
  acceptance outcomes, replay barriers, relay tickets, producer event and
  ticket watermarks, spool rows, and cleanup metadata.
- Producer event IDs are monotonic. Each producer has a permanent
  `closed_event_through` watermark plus bounded gap tombstones. Once an event is
  closed, rejected, expired, compacted, or tombstoned, it can never mint a new
  action or relay ticket.
- Immutable action tickets have their own monotonic IDs and separate
  reject-through watermarks. Closing an ingress event does not erase action
  ticket rejection history.
- Only one consumer epoch owns delivery and action execution. Epoch fencing
  prevents an old process, restored process, or delayed callback from acting.
- Cursor advancement is transactional with durable composition and action
  outcomes. Cursor floor never moves backward.
- Rollback snapshots can restore code and static configuration only. They never
  restore live journal, registry, ticket, cursor, or spool state.

**Attachment streams, quotas, and control reserve**

- Attachment bytes cross service boundaries only through authenticated bounded
  streams. Paths, file URLs, descriptors from untrusted callers, and caller
  selected filesystem locations are never accepted.
- Limits are 20 files per message, 25 MiB per file, 50 MiB per message, 100 MiB
  of active attachment quota per peer, 512 MiB globally, and 256 KiB per frame.
- Deadlines are 60 seconds per file and 120 seconds for the whole message.
  Deadlines are monotonic and do not reset after retry, reconnect, or recovery.
- Active spool plus cleanup rows are capped at 100 per peer and 2,000 globally.
- New attachment admission stops at 448 MiB globally. The remaining 64 MiB and
  10,000 durable control rows are reserved for text, cursors, unavailable
  sentinels, ticket closure, and cleanup progress.
- Cleanup changes the existing spool row in place. It never allocates a second
  cleanup row or releases quota early.

**Spool state machine and recovery**

- Spool states are `needs_copy`, `reserved`, `ready`, `deleting`, `cleanup`, and
  `deleted`.
- Identity fields are state-specific. A `needs_copy` row has no current or
  staging identity. A `reserved` row is quota-charged and durably owns one
  attempt nonce plus one broker-generated staging locator inside a
  broker-only spool root before file creation. After exclusive no-follow
  creation and before the first byte, that same row records the exact staging
  parent, inode, current byte size, and current digest. A `ready` row records the
  exact final parent, inode, byte size, and digest. A `deleting` or `cleanup` row
  keeps the exact deletion-target identity and durable after-delete target. A
  `deleted` row retains historical deletion evidence but no live identity. All
  opens and deletes use no-follow semantics and verify the state-appropriate
  staging, current, or deletion-target identity immediately before action.
- Each bounded frame updates the reserved attempt's durable byte count and
  digest after the write is synced. A crash-visible mismatch moves the same row
  to `deleting`; it cannot resume or bless partial bytes. Final file and parent
  sync precede the atomic `reserved` to `ready` transition. Only the
  uninterrupted copy owner in the current consumer epoch can make that
  transition immediately after those syncs.
- Every crash-recovered `reserved` row is uncertain and can never transition to
  `ready`, even when its staging identity, length, and digest match the expected
  complete file. If its staging object is present, the same row moves through
  exact unlink, parent sync, and durable absence confirmation. If it is missing,
  the same row durably confirms absence. Only then can the row return to
  `needs_copy` and reserve another attempt.
- Initial copy receives at most three total attempts within one non-resettable
  five-minute deadline.
- A ready row has at most one non-resettable recovery episode. Recovery,
  cleanup, and at most three recovery copy attempts share one five-minute
  deadline.
- If durable evidence proves a ready file is absent, the same row can transition
  directly to `needs_copy`. It clears current identity and retains the prior
  identity only as historical recovery evidence.
- If a ready file is present but invalid, or absence cannot be proved, the same
  transaction moves the row to `deleting` with the exact old identity and a
  durable after-delete target.
- Two-phase deletion unlinks only the exact old identity, syncs the parent,
  confirms absence, and then advances the same row. No replacement path, inode,
  or row may exist before all four facts are durable.
- A failed or interrupted reserved attempt must pass through same-row deletion
  and durable absence confirmation before another attempt is reserved. If a
  crash occurs after staging creation but before its inode is stored, recovery
  uses the durable attempt nonce and protected staging locator to bind the
  no-follow object as the deletion target. It never treats that object as
  content and never recopies beside it.
- Quota remains charged through `deleting` and `cleanup` until durable deletion
  completion.
- Exhausted copy or recovery creates a content-free unavailable sentinel,
  detaches the attachment from message composition, and allows cursor and text
  progress. The same spool row retains cleanup state and quota.
- A successful recopy keeps the recovery-used marker. Any later loss
  terminalizes the attachment rather than starting another recovery episode.

### Implementation

Implementation is intentionally not started.

Prototype work is a separate lifecycle stage. It requires explicit
prototype-only approval and may use only disposable accounts, fixture
invitations, throwaway harnesses, and fake or recording adapters. It must not add
production code, change production accounts, or activate deployment paths. It
records exact OS and application versions and updates this plan with every gate
result. The updated design then stops for a separate implementation approval.

After that second approval, implementation proceeds in these
dependency-ordered slices:

1. Define deployment-owned identity and policy schemas, generation leases,
   authenticated IPC envelopes, durable journal migrations, registry records,
   and denial-safe error contracts.
2. Land journal compatibility, producer watermarks, action ticket watermarks,
   consumer epoch fencing, and the attachment state machine before any live
   producer cutover.
3. Establish distinct Messages and PIM GUI identities, then prove service
   account and TCC parity without changing live delivery.
4. Build the non-GUI gateway and isolated model worker boundaries. Add per-friend
   state separation, the public-web proxy, and owner relay.
5. Build proposal and challenge handling in trusted transport. Keep challenge
   generation, delivery, and confirmation consumption outside model processing.
6. Build the dedicated Notes GUI broker and version-pinned helper. Add intent
   reconciliation, URL validation, stable-ID mapping, grant storage, and
   account-wide membership fences.
7. Add bounded read-only list and read tools with per-resource reauthorization,
   pagination, normalization, data marking, and injection filtering.
8. Exercise the full fake and recording-adapter pool. Then stage each cutover
   behind pause, drain, generation fencing, and rollback checks.

Expected implementation artifacts must include:

- Focused unit and integration tests beside each component.
- Cross-component regressions in `packages/e2e/`.
- Durable migration and downgrade compatibility tests.
- Recording adapters for every message delivery, invitation acceptance, Apple
  UI action, note read, relay delivery, and attachment stream.
- Operator documentation for identity creation, TCC grants, policy generation,
  cutover, reconciliation, rollback, quarantine, and read-only health checks.
- No secret, account identifier, private peer binding, live invitation, or
  personal note content in source, fixtures, logs, plans, or test output.

### Validation

All scenarios below are required before rollout. Tests must assert both the
result and the absence of unintended model input, delivery, UI action, note
read, cross-peer disclosure, quota release, and cursor stall.

**Proposal, challenge, and confirmation**

| Scenario | Required result |
|---|---|
| Immutable provider evidence proves a final authenticated direct-message composition has a complete ordered inventory of exactly one row containing only one valid allowlisted collaboration link | One pending proposal is durably created and one immutable model-free challenge is anchored to that row |
| Source is unauthenticated, a group, cron, command-line, subagent, delegated, wildcard, default, or synthetic route | Deny before proposal creation |
| Completion evidence is missing, malformed, altered, duplicated, or replayed | Deny without proposal creation or challenge delivery |
| Evidence covers one row but omits the composition key, provider finality marker, order boundary, complete inventory, or exact cardinality | Deny automatic proposal creation |
| Messaging provider cannot attest provider-final composition and exact one-row cardinality | Automatic proposal path is unavailable |
| A coalescing or composition timer fires without immutable provider completion evidence | It has no proposal authority and cannot cause challenge delivery |
| Source is empty, split across rows, composed from multiple members, includes attachments, includes extra text, or has zero or multiple URLs | Deny without challenge delivery |
| Source contains one valid URL but also carries preview metadata or a preview companion | Deny without challenge delivery |
| A companion row or preview arrives after challenge delivery but before confirmation consumption | Permanently close the proposal and challenge; confirmation cannot create an action |
| A companion row or preview arrives after confirmation but before grant commit | Cancel an unexecuted action or quarantine a UI-crossed intent without activating a grant |
| Companion ingestion races final confirmation authorization and the `ui_crossing` transition | The composition-key transaction chooses one durable order: contradiction first denies UI, fence first records a cancellation latch that prevents grant activation |
| Companion ingestion races terminal grant commit after UI action | Composition-generation compare-and-set fails, no grant activates, and the intent remains quarantined for reconciliation |
| A provider-completeness contradiction is discovered after grant commit | One composition transaction advances generation and sets the latch; every linked grant immediately fails read authorization pending reconciliation |
| URL has a wrong scheme, host, port, path, credentials, malformed encoding, or disallowed redirect | Deny without UI action |
| Peer already has a pending proposal | Deny the new proposal without changing the original expiry |
| Global pending proposal count is 100 | Deny the new proposal while text and cursor processing continue |
| Proposal reaches ten minutes | Expire permanently with no extension, confirmation, or model input |
| Challenge cannot be anchored to the exact source member | Close or quarantine the proposal without an ordinary reply |
| Confirmation comes from a different account, channel, peer, agent, session, route, thread, or reply anchor | Deny and preserve peer isolation |
| Confirmation includes a URL, attachment, quote, reaction, edit, extra text, altered case, altered spacing, or only part of the phrase | Deny before model processing |
| Exact confirmation is replayed or arrives after consumption, rejection, or expiry | Deny permanently |
| Exact valid confirmation races with duplicate consumers | One consumer epoch consumes it once and creates one isolated turn |

**Sealed context and acceptance broker**

| Scenario | Required result |
|---|---|
| Any sealed key is missing or mismatched | Deny before broker IPC |
| Policy generation is stale, nonce is reused, or expiry has passed | Deny and close the action ticket |
| Policy is revoked before the acceptance generation lease is acquired | Deny before broker IPC |
| Policy change races after the acceptance generation lease is acquired | Hold the approved generation through terminal acceptance and grant commit or durable quarantine, then apply the new generation |
| Isolated turn requests arguments, another tool, memory, browser, process, subagent, note content, or user-controlled response content | Deny |
| Broker IPC is unauthenticated, oversized, replayed, late, unknown, or from the wrong service role | Deny without opening Notes |
| Runtime OS build, Notes build, helper version or digest, or UI profile is absent, changed, or outside the approved matrix | Deny before intent creation or UI action |
| Valid request has a redirect chain that leaves the allowlist or resolves to a denied address | Deny before intent crosses the UI boundary |
| Baseline cannot be bounded or durably stored | Deny before opening Notes |
| Crash occurs before intent commit | No UI action exists and retry can create one new intent |
| Crash occurs after intent commit but before UI open | Startup reconciliation proves no crossing before retry |
| Crash occurs during or after UI open but before result commit | New acceptance is fenced until reconciliation reaches a terminal or quarantined result |
| Shared-note delta has zero, two, or unstable candidates | Do not register a note; quarantine for reconciliation |
| Delta candidate does not causally match the invitation | Do not register a note or grant |
| Exact normalized invitation identity already maps to one canonical note and current membership matches | Record a grant-only intent, skip UI, and atomically add only the new independent grant |
| Unknown invitation appears to reference an already present note | Do not use the grant-only path; quarantine without adding a grant |
| One grant is revoked while another grant or reference remains | Keep account-wide membership |
| Membership removal races with a new grant or unfinished intent | Fence removal and preserve membership |

**Authorization and content handling**

| Scenario | Required result |
|---|---|
| Top-tier caller lists active top, household, and friend grants | Authorized resources are returned within bounds |
| Household caller lists household and friend grants | Authorized resources are returned, while top grants remain indistinguishable from absence |
| Friend caller lists its own sender partition | Only that exact partition is returned |
| Friend caller asks for another friend, household, top, wildcard, or default partition | Deny without existence disclosure |
| Link was forwarded by a higher-tier peer to a friend | Grant uses the authenticated friend's partition and cannot raise tier |
| Grant is revoked between list and read, or during retrieval | Reauthorization denies release |
| Composition contradiction commits while note retrieval or response release is in progress | Composition serialization gives one order: an existing bounded read lease releases first, or the contradiction commits first and post-retrieval authorization denies |
| Process crashes after contradiction generation/latch commit but before materialized grant status changes | Reads still deny from the authoritative composition join |
| Continuation is expired, altered, replayed by another caller, or from another policy generation | Deny |
| Count, page, title, body, or total byte bound is exceeded | Truncate or reject by the documented deterministic rule without leaking adjacent resources |
| Body contains malformed encoding, control characters, rich objects, deceptive markup, or prompt injection | Normalize, data-mark, filter, and retain untrusted classification |
| Content comes from a trusted sender | It remains untrusted and receives the same filtering |
| V1 caller attempts any note or membership write | No write-capable tool or route exists |

**Service, friend, proxy, and relay isolation**

| Scenario | Required result |
|---|---|
| Model worker attempts direct host, policy, journal, registry, Messages, PIM, or Notes access | Operating-system and service controls deny |
| Messages, PIM, or Notes service attempts to read another service's files, credentials, or TCC-protected data | Distinct UIDs and permissions deny |
| Friend transcript, session key, memory, workspace, browser, process, or subagent ID is reused across peers | Test fails; runtime has no fallback namespace |
| IPC peer is wrong, certificate or key is stale, payload is oversized, method is unknown, deadline passes, or replay is detected | Deny and record a content-free terminal outcome |
| Friend proxy targets private, loopback, link-local, multicast, metadata, local, non-public, or reserved space | Deny before connect |
| DNS changes between validation and connect, redirect, or reconnect | Deny and close the request |
| URL uses an IP literal, alternate numeric form, user information, Host override, TLS name mismatch, proxy chain, or Unix socket | Deny |
| Relay ticket is guessed, copied into text, reused, expired, revoked, or presented by another peer | Deny without origin disclosure |
| Owner response is not anchored by the messaging provider to the exact delivered owner message | Deny |
| Policy or origin changes before return delivery | Deny after current revalidation |
| Policy changes after authorization but before terminal friend delivery | Generation lease prevents mixed-policy delivery |
| Delivery fails after lease acquisition | Record one durable terminal failure and do not reuse the ticket |

**Journal, cursor, and replay**

| Scenario | Required result |
|---|---|
| Process crashes while ingesting raw rows or composing split messages | Restart resumes from durable rows without duplicate composition or cursor rollback |
| Producer skips event IDs and later fills a bounded gap | Gap tombstone rules deterministically accept or close the event once |
| Event is at or below `closed_event_through` | It can never mint a proposal, action ticket, relay ticket, or delivery |
| Closed event is compacted and then replayed | Permanent watermark still denies |
| Action ticket is at or below its reject-through watermark | It can never execute even if the source event remains |
| Old consumer resumes after a new epoch starts | Epoch fence denies all actions and deliveries |
| Cursor update races with action outcome or unavailable sentinel | One transaction preserves outcome and monotonic cursor floor |
| Code rollback starts against forward journal state | Forward migrations remain authoritative; no live state is restored from snapshot |
| Restored callback or spool record carries an old generation or epoch | Deny and reconcile current durable state |

**Attachment admission and streaming**

| Scenario | Required result |
|---|---|
| Attachment crosses IPC as a path, file URL, caller-selected descriptor, or location | Deny |
| Stream authentication fails, frame exceeds 256 KiB, order breaks, digest differs, or deadline passes | Stop the stream and retain durable cleanup state |
| Message has more than 20 files, a file exceeds 25 MiB, or message total exceeds 50 MiB | Deny attachment admission while preserving text/control progress |
| Peer active quota would exceed 100 MiB or global quota would exceed 512 MiB | Deny admission |
| Active plus cleanup rows would exceed 100 per peer or 2,000 globally | Deny admission |
| Global attachment use reaches 448 MiB | Stop new attachments and preserve 64 MiB plus 10,000 rows for controls |
| Attachment admission is stopped | Text, cursor, ticket closure, cleanup, and unavailable sentinels still progress |
| Per-file work exceeds 60 seconds or message work exceeds 120 seconds | Terminalize without resetting deadlines |

**Spool state and recovery**

| Scenario | Required result |
|---|---|
| Initial copy succeeds within three attempts and five minutes | Same row reaches `ready` with exact inode, size, and digest |
| Initial copy exhausts attempts or deadline | Create content-free unavailable sentinel, detach composition, advance text/cursor, and retain same-row cleanup quota |
| Crash occurs after attempt reservation but before staging creation | Same row proves the protected staging locator absent before retry |
| Crash occurs after staging creation but before exact staging identity is stored | Same row uses its durable nonce and protected locator to bind the no-follow object as a deletion target, then unlinks, syncs, and confirms absence before retry |
| Crash or error occurs after a partial frame write but before its durable byte count and digest update | Observed identity mismatch moves the same row to deletion; partial bytes are never resumed or promoted |
| Crash occurs after final file and parent sync but before the `ready` commit, and recovered staging exactly matches identity, length, and digest | The recovered `reserved` row never promotes; it unlinks the exact object, syncs the parent, durably confirms absence, then recopies |
| Crash-recovered `reserved` row has no staging object | Durably confirm absence before returning to `needs_copy`; never promote on restart |
| Symlink, inode swap, size change, digest change, or parent mismatch appears before open or delete | No-follow identity check denies use |
| Ready file is provably absent and recovery has not been used | Same row clears current identity, retains it only as historical evidence, enters `needs_copy`, and starts its only recovery episode |
| Ready file is present but invalid, or absence is unprovable | Same row enters `deleting` with exact old identity and durable after-delete target |
| Crash occurs before exact unlink | Restart verifies old identity before retry |
| Crash occurs after unlink but before parent sync | Quota remains held and recovery resumes at parent sync |
| Crash occurs after parent sync but before absence confirmation | Same row confirms absence before any replacement |
| Replacement path, inode, or row is attempted before unlink, parent sync, and absence are durable | Deny replacement |
| Cleanup plus recovery copy attempts reach three attempts or five minutes | Unavailable sentinel and terminal cleanup path win |
| Recovery recopy succeeds | Same row returns to `ready` and retains recovery-used marker |
| Recovered ready file is lost again | Terminalize without a second recovery episode |
| Cleanup is needed | Existing row transitions in place; no extra row or early quota release |
| Parent sync or exact absence confirmation cannot complete | Keep quota and quarantine cleanup rather than claiming deletion |

**Rollout, rollback, and live safety**

| Scenario | Required result |
|---|---|
| Disposable invitation flow uses fake and recording adapters | No live message, UI action, note mutation, or membership change occurs |
| Journal compatibility stage fails | Stop before identity or service cutover |
| Messages/PIM identity split fails parity or TCC checks | Roll back service routing, but never merge the UIDs again after activation |
| Gateway/worker or Notes cutover begins | Pause ingress, drain owned work, advance generation fence, then switch one boundary |
| Cutover crashes before fence | Old generation remains sole owner |
| Cutover crashes after fence | New generation reconciles durable state; old generation cannot resume |
| Rollback follows journal or spool migration | Preserve forward live state and roll code/config only |
| Rollback occurs with pending proposals or confirmations | Cancel them durably; old challenges cannot revive |
| Rollback occurs with UI-crossed Notes intents | Keep reconciliation-only Notes services alive until every intent is terminal or quarantined |
| Automated live health check runs | Read-only checks only; no message, invitation, note, membership, or relay mutation |

**Prototype gates**

- For every supported messaging provider, prove with disposable fixtures that
  authenticated immutable evidence carries provider finality, the order
  boundary, complete ordered row inventory, exact one-row cardinality, complete
  metadata, and stable composition identity. Exercise previews, late
  contradictions, restart, duplication, and replay. Record any provider that
  cannot prove the contract as ineligible for automatic proposals. A local
  timer is never an accepted substitute.
- Prove the accepted Apple collaboration URL and redirect shapes on each
  supported OS and Notes version.
- Prove that the pinned helper can open the invitation under the dedicated Notes
  GUI identity with least privilege, perform deterministic terminal acceptance
  for every supported Notes version, and distinguish accepted, rejected,
  canceled, timed out, unexpected-prompt, and unknown UI states. If unattended
  terminal acceptance cannot be proved, replace this flow with explicit human
  acceptance before implementation approval.
- Prove runtime OS, Notes, helper, digest, and UI-profile checks deny before
  intent creation and UI action when any value is unknown, changed, or outside
  the approved matrix.
- Prove stable Apple note ID extraction and causal mapping from a bounded
  pre-action baseline and post-action delta.
- Prove an exact known invitation identity can add a second sender grant without
  UI only while its canonical mapping and current Notes membership both match.
  Prove that unknown pre-existing membership cannot use this path.
- Prove direct-message source and reply member anchors survive transport restart,
  edits, reactions, split messages, and replay.
- Prove the runtime can seal and enforce exact account, channel, peer, agent,
  session, route, nonce, expiry, and policy-generation context.
- Prove distinct Messages, PIM, and Notes service accounts have the required GUI
  session behavior and TCC grants without sharing UIDs or files.
- Prove deployment compatibility, pause/drain behavior, generation fencing,
  reconciliation startup, and forward-state rollback in a disposable fixture.
- Confirm the design still assumes no supported Apple API for invitation
  acceptance, owner/participant/permission lookup, stable note identity mapping,
  or atomic conflict-safe note writes. Any supported replacement must be
  evaluated before changing the trust model.

### Rollout and rollback

Rollout is gated and ordered:

1. Use a disposable Apple account, disposable transport peers, fixture content,
   and fake or recording adapters. Complete all prototype gates without live
   production writes.
2. Deploy backward-compatible durable journal, registry, ticket, cursor, and
   spool migrations first. Prove old readers fail closed and new readers retain
   forward state through code rollback.
3. Create distinct Messages and PIM GUI identities. Prove their service and TCC
   parity, then activate the split as a permanent security baseline.
4. Cut over the non-GUI gateway and isolated model worker behind pause, drain,
   generation lease, epoch fence, and read-only health checks.
5. Cut over the Notes broker/helper and read tools behind the same controls.
   Invitation acceptance remains disabled until reconciliation and prototype
   gates are green.
6. Enable proposal and acceptance for a bounded disposable cohort before any
   wider rollout. Increase limits only after durable evidence shows no denial,
   replay, quota, or recovery regressions.

Every boundary uses this sequence: stop new admission, drain or terminalize
owned work, persist the next policy generation and consumer epoch, verify the
old owner is fenced, activate the new owner, reconcile durable state, then run
read-only checks.

Rollback replaces code and static configuration only. It preserves the newest
journal, registry, cursor, ticket, and spool state. It never restores those
stores from snapshots. After the Messages/PIM UID split activates, rollback
keeps those identities separate. Rollback cancels all pending proposals,
challenges, confirmations, and unexecuted acceptance tickets. Any Notes intent
that may have crossed the UI boundary keeps the reconciliation-only broker and
helper alive until the intent is terminal or quarantined. No new invitation is
accepted during rollback reconciliation. Durable completion evidence,
composition generations, UI-crossing fences, contradiction latches, and
proposal closures remain authoritative across rollback. A timer or older binary
cannot reclassify a closed or preview-bearing source as complete or activate a
grant from a stale composition generation.

Automated production checks remain read-only. A failed post-cutover check closes
admission, fences the candidate generation, rolls code and static configuration
back, keeps forward durable state, and verifies read-only health. Cleanup or
reconciliation failure is an additional visible error, never a success-shaped
fallback.

### Review log

- 2026-07-30: The existing plan was rewritten to the v1.7 plan contract. The
  design is provider-neutral, read-only, and stopped at the explicit approval
  gates. Independent review found and resolved missing terminal invitation
  proof, conflicting repeat-grant mapping, circular prototype approval,
  state-invalid spool identity requirements, and an unnecessary tracker
  reference. A complete-diff recheck found no remaining material issues. The
  terminal candidate review then found and resolved missing fail-closed runtime
  version checks and a policy-revocation race during invitation acceptance. A
  fresh exact-head review found and resolved missing crash-safe ownership for
  partial staging copies. A later cross-design review required immutable
  messaging-provider proof of one complete link-only source row and removed all
  proposal authority from local composition timers and preview-bearing input.
  The same update makes every crash-recovered reserved copy cleanup-only and
  forbids promotion on restart even when recovered bytes appear complete.
  Independent review then required provider-final one-row composition
  attestation and a durable composition-generation fence that serializes late
  companions with UI crossing and grant activation. The next recheck made that
  composition state authoritative for every read, added its disposable
  provider-evidence prototype gate, and synchronized both fail-closed recovery
  decisions into the Human section.

### Checklist

- [x] Read current repository instructions, workflow skill, prior plan, Apple
  PIM guidance, messaging guidance, sandbox guidance, and related PIM plans.
- [x] Replace contact-group and human-attestation trust with exact authenticated
  direct-message grants and deployment-owned hierarchical policy.
- [x] Remove write tools and document why V1 is read-only.
- [x] Define model-free proposal, challenge, confirmation, and isolated
  acceptance behavior.
- [x] Define deterministic Notes acceptance, stable-ID mapping, independent
  grants, crash reconciliation, and membership fencing.
- [x] Define per-resource authorization, bounded reads, normalization, data
  marking, and injection filtering.
- [x] Define separate gateway, worker, Messages, PIM, and Notes security domains.
- [x] Define per-friend isolation, public-web proxy controls, and owner relay.
- [x] Define journal, replay, ticket, cursor, attachment, quota, spool, cleanup,
  recovery, rollout, and rollback behavior.
- [x] Add denial, crash, replay, isolation, quota, recovery, rollback, and
  prototype validation scenarios.
- [x] Complete final independent review of the documentation diff.
- [ ] Receive explicit approval for disposable prototype-only work.
- [ ] Complete prototype gates and update this design with the evidence.
- [ ] Receive separate explicit approval to begin implementation.
- [ ] Implement code, tests, deployment wiring, or live account changes.
