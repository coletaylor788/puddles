# Native approval for household questions to main

**Status:** Released; physical phone acceptance remains open
**Issue:** [#259](https://github.com/coletaylor788/puddles/issues/259)
**Last updated:** 2026-10-14

## Human section

### Design

Household asks main for information through native `sessions_send`. Each question
requires the owner's approval. Main's answer returns to the household conversation
that asked. The calling agent determines whether this policy applies, not the
channel, sender, or a configured list of conversations.

```mermaid
flowchart TD
    Conversation["Household conversation, in an app or channel"] --> Household["Household follows its agent instructions"]
    Household --> Policy["Policy checks the calling agent, fixed main target, and question"]
    Policy --> Approval["Native approval to the fixed owner"]
    Approval --> Decision{"Owner decision"}
    Decision -->|Deny or expire| Stop["Main does not run"]
    Decision -->|Approve once| Main["Native send to main's exact session"]
    Main --> Answer["Waited answer returns to the originating household conversation"]
    Answer -->|Another question| Policy
```

#### Agent-level policy and instructions

OpenClaw already identifies the agent executing each tool call. The plugin checks
that identity and the current calling session before requesting approval. It does
not introduce a caller identity system or require channel sender metadata. The
configuration contains only the requesting agent and the fixed main session.
Child, cron, and hook sessions retain their restrictions; household reader and
browser agents gain no access.

Household's `AGENTS.md` tells it to call `sessions_send` for information it needs
from main. The same instructions apply to native app and channel conversations.
Remove the old manual owner-message relay and the per-conversation prompt override.
For decisions or actions outside its scope, household asks the person to contact
the owner directly. Information requests never fall back to the old relay.

#### Approve one question

The small policy plugin uses OpenClaw's `before_tool_call.requireApproval` hook.
That hook pauses the tool before dispatch. The approval shows the requesting
agent, originating conversation, fixed destination, and complete quoted question.
The fixed authenticated owner can approve once or deny within ten minutes.
Every later question, including clarification, needs a new approval.

OpenClaw owns approval delivery, decisions, cancellation, and frozen arguments.
The plugin accepts only the fixed target, a bounded question, and a positive
60-second reply timeout. Approval permits returning main's answer to the asking
conversation. It does not make household the owner or authorize unrelated actions.
There is no native gate on the automatically returned answer, and no custom
answer-approval system is proposed.

#### Return one answer through native scoped access

The supported `openclaw/plugin-sdk/session-visibility` API grants `send` access
to main's exact current session. The provider resolves that session from host
state. It grants no history, discovery, search, alternate target, or main files.
Ordinary household cross-agent access remains denied, so a missing or stopped
provider cannot fall back to unrestricted peer communication.

Native exact-session sends return the waited answer without starting detached
peer reply turns, announcements, or watches. A timeout can return an uncertain
outcome; household must not resend automatically, read history, or promise later
delivery. Native admission rejects a target replaced or archived after the grant.
The plugin never replaces the tool executor or patches agent-to-agent code.

### Status

**Approval:** Production approved. **Approval reference:** On 2026-10-14 the
requester approved the agent-level policy, agent-level instructions, fixed-owner
approval for every question, and native exact-session sends: "okay, approved this
new solution". No core agent-to-agent patch is permitted. This approval covers
implementation, review, validation, release, and cleanup within that scope.

The agent-level correction is deployed and its tested source is merged. Focused
checks, retained review, DEV, the full application gate, TEST, and read-only
production acceptance passed. Production is healthy with intake open. Physical
phone question, owner approval, and returned-answer acceptance remains open.

## Agent section

### State

[PR #289](https://github.com/coletaylor788/puddles/pull/289) merged as
`e31805991e18e8b0ec20974acd2e3260f4d5f62e`. The release controller deployed
artifact `bf12e7d1bcdca8d6543cdfbef9a02badec4d32f54e67d16eb7ab10cfe36860f0`
and completed ticket `household-agent-approvals-20261014-r3`. The release lane is
empty, production is healthy, and intake is open. The single recovery backup is
valid. The release manager owns remote workspace finalization; local feature
output and its companion worktree have been finalized.

The earlier native app failure came from conversation-specific instructions:
household chose the old message relay, which failed before creating an approval.
The deployed correction applies instructions and policy to the household agent
across app and channel conversations. Physical approval delivery remains unproven.

The selected upstream revision remains OpenClaw 2026.9.6,
`eb377ac59e6c9fd6c7705028034812becf00271b`. Upstream removed
`session.agentToAgent.maxPingPongTurns` in
[PR #111382](https://github.com/openclaw/openclaw/pull/111382). Ordinary peer sends
use five turns. This design uses the separate supported exact-session capability,
not a restored setting, `REPLY_SKIP`, or a custom executor.

### Scope and acceptance criteria

- Native app and iMessage household conversations can request fixed-owner approval.
- Every question freezes its own arguments and requires a fresh decision.
- Main never runs before approval or after denial, expiry, or pre-dispatch abort.
- The answer returns to the originating conversation without automatic peer turns.
- Worker sessions, other destinations, missing caller context, stale sessions,
  and absent approval hooks do not receive the scoped grant.
- Household gets no main history, memory, files, or broad agent-to-agent access.
- Agent instructions replace the manual relay across channels.
- Automated checks record external delivery and never send live messages.

### Architecture and decisions

[`src/plugin.ts`](../../openclaw-plugins/approved-session-send/src/plugin.ts)
checks the native tool-call context's `agentId`, `sessionKey`, `sessionId`, and
`runId`. It verifies that the session belongs to the configured agent and matches
host state. Sender, channel, and account are not admission criteria. The scoped
provider receives OpenClaw's requester session key and resolves its agent and
current metadata through the native session API.

The provider is process-wide, while hooks belong to run registries. Before
granting access it requires its own loaded plugin and `before_tool_call` hook in
the current native registry. Startup and Copilot harness activation, including
`discovery` registration, remain required. Registration cleanup revokes access;
configuration changes disable the old registration until reload.

The prior `requesters` list and per-conversation prompt hook are removed. Agent
instructions belong in the configured household workspace, supplied by the
application's reviewed guidance. Environment bindings no longer alter approval
requester identity. Fixed-owner forwarding remains independently configured.

### Implementation

The public plugin, manifest, package tests, and composed native regression change
together. The composed test uses a native app session without requester channel
metadata. Environment configuration tests reject attempts to change the policy's
agent or target through bindings.

Companion changes remove obsolete requester bindings, package household guidance,
and apply it with the same environment preparation used in DEV, TEST, and PROD.
Preparation binds the exact configured guidance path and predecessor hash or
explicit absence, rejects drift and symlinks, and installs the candidate bytes.
Acceptance compares installed guidance and plugin configuration with the candidate.
The release backup must include the individual production household guidance file.

### Validation

Local policy tests pass: 47 tests. Environment configuration tests pass: 20 tests.
Focused companion configuration and guidance installation tests pass: 9 tests.
The composed native SDK regression passed five recorded questions. Three fresh
installed cases passed: iMessage, native app chat, and a native app connection
without approval permission. Each successful conversation required two fresh
approvals, ran main once, and denied its follow-up. The unprivileged connection
created no approval record and never ran main. All external delivery was recorded.

The app fixture retains a native gateway connection throughout each conversation
and uses normal operator approval scopes. It seeds a named empty conversation to
avoid an unrelated title-generation model call. Every household model request
contains the exact packaged guidance. These tests exercise the native chat RPC
contract; physical app pairing and delivery remain separate acceptance.

Retained implementation and validation review is clear. DEV passed all 67
installed checks. A bounded real-model DEV check selected `sessions_send` and
created a native approval from household after one model request. It stopped
before main ran and recorded all delivery, with zero external writes.

The full application gate passed in 810,137 ms. The final controller attempt
reused that result only after exact source, artifact, prepared output, runner,
environment, toolchain, and dependency inputs matched. TEST passed all 67 checks
with no failures or skips in 209,502 ms. Read-only production acceptance passed in
925 ms and verified health, plugin activation, configuration, and installed
guidance. The installed guidance SHA-256 is
`a53eff7b51c3812f252f1d36fe571f89e5ec7d35e55521c31994fca8fac3cb04`.
No production model requests or message sends were used for acceptance.

### Rollout and rollback

Follow the [application runner](../../packages/e2e/README.md),
[deployment coordination](../../packages/e2e/DEPLOYMENT_COORDINATION.md), and
[storage workflow](../../packages/e2e/DEVELOPMENT_STORAGE.md). Reuse one owned
workspace and one incremental application output. The manager owns the FIFO lane.

After review and DEV readiness, freeze the candidate, run the complete application
suite, and install those bytes in TEST. Replace the verified backup before PROD.
Keep intake held through read-only production checks and source merge. Restore
runtime, configuration, and household instructions together on failure. Never
leave scoped access active without the approval hook. Physical acceptance remains
separate from automated recording and read-only production checks.

### Review log

The retained independent reviewer cleared the complete public and companion
behavior diff and the corrected installed test driver. Permission-denial behavior
and connection lifetime are covered by the installed regression. The same reviewer
also cleared the fixture-only browser wait compatibility correction, which keeps
profile and stale-lock assertions intact without changing the shipped browser
entrypoint. Later behavior changes require review by that same reviewer.

### Checklist

- [x] Record approval and the agent-level design.
- [x] Implement the policy and focused configuration regressions.
- [x] Pass native app and channel installed regressions and DEV behavior checks.
- [x] Complete retained review and required repository checks.
- [x] Pass the frozen application gate, TEST, and read-only PROD acceptance.
- [ ] Merge tested source and finalize owned development output.
- [ ] Complete physical question, owner approval, and answer acceptance.
