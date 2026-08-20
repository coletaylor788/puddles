# Secure Apple Notes shared access

**Status:** Editable access under review
**Issue:** [#74](https://github.com/coletaylor788/puddles/issues/74)
**Last updated:** 2026-08-20

## Human section

### Design

The accepted invitation design stays simple. An admitted direct message can
carry one Notes invitation to its receiving agent. A hook records that exact
agent and link before the model runs. A non-model helper accepts the invitation
under the dedicated Apple account, resolves the shared note to one stable
identifier, and turns the same row into that agent's grant.

The agent edits a granted note by appending a new update through the native Notes
editor. The helper opens the exact mapped note, confirms the editor is on that
note, moves to the end, and inserts one bounded plain-text block with a unique
receipt. It never reads and replaces the whole body. Notes therefore handles the
append as a normal participant edit and merges it with human collaboration.
Concurrent edits can change where two additions appear, but they cannot be
silently overwritten by an agent body replacement.

Memo is not the write engine. Its edit command converts the whole note through
Markdown and assigns the whole body again. That can erase concurrent edits and
damage rich content or attachments. OpenClaw only includes instructions and an
optional installer for Memo. It does not bundle Memo or provide a scoped Notes
tool.

If the helper cannot prove that it opened the mapped note, placed the complete
receipt exactly once, or observed the completed append, it reports a conflict
and does not retry blindly. The user can read the note and decide whether to try
again. Arbitrary replacement, deletion, range editing, and rewriting an earlier
agent block remain out of scope because the available interfaces provide no
atomic precondition.

### Status

The invitation hook and exact agent-to-note grant remain accepted. Research now
supports a concrete append-only edit design, and independent review is checking
its factual accuracy and failure behavior.

No prototype or implementation is approved or started. The next approval can
authorize only disposable proof with throwaway accounts and shared notes. Real
implementation still needs separate approval after that evidence updates this
plan.

## Agent section

### State

- Lifecycle state: investigation and design only.
- Source of truth:
  `docs/plans/todoist-74-apple-notes-shared-access.md`.
- Current implementation: none. This repository has no Apple Notes plugin,
  invitation helper, grant registry, Memo installation, or Notes tool.
- Accepted design boundary: preserve the pre-model invitation hook, one durable
  invitation/grant table, serialized acceptance, and exact `(agentId, noteId)`
  authorization.
- New write requirement: V1 must support a bounded edit without replacing the
  existing note body.
- Selected V1 edit: append one bounded plain-text update through the native
  Notes editor after exact stable-ID selection.
- Approval gate 1: explicit approval may authorize only a disposable prototype
  with throwaway accounts and notes.
- Approval gate 2: prototype evidence must update this plan before separate
  implementation approval.
- Production impact: none. This design authorizes no installation, live
  invitation, account, note, service, deployment, or tool change.

### Scope and acceptance criteria

- The existing channel allowlist and route binding are the trust decision.
- The exact receiving runtime `agentId` is the grant scope.
- A grant is one accepted registry row containing an exact agent ID and stable
  note ID.
- The same note sent separately to another agent creates another accepted row.
- No Contacts lookup, owner inference, hierarchy, or grant propagation exists.
- The accepted invitation hook behavior, single-row intake proof, immediate
  handled reply, durable pending state, and serialized acceptance remain
  unchanged.
- List, search, read, and append derive caller scope from runtime context. The
  model cannot provide or widen `agentId`.
- Every host operation is limited to stable note IDs joined to active grants for
  that exact caller before note content reaches the model or GUI helper.
- V1 append accepts one granted note ID, plain text, and a bounded client request
  ID. It does not accept HTML, Markdown interpretation, file paths, attachments,
  a target scope, a cursor position, or a replacement body.
- The write helper opens the exact stable ID, verifies the expected selected
  note, inserts one receipt-marked block at the end through the native editor,
  and verifies the receipt afterward.
- The helper serializes writes per stable note ID across every agent grant.
- A repeated request ID with the same agent, note, and payload returns its saved
  result. Any mismatch fails.
- An uncertain or partial result never retries automatically.
- Human edits may interleave with the append. The helper must not replace an
  existing range or claim atomic ordering with remote collaborators.
- View-only shares, disappeared notes, revoked grants, ambiguous UI state,
  unsupported Notes versions, and missing permissions fail closed.
- Notes already visible to the Apple account but absent from an accepted grant
  remain unavailable.
- Automated tests use fake message, Notes, accessibility, and read-back
  adapters. They never accept a live invitation or mutate a live account.

### Architecture and decisions

**Accepted invitation and grant flow**

1. Existing channel policy admits a direct message and routing chooses the
   receiving agent.
2. The pre-model hook receives trusted route and final source-row facts. It
   accepts only one supported single-note invitation URL in one complete source
   row with no preview, attachment, group context, or extra text.
3. The hook upserts one pending row for the stable source identity, normalized
   URL, and exact runtime `agentId`. It wakes the helper and returns a fixed
   handled response without waiting for Apple UI work.
4. The serialized helper accepts or reopens the invitation under the dedicated
   Apple account and resolves exactly one stable Notes note ID.
5. One transaction stores the stable note ID and changes the same row to
   `accepted`. That row is the grant.
6. Repeating a known URL for another receiving agent verifies the mapped note
   and adds that exact agent's row without accepting the invitation twice.

The current OpenClaw seam remains the pre-model `before_dispatch` hook. The
previous research commit is superseded by current upstream commit
[`916eef4`](https://github.com/openclaw/openclaw/tree/916eef4e996008d387207c53044afd8cf02dcc30).
The current
[`src/auto-reply/reply/dispatch-from-config.choose-route.ts`](https://github.com/openclaw/openclaw/blob/916eef4e996008d387207c53044afd8cf02dcc30/src/auto-reply/reply/dispatch-from-config.choose-route.ts)
still runs the hook after routing and before model dispatch. Implementation
still needs the small context addition for resolved `agentId` and canonical
source-row, attachment, and preview facts.

**What OpenClaw actually provides**

- Current OpenClaw bundles
  [`skills/apple-notes/SKILL.md`](https://github.com/openclaw/openclaw/blob/916eef4e996008d387207c53044afd8cf02dcc30/skills/apple-notes/SKILL.md).
  It tells an agent how to invoke Memo interactively and declares `memo` as a
  required host binary.
- The skill metadata offers the Homebrew formula
  `antoniorodr/memo/memo`. It does not contain Memo or install it silently.
- Current
  [`src/skills/discovery/status.ts`](https://github.com/openclaw/openclaw/blob/916eef4e996008d387207c53044afd8cf02dcc30/src/skills/discovery/status.ts)
  marks a skill ineligible when a required binary is missing and surfaces an
  install option.
- Current
  [`src/commands/onboard-skills.ts`](https://github.com/openclaw/openclaw/blob/916eef4e996008d387207c53044afd8cf02dcc30/src/commands/onboard-skills.ts)
  offers bundled dependency recipes only through an explicit onboarding
  selection before running the installer.
- Current
  [`docs/help/faq.md`](https://github.com/openclaw/openclaw/blob/916eef4e996008d387207c53044afd8cf02dcc30/docs/help/faq.md)
  describes Memo as a macOS binary that the agent runs directly or through a
  remote node or user-created SSH wrapper.
- No current OpenClaw plugin, MCP server, built-in tool, or runtime wrapper
  enforces this plan's exact agent-to-note grants around Memo.
- This repository only mentions the upstream Apple Notes skill in its
  sandboxing documentation. It does not install or invoke Memo.

**Memo source findings**

Research used Memo main commit
[`1b84963`](https://github.com/antoniorodr/memo/tree/1b84963ade3ff14e6f8d21e6beceb4d0cb19d404)
and latest release `v0.6.1` at
[`bb0b53d`](https://github.com/antoniorodr/memo/tree/bb0b53d1404fe5eb18bc413ef6653a6f115cc3ae).
The Apache-2.0 project is active, with its latest main commit on 2026-08-11.

- Memo is a Python 3.13 Click CLI. Runtime dependencies in
  [`pyproject.toml`](https://github.com/antoniorodr/memo/blob/1b84963ade3ff14e6f8d21e6beceb4d0cb19d404/pyproject.toml)
  include `html2text` and `mistune`. Interactive search also shells out to
  `fzf`, `bat`, `file`, and `git`.
- Memo uses `osascript` for Notes operations. It does not ship direct database
  writes, ScriptingBridge, an App Intent client, or Notes accessibility
  automation.
- [`get_memo.py`](https://github.com/antoniorodr/memo/blob/1b84963ade3ff14e6f8d21e6beceb4d0cb19d404/src/memo_helpers/get_memo.py)
  enumerates notes and builds a positional display map. Notes themselves expose
  Core Data IDs, but interactive commands ask the user to select a list number.
- [`cache_memo.py`](https://github.com/antoniorodr/memo/blob/1b84963ade3ff14e6f8d21e6beceb4d0cb19d404/src/memo_helpers/cache_memo.py)
  caches that list for five minutes.
- [`search_memo.py`](https://github.com/antoniorodr/memo/blob/1b84963ade3ff14e6f8d21e6beceb4d0cb19d404/src/memo_helpers/search_memo.py)
  converts every note to temporary Markdown files and starts interactive fuzzy
  search. It has no structured scoped output contract for an agent tool.
- [`edit_memo.py`](https://github.com/antoniorodr/memo/blob/1b84963ade3ff14e6f8d21e6beceb4d0cb19d404/src/memo_helpers/edit_memo.py#L61-L140)
  reads the full HTML body, converts it to Markdown, opens a terminal editor,
  converts the result back to HTML, then uses AppleScript `set body` on the
  selected note. There is no append command, range operation, revision token,
  hash precondition, lock, or conflict detection.
- The same edit path deletes every attachment and recreates only surviving
  images at the end. Non-image attachments, native tables, checklists, drawings,
  tags, mentions, style details, and original image positions cannot be
  preserved by the conversion pipeline.
- [`move_memo.py`](https://github.com/antoniorodr/memo/blob/1b84963ade3ff14e6f8d21e6beceb4d0cb19d404/src/memo_helpers/move_memo.py)
  creates a body-only copy and deletes the original, so a move changes the note
  ID and loses unsupported content.
- Memo returns human-oriented text and interactive prompts, not stable
  machine-readable mutation receipts. Errors are inconsistent, and body,
  title, folder, and ID values are interpolated into AppleScript strings without
  one shared safe quoting boundary.

Memo is useful evidence that AppleScript can discover IDs and read HTML. Its
write, move, selection, conversion, and output behavior are not suitable for
shared-note authorization or editing. The design does not install or wrap it.

**Write-surface comparison**

| Surface | Exact stable ID | Mutation | Human-collaboration behavior | Decision |
|---|---:|---|---|---|
| AppleScript or JXA | Yes | Whole `body` HTML assignment | Read-modify-write can erase concurrent edits and alter rich content | Use only for exact-ID metadata and read-back |
| ScriptingBridge | Yes | Same Notes scripting dictionary | Same whole-body limit with more native packaging | Reject for content writes |
| Shortcuts `Append to Note` | Not for arbitrary dynamic existing IDs | Native end append | Does not rewrite existing ranges; ordering and sync still need proof | Strong semantic reference, but unsafe target resolution |
| Accessibility-driven Notes editor | Yes, by exact `show note id` before UI work | Native insertion at the selected note's end | Participates in Notes editing instead of replacing the body | Selected for disposable prototype |
| Share extension | No unattended exact target | User-driven create or append | Requires user interaction and cannot enforce runtime agent grant | Reject |
| Direct `NoteStore.sqlite` or protobuf write | Internal IDs only | Private database mutation | Bypasses supported Notes and CloudKit write paths | Prohibit |
| CloudKit or private iCloud API | No public Notes container API | Private service calls | Unsupported and unstable | Prohibit |

Apple documents UI scripting as simulated user interaction through macOS
accessibility, with per-application permission, in
[`Automating the User Interface`](https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html).
Apple's
[`Notes keyboard guide`](https://support.apple.com/guide/notes/keyboard-shortcuts-and-gestures-apd46c25187e/mac)
states that pressing Return on a selected note starts editing with the insertion
point at the end. Notes AppleScript supports exact `show note id` addressing,
as documented and exercised by maintained adapter
[`sweetrb/apple-notes-mcp`](https://github.com/sweetrb/apple-notes-mcp/blob/3049367b96db6b41a0b913a89c32f321e497d86a/docs/APPLESCRIPT-LIMITATIONS.md).

**Why Shortcuts is not the selected target adapter**

- Apple documents that the `shortcuts` CLI runs an already installed named
  workflow and can pass files or text as input in
  [`Run shortcuts from the command line`](https://support.apple.com/guide/shortcuts-mac/run-shortcuts-from-the-command-line-apd455c82f02/mac).
- Maintained reference
  [`iangray001/applenotes-mcp`](https://github.com/iangray001/applenotes-mcp/tree/3e93d80ef7906f3beb3bf8d51e2d8991c3b0b603)
  proves that a generated Shortcut can create a note and append native rich text,
  checklists, tables, and files while it still holds the returned Note entity.
- Its
  [`NOTES.md`](https://github.com/iangray001/applenotes-mcp/blob/3e93d80ef7906f3beb3bf8d51e2d8991c3b0b603/NOTES.md)
  also explains that Shortcuts `Find Notes` is a fuzzy name query and cannot
  safely address an arbitrary existing note. The project's existing edit works
  by creating a replacement and deleting the original, which changes the ID and
  breaks shared notes.
- A third-party process cannot directly invoke another app's App Intent. It can
  only run a user-installed Shortcut wrapper. Current public inputs do not turn
  this plan's Core Data note ID into the exact Notes App Entity required by
  `Append to Note`.
- The prototype should retest this limitation on the target Notes and Shortcuts
  versions. If a supported exact-ID entity input exists, the Shortcuts append
  becomes preferable to accessibility. Title search, fuzzy selection, per-note
  generated shortcuts, and manual selection are not acceptable substitutes.

**Selected append flow**

1. The Notes tool is created with trusted runtime `agentId`. The model supplies
   one note ID returned by scoped list or search, bounded plain text, and an
   idempotency key. It cannot supply caller scope.
2. The tool joins the note ID to an active accepted row for that exact agent
   before it sends anything to the host.
3. One protected SQLite write-action row stores action ID, agent ID, note ID,
   payload digest, bounded pending payload, state, content-free error, and
   timestamps. Payload is removed when the action reaches a terminal state.
   This second table is necessary because a durable grant row cannot also
   represent an interruptible content mutation.
4. A single non-model GUI helper serializes actions by note ID. It rechecks the
   active grant and note existence, confirms the share is editable, and records
   the current modification date.
5. The helper marks the action `executing`, asks Notes to show the exact stable
   ID, and waits for one version-pinned accessibility hierarchy. It must prove
   that the selected editor corresponds to the expected note ID. A title or
   window label is not sufficient.
6. The helper uses the native editor's end-of-note action and performs one paste
   containing a leading paragraph break and a complete bounded block. The block
   includes a visible opaque action receipt, timestamp, text, and closing
   receipt. It does not interpret markup.
7. The helper reads the same exact note through the read adapter. Success
   requires one complete matching receipt at the end, the exact normalized
   payload between its markers, and a changed modification date. Existing body
   content and attachment metadata sampled before the append must remain
   unchanged.
8. The helper stores `applied`, removes the pending payload, and returns a fixed
   receipt. If verification proves no receipt was inserted, it stores `failed`.
   A partial, duplicate, wrong-note, timeout, lost-focus, or unreadable result
   stores `needs_review`.
9. Recovery rechecks `prepared` and `executing` rows by exact note ID and receipt.
   A complete single receipt becomes `applied`. A partial or duplicate receipt
   becomes `needs_review`. An executing row with no receipt remains
   `needs_review`; it never pastes again automatically.

The UI helper runs under the same dedicated Notes GUI identity already required
for invitation acceptance. It receives only action ID, exact note ID, and
bounded text over authenticated IPC. The model worker cannot access Notes,
accessibility, the registry database, or the helper directly.

**Conflict model**

- The native editor changes only a new block at the current end. It does not
  fetch and replace the existing body, so concurrent human changes elsewhere
  are left to Notes' normal collaboration merge.
- There is no claim of transactional append across devices. A human adding text
  to the same final paragraph may cause relative ordering changes or a sync
  conflict. The prototype must measure this.
- The helper serializes local writes to the same note. It cannot serialize human
  collaborators.
- Every write has one visible receipt. This lets read-back and restart recovery
  distinguish success, absence, partial insertion, and duplication without
  relying only on modification time.
- On `needs_review`, the tool returns a fixed conflict with the action receipt.
  The caller must read the note before submitting a new action. The helper does
  not roll back native collaboration by replacing the old body.
- Rollback of a completed append is another append that marks the prior receipt
  superseded. V1 never deletes or rewrites the original block automatically.

**Operations considered**

| Operation | Feasibility | Decision |
|---|---|---|
| Append a new update block | Native end insertion, no existing range replacement | V1 write |
| Append a new agent-owned section | Same operation with a section heading | V1 write |
| Change an earlier agent block | Requires range addressing or whole-body rewrite | Reject |
| Insert at a marker in the middle | No supported exact-range API | Reject |
| Exact-range patch with hash | No atomic precondition or conditional range mutation | Reject |
| Whole-body replace after optimistic re-read | Human can edit after the last read and before the write | Reject |
| Memo interactive edit | Whole-body lossy conversion and assignment | Reject |
| Delete or recreate the note | Changes identity or membership and can destroy content | Reject |

### Implementation

Implementation is intentionally not started.

After explicit prototype-only approval:

1. Use only disposable Apple accounts and disposable single-note shares with
   read-write participant permission.
2. Reconfirm the accepted invitation flow, stable note ID, link reuse, and exact
   agent grant on the target OpenClaw and macOS versions.
3. Inventory target Notes App Intents at runtime. Test whether one installed
   Shortcut can resolve an arbitrary existing note by the stored stable ID. Use
   Shortcuts only if this exact, non-title path is proven.
4. Otherwise build a throwaway accessibility probe for exact `show note id`,
   selected-note proof, end-of-note focus, one-shot plain-text paste, and
   read-back. Do not generalize it into production code.
5. Exercise remote human edits before, during, and after each append. Cover the
   same final paragraph, another paragraph, offline sync, two local actions,
   interruption before paste, interruption after paste, and restart recovery.
6. Use notes containing rich text, tables, native checklists, files, drawings,
   links, tags, mentions, highlights, and images. Prove every pre-existing
   element survives unchanged.
7. Measure receipt fidelity, partial paste behavior, modification-date
   granularity, stable-ID persistence, focus loss, wrong-window detection,
   language and keyboard-layout dependence, sync delay, and conflict copies.
8. Revoke edit permission and remove the share while an action is queued and
   while the editor is open. Both must fail without cross-note mutation.
9. Record exact supported Notes, Shortcuts, and macOS versions plus the observed
   accessibility hierarchy and TCC permissions.
10. Rewrite this plan with the evidence and stop for separate implementation
    approval.

Only after the second approval:

1. Add the small `before_dispatch` context patch and its OpenClaw regression.
2. Add the invitation hook, grant registry, and serialized acceptance helper.
3. Add exact-ID list, search, read, and append tools using runtime `agentId`.
4. Add the protected write-action table and the version-gated GUI append helper.
5. Add focused tests and cumulative integration coverage with recording
   adapters. No automated test may reach live Notes or accessibility.
6. Deploy through the managed test lifecycle only. Production remains outside
   this design approval.

### Validation

**Invitation and scope**

| Scenario | Required result |
|---|---|
| Allowed direct message has one valid invitation | Insert one pending row for the exact routed agent and claim before model dispatch |
| Sender is rejected by channel policy | Hook never runs |
| Runtime agent ID or final source proof is missing | Reject and write no row |
| Same URL reaches another agent | Add that agent's grant after verifying the mapped note |
| Preview, attachment, extra text, several rows, group, or several links | Reject before helper or model |
| Account contains an unmapped note | No agent can list, search, read, or append it |

**Write authorization**

| Scenario | Required result |
|---|---|
| Exact caller has an active grant | Prepare one action for that note |
| Model supplies another agent ID | Tool schema has no such argument |
| Model supplies an ungranted stable ID | Reject before host access |
| Same note is granted to several agents | Each caller needs its own active row; helper still serializes by note ID |
| Grant or share is revoked before paste | Fail without mutation |
| Share becomes view-only | Fail without mutation |

**Append and collaboration**

| Scenario | Required result |
|---|---|
| Exact mapped note is selected and editable | Append one complete receipt block at end |
| Human edits another paragraph concurrently | Preserve the human edit and append block |
| Human edits the final paragraph concurrently | Preserve both changes or return conflict; never replace the body |
| Two local appends target one note | Serialize and produce two complete receipts |
| Notes focus or selected-note proof is missing | Fail before paste |
| Focus changes during action | Verification cannot prove success, so mark needs review |
| Rich note has tables, checklists, files, drawings, tags, mentions, links, highlights, or images | Every existing element remains unchanged |
| Payload contains Unicode, line breaks, markup characters, or receipt-like text | Insert literal bounded text without breaking receipt framing |

**Interruption and idempotency**

| Scenario | Required result |
|---|---|
| Same action ID, agent, note, and payload repeats | Return saved state without another paste |
| Same action ID has different scope, note, or digest | Reject |
| Crash before executing | Recovery may process prepared row once |
| Crash after paste with one complete receipt | Recovery records applied without another paste |
| Crash during paste with a partial receipt | Mark needs review and do not retry |
| Executing row has no provable receipt | Mark needs review and do not retry |
| Read-back sees a duplicate or wrong-note receipt | Mark needs review and disable automatic retry |

**Rejected adapters**

| Candidate | Required proof |
|---|---|
| Memo edit | Test demonstrates whole-body assignment and rich-content loss; never use for V1 write |
| AppleScript append by read-concat-set | Concurrent edit test demonstrates body-replacement race; never use |
| Shortcuts append by title or fuzzy search | Duplicate-title test demonstrates ambiguity; never use |
| Direct Notes database write | Static validation rejects any writable database open |
| Whole-body optimistic replace | Concurrent edit after final check demonstrates remaining race; never use |

### Rollout and rollback

This revision stops before prototype work. Prototype approval permits live
invitation and append tests only between disposable accounts and disposable
notes. It does not authorize Memo installation, production code, production
invitations, production notes, or production writes.

After separate implementation approval, rollout starts with fake adapters, then
the exact-version disposable GUI identity, then one test agent and one disposable
shared note. Each step must prove that unrelated and ungranted notes remain
invisible and untouched.

Runtime version or accessibility hierarchy mismatch disables write tools.
Read-only operations may remain available when their own exact-ID adapter is
healthy. A missing Shortcut, permission, active GUI session, focus proof, or
read-back capability cannot degrade into whole-body AppleScript.

Rollback disables invitation intake and Notes tools. It preserves accepted
grants and write receipts for diagnosis. It deletes any pending write payload
only after recording the action as cancelled. It never removes a completed
append, rewrites a shared note, opens an invitation, or restores live registry
state from an older snapshot.

Automated production checks remain read-only. They never send a message, accept
an invitation, open the Notes editor, or append content.

### Review log

- 2026-08-20: Preserved the accepted hook and grant model. Replaced the
  read-only decision with a native exact-ID append design. Current Memo source
  proved its edit is a lossy whole-body assignment with no append or conflict
  control. Current OpenClaw source proved its Memo integration is an
  instructional skill plus optional installer, not a scoped tool. Independent
  review is pending.

### Checklist

- [x] Read current main repository instructions and safe feature workflow.
- [x] Re-read the complete source-of-truth plan and current tracking state.
- [x] Preserve the accepted invitation hook and exact agent-to-note grant.
- [x] Inspect Memo main source, latest release, dependencies, commands,
  selection, IDs, output, errors, conversion, attachments, and concurrency.
- [x] Trace every current OpenClaw Memo and Apple Notes reference.
- [x] Distinguish bundled skill instructions from Memo installation and runtime
  tool enforcement.
- [x] Compare AppleScript, JXA, ScriptingBridge, Shortcuts, accessibility, share
  extensions, direct database writes, and private service APIs.
- [x] Compare append, marker insertion, range patch, optimistic whole-body
  replace, and native UI editing.
- [x] Select exact-ID native append and define its conflict behavior.
- [x] Define write authorization, durable receipts, interruption handling,
  read-back, and fail-closed outcomes.
- [x] Define the disposable collaboration and rich-content prototype.
- [ ] Complete independent review of factual accuracy, edit safety, Memo and
  OpenClaw evidence, simplicity, and read-write coverage.
- [ ] Receive prototype-only approval.
- [ ] Run disposable prototype and update this plan.
- [ ] Receive separate implementation approval.
- [ ] Implement or deploy production behavior.
