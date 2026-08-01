# Secure Apple Notes shared access

**Status:** Design complete, awaiting prototype-only approval
**Issue:** [#74](https://github.com/coletaylor788/puddles/issues/74)
**Last updated:** 2026-07-31

## Human section

### Design

The existing message rules decide trust. When a message is admitted and routed
to an agent, that receiving agent is the Notes scope. A collaboration link sent
to main grants only main. The same link sent to household grants household too.
Each friend agent gets a separate grant only when that agent receives the link.
The design does not check Contacts, infer the note owner, or copy access between
agents.

The transport must prove that one complete direct-message row contains only one
supported note collaboration link, with no preview or attachment. A small hook
then intercepts that admitted, routed message before the model and records the
link and receiving agent in a durable queue. One non-model worker opens the link
under the dedicated Apple account, accepts it in Notes, finds the one note that
appeared, and stores the link, note identifier, and exact agent grant in one
transaction. A known link adds another agent grant without accepting the
invitation again. Missing transport proof, failed acceptance, folder links, and
ambiguous mapping create no grant.

Notes tools take the calling agent from trusted runtime context. List, read, and
search ask the host helper only for note identifiers granted to that exact
agent, so ungranted notes never reach the model. The first implementation is
read-only. Notes can replace a whole note body, but it does not offer an atomic
conflict check, so an automated update could erase a collaborator's newer edit.
Write support stays blocked until a disposable prototype proves a safe
operation or a later design explicitly accepts narrower semantics.

### Status

The design is complete around the existing message ACL and exact
receiving-agent grants. Independent review found no remaining actionable issue.
It is ready for prototype-only approval.

No prototype or implementation work is approved or started. Initial approval
may authorize only disposable proof of message intake, durable queue and crash
behavior, invitation acceptance, stable note identity, exact-scope tool
enforcement, and write behavior. That proof may use live invitations only
between throwaway accounts. The evidence must update this plan before a separate
implementation approval.

## Agent section

### State

- Lifecycle state: investigation and design only.
- Repository source of truth:
  `docs/plans/todoist-74-apple-notes-shared-access.md`.
- Current repository implementation: none. There is no checked-in Apple Notes
  plugin, MCP server, CLI, registry, acceptance worker, or test suite.
- Runtime integration gap: OpenClaw already runs `before_dispatch` for ordinary
  agent messages, but that context lacks resolved `agentId`, media facts,
  provider composition-finality evidence, and per-handler fail-closed behavior.
  A small provider-neutral runtime patch is required to add those fields and let
  the Notes registration fail closed without changing other handlers.
- Approval gate 1: explicit approval may authorize only disposable prototype
  work with throwaway Apple accounts and recording adapters. Live invitations
  are allowed only between those disposable accounts.
- Approval gate 2: prototype evidence must update this plan before separate
  implementation approval.
- Production impact: none. This design authorizes no account, permission,
  invitation, message, note, service, or deployment change.
- Read path decision: V1 may implement list, read, and search.
- Write path decision: V1 does not expose update, append, delete, move, or
  participant tools. A safe write phase remains blocked by the lack of an atomic
  compare-and-set operation for Notes content.

### Scope and acceptance criteria

- Reuse the current channel ACL and route binding. The Notes feature does not
  add Contacts lookup, sender-owner proof, challenge-response, or another trust
  classification.
- The trusted grant scope is the exact receiving runtime `agentId`. The sender,
  message text, model, URL, and Notes metadata cannot choose or widen it.
- A grant is an explicit tuple of exact agent scope and stable Notes resource
  ID. Main, household, and each friend agent are independent scopes.
- A link received by one scope creates no grant for another scope. Sending the
  same link to several agents can create several grants to the same canonical
  note.
- If several people route to one agent ID, they share that agent's Notes scope.
  Per-person grants require separate agent IDs and bindings. This follows the
  current runtime, which authorizes tools by receiving agent rather than by
  sender inside an agent.
- Only an ACL-admitted direct-message route can enqueue acceptance in V1.
- The intake path requires immutable provider evidence that one complete source
  row contains only one supported Apple Notes single-note collaboration URL.
  Surrounding whitespace and the channel's normal URL wrapper may be normalized.
- Preview metadata, media, additional text, multiple source rows, group context,
  zero links, several links, unsupported hosts, missing completion evidence,
  malformed evidence, or replayed evidence create no acceptance job.
- A coalescing or debounce timer is not completion evidence. A channel that
  cannot supply an immutable final row set must keep automatic intake disabled.
- Intake is idempotent by source message identity and by normalized URL plus
  exact agent scope.
- Source identity includes the trusted channel, account, stable provider
  conversation ID, and immutable source-row or message ID. It does not include
  the routed agent or agent-prefixed session key. The resolved session and scope
  are stored as facts on that source row, so replay after a binding change cannot
  grant a second agent.
- One durable queue and one acceptance worker serialize new invitation
  acceptance so a before-and-after Notes snapshot has one candidate.
- One URL-wide acceptance intent owns UI work for every scope request for that
  normalized URL. Scope jobs wait behind it. An unresolved or potentially
  UI-crossed intent blocks every later scope from reopening the URL.
- The worker's intent claim is a broker-owned lease with an owner and epoch. A
  stale pre-marker claim can return to pending only after startup proves there
  is no live worker claim and no UI-action lease.
- Each new claim increments a monotonic intent claim generation. The worker must
  present the current owner and generation to mark `ui_may_cross` or acquire an
  action lease. Reclamation increments the generation before returning pending,
  so an old worker can never resume.
- The worker may cross into Notes UI only when the current macOS build, Notes
  build, helper digest, scripting-dictionary hash, and UI profile exactly match
  the approved prototype matrix. It checks at startup, before claiming UI work,
  and immediately before each open or acceptance action.
- Acceptance succeeds only when the dedicated Apple account reaches a terminal
  accepted single-note state, the UI helper identifies the exact opened note,
  and the before-and-after ID delta corroborates that same note.
- A known URL mapped to a still-present Notes resource skips UI acceptance and
  adds only the missing exact-scope grant.
- Unknown, failed, timed-out, disappeared, ambiguous, or folder resources fail
  closed. They create no active grant.
- Revoking a scope grant immediately removes tool access for that scope. If the
  Notes resource disappears, all grants linked to it become inactive.
- List, read, and search return only resources joined to an active grant for the
  caller's exact runtime agent ID.
- The host helper never lists all Notes and then returns an unfiltered result to
  the model.
- The acceptance worker receives only URL intent ID and normalized URL. It never
  receives scope metadata, free-form note content, or a model-authored command.
- A broker acceptance epoch fences queue claims and UI actions. A worker must
  acquire a single-use epoch-bound broker lease for each URL-open or Accept
  action. The helper cannot act without that lease.
- The write-ahead UI marker and URL-open lease are one broker transaction. It
  validates enabled state, expected intent state, epoch, claim owner and
  generation, helper identity, and the complete approved runtime tuple together.
- Automated tests use fake Notes and recording message adapters. They never open
  a live invitation or mutate a live Notes account.

Out of scope:

- Contacts-based trust.
- Note owner or participant inference.
- Hierarchical grant inheritance.
- Copying a grant between agents.
- A second confirmation message.
- General message composition journals, permanent replay watermarks, attachment
  spools, relays, web proxies, or cross-agent policy leases.
- Production invitation acceptance before both approval gates pass.
- Whole-body writes without a separately approved conflict decision.

### Architecture and decisions

**Existing message authorization and route evidence**

- `docs/openclaw-setup/02-talking-to-puddles-on-imessage.md` documents
  `channels.bluebubbles.dmPolicy=allowlist` and `allowFrom`. It states that a
  sender outside the allowlist is dropped at the gateway before an agent sees
  the message.
- `docs/plans/022-household-and-friends-tiers.md` documents exact channel
  bindings from `channel + peer.kind + peer.id` to `agentId`. Its
  `message-chat-pin` design also authorizes outbound targets from `ctx.agentId`
  and the configured bindings. The current scope unit is therefore the receiving
  agent, not a second sender classification inside that agent.
- OpenClaw upstream commit
  [`89aadef`](https://github.com/openclaw/openclaw/tree/89aadef6efe098679499d7bb2578ecbba66d7215)
  already calls `runBeforeDispatch()` for ordinary agent messages in
  `src/auto-reply/reply/dispatch-from-config.choose-route.ts`. It runs under
  dispatch lifecycle admission and can return `handled: true` before model
  dispatch.
- `src/plugins/hook-types.ts` shows that the current `before_dispatch` event has
  canonical content and message ID, while its context has channel, account,
  conversation, session, and sender. It does not expose resolved `agentId`,
  canonical media facts, or provider composition-finality evidence.
- `docs/plugins/hooks.md` states that `inbound_claim` belongs only to the plugin
  that owns a conversation binding. The Notes design preserves that contract
  and does not broadcast ordinary messages through the general inbound-claim
  runner.
- `docs/openclaw-setup/patches/imessage-message-part-coalescing.md` records the
  concrete completion race. One composition can arrive as a text row, a later
  preview or attachment row, and trailing text. It also states that standalone
  URLs dispatch immediately while preview rows may arrive later. A debounce
  deadline therefore cannot prove that a URL row was the complete composition.
- Implementation needs one narrow provider-neutral OpenClaw patch to the
  existing `before_dispatch` surface. It adds trusted resolved `agentId`,
  canonical media facts, and immutable channel-supplied composition evidence.
  The evidence includes one provider composition ID, its final source-row IDs,
  completion status, and preview/media flags. The hook rejects evidence unless
  it proves exactly one complete direct-message source row.
- The patch also adds a registration-scoped failure mode. The Notes handler
  registers fail closed, so only its own error or timeout becomes a fixed
  `handled: true` failure. Other `before_dispatch` handlers keep their current
  error behavior. This avoids changing availability or ownership semantics for
  unrelated plugins.
- The registration supplies one runtime-owned attempt ID, absolute deadline, and
  settlement signal. The Notes handler may only prepare an intake row under that
  fence. It cannot make a job runnable. The runtime settles a successful handled
  result before returning it to dispatch; timeout or error requests
  `cancel_or_observe`. The broker atomically rejects activation after
  cancellation or deadline, so a timed-out handler cannot commit a late
  acceptance job after cancellation wins.
- Broker state is authoritative when an activation response is lost. An
  idempotent `cancel_or_observe` operation atomically cancels `prepared`, reports
  `committed` without reversing it, or confirms `canceled`. If activation already
  committed, dispatch keeps the message terminally handled and reports queued
  or reconciling status. It never reports a rejection for a job that may run.
  If cancellation wins, no runnable job can appear.
- The Notes intake plugin uses patched `before_dispatch`, not a model tool call.
  A matching proven link-only message returns `handled: true` with a fixed
  status reply, so the URL does not enter model processing. It catches its own
  validation and storage errors and returns a handled content-free failure. A
  message containing a supported collaboration URL but invalid finality evidence
  also returns a fixed handled rejection. Only a message with no supported
  collaboration URL continues through the ordinary message path.
- Intake derives `target_scope` only from `ctx.agentId`. It verifies the
  canonical `sessionKey` resolves to the same agent and rejects missing or
  conflicting runtime identity. Message fields cannot supply an agent ID.

**Current calendar wrapper pattern**

- `openclaw-plugins/secure-apple-calendar/src/plugin.ts` supplies the closest
  checked-in pattern. `resolveConfigDirForAgent()` derives per-agent Apple PIM
  configuration from `PluginToolCtx`. `narrowCalendarTool()` and
  `restrictActionsCaller()` narrow the schema and reject disallowed actions
  before MCP dispatch.
- `openclaw-plugins/secure-apple-calendar/src/bridge-cache.ts` caches one bridge
  per config directory and evicts it when the child closes.
- `openclaw-plugins/secure-apple-calendar/src/wrap-tool.ts` runs egress checks
  before the delegate and ingress checks before results reach the agent.
- `openclaw-plugins/secure-apple-calendar/tests/plugin.split.test.ts` proves the
  read tool rejects writes without spawning the bridge. Its factory and tests
  are the template for `notes_read` and any later `notes_write` surface.
- Notes differs from Calendar in one important way. Static per-agent config is
  not enough because accepted Notes IDs appear at runtime. The Notes wrapper
  must join the trusted `ctx.agentId` to a durable grant registry before every
  host call.

**Actual Notes surface and platform evidence**

- No Notes tool exists in this repository. Implementation must add a narrow host
  adapter rather than assume an existing CLI already enforces grants.
- Apple's
  [Script Editor guide](https://support.apple.com/guide/script-editor/view-an-apps-scripting-dictionary-scpedt1126/mac)
  says an application's scripting dictionary is the authoritative vocabulary
  for commands and objects. The disposable prototype must record the Notes
  dictionary for each supported macOS build.
- Apple's
  [collaboration guide](https://support.apple.com/guide/notes/collaborate-with-shared-notes-and-folders-apd4e6e2c9a6/mac)
  describes accepting a collaboration link by opening it in Notes. It does not
  document a programmatic acceptance command.
- Apple's
  [shared-note management guide](https://support.apple.com/guide/notes/manage-shared-notes-folders-apd881ec5518/mac)
  confirms that participants may edit only when the owner granted that
  permission, and that only invited people can use a copied link.
- Community implementations show the available automation shape but are not
  security authorities. `mcp-apple-notes` documents AppleScript-backed create,
  read, update, delete, list, and search. `ailenshen/apple-notes-mcp` documents
  list/search via read-only SQLite, read via AppleScript, and update as
  delete-plus-create. Its limitations state that partial editing is unsupported
  and update replaces full content.
- These sources support a read adapter and prove that whole-body mutation is
  technically possible. They do not prove conflict-safe updates, unattended
  invitation acceptance, or long-term stable IDs. Those remain prototype gates.

**Message-to-grant flow**

1. The gateway completes its existing channel ACL and binding route. Its current
   pre-model path calls the Notes plugin's patched `before_dispatch` handler with
   the canonical message, resolved runtime agent, media facts, and immutable
   provider composition evidence.
2. The hook verifies a configured agent scope, a canonical session owned by that
   agent, direct-message context, a stable provider conversation and source-row
   ID, and one complete
   provider composition containing exactly one source row. That row must contain
   only one supported single-note collaboration URL and must have no preview,
   media, or companion row. The source key contains trusted channel, account,
   provider conversation, and source-row ID. The routed session and target scope
   are stored separately and do not affect source uniqueness.
3. The hook normalizes the URL without following it. It writes one prepared
   source row under the runtime-owned attempt ID and deadline, then returns a
   fixed handled reply plus the opaque settlement token. Validation or storage
   failure returns a different fixed handled reply.
4. Before dispatch accepts the handled result, the Notes registration's bounded
   settlement callback asks the broker to activate the prepared row. One SQLite
   transaction rechecks the open attempt and deadline, marks the source
   committed, creates the idempotent scope job for
   `(normalized_url, target_scope)`, and creates or joins the one URL-wide
   acceptance intent. Timeout or error requests
   `cancel_or_observe`. Prepared and canceled rows are never visible to the
   worker.
5. If the activation IPC response is lost, the runtime calls the idempotent
   `cancel_or_observe` operation. A committed result remains runnable and the
   message remains terminally handled. A prepared result is canceled before it
   can activate. If the broker stays unreachable, dispatch still consumes the
   recognized link with a fixed content-free unknown-status reply and never
   reports definite rejection or falls through to the model.
6. A supported URL with missing, malformed, replayed, preview-bearing,
   multi-row, or non-final evidence receives a handled rejection and creates no
   prepared row. A handler that finishes after timeout cannot activate its
   expired attempt. The model does not participate in any case.
7. A single acceptance worker claims the oldest eligible URL-wide intent. Its
   IPC request contains only intent ID and normalized URL. Scope jobs do not own
   UI work. The worker revalidates the URL scheme and host before any UI action.
8. If the intent already maps to a note ID, the worker verifies that the note
   still exists. The broker then inserts each waiting job's exact-scope grant
   and completes it in an idempotent transaction. The UI worker never receives
   those scopes and does not reopen the URL.
9. For a new URL intent, the worker reads a bounded current set of shared note IDs.
   Before changing state, it verifies the actual macOS build, Notes build,
   helper digest, scripting-dictionary hash, and UI profile against the approved
   matrix. One transaction then stores that exact baseline and current
   acceptance epoch, worker claim owner, and newly incremented claim generation
   on the intent and changes its state to `accepting`.
10. Immediately before opening the URL, one broker transaction validates
   acceptance enabled, exact `accepting` state, current epoch, unexpired claim
   owner and generation, helper identity, and the complete approved runtime
   tuple. It then atomically marks the intent `ui_may_cross` and issues the
   single-use URL-open lease. The marker is durable before any external action.
   Once marked, the intent can only map, close through explicit terminal
   evidence, or enter reconciliation. It never returns to pending.
11. The helper presents the URL-open lease, and the broker keeps it active until
   the helper reports terminal action status. The helper must identify the
   invitation as one shared note.
12. Before clicking Accept, the helper obtains a separate single-use action
   lease. Its broker transaction requires exact `ui_may_cross` state and
   revalidates enabled state, epoch, claim owner and generation, helper identity,
   the complete approved runtime tuple, terminal success of the URL-open lease,
   and the single-note invitation result. A mismatch performs no next UI action
   and moves the intent to `needs_reconcile`. A folder or unknown resource type
   is canceled and closes the intent without a grant.
13. The version-pinned UI helper returns content-free causal evidence for the
   exact note opened by that acceptance action. At minimum this is the stable ID
   of the note selected by the helper in the accepted Notes window. The worker
   durably stores that candidate ID on the URL intent before it can create a
   grant.
14. After terminal success, the worker reads the shared note IDs again.
   Exactly one new ID must appear, and it must equal the helper's candidate ID.
   The adapter fetches that ID and verifies it remains present across a Notes
   restart and sync cycle in the disposable prototype.
15. One SQLite transaction stores the normalized URL to canonical note ID
   mapping, marks the URL intent mapped, inserts grants for every currently
   waiting scope job, and marks those jobs complete. A later scope job that
   joins a mapped intent verifies the note still exists, then inserts its grant
   and completes in one idempotent transaction.
16. Missing causal evidence, a candidate not corroborated by the exact delta,
   zero or several new IDs, UI uncertainty, missing resource, or storage failure
   marks the URL intent `needs_reconcile`. A helper timeout first quiesces or
   stops the exact helper and retires its action lease, then marks the intent for
   reconciliation. It creates no active grant, and all scope jobs for that URL
   remain blocked behind the intent.

**Minimal durable state**

The design needs five small tables:

- `source_messages`: one provider-stable source key made from channel,
  normalized account, provider conversation ID, and immutable source-row or
  message ID, plus the separately recorded resolved session, agent scope,
  runtime-owned attempt ID, deadline, and state
  (`prepared | committed | canceled`). This prevents one inbound event from
  enqueueing twice across route rebinding without assuming message IDs are
  account-wide. Only the registration settlement transaction may change
  `prepared` to `committed` and create a runnable job.
- `acceptance_jobs`: job ID, normalized URL, target scope, state
  (`waiting_intent | complete | failed`), attempt count, bounded timestamps, and
  content-free error code. A unique constraint on URL plus target scope prevents
  duplicate scope work.
- `note_urls`: normalized URL, one intent ID and owner, intent state
  (`pending | accepting | ui_may_cross | needs_reconcile | mapped | closed`),
  acceptance epoch, worker claim owner, expiry, and monotonic generation,
  write-ahead UI marker,
  bounded exact pre-acceptance note-ID baseline, content-free UI candidate note
  ID when proven, canonical mapped note ID, and timestamps. This row is both the
  URL-wide acceptance fence and the durable URL-to-note mapping. V1 stores no
  folder resource.
- `scope_grants`: canonical resource ID, exact agent scope, active flag, and
  monotonic generation, revocation state, and timestamps. The unique key is
  resource ID plus scope.
- `broker_state`: one row containing the acceptance-enabled flag and monotonic
  acceptance epoch, plus the single worker's active single-use UI-action lease.
  Fencing increments the epoch and disables new claims and leases atomically.

There is one queue consumer. On startup, the broker first retires stale worker
claims and active helper leases. It waits for a live helper to quiesce or stops
that exact helper before retiring its lease. An `accepting` intent without
`ui_may_cross` returns to pending only when no live worker claim or helper lease
remains. Reclamation increments the intent claim generation before releasing it,
which invalidates every old worker token. This is safe because the helper cannot
act before the marker and action lease.

The worker then reconciles every `ui_may_cross` or `needs_reconcile` URL intent
before claiming a new intent. It never repeats UI acceptance when the URL may
already have crossed into Notes. It first checks the URL mapping, then compares
the intent's durable pre-acceptance baseline with the current bounded Notes ID
set. Exactly one new ID may complete the intent only when it equals the durable
candidate ID returned by the original UI action. An intent without that causal
evidence, or with zero, several, or a different new ID, remains
`needs_reconcile`. The worker never reopens the URL or guesses.

Every later scope job for an unresolved URL remains `waiting_intent`. It can
proceed only after reconciliation maps the URL or an explicit operator decision
closes the intent. Closing fails all waiting jobs. It never silently resets the
URL to pending.

The registry controls tool access, not Apple account membership. Revoking a
scope grant removes that scope's access even if the dedicated Apple account
still has the note. If the adapter cannot fetch a mapped ID, it marks the
resource missing and disables all linked grants.

One local registry broker owns SQLite writes and active read-release leases.
The intake plugin, acceptance worker, and Notes tool wrapper use bounded
authenticated IPC to that broker. This keeps grant generation and revocation
ordering in one place without adding a general policy service.

Deployment owns a read-only approved runtime matrix. The broker and worker
compare exact macOS and Notes builds, helper digest, scripting-dictionary hash,
and UI profile before UI work. A version mismatch is not a retryable UI error.
It blocks acceptance until a new disposable prototype updates the matrix and
receives approval.

Rollback and UI actions serialize through the broker. Disabling acceptance
prevents new action leases. Rollback then waits for every already issued helper
action to report terminal status before its fence is complete. If a helper does
not quiesce within the bound, the exact helper process is stopped, its intent
remains `ui_may_cross`, and rollback reports a reconciliation blocker rather
than pretending the UI action did not occur.

**Notes tool enforcement**

- Add a `secure-apple-notes` plugin using the Calendar plugin's tool-factory,
  action-narrowing, bridge, and hook pattern.
- The tool factory captures `ctx.agentId`. The public schema has no `scope`,
  `agentId`, registry path, account, or unrestricted list argument.
- `notes_read.list` queries active grants for the captured scope and asks the
  host adapter for metadata for only those IDs.
- `notes_read.get` requires an active grant before it asks the host adapter for
  that exact ID.
- `notes_read.search` supplies the active granted ID set to the trusted host
  adapter. The adapter searches only those resources, or fetches only those
  resources and performs the search locally. It must not run an account-wide
  search and filter the returned content after model exposure.
- The host adapter returns structured records carrying their stable resource ID.
  Note title and body remain untrusted content.
- Each call acquires a narrow read-release lease for the exact scope and grant
  generation before host access. After the host call, the wrapper reauthorizes
  every returned stable ID under that lease immediately before it sends any
  title or body to content-bearing ingress processing. This is the ingress
  disclosure authorization point.
- If revocation reaches the broker before ingress disclosure authorization, the
  affected record never reaches an ingress classifier. If disclosure
  authorization wins first, that ingress use linearizes before revocation.
- After ingress checks, the wrapper reauthorizes every returned stable ID again.
  It holds the lease through this terminal authorization point immediately
  before the tool promise returns its final result to OpenClaw.
- Revocation first marks the grant inactive and cancels matching active leases,
  then waits for their terminal authorization. A revocation that reaches the
  broker before that point makes the check fail, so the wrapper releases no
  content for that grant. If terminal authorization wins first, the read
  linearizes before revocation. New calls cannot acquire a lease after the
  inactive commit.
- A removed note, changed grant generation, canceled lease, or inactive grant
  fails closed. List and search omit the affected record. Direct get returns a
  content-free unavailable result.

**Write path decision**

- AppleScript and community adapters can replace a whole note body, but the
  reviewed evidence shows no atomic compare-and-set that binds a write to the
  version just read. `ailenshen/apple-notes-mcp` uses delete-plus-create for
  update, which also changes identity and is unsuitable for shared grants.
- V1 therefore exposes no `notes_write` tool. This does not satisfy the original
  write request, and the plan states that gap plainly.
- The disposable prototype must test the current Notes dictionary and any
  stable modification token. If no atomic conditional write exists, the next
  plan may choose one of two explicit paths: keep shared-note access read-only,
  or seek separate approval for a narrowly described last-writer-wins replace
  operation with its data-loss risk. The implementation may not silently choose
  the second path.
- Shared-folder invitations and create-in-folder writes require a separate
  design for child-note authorization. They are rejected before acceptance in
  V1.

**Removed complexity**

The current design intentionally removes:

- Contacts lookup and sender-owner inference.
- Top, household, and friend inheritance rules.
- Challenge-response confirmation.
- A general composition journal. The feature retains only the demonstrated
  requirement for immutable provider proof of one complete source row.
- General replay watermarks and gap tombstones.
- Attachment spool and quota state machines.
- Owner relay, public-web proxy, and unrelated per-friend process design.
- Multiple acceptance services, broad policy leases, and account-membership
  removal automation.

The remaining controls are directly tied to the feature: existing route
authorization, exact runtime scope, provider-final single-row evidence, URL
validation, source and job idempotency, one durable acceptance queue,
URL-to-note mapping, exact-scope grants, fail-closed reconciliation, and
pre-host-call tool authorization.

### Implementation

Implementation is intentionally not started.

After explicit prototype-only approval:

1. Use a disposable Apple account and disposable shared notes to record
   supported collaboration URL shapes, Notes UI states, scripting dictionary,
   resource IDs, restart behavior, and sync behavior.
2. Build a throwaway recording adapter that opens no production URL and proves
   the patched `before_dispatch` path runs after existing admission and routing,
   supplies the resolved agent scope, media facts, stable source identity, and
   immutable final source-row evidence for each configured route. Prove that the
   Notes registration alone keeps its errors and timeouts terminal.
3. Test one new invitation, repeat delivery to the same scope, delivery of the
   same URL to a second scope, acceptance interruption, ambiguous deltas,
   disappeared notes, and revocation.
4. Test AppleScript and any available Notes automation for read, search, full
   replace, concurrent collaborator edits, and identity changes. Record whether
   any conditional write primitive exists.
5. Rewrite this complete plan with the evidence and stop for separate
   implementation approval.

Only after the second approval:

1. Add the minimal SQLite registry and single acceptance queue.
2. Add the narrow OpenClaw `before_dispatch` context and registration patch and
   register its regression in
   `packages/e2e/openclaw-patch-suite.json`.
3. Add the `before_dispatch` intake plugin and recording adapter tests.
4. Add the isolated Notes acceptance worker and fail-closed reconciliation.
5. Add the host read adapter and stable ID lookup.
6. Add `secure-apple-notes` with exact-scope list, get, and search.
7. Add focused tests and cross-component regressions in `packages/e2e/`.
8. Deploy only to the configured test environment with fake or disposable
   adapters. No live invitation or account mutation belongs in automated tests.

### Validation

**Route and grant scope**

| Scenario | Required result |
|---|---|
| An ACL-admitted message routes to main with one supported link | Enqueue one job with `target_scope=main`; no other grant appears |
| The same URL later routes to household | Verify the mapped note still exists, then add only the household grant without reopening the URL |
| The same URL routes to two different friend agent IDs | Create one independent grant for each exact agent ID |
| One agent has several sender bindings | All admitted senders share that agent's Notes scope, matching current runtime semantics |
| Message text contains an agent or tier name | Ignore it for authorization; use only trusted `ctx.agentId` |
| Session key is missing or resolves to another agent | Reject intake and create no job |
| Two conversations reuse the same provider message ID | Their provider-stable conversation keys remain distinct |
| The route binding changes and the provider replays the same source row | Provider-stable source key rejects the replay; the new agent receives no grant |
| Sender is rejected by the existing channel ACL | Notes intake never runs |
| Group route contains a collaboration URL | Return a handled rejection; V1 creates no group grant |

**Intake and idempotency**

| Scenario | Required result |
|---|---|
| Provider proves one complete direct-message source row with one link and no preview or media | Normalize URL, durably record source and job, and handle the message before model dispatch |
| Message has zero links | Continue through ordinary message processing |
| Supported link has several links, extra text, preview metadata, media, or several source rows | Return a fixed handled rejection and create no job |
| Supported link lacks completion evidence | Return a fixed handled rejection and create no job |
| Completion evidence is malformed, replayed, or names a different source row | Return a fixed handled rejection and create no job |
| A preview or companion row arrives after a URL row | The provider could not truthfully mark the earlier row final, so no acceptance job may exist |
| A coalescing timer expires for a standalone URL | Timer expiry grants no authority and creates no job without provider-final evidence |
| Channel cannot provide immutable final source-row evidence | Automatic invitation intake remains disabled for that channel |
| URL uses unsupported scheme or host | Reject intake |
| Same source event is delivered twice | Unique source key creates one job |
| Intake validation or SQLite storage fails after recognizing a supported link | Return a fixed handled failure; do not run commands, later hooks, or the model |
| Notes `before_dispatch` handler throws or times out | Its fail-closed registration returns a fixed terminal failure and does not change other handlers |
| Handler times out while its broker write is pending | Cancel or expire the prepared attempt; no runnable job can appear later |
| Prepared row is durable and cancellation wins | Leave no runnable job; the prepared row becomes canceled or expires |
| Handled settlement succeeds | Atomically commit the source and create one runnable idempotent job before dispatch accepts the result |
| Activation commits but its IPC response is lost | `cancel_or_observe` reports committed; keep the message terminally handled and allow the one job |
| Cancellation reaches a prepared attempt before activation | Atomically cancel it; no later activation or runnable job is possible |
| Broker state is unreachable after an uncertain activation | Keep the recognized message terminally handled with unknown status; never report definite rejection or fall through |
| Same URL and scope arrive through another admitted message | Reuse the existing scope job and URL intent |
| Same URL arrives for a new scope | Create a distinct scope job that joins the one URL intent |

**Automatic acceptance and mapping**

| Scenario | Required result |
|---|---|
| New note URL produces terminal accepted UI state and exactly one corroborated note ID | Atomically store URL mapping, exact-scope grant, and completed job |
| Invitation UI identifies a shared folder | Cancel before acceptance and create no grant |
| Invitation UI cannot prove note versus folder | Cancel before acceptance and create no grant |
| Known URL maps to a still-present resource | Add missing scope grant without UI acceptance |
| Known URL maps to a missing resource | Mark resource missing, disable linked grants, and fail closed |
| Acceptance returns canceled, rejected, timed out, or unknown | No active grant |
| Before-and-after scan yields zero or several new IDs | Mark `needs_reconcile`; no active grant |
| Worker crashes before the write-ahead UI marker | Retry the URL intent |
| Startup finds stale `accepting` before the marker | Prove no live worker claim or helper lease, then return the intent to pending |
| Paused old worker resumes after its claim is reclaimed | Owner/generation check rejects its marker transition and every action-lease request |
| Worker crashes after the marker but before URL open | Reconcile the URL intent; never reopen automatically |
| Worker crashes after UI may have opened | Reconcile Notes and mappings before any retry; never blindly reopen |
| Worker crashes after acceptance and durable UI evidence but before mapping commit | Compare current IDs with the intent's durable baseline; complete only when one exact new ID equals the stored candidate |
| Worker crashes after opening the URL but before storing UI evidence | Mark `needs_reconcile`; never map a baseline delta alone |
| An unrelated note appears after the baseline | It cannot be mapped unless the original UI helper identified that exact ID and the delta corroborates it |
| Baseline transaction fails | Perform no UI action and leave no `accepting` URL intent |
| Main intent is unresolved and household submits the same URL | Household scope job remains waiting; no second UI open occurs |
| Registry commit fails after UI success | Reconcile the accepted note and keep access disabled until one mapping is committed |
| Mapping transaction includes several waiting scope jobs | Map once, insert every grant, and complete those jobs atomically |
| Process crashes immediately after the mapping transaction | Restart observes mapped intent and completed grants; it performs no UI action |
| A new scope job joins an already mapped intent | Verify the note, then atomically add that exact grant and complete the job |
| Acceptance worker receives scope metadata, free-form content, or model parameters | Reject IPC request |
| Worker starts on an unapproved macOS, Notes, helper, dictionary, or UI profile | Do not claim UI work; mark it blocked without opening Notes |
| Version tuple changes after baseline but before URL open | Atomic marker-and-lease transaction fails; write no marker and perform no UI action |
| Version tuple changes after URL open but before Accept | Recheck fails; do not click Accept or create a grant |
| Stale worker requests a lease after intent enters reconciliation or closes | Expected-state and owner/generation checks reject it |
| Helper times out with an active action lease | Quiesce or stop that exact helper and retire the lease before reconciliation |
| Startup finds a surviving helper or action lease | Drain or stop it first; reconciliation cannot run concurrently with possible UI action |

**Tool authorization**

| Scenario | Required result |
|---|---|
| Main lists Notes | Host adapter receives only active resource IDs granted to main |
| Household searches Notes | Search runs only over IDs granted to household |
| Friend requests an ID granted only to another agent | Reject before host Notes access and reveal no existence |
| Model supplies another scope or registry path | Schema rejects it; runtime ignores caller-supplied authority |
| Grant is revoked before a call | Lease acquisition fails and no host call runs |
| Grant revocation reaches the broker during a host call | Pre-ingress reauthorization fails; no affected content reaches ingress processing |
| Grant revocation starts after ingress disclosure but before tool-result release | Ingress use is ordered before revocation, then terminal reauthorization suppresses the affected tool result |
| Search returns one active and one newly revoked ID | Reauthorize both IDs and release only the still-active record |
| Mapped note disappears | Mark resource missing, disable grants, and return a content-free unavailable result |
| Granted note contains prompt injection | Existing ingress hooks inspect it before model release |
| Tool attempts account-wide list or search | Runtime gate rejects it |
| Tool attempts update, append, delete, move, or participant change | No write tool exists in V1 |

**Prototype gates**

- Prove the supported single-note collaboration URL hosts and normalization
  rules, and prove folder links can be identified before acceptance.
- Prove each enabled channel can provide immutable completion evidence for one
  final direct-message source-row set. A timer or absence of a row is not proof.
- Prove patched `before_dispatch` runs after ACL, route resolution, inbound
  dedupe, and lifecycle admission. It must supply trusted exact `agentId`,
  canonical session key, media facts, provider-final source rows, and stable
  message identity, and it must stop a handled link before model dispatch.
- Prove only the Notes handler's fail-closed registration turns its error or
  timeout into a terminal result. Other handlers retain their current behavior.
- Prove the runtime-owned attempt fence lets only a successfully settled handled
  result activate a prepared source row. Timeout, error, late completion, and
  cancellation that wins before activation must create no runnable job.
- Prove `cancel_or_observe` resolves commit-plus-lost-response and
  commit-plus-timeout races from durable broker state. A committed job must
  remain terminally handled, while a canceled attempt can never activate.
- Prove unattended acceptance can reach a bounded terminal success state on each
  supported Notes and macOS version.
- Prove the worker attests the exact macOS build, Notes build, helper digest,
  scripting-dictionary hash, and UI profile at startup, before claim, before
  URL open, and before Accept. Every mismatch must fail before the next UI
  action.
- Prove each URL-open and Accept operation requires a single-use lease bound to
  the current broker epoch, intent, helper identity, and approved runtime.
- Prove the marker and URL-open lease commit in one full-tuple transaction from
  exact `accepting`, and the Accept lease repeats the full tuple from exact
  `ui_may_cross` after successful single-note identification.
- Prove helper timeout and startup recovery quiesce or stop the exact helper and
  retire its lease before reconciliation.
- Prove stale `accepting` can return to pending only before the UI marker and
  only after no live worker claim or helper lease remains.
- Prove reclamation increments the claim generation and rejects a paused old
  worker at both marker and action-lease acquisition.
- Prove exactly one accepted resource can be mapped to a Notes ID with one
  serialized worker and invitation-correlated UI evidence.
- Prove the chosen Notes ID remains stable across app restart and sync in the
  disposable account.
- Prove repeat URL handling and multi-scope grants do not reopen an accepted
  invitation.
- Prove interruption reconciliation cannot accept twice or grant an ambiguous
  resource.
- Prove crash recovery can resolve one exact post-baseline resource and cannot
  resolve an absent, unrelated, or multi-resource delta. A baseline delta alone
  must never authorize a grant.
- Prove list, get, and search can address only a supplied ID allowlist without
  account-wide content reaching the wrapper or model.
- Prove revocation cancels an in-flight exact-grant release lease and suppresses
  the affected structured result before OpenClaw accepts it.
- Prove revocation that wins before ingress disclosure prevents note content
  from reaching content-bearing ingress processing. Retain the final per-ID
  check for revocation that arrives later.
- Prove whether Notes exposes any atomic conditional write. If not, record V1 as
  read-only and leave write approval unresolved.

### Rollout and rollback

This revision stops before prototype work. Prototype approval authorizes only
throwaway accounts, fixture messages, recording adapters, and live invitation
acceptance between disposable Apple accounts. It does not authorize production
code, production-account invitations, or live production writes.

After later implementation approval, rollout uses three small stages:

1. Deploy the registry, intake plugin, and fake acceptance worker with acceptance
   disabled. Verify exact route scopes and idempotency.
2. Enable the real worker only in the disposable test account. Verify
   acceptance, mapping, repeat URLs, multi-scope grants, and reconciliation.
3. Enable read tools for a bounded test scope, then expand one configured scope
   at a time after list, get, search, revocation, and missing-note checks pass.

Rollback begins with one broker transaction that disables acceptance,
increments the acceptance epoch, and prevents new UI-action leases. New queue
claims stop immediately. Rollback then waits for the one worker's active helper
lease to reach terminal status before declaring the fence complete. A URL-open
lease may finish, but no later Accept lease can start after the fence.

Pending URL intents and waiting scope jobs remain untouched. A claimed intent
without the write-ahead marker returns to pending or becomes blocked.
Only after active helper work quiesces does reconciliation continue for every
intent with durable `ui_may_cross`, even if the old worker crashed before the
actual open. Reconciliation may inspect existing Notes state, but it cannot
reopen a URL or click Accept. If the helper cannot quiesce, rollback stops that
exact helper process, retains the intent for reconciliation, and reports the
blocker.

After the fence is durable, rollback disables intake and tool exposure. It
preserves SQLite URL mappings, grants, broker epoch, and unfinished jobs so a
newer state is never replaced by an older snapshot. Rolling back code must not
reopen an invitation or reactivate a revoked or missing grant.

Rollback validation covers a pending URL intent, a claimed pre-marker intent,
an intent marked just before URL open, an intent between URL open and Accept,
and a post-Accept mapping intent. In each case, the fence stops new UI action
while every potentially crossed intent reaches a terminal or
`needs_reconcile` state.

It also covers rollback after lease acquisition but before helper action,
rollback during URL open, rollback between URL open and Accept, and a helper
that does not report terminal status. No new lease starts after fencing, active
work quiesces or is stopped, and reconciliation begins only afterward.

Automated production checks, if implementation is later approved, remain
read-only. They never enqueue a real invitation, accept a share, edit a note, or
send a message.

### Review log

- 2026-07-31: Replaced the earlier contact, hierarchy, challenge, broad journal,
  relay, and spool design with a direct exact-agent grant model. The rewrite is
  based on the current message ACL and route bindings, the checked-in Calendar
  wrapper pattern, OpenClaw's ordinary `before_dispatch` path, Apple's
  documented Notes UI, and the absence of a checked-in Notes tool. Independent
  review found claim-error fallthrough, a missing durable acceptance baseline,
  an incomplete source dedupe key, baseline-only crash mapping, a revocation
  release race, missing composition finality, an invalid use of
  `inbound_claim`, undefined folder semantics, a late timeout side effect, and
  missing authorization before ingress disclosure, missing runtime version
  gates, an unfenced rollback queue, a post-action UI marker, and per-scope UI
  acceptance races. The plan now uses a
  registration-scoped fail-closed `before_dispatch` extension, requires
  provider-final single-row evidence, accepts only note invitations, persists
  a prepared-to-active intake fence, uses one URL-wide acceptance intent,
  persists a write-ahead UI marker and baseline before external action, requires
  UI-correlated note evidence, keys source rows by canonical provider
  conversation independently of route bindings, resolves uncertain settlement
  with authoritative `cancel_or_observe`, and authorizes exact-grant leases
  before ingress disclosure and again before tool-result release. It attests the
  exact runtime before every UI crossing and fences claims and UI actions before
  rollback reconciliation. Each external UI action now requires an epoch-bound
  broker lease that rollback drains, and the acceptance worker never receives
  scope metadata. URL mapping atomically completes all current scope grants.
  Startup and timeout recovery now quiesce the helper before reconciliation,
  stale pre-marker claims can be reclaimed safely, and the Human approval scope
  matches the complete disposable prototype. Reclaimed claims now advance a
  fencing generation, and gate one explicitly permits live acceptance only
  between disposable accounts. The marker and URL-open lease now validate the
  complete authority and runtime tuple atomically, and Accept repeats that tuple
  from the exact expected state. The final complete-current-diff review found no
  actionable findings. Remaining questions are explicit disposable prototype
  gates.

### Checklist

- [x] Read current repository instructions, workflow skill, reserved plan, and
  issue.
- [x] Trace current channel ACL, agent route bindings, and runtime scope context.
- [x] Confirm `inbound_claim` remains conversation-owner scoped and ordinary
  messages already use `before_dispatch`.
- [x] Trace the checked-in Calendar wrapper and per-agent tool factory.
- [x] Confirm no Apple Notes implementation exists in this repository.
- [x] Record Apple and community evidence for acceptance, IDs, reads, and writes.
- [x] Replace sender and owner inference with exact receiving-agent grants.
- [x] Specify one queue, one acceptance worker, URL mapping, and fail-closed
  reconciliation.
- [x] Make only the Notes `before_dispatch` registration fail closed and
  preserve the exact pre-acceptance baseline for crash recovery.
- [x] Fence prepared intake so cancellation that wins before activation cannot
  produce a late acceptance job.
- [x] Resolve lost activation responses with authoritative cancel-or-observe
  broker state.
- [x] Require immutable provider-final single-row evidence and reject previews,
  media, multi-row compositions, groups, and timer-only completion.
- [x] Scope source event idempotency to the stable provider conversation and
  keep it independent of agent route rebinding.
- [x] Require invitation-correlated UI evidence before a baseline delta can map
  a resource.
- [x] Reauthorize returned IDs under a revocation-aware release lease.
- [x] Reauthorize before content-bearing ingress processing and again before
  final tool-result release.
- [x] Restrict V1 to single-note invitations and reject folders before
  acceptance.
- [x] Gate every UI crossing on the approved runtime and helper matrix.
- [x] Fence queue claims and UI actions before rollback reconciliation.
- [x] Persist a write-ahead UI marker before URL open and reconcile every marked
  intent without reopening.
- [x] Serialize all scope jobs for one URL behind one acceptance intent.
- [x] Bind every UI action to a broker lease that rollback disables and drains.
- [x] Validate the complete authority, state, helper, and runtime tuple in the
  marker/open transition and again before Accept.
- [x] Keep the UI worker scope-free and complete waiting grants atomically after
  mapping.
- [x] Quiesce or stop helper work before timeout or startup reconciliation.
- [x] Reclaim stale pre-marker intent claims only after proving no worker or
  action lease remains.
- [x] Fence every reclaimed worker with a monotonic claim generation.
- [x] Align the Human approval gate with the complete disposable prototype.
- [x] Permit live invitation proof only between disposable prototype accounts.
- [x] Specify pre-host-call list, get, and search authorization.
- [x] State the unresolved write requirement and phased decision.
- [x] Remove unrelated challenge, relay, spool, and broad replay machinery.
- [x] Complete independent review of the concrete minimal design.
- [ ] Receive explicit approval for disposable prototype work.
- [ ] Complete prototype gates and rewrite this plan with evidence.
- [ ] Receive separate implementation approval.
- [ ] Implement or deploy any production behavior.
