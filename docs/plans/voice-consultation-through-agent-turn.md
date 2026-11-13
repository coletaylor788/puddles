# Latest stable and native CLI voice controls

Status: Production approved in two independent phases; upgrade in progress
Issue: https://github.com/coletaylor788/puddles/issues/359
Last updated: 2026-11-13

## Human section

### Design

Upgrade to **OpenClaw v2026.11.3, the latest stable release**, and safely finish that production release first. Then make and independently release the remaining integration repair between realtime Talk, native agent coordination and the configured CLI runtime. Preserve native CLI authentication, concurrent conversation, same-run steering and proactive research results.

```mermaid
flowchart LR
  U[Phase 1: upgrade and preserve existing behavior] --> G[Review, DEV, full suite, TEST, PROD]
  G --> C[Merge and terminal cleanup]
  C --> P[Phase 2: native CLI voice repair]
  P --> R[Independent review and complete release process]
```

```mermaid
flowchart LR
  T[Realtime Talk] --> O[Native agent execution and controls]
  C[Chat and agent coordination] --> O
  O --> CLI[Existing configured CLI backend]
  CLI -->|Receipts and results| O
  O -->|Existing result attachment| T
```

#### Phase 1: upgrade and preserve existing behavior

Qualify the entire maintained application, including integrations, permissions, sessions, memory, tools, provider routing and state migration. Port existing patches only as needed to preserve their behavior. Remove a patch only when the replacement and its regression coverage are proved. The new voice repair is excluded from this candidate.

This phase has its own focused checks, independent review, build, DEV, full application suite, TEST, production acceptance, merge and cleanup. An upstream unit-test pass alone does not qualify the upgrade.

The upgrade provides

- Native Claude CLI text steering into the running process, with current-authority checks and consumption receipts before recording acceptance.
- Existing transcript/cancellation handling and explicit uncertain-delivery outcomes, without blindly replaying accepted input.
- Stable's fixes for keeping private child completions out of streamed replies and allowing replacement work after a cancelled child's handoff.

Stable does not include main's unified session controller or the injected child-result context fix. Those must not be counted as upgrade benefits.

One upgrade behavior needs a separate decision. Stable removes Workshop's staged
skill proposals and uses immediate, versioned skill changes with native undo.
The previous tool already allowed an authorized caller to apply its proposal,
but creation itself stayed pending. The proposed adjustment is to adopt native
Workshop behavior, preserve the existing tool and agent access limits, and use
native Doctor to export pending drafts. It does not recreate a proposal queue.
This adjustment remains proposed; the affected compatibility port is paused.

#### Phase 2: repair native CLI voice coordination

Begin implementation only after Phase 1 has passed production and completed source merge and terminal cleanup. Start from that landed upgraded baseline, with a separate candidate and the full development and release process. The patch will:

1. Route Talk through the agent's configured runtime while retaining its admitted caller, session and asynchronous result ownership.
2. Connect Talk steering, coordinator guidance and child completion to the **same native CLI execution and guarded control capability**. Reconcile embedded-only ownership checks with that actual run. Keep one result claim and native continuation after yield.
3. Preserve each injected input's full context and provenance, so Reader's result reaches a busy parent as a child completion rather than an empty wake-up or new human request.

Reuse native transport, tools, sessions and delivery. Do not retain the first repair's CLI-ready flags or steering refusal, substitute cancellation/restart for steering, or add another message queue. Retire existing patches only after replacement proof.

#### Qualification

**69 existing checks passed on unmodified latest stable in 99.67 seconds.** They cover the real CLI stdio adapter with fixture processes, text injection, authority checks, consumption receipts, cancellation, Talk controls and delayed-result ownership.

The complete repair still must prove one continuous scenario: delegate research, keep talking, steer the same task, let Reader finish while the parent is busy or has yielded, and receive the corrected result proactively. Require actual native CLI execution, exact permissions, no duplicate work and one final delivery through browser and the maintained FaceTime path.

### Status

**Approval:** Production approved for both phases, in order. Phase 1 upgrades and preserves existing behavior. Phase 2 implements the native CLI voice repair only after Phase 1 completes its independent production lifecycle. Approval covers implementation, commits, pushes, review, CI deployment, merge and cleanup within this scope.

