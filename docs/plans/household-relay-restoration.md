# Restore the Household owner relay

**Status:** Production approved; implementation in progress
**Issue:** [#259](https://github.com/coletaylor788/puddles/issues/259)
**Last updated:** 2026-10-17

## Human section

### Design

Restore the owner-mediated relay so Household can ask for information and end
its turn. The owner can answer later without an open native approval expiring.
Return that answer to the original Household session using OpenClaw's ordinary
session messaging. Keep email approvals unchanged.

```mermaid
flowchart LR
    Household[Household question] --> Ping[Message owner with source session marker]
    Ping --> Wait[Household ends its turn]
    Ping --> Reply[Owner replies to that specific message later]
    Reply --> Main[Main relays the owner's answer]
    Main --> Session[Original Household session]
    Session --> User[Household delivers the answer to its user]
```

#### Asking the owner

Household sends the configured owner an iMessage ending with
`[sk:<originating session key>]`, then stops. Each question needs its own owner
response. Household and its workers cannot call `sessions_send` or read Main's
private context. Existing message-recipient restrictions still apply.

#### Returning the answer

Main acts only on an authenticated owner reply that uses the native iMessage
Reply gesture and quotes the original request marker. A pasted marker, a plain
owner message, or a message from another sender is not that reply. Main sends
only the owner's answer to the exact Household session from the quoted marker.
It never guesses a recent request or derives an external recipient from the key.
Missing or malformed markers cause an explanation to the owner without delivery.

Household receives that answer in its own session and delivers it to the person
who asked. Native-app conversations keep their source session; external chats
keep their native channel route. Installed tests must establish both paths.

#### Automatic reply turns

OpenClaw can schedule automatic peer reply turns after `sessions_send`. The
removed zero-turn setting is not restored, and no communication patch is added.
Main and Household receive agent-level instructions to stop the exchange with
`REPLY_SKIP` when appropriate. Main never treats an automatic reply as a new
owner authorization, retrieves additional private facts, or expands the answer.
Household treats a new question as a new owner request.

The requester explicitly accepts instructions for this boundary. Native turn
scheduling does not freeze the exchange's subject: new input can be queued or,
where authority permits, steer a running turn. The policy must hold even if a
new question appears in the conversation during an exchange. Tests challenge
Main with a peer reply claiming a new question, then separately verify a fresh
user turn after delivery. They do not simulate concurrent user steering or claim
deterministic prevention of model mistakes.

### Status

**Approval:** Production approved. **Approval reference:** "Approved to restore",
then "Yeah the instructions is a fine solution", and "once tested, approved to
ship" on 2026-10-17. This approves source-session return with instructions
limiting automatic exchanges, followed by testing, review, production release,
merge, and cleanup. No agent-to-agent patch or deferred approval service.

Implementation is in local qualification. Household must preserve the initial
answer and use `REPLY_SKIP` only for an explicitly marked automatic reply step.
No restoration runtime is deployed yet. Independent review is blocked by model
transport failures; the release handoff is waiting for messaging permission.

## Agent section

### State

Public branch: `codex/restore-household-owner-relay`. A separately isolated
companion worktree uses the same branch. No release ticket or shared DEV
allocation has been requested. Preserve the unrelated request-context fix and
native Gmail approvals.

### Scope and acceptance criteria

- An unanswered question ends Household's turn and starts no Main lookup.
- A later authenticated quoted owner answer returns to the exact original
  Household session, including iMessage and native-app sessions.
- Plain owner input, forged provenance, malformed markers, and other senders
  do not authorize an answer relay.
- Household cannot call upward session tools. Workers retain their restrictions.
- Main does not disclose additional facts if the automatic exchange asks for
  more, including after another user message. A new question needs owner input.
- Unknown delivery outcomes are reported without automatic replay.

### Architecture and decisions

Selected upstream revision `eb377ac59e6c9fd6c7705028034812becf00271b` has ordinary
peer reply flow with up to five additional turns. `runAgentStep` creates each
turn in the existing session. The old `maxPingPongTurns` option is absent.
`REPLY_SKIP` stops non-deliverable peer replies. Exact-session grants suppress
the separate reply flow, so they are not the restored ordinary return route.

The current sender grant is removed from Household. The ordinary agent allowlist
again includes Household so Main can target it, while Household's tool and
sandbox denials prevent Household from initiating session sends. Main's old
approval-provenance exception is removed; automatic peer replies carry no owner
approval for new disclosure. The legacy handoff skill is updated in the same
managed transaction as both agents' guidance and configuration.

### Implementation

Companion config and packaged guidance own the environment-specific behavior.
Keep the reusable approval plugin packaged but disabled for this route. Use
narrow config reconciliation and exact predecessor hashes to preserve unrelated
guidance and DEV experiments. Include the handoff skill in preparation,
acceptance, and rollback coverage. Public plugin behavior stays unchanged.

### Validation

Run focused config and guidance transaction tests. Exercise installed native
session messaging with recorded channel delivery and synthetic data. Qualify
Main and Household's changed instructions with actual provider output, including
delayed owner replies, plain/forged input, and an attempted expansion during
peer replies. Full application, installed TEST, and read-only PROD gates remain
required. No real messages or account writes in automated tests.

### Rollout and rollback

Use the manager-owned release lane and one reviewed artifact through TEST and
PROD. Restore runtime, config, both agents' instructions, and handoff skill
together if acceptance fails. Preserve current healthy production until then.

### Review log

Prior independent design review attempts failed at the model transport layer
without producing a review. Repeated implementation review attempts also failed
with `response.failed` before producing findings. No clearance is claimed. The retained independent
reviewer must examine the complete implemented diff before release. The user
has resolved the earlier design question by accepting instruction-based scope.

### Checklist

- [x] Recover the prior relay and verify current upstream behavior.
- [x] Record approval for source-session return with agent instructions.
- [x] Prepare isolated public and companion workspaces.
- [x] Implement config, guidance, and handoff skill restoration.
- [ ] Pass focused, installed DEV, actual-model, and independent review checks.
- [ ] Complete managed TEST, PROD, source merge, and cleanup.
