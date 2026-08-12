# Secure Apple Notes shared access

**Status:** Design under revision
**Issue:** [#74](https://github.com/coletaylor788/puddles/issues/74)
**Last updated:** 2026-08-12

## Human section

### Design

Apple Notes live collaboration belongs to Apple, not to the agent. After the
dedicated Apple account accepts an invitation, Notes keeps that shared note in
sync. People with edit permission can work in the Notes app and see each
other's changes in near real time. The agent reads the same synced note through
automation, but that automation can only replace the whole body. It cannot say
"write this only if nobody changed the note since I read it." An agent replace
could therefore erase a person's newer edit, so the first version is read-only.

The access design is one hook and one table. The existing message rules admit
the sender and route the message to an agent. Before the model runs, the hook
recognizes one supported Notes invitation, records the receiving agent and link,
and asks a non-model helper to open it under the dedicated Apple account. When
the helper resolves the opened note to one stable identifier, the same row
becomes the grant. Sending the same note to another agent creates another row
for that agent.

The dedicated account may also contain local notes, synced notes, folders, or
shares accepted by a person. That does not grant agent access. Notes tools use
the calling agent from trusted runtime context and expose only stable note
identifiers in accepted rows for that exact agent. Everything else in the Notes
account stays invisible to the model.

### Status

The design is being revised to answer the live-collaboration and hook questions
with the smallest workable flow. Repository and platform evidence now supports
the simplified read-only design, which is awaiting independent review.

No prototype or implementation is approved or started. A later approval may
authorize disposable proof only. Real implementation still needs separate
approval after that evidence updates this plan.

## Agent section

### State

- Lifecycle state: investigation and design only.
- Source of truth:
  `docs/plans/todoist-74-apple-notes-shared-access.md`.
- Current implementation: none. This repository has no Apple Notes plugin,
  invitation helper, registry, or Notes tool.
- Approval gate 1: explicit approval may authorize only a disposable prototype
  with throwaway accounts and notes.
- Approval gate 2: prototype evidence must update this plan before separate
  implementation approval.
- Production impact: none. This design authorizes no live invitation, account,
  note, service, deployment, or tool change.
- V1 tool scope: list, search, and read only.
- Write decision: blocked until a disposable prototype proves a conflict-safe
  operation. Whole-body replace is not accepted as conflict safe.

### Scope and acceptance criteria

- The existing channel allowlist and route binding are the trust decision.
- The exact receiving runtime `agentId` is the grant scope.
- A grant is one accepted registry row containing an exact agent ID and stable
  note ID.
- The same note sent separately to another agent creates another accepted row.
- No Contacts lookup, owner inference, hierarchy, or grant propagation exists.
- Automatic intake accepts only an authenticated direct message whose trusted
  source facts prove one complete row containing one supported single-note
  collaboration URL and no extra text, preview, or attachment.
- The hook claims a recognized invitation before model dispatch. Ordinary text
  continues normally.
- One durable row is written before any external acceptance action.
- One serialized helper processes pending rows. It receives only row ID and URL.
- Successful acceptance resolves exactly one stable Notes note ID and changes
  the row to `accepted` in one transaction.
- Tools query only accepted rows for the caller's runtime agent ID before asking
  the host for note data.
- Notes already visible to the Apple account but absent from an accepted row are
  never returned by list, search, or read.
- Shared-folder invitations are rejected in V1 because a folder grant needs
  separate child-note rules.
- Failed, ambiguous, disappeared, or revoked notes are unavailable.
- Automated tests use fake message and Notes adapters. They never accept a live
  invitation or mutate a live account.

### Architecture and decisions

**How human live collaboration works**

- Apple's
  [collaboration guide](https://support.apple.com/guide/notes/collaborate-with-shared-notes-and-folders-apd4e6e2c9a6/4.13/mac/26)
  says an invited person opens the received link, then opens the item in Notes.
  After that, the note remains in their Notes list.
- The same guide says all participants with the note open can see changes in
  near real time. It also documents immediate change indicators, highlights,
  mentions, and an activity history.
- Apple's
  [sharing guide](https://support.apple.com/guide/notes/share-your-notes-and-folders-apda5307056b/4.13/mac/26)
  lets an owner choose whether participants can make changes or only view.
- Apple's
  [shared-note management guide](https://support.apple.com/guide/notes/manage-shared-notes-folders-apd881ec5518/4.13/mac/26)
  says a participant with edit permission can edit the note. A view-only
  participant cannot.
- This means the dedicated Apple account becomes a normal Notes participant
  after acceptance. Apple owns membership, synchronization, conflict handling,
  activity, and permissions. The agent registry does not reimplement those
  features.

**Why the agent is read-only**

- The Notes scripting surface exposes note IDs, names, bodies, and modification
  dates. Community adapter
  [`mcp-apple-notes`](https://github.com/henilcalagiya/mcp-apple-notes/blob/ca9df02bbb83757b58880f5f2d82afa4c8777656/mcp_apple_notes/applescript/update_note.py)
  writes by assigning a complete HTML body to the note. It verifies the note ID
  and name, but it does not compare a revision or modification token.
- Community adapter
  [`apple-notes-mcp`](https://github.com/ailenshen/apple-notes-mcp/blob/84243277f9e9b6454bc4c2dc2193196204fdc220/src/applescript.ts)
  updates by deleting the old note and creating a new one. Its documentation
  states that partial editing is unsupported and update replaces all content.
- Both approaches can make content that Notes then syncs to human
  collaborators. Neither proves that the content is based on the latest human
  edit, and delete-plus-create also changes note identity.
- Human collaboration is safe because people edit through the native
  collaboration surface. Automated whole-body replacement is unsafe because
  the available interfaces expose no compare-and-set operation.
- The smallest write prototype question is: does the supported Notes build
  expose either a stable revision token with conditional update or a bounded
  append operation that preserves note identity without overwriting concurrent
  edits? If not, shared-note tools remain read-only.

**What can make a note visible to the account**

- Invitation acceptance is not the only possible source of Notes visibility.
  A person can accept a share outside the hook. The Apple account can also sync
  its own notes, local notes, previously accepted shares, and shared folders.
- The design does not try to prove that every visible note came through the
  hook. It treats the registry as the authorization boundary.
- A manually accepted or otherwise synced note is harmless to agent
  authorization. Without an accepted registry row for the exact agent and note
  ID, the tools cannot expose it.
- If a link was already accepted outside the hook, the helper may use that link
  to open and resolve the existing note, then record the grant. This must be
  proven in the disposable prototype.

**Current message hook seam**

- The current OpenClaw main commit reviewed for this plan is
  [`5bcbbcf`](https://github.com/openclaw/openclaw/tree/5bcbbcf6fdd90ff1cc9c84f4cac325e0a12292c0).
- `src/auto-reply/reply/dispatch-from-config.choose-route.ts` calls
  `runBeforeDispatch()` after route and session preparation, under dispatch
  lifecycle admission, before the model. A handled result skips model dispatch
  and can return fixed text to the user.
- `src/plugins/hook-types.ts` shows that `before_dispatch` already receives
  canonical content, message ID, channel, account, conversation, session,
  sender, group flag, and timestamp.
- The hook does not currently receive the resolved `agentId` or canonical
  attachment and final source-row facts. Those are the only missing trusted
  inputs for this design.
- The smallest runtime change is to add resolved `agentId` plus the canonical
  source-row, attachment, and preview facts already known by inbound dispatch to
  the `before_dispatch` event. No new global hook, policy service, broker,
  generation lease, or challenge flow is needed.

**Hook flow**

1. Existing channel policy admits the direct message and existing routing
   chooses the receiving agent.
2. The pre-model hook receives trusted `agentId`, source message identity,
   canonical body, source rows, preview facts, and attachment facts.
3. If the message is not exactly one supported single-note collaboration URL,
   the hook returns without handling it. If it contains a Notes invitation but
   fails the exact shape, the hook returns a fixed rejection and does not invoke
   the model.
4. For a valid invitation, the hook upserts one registry row keyed by stable
   source identity. The row stores normalized URL, receiving agent ID, and
   `pending` state.
5. The hook invokes the serialized non-model helper with only row ID and URL.
   The helper opens the link under the dedicated Apple account.
6. If the URL is already present in another accepted row, the helper first
   verifies that mapped note still exists. It can then reuse that note ID
   without accepting the invitation again.
7. Otherwise the helper accepts the invitation, observes the note opened by
   that action, and resolves its Notes ID. The disposable prototype must prove
   this mapping and prove that retrying an already accepted link opens the same
   note without another mutation.
8. One transaction stores the note ID and changes the row to `accepted`. The
   row itself is now `(receiving agent ID, note ID)` authorization.
9. The hook returns fixed status text such as accepted, already available,
   pending review, or failed. No model generates this response.

**Minimal durable state**

One SQLite table is sufficient:

| Column | Purpose |
|---|---|
| Stable source key | Makes provider retries idempotent |
| Normalized URL | Finds a prior accepted mapping for repeat or multi-scope delivery |
| Receiving agent ID | Defines the exact authorization scope |
| State | `pending`, `accepted`, `needs_review`, `failed`, or `revoked` |
| Stable note ID | Becomes the tool allowlist value after acceptance |
| Content-free error and timestamps | Supports retry and operator diagnosis without note data |

The table has unique constraints on stable source key and normalized URL plus
receiving agent ID. A single helper serializes pending rows, so two scopes
receiving the same new URL cannot race two acceptance actions.

This pending state is the only crash control. If the process stops before
acceptance, the row retries. If it stops after Apple may have accepted but before
the final transaction, retry is allowed only if the disposable prototype proves
that reopening the same accepted link deterministically selects the same stable
note without another mutation. Otherwise the row moves to `needs_review` and no
grant is active.

**Tool enforcement**

- Follow the checked-in Calendar plugin pattern in
  `openclaw-plugins/secure-apple-calendar/src/plugin.ts`: build the tool from
  runtime context and reject disallowed actions before host dispatch.
- The Notes tool captures `ctx.agentId`. Its public schema has no scope or agent
  argument.
- List selects note IDs from accepted rows for that exact agent, then asks the
  host only for metadata for those IDs.
- Read verifies one accepted row before asking the host for that note ID.
- Search operates only over the caller's accepted IDs. It never returns an
  account-wide search result and filters later.
- The tool rechecks the accepted row before returning content to the model.
  Revocation applies to subsequent calls. An already-running read may complete.
- Note content remains untrusted and passes through the existing ingress checks
  before model use.

**Why the removed machinery is unnecessary**

- Apple owns shared-note membership and live synchronization.
- The existing message ACL and route own sender admission and agent scope.
- The one registry row owns idempotency, retry state, URL mapping, and the grant.
- The serialized helper prevents concurrent acceptance.
- Exact-ID tool queries make unrelated Notes account contents irrelevant.
- No Contacts checks, ownership proof, hierarchy, confirmation challenge,
  separate grants table, URL-intent table, broker, epochs, action leases,
  rollback state machine, attachment spool, relay, or web proxy is part of this
  feature.

### Implementation

Implementation is intentionally not started.

After explicit prototype-only approval:

1. Use only disposable Apple accounts and disposable single-note shares.
2. Confirm supported collaboration URL shapes and whether link reuse after
   acceptance opens the same stable note.
3. Confirm the accepted note exposes one stable ID across app restart and sync.
4. Confirm the current message runtime can supply final source-row facts and the
   exact routed `agentId` at `before_dispatch`.
5. Exercise the one-table pending, accepted, retry, multi-scope, failed, revoked,
   and `needs_review` states with recording adapters.
6. Test whether a conditional update or safe bounded append exists. Record the
   exact behavior under a concurrent human edit.
7. Rewrite this plan with the evidence and stop for separate implementation
   approval.

Only after the second approval:

1. Add the small `before_dispatch` context patch and its OpenClaw regression.
2. Add the hook, one SQLite table, and serialized acceptance helper.
3. Add exact-ID list, search, and read tools using the Calendar wrapper pattern.
4. Add focused tests and cumulative integration coverage with fake adapters.
5. Deploy through the managed test lifecycle only. Do not touch production
   invitations or notes.

### Validation

**Hook and scope**

| Scenario | Required result |
|---|---|
| Allowed direct message routes to one agent with one valid invitation | Insert one pending row for that exact agent and claim the message before model dispatch |
| Sender is rejected by existing channel policy | Hook never runs |
| Runtime agent ID is missing | Reject the invitation and write no row |
| Message text names another agent | Ignore it; use only routed runtime agent ID |
| Same source message is replayed | Reuse the same row |
| Same URL reaches another agent | Create another row for that agent |
| Message has extra text, preview, attachment, several links, or several source rows | Reject it and invoke neither helper nor model |
| Ordinary text contains no supported invitation | Continue normal model dispatch |

**Acceptance and retry**

| Scenario | Required result |
|---|---|
| New invitation resolves one stable note ID | Atomically set note ID and accepted state |
| Same accepted URL reaches another agent | Verify existing note and reuse its ID without accepting again |
| Link was accepted manually before hook delivery | Resolve the existing note and record the exact agent grant |
| Crash before helper action | Pending row retries once |
| Crash after Apple may have accepted | Retry only when prototype-proven link reuse is safe; otherwise move to needs review |
| Zero or several candidate notes appear | No grant; move to needs review |
| Shared-folder invitation | Reject before acceptance |
| Note later disappears | Reads fail and row becomes failed or revoked |

**Account visibility and tools**

| Scenario | Required result |
|---|---|
| Account contains a local or manually synced note with no registry row | No agent can list, search, or read it |
| Main has an accepted row | Only main can use that note ID |
| Household receives the same note separately | Household gains its own row; other scopes do not |
| Model supplies another agent ID | Tool schema rejects it |
| List or search attempts account-wide enumeration | Reject before host content is returned |
| Row is revoked before a call | Tool refuses the note |
| Note contains prompt injection | Ingress checks run before model use |

**Live collaboration and writes**

| Scenario | Required result |
|---|---|
| Human edits a shared note in Notes | Other open Notes clients see the change in near real time |
| Agent reads after sync | It reads the current body through its exact accepted note ID |
| Adapter replaces the whole body | Treat as unsafe for V1 |
| Human edits between agent read and whole-body replace | Prototype demonstrates the overwrite risk; no production write tool is approved |
| Stable revision or safe append is unavailable | Keep all shared-note tools read-only |

### Rollout and rollback

This revision stops before prototype work. Prototype approval permits live
invitation acceptance only between disposable accounts and notes. It does not
authorize production code, production invitations, or production writes.

After separate implementation approval, rollout starts with the hook and fake
helper, then a disposable account, then exact-ID read tools for one test scope.
Each step must show that unrelated account notes remain invisible.

Rollback disables the hook and Notes tools. It preserves the one registry table
so accepted mappings are not lost or accidentally recreated. Pending rows remain
pending or move to `needs_review`; rollback never opens a link or accepts an
invitation.

Automated production checks remain read-only. They never send a message, accept
an invitation, or edit a note.

### Review log

- 2026-08-12: Rewrote the design around one pre-model hook, one registry table,
  one serialized non-model helper, and exact-ID read tools. Removed speculative
  broker, lease, epoch, URL-intent, and multi-table recovery machinery.
  Independent review is pending.

### Checklist

- [x] Read current repository instructions and the current source-of-truth plan.
- [x] Recheck current message authorization and route bindings.
- [x] Recheck the current OpenClaw pre-model hook and its missing fields.
- [x] Verify Apple documentation for invitation acceptance, permissions,
  near-real-time collaboration, highlights, and activity.
- [x] Verify current adapter evidence for whole-body replace and
  delete-plus-create writes.
- [x] Separate Apple membership and sync from registry authorization.
- [x] Reduce durable state to one table.
- [x] Explain the hook from admitted message through exact agent grant.
- [x] Make unrelated Notes account contents invisible by exact-ID authorization.
- [x] Keep V1 read-only and state the smallest write prototype question.
- [ ] Complete independent review of simplicity, factual accuracy, and hook
  feasibility.
- [ ] Receive prototype-only approval.
- [ ] Complete disposable prototype and update this plan.
- [ ] Receive separate implementation approval.
- [ ] Implement or deploy production behavior.