**Approval reference:** “One change. Make it have two phases, that follow dev process independently. I.e we upgrade first, safely roll to prod, then we make the patch and safely roll to prod. Upgrade is holistically ensuring existing tests and behavior doesn’t break. Then approved to ship, push, and implement” (2026-11-13).

**Progress:** Phase 1 is in progress. Both source branches were refreshed onto main while preserving research. Stable component checks and public plugin compilation/unit tests passed. Maintained patch ports and complete application qualification remain open. Testing found a mismatch between the migration preview and native configuration writer; exact preview/persisted equality remains a release gate. Workshop proposal retirement needs review before its port can proceed. Other compatibility work continues. Phase 2 implementation has not started. The held first repair remains excluded.

## Agent section

### State

Selected target: `v2026.11.3`, commit `847611dcaa3bf0e2783335f961dd1fd0580e4d9f`, published 2026-11-10. Release/tag APIs were reconfirmed on 2026-11-13. Earlier runtime source pin: `eb377ac59e6c9fd6c7705028034812becf00271b`.

Main `466a4b6f5073b5fe83b6a0b479a6dfc8392c82e4` is comparison evidence only. The previous proposal's main-based unified-controller and ambient `withSessionTurn` assumptions do not describe stable and are superseded here.

The initial stable qualification ran on an unmodified checkout with Node 26.1.0 and pnpm 12.15.0. The isolated checkout now holds ordered compatibility ports of the existing patch stack. Tests use isolated fixture state, without external messages or production changes.

### Scope and acceptance criteria

Phase 2 maintained patch: **`native-cli-voice-coordination.patch`**. Its three reviewed contracts are configured execution/ownership, shared guarded control/completion, and injected input context. No full session-controller backport, new harness, custom delivery watcher, replay queue or API-auth replacement is in scope.

Cover ordinary chat, direct CLI agent/child turns, provider-owned Talk and parent continuation. Preserve exact physical session, run, source and authority identity, plus existing non-CLI behavior. The maintained Puddles patch bundle and runtime/state upgrade still need qualification against the new version.

### Architecture and decisions

| Contract | Stable evidence | Required integration |
|---|---|---|
| Native CLI steering | Anthropic `registerMessageInjection` and host `createSteeredCliMessageInjection` provide guarded V2 with consumption receipts. `attachCliReplyBackend` requires a reply operation. | Reuse that capability and authority checks. |
| Runtime/owner selection | Talk calls embedded execution. Direct command ingress prepares its own admission and does not automatically create a `ReplyOperation`. Stable lacks main's CLI turn-admission wrapper. | Share ordinary configured execution under the correct native owner, preserving Talk admission. A command-entry substitution alone is insufficient. |
| Cross-caller controls | Talk, `sessions_send` and busy-parent announce select the embedded-run registry; its CLI diagnostic handle lacks V2. Native reply-target injection already supports CLI V2 and captured backend identity. | Connect these callers to the genuine capability with exact owner binding. Preserve mismatch refusal and accepted-unconfirmed custody. |
| Talk ownership | Provider-owned Talk requires embedded completion registration/authority before steering and consumes a one-time claim before append. | Reconcile existing checks with the real execution owner; preserve requester-final transfer after yield. No readiness boolean or first-output authority. |
| Child-result context | Stable injection takes text/currentness callback but no per-input context/provenance; injected prompt hooks suppress private initial context. | Port the relevant per-input contract from upstream #185945. Do not inherit the running input's context or mislabel the child as human. |

Two native bridge locations remain to compare in implementation qualification: use the existing captured ReplyOperation target, or expose the same genuine CLI V2 capability through the existing native active-run handle. Both must retain real authority, exact admitted instance and cleanup ownership. Do not create a second sink or competing owner.

Stable reply-turn kinds (`visible`, `heartbeat`, `queued_followup`) affect scheduling, stale recovery and continuation. Do not select one mechanically just to obtain a registry entry. A broader lifecycle/state redesign requires revised review. This bounded ownership mapping remains unproven; source inspection alone cannot establish the smallest sound bridge.

Relevant upstream evidence:

