# Fix cron email reader failures

**Status:** Landed and production-validated
**Issue:** [#43](https://github.com/coletaylor788/puddles/issues/43)
**Last updated:** 2026-07-30

## Human design

### Problem

Interactive main-agent runs explicitly target the `reader` profile and can read
email. Three consecutive scheduled triage runs instead omitted
`sessions_spawn.agentId`, supplied `taskName="email_reader"`, and silently
spawned a same-profile `main` child. The cron run's restricted tool policy then
correctly propagated to that child, leaving it without Gmail read tools. Existing
tests covered cross-agent policy isolation and the optional explicit-target
configuration separately, but not this scheduled omission path.

### Outcome

Scheduled delegation must name its target profile instead of silently falling
back to the scheduler's profile. A missing target fails immediately with a
repairable error, explicit `reader` delegation retains the reader's Gmail tools,
and the shared managed pool proves both paths with synthetic state.

### Approach

Patch OpenClaw so native cron `sessions_spawn` calls require an explicit
`agentId` by default, and ACP cron calls do so only when their configured default
resolves to the requester profile. Retain explicit configuration overrides and
distinct ACP harness defaults. Clarify the model-facing schema so `taskName`
cannot be mistaken for profile selection. Cover ambiguous scheduled spawns,
overrides, explicit scheduled `reader` delegation, and explicit scheduled
coordinator self-spawn. Preserve same-agent tool restrictions when global ACP
scope identifies the requester through an explicit override. Normalize the live
coordinator policy before promotion by enabling explicit targeting before adding
`main` as an allowed target, so interrupted updates fail closed. Include
generated prompt snapshots and upstream documentation for the conditional
defaults.

### Safety and rollout

Keep the existing cron job and its least-privilege `toolsAllow` unchanged. Tests
use synthetic session state and mocked gateway calls; they never access Gmail,
send messages, or mutate accounts. Promote only through the maintained OpenClaw
patch lifecycle. Coordinator policy updates apply the restrictive flag before
the expanded allowlist. Validate the installed guard and reader access with
read-only checks, and rebuild without the patch to roll back.

## Agent details

### State

The fix is landed on `main` in merge commit `ceff0eb`. Public feature head
`5b771f9` and its host-combined promotion were independently reviewed and
validated before landing. Production runs OpenClaw `2026.7.1-2` at pinned source
`0790d9f` with all six maintained patches installed. Deployment
`8491ddf6-668b-487d-8623-7c7dff0a0e31` is healthy, its marker and rollback
snapshot verify, and post-landing read-only validation passes. Cron definitions
remain unchanged.

### Scope and acceptance criteria

- [x] Identify why scheduled runs fail while equivalent interactive runs succeed.
- [x] Fail closed for native cron delegation that omits `agentId`, without
  changing cron configuration.
- [x] Preserve distinct ACP defaults and an explicit compatibility override.
- [x] Keep same-agent restrictions while native cross-agent children use the
  target profile's tool policy.
- [x] Preserve ACP requester command-policy boundaries for every resolved target.
- [x] Prove explicit scheduled `main -> reader` delegation retains Gmail read
  tools.
- [x] Map focused source regressions into the cumulative managed pool.
- [x] Keep tests and production probes isolated from delivery and mailbox
  mutation.
- [x] Complete independent review, exact promotion, landing, and post-landing
  validation.

### Architecture and decisions

- `taskName` is a stable handle only; it never selects an agent profile.
- Native cron callers default to `requireAgentId=true` when no explicit setting
  exists. `subagents.requireAgentId=false` remains the compatibility escape
  hatch.
- ACP cron callers require an explicit target only when `acp.defaultAgent`
  resolves to the requester profile. A distinct configured ACP default remains
  valid.
- Same-agent children inherit requester allow/deny policy. Native cross-agent
  children omit that inherited policy and resolve tools from the target profile.
- ACP compatibility checks run after target resolution and enforce the
  requester's required host command access for every ACP target. Compatible
  cross-agent ACP calls omit inherited session policy, but restricted requesters
  cannot escalate through an external harness.
- Global ACP scope compares the target with the resolved requester override.
- Coordinator promotion sets `requireAgentId=true` before expanding
  `allowAgents`, and mutates only those leaves.
- The managed lifecycle applies the complete maintained patch stack before
  checking generated prompt snapshots and running mapped source tests.

### Implementation

- Extended `subagent-cross-agent-spawn-fix.patch` with native and ACP cron target
  guards, same-agent/cross-agent inheritance boundaries, ACP command-policy
  enforcement, model-facing schema text, upstream documentation, generated
  prompt snapshots, and source regressions.
- Added setup-contract coverage for explicit reader targeting, coordinator
  self-spawn, inherited-default handling, and fail-closed policy update order.
- Added the changed OpenClaw suites to the cumulative patch manifest.
- Synchronized the integration workflow and cumulative manifest to source
  `0790d9f` and Node `22.23.1`, with per-major embedded-SQLite safety floors.
- Preserved the established atomic deployment, rollback, readiness, and
  production-probe lifecycle.

### Validation

- Complete managed lifecycle:
  - repository build and lint;
  - 288 repository tests: 112 `mcp-hooks`, 72 `e2e`, 61 secure calendar, and
    43 secure Gmail;
  - seven current generated prompt snapshots;
  - 470 mapped patched-source tests;
  - candidate browser entrypoint test;
  - managed worktree cleanup.
- Hosted validation on exact public head `5b771f9` over base `6dc4e03`:
  cumulative Integration and all CodeQL analyses passed.
- Independent adversarial review:
  - corrected native and ACP target semantics, snapshot completeness, deployment
    safety, Node/SQLite compatibility, global requester handling, and publication
    wording;
  - caught and remediated an ACP cross-agent command-policy escalation;
  - mutation-checked same-agent and cross-agent inverse-gate coverage;
  - final exact-tuple review found no actionable code, security, test, rollback,
    or publication defect.
- Production and post-landing validation:
  - deployment marker SHA-256
    `c48b5745394a3bc697b3b9bc5c8d5e29bcd0746acdcd295ae8f6cda9234789c8`;
  - rollback snapshot
    `~/.openclaw/deploy-snapshots/20260730T084333Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`;
  - marker lists all six maintained patches plus required host-local components;
  - snapshot checksums pass and deployment locks are absent;
  - gateway is running and connected;
  - explicit-target policy, reader finite allowlists, native and ACP guards, and
    installed patch symbols pass;
  - direct no-delivery trace made one fixed no-match `list_emails` call and
    returned `READ_OK`;
  - cron-shaped synthetic trace denied implicit spawn, accepted explicit
    `reader`, made one fixed no-match `list_emails` call, and returned
    `CRON_READER_OK`;
  - no cron invocation or definition change, message delivery, mailbox content
    exposure, or account mutation occurred.

### Rollout and rollback

Production was promoted atomically through the reviewed host-combined lifecycle.
The lifecycle serializes source and deployment work, verifies exact public patch
bytes, snapshots runtime/configuration/service state, probes readiness, and rolls
back automatically on failure. The durable snapshot above is the rollback source
for this deployment.

### Review log

- Todoist's first signed comment points to issue #43, and the issue remained a
  concise plan-linked status ledger.
- Transcript research proved failing scheduled runs omitted `agentId` and spawned
  `agent:main:subagent:*`; successful interactive and scheduled runs explicitly
  targeted `reader`.
- Review findings were accepted and remediated iteratively, including stale
  snapshots, incomplete ACP parity, unsafe policy mutation order, release-pin
  drift, Node/SQLite compatibility, global ACP requester handling, ineffective
  regressions, and ACP cross-agent command-policy escalation.
- Public PR #48 landed exact feature head `5b771f9` as merge `ceff0eb`.
- The reviewed host-combined promoter landed, exact deployment succeeded, and
  post-landing production validation remained green.

### Risks and residuals

- The cron-safe default recognizes the immediate cron requester key; descendants
  rely on the promoted explicit `requireAgentId=true` coordinator policy.
- Configured `requireAgentId=true` also applies to top-level ACP callers. This is
  documented and intentionally fails closed.
- Production probes use fixed no-match Gmail queries so they prove the reader
  boundary without exposing mailbox content.

### Checklist

- [x] Verify tracking comment and issue ledger structure.
- [x] Create and maintain the synchronized repository plan.
- [x] Research and reproduce the execution-context difference.
- [x] Implement native and ACP guards with cross-agent policy isolation.
- [x] Add focused regressions to the cumulative pool.
- [x] Pass local and hosted cumulative validation.
- [x] Complete adversarial review and all remediation.
- [x] Promote the exact reviewed candidate and validate production read-only.
- [x] Land the public and host-combined changes.
- [x] Complete post-landing production validation.
- [x] Set the issue and Todoist task to review-ready without completing the task.
