# Realtime consultation through the configured agent runtime

Status: Production approved
Issue: https://github.com/coletaylor788/puddles/issues/346
Last updated: 2026-11-11
Owner: Realtime consultation repair owner

## Human section

### Design

#### Problem and outcome

Realtime voice consultations call the embedded agent runner directly. When the selected model uses a native CLI runtime, that entrypoint can request API authentication instead of starting the configured CLI. Ordinary text messages use a dispatcher that selects the native runtime first. Voice requests fail before the configured agent starts.

#### Execution flow

Use the existing authenticated gateway agent command for realtime consultations so text and voice honor the same model runtime and fallback selection. Preserve the existing voice session, authenticated caller, cancellation, progress, and spoken result ownership.

```mermaid
flowchart LR
  V[Realtime voice request] --> A[Existing consultation authority and session]
  A --> D[Native gateway agent command]
  D --> N[Configured native CLI or embedded runtime]
  N --> R[Existing voice progress and result delivery]
```

#### Runtime selection

Honor the configured model and native authentication through the existing dispatcher. Do not add a direct provider client, copy credentials, or change the configured primary runtime. Model fallback follows the existing agent policy.

#### Session and lifecycle

Keep the current session and native bindings. Carry caller authority, tool policy, cancellation, and request ownership through the dispatch boundary. Return public progress and one final result through the existing voice bridge. A closed or superseded request cannot speak a late result. The active native CLI execution must promote its existing completion claim so a realtime provider can publish its delayed answer exactly once. Bind promotion to the current claim, lifecycle and exact operational run instance. Cancellation continues through the existing abort signal. A runtime without interactive steering returns the existing unsupported-steering error promptly, leaving the original consultation running.

#### Validation and delivery

Add a regression that reaches runtime selection with a native model and no API credential. Cover fallback, cancellation, and result ownership at the changed boundary. Exercise the installed candidate in DEV before production CI. CI retains deployment, backup, recovery, merge, and cleanup ownership.

### Status

**Approval:** Production approved.

**Approval reference:** Requester approved the proposed normal-agent routing repair on 2026-11-10: “Sounds good, let's make this repair. Keep current state as baseline ... work on rolling out a fix on top.”

**Scope and limits:** Repair realtime delegation on top of the current native CLI deployment. Preserve existing state and new work. Temporary realtime unavailability is acceptable. Do not restore a runtime from before native CLI adoption. Calendar filtering, email runtime bindings, and native call helper permissions are separate work.

**Progress:** The native gateway command and completion lifecycle changes passed retained review. Installed validation exposed a missing execution identity in the native lifecycle handoff. The corrected handoff passed 174 independent checks and core typechecking. The rebuilt installed regression passes, including the adopted answer claim and rejection after session closure. A later DEV run reached the real native consultation, but the first voice turn reset the warm CLI session because Talk omitted the session's stable reply-policy fact. The repair now derives that fact from the admitted session entry without changing per-turn delivery. Required hosted CI remains the validation gate for the updated candidate.

## Agent section

### State

Source remediation is reviewed on `codex/realtime-cli-consult-repair`. Preserve the current runtime baseline. The revised handoff keeps the exact admitted instance, defers completion promotion until actual CLI output and invalidates replaced requests immediately. Talk now supplies the canonical session-stable reply mode to native command preparation, so a warm text session can resume through voice without changing visible-reply behavior. The session-policy repair passed 178 affected checks, core typechecking and retained source review. A fresh build must prove installed warm-session reuse before the next DEV submission.

### Scope and acceptance criteria

Realtime consultations must honor the configured native runtime without requiring API credentials. Preserve session continuity, caller authority, tool policy, cancellation, progress, fallback and exactly one owned final result. Synthetic tests must not deliver messages or mutate external accounts.

### Architecture and decisions

Use the existing `agentCommandFromGatewayIngress` within the Talk consultation lifecycle. Its trusted options already carry authenticated owner status, tool restrictions, operator authority, cancellation, operational run identity and the hidden user turn recorder. It selects the configured native runtime and returns original yield metadata. Preserve exact session continuity and Talk completion ownership. Reuse run-scoped progress events and preserve session tool overrides in native execution. Promote the existing completion claim only after the CLI backend yields its first valid event under current ownership and abort fences. Both gateway commands and ordinary chat CLI turns notify that lifecycle, so a newer execution invalidates an older retained answer. Public command ingress strips the internal readiness callback. Do not fabricate an embedded execution handle. Settle registration as non-steerable so a steering request receives `TALK_STEERING_NOT_ADMITTED` without hanging or canceling the original answer.

### Implementation

Prepared source entrypoints are `src/gateway/talk/client-agent-consult.ts`, `src/agents/agent-command.ts`, and `src/agents/command/attempt-execution.ts`. Promote the complete source change into a maintained patch and register regressions in the cumulative patch suite. Preserve existing Talk progress, authority, overlap recovery and requester-result patches.

### Validation

The native revision passed 226 checks across six focused test files in 53.48 seconds and 19 public patch-manifest checks. The composed regression reaches the production runtime selector for both the configured model and an explicit model without a session runtime override. Embedded API execution is a failing double, and the CLI call must receive the session tool overrides. The continuity regression seeds a warm native session, then requires Talk to resume the same native identifier. Focused policy coverage verifies the session's persisted non-webchat reply mode. Those focused tests do not replace installed ownership validation. The installed regression must use a gateway-owned provider that adopts completion claims and invokes a recording native CLI. It must prove one claimable answer and cancellation, stale-owner and unsupported-steering behavior. DEV must exercise installed native CLI consultation, including tool use and session continuity. The accumulated application suite runs through production CI.

### Rollout and rollback

Refresh both mains and freeze the current production baseline. Use installed `build`, `ci-dev`, and `ci-prod`; record IDs and yield after dispatch. CI owns deployment, tests, recovery, merge and cleanup. Recovery captures the current native CLI deployment and state. A pre-adoption backup is not an allowed repair baseline.

### Review log

Independent review found the existing authenticated gateway command is a smaller suitable seam. The draft custom owner-authority handoff is unnecessary and will not be added. Remove draft reply-dispatch ownership/continuation hooks. Preserve native caller restrictions, session tool overrides, progress, cancellation and result ownership. The retained reviewer subsequently identified the native CLI completion-claim gap and withheld clearance. The completed correction passed retained review and 158 independent checks across six files. The earlier reviewed patch was `02d0ac85f47243d411c7d2c8fe3efb3dc5bf9d11fdb502eb7e6f4f1f3d5c4cc7`. The rebuilt installed test then failed the current-admission check at first CLI yield. The deferred lifecycle registers its diagnostic CLI owner without the already-bound operational instance, revoking the claim. Carry the existing identity through that native handoff while preserving cancellation ownership and deferring completion promotion until actual readiness. The corrected handoff passed retained review and 174 independent tests across seven suites. Its exact patch is `a9a1b0db6b02b2325854786318353b5ce400131351373e7a303f98a303cc9c20`. Core typechecking and exported patch application checks pass. The rebuilt installed regression passed with one test, zero skips and complete fixture cleanup.

### Checklist

- [x] Record production approval and current-baseline constraint.
- [x] Implement and register durable regressions.
- [x] Complete focused checks and independent review.
- [ ] Pass installed DEV consultation.
- [ ] Confirm production terminal receipt, source merge and cleanup.