- [Stable release](https://github.com/openclaw/openclaw/releases/tag/v2026.11.3) and [release notes](https://github.com/openclaw/openclaw/blob/847611dcaa3bf0e2783335f961dd1fd0580e4d9f/CHANGELOG/2026.11.3.md): private completion streaming #188490 and cancelled-child handoff #178893 are shipped. Their specific regressions were not separately run in this focused qualification.
- [Native CLI steering #159816](https://github.com/openclaw/openclaw/pull/159816): represented in stable source and release history; local fixture-level checks below passed on the selected tag.
- [Input context #185945](https://github.com/openclaw/openclaw/pull/185945): relevant main repair absent from stable. Port its narrow context/provenance contract, not the entire main runtime.
- [Coordinator steering #178865](https://github.com/openclaw/openclaw/pull/178865): main uses operation authority when CLI placeholder authority is absent. Design evidence, not a shipped stable capability claim.
- [Talk routing #164229](https://github.com/openclaw/openclaw/pull/164229) and [phone routing #191683](https://github.com/openclaw/openclaw/pull/191683): useful routing, terminal and permission cases. Neither proves this full scope. Do not adopt cancel-and-replace as in-place steering or guest phone ingress as owner authority.
- [Owner steering #189418](https://github.com/openclaw/openclaw/pull/189418): check projection under the selected stable admission. Do not automatically add a main-specific patch or relax permissions.

### Implementation

#### Phase 1

Workshop compatibility is blocked on a design decision. Old `create`/`update`
stage a draft, with a separate native `apply` action. Stable
`src/agents/tools/skill-workshop-tool.ts` calls native library mutations directly;
`legacy-config-migrations.runtime.skills.ts` removes `approvalPolicy` and
`maxPending`. Existing pending-draft export and migration need fixture proof.
Do not mechanically remove the new sandbox gate or restore a custom proposal
subsystem. Proposed native adoption must be approved before this affected port
or configuration migration changes the deployed contract.

Upgrade compatibility includes the integrity-bound pnpm 12.15.0 toolchain and native schema migration from shared state 18 / agent 23 to shared state 22 / agent 27. The existing-state regression seeds the exact predecessor schemas with synthetic sessions, committed WAL history, memory, disabled cron and execution denial settings. It runs the candidate's native migration and verifies reopened data; fresh state does not substitute for this proof.

1. Fetch both feature repositories and rebase preserved work before submission. Pin stable and review every maintained public and private patch. Port only existing behavior; retire only proved redundant hunks with durable replacement coverage.
2. Update the package graph, build tooling, test registration and runtime configuration compatibility as required by the stable upgrade. Preserve current provider routing and security boundaries.
3. Run focused compatibility checks and retain independent review of the complete upgrade diff. Build one reusable candidate and submit it through `ci-dev`, then `ci-prod` with its full application suite and installed acceptance.
4. Require the terminal production receipt, exact source merge and all source/transfer/cleanup closure before starting Phase 2. Record physical acceptance separately from automated readiness.

#### Phase 2

1. Start a fresh feature branch from the landed Phase 1 baseline. Reconfirm the three approved contracts against that exact runtime.
2. Resolve and test the native ownership bridge, then implement the three scoped contracts. Use native registry/admission operations with one execution and delivery owner.
3. Exercise real provider-owned `runPrompt.steer` and adopted `claimAppend`. Do not bypass wrapper checks or let fixtures grant completion unconditionally.
4. Check actual allowed tools and denied execution, including caller caps, logical provider rules, source revocation and CLI-native controls. Retain the independent reviewer through remediation.
5. Independently build, qualify DEV, run the full release gate, qualify TEST and PROD, merge and close cleanup. Phase 1 evidence is baseline evidence, not release clearance for changed inputs.

### Validation

Phase 1 local compatibility: all eight public plugins compile against the pinned `openclaw@2026.11.3` SDK. Their existing suites pass 364 tests with no skips. The public lockfile was regenerated and installed using pnpm 12.15.0 and the shared store. The first dependency-order check required building `mcp-hooks`; compilation then passed. These checks do not replace the complete application or installed candidate gates.

Focused compatibility ports now have additional evidence. The iMessage coalescer passes 41 cases, independently rerun by the retained reviewer. The browser entrypoint fixture passes against the ported source. The corrected native delegation suite passes 43 cases in 35.05 seconds. Heartbeat prompt and terminal resolution pass 65 cases in 16.05 seconds; the two Copilot inbound-context cases pass in 27.28 seconds. These focused source checks do not prove the final composed runtime, prompt generation, installed startup, or production readiness.

The retained reviewer cleared the wiki metadata port and verified correction of delegation fixtures that still used the retired roster shape and test configuration owner. State-migration SDK qualification remains in progress: native worker compilation exposed a removed roster helper, now replaced by the stable Doctor migration owner. The port retains and expands the roster regression. A frozen source run passed 42 tests across SQL, cron, worker and Doctor checks, but the markerless roster case failed. The preview lost the original legacy owner while the native writer retained it and materialized ownership. This is a real release-gate mismatch, not a reason to weaken the assertion. The correction carries native owner provenance through the preview; exact equality, explicit owners, workspace, fixed-store and include cases remain under qualification.

Completed on unmodified `847611dcaa3bf0e2783335f961dd1fd0580e4d9f`:

| Existing test file | Result | Duration |
|---|---|---|
| `src/talk/agent-run-control.test.ts` | 15 passed | 29.94 s |
| `src/gateway/test/talk-client-agent-consult.requester-final.test.ts` | 2 passed | 14.27 s |
| `src/agents/cli-runner/execute-plugin.steering.test.ts` | 1 passed, covering configured/session/explicit input routes | 18.31 s |
| `extensions/anthropic/cli-runtime.test.ts` | 51 passed | 28.71 s |

Command: `pnpm test` with those four explicit files and `--maxWorkers=1`. Exit 0; four shards passed in 99.67 seconds. Fixture processes exercise the real stdio adapter, not authenticated Claude. Talk delayed-result tests use an embedded fixture. Neither proves the repaired composed path. No full application build, cumulative suite, installed DEV/TEST or physical audio check was performed.

Phase 1 acceptance requires every existing application suite and maintained public/private patch regression, compatible plugin packaging and startup, preserved sessions/state, tool access and denials, provider authentication/routing, messaging, memory, browser, calendar and maintained voice paths. Any removed regression needs evidence that its behavior is covered by the new runtime and cumulative runner. Existing voice limitations may remain; regressions may not be hidden by the pending repair.

Phase 2 candidate proofs:

- Chat, voice and coordinator corrections reach the intended active CLI run/process; unavailable or incompatible input is not lost or replayed after acceptance.
- Reader's opaque result and provenance reach a busy or resumed parent without history polling; the final reaches Talk proactively once.
- Actual Talk readiness, authority, claim and continuation attachment survive startup, fallback, cancellation, stale-source and hangup races.
- Installed native CLI login, warm continuity, allowed synthetic operations and denied/revoked operations pass without exporting credentials or delivering real test messages.
- Browser and maintained FaceTime qualify against the same candidate, with physical audible delivery separately confirmed.
- Full maintained-patch compatibility, application suite and runtime/state migration pass through CI before production.

### Rollout and rollback

Each phase independently uses the normal development process and immutable candidate. Phase 2 cannot enter implementation before Phase 1 terminal production, merge and cleanup closure. Upgrade latest stable, not moving main. Preserve the working CLI baseline. Use `build`, `ci-dev`, and `ci-prod`; CI owns installed tests, full suite, deployment, merge, recovery and cleanup. Yield after dispatch and resume from terminal receipts. Recovery uses the captured current baseline, never the superseded pre-CLI harness. Preserve active candidates and recovery references until closure.

### Review log

The retained reviewer independently checked the full stable checkout. It confirmed native CLI V2 exists but direct command/Talk execution does not automatically own a ReplyOperation; Talk, coordinator and announce callers still select the embedded registry. The proposal separates three remaining contracts and removes the assumption that main's unified controller ships in stable. Architecture review and component tests do not constitute full repair or release clearance.

### Checklist

- [x] Pin and inspect latest stable separately from main.
- [x] Run focused unmodified native CLI, Talk-control and delayed-result tests.
- [x] Separate shipped fixes from the proposed patch's three contracts.
- [x] Record approval for two independently gated production phases.
- [ ] Phase 1: preserve all existing behavior and complete independent upgrade review and qualification.
- [ ] Phase 1: close production, source merge and cleanup before Phase 2 starts.
- [ ] Phase 2: resolve the ownership bridge and qualify the complete voice/CLI/Reader scenario.
- [ ] Phase 2: complete its own CI-owned release, cleanup and physical acceptance.
