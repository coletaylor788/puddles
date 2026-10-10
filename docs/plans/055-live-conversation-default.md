# Default to live conversation

Status: Implemented, reviewed, and DEV-validated; approved for landing and rollout
Issue: [#256](https://github.com/coletaylor788/puddles/issues/256)
Last updated: 2026-10-09

## Human section

### Design

Voice delegates too readily. The previous instructions included careful reasoning
as a reason to consult the agent harness. Make live conversation the default and
delegate only when the response needs information or an action outside it.

Use this concise instruction:

> Converse live by default. Reason, explain, brainstorm, and iterate using the
> conversation and available results. Consult the harness only to retrieve
> missing memory or context, look up or verify information using the internet or
> other tools, or take an external action. Reasoning alone does not require a
> consultation. Reuse available results; consult again only when a new lookup
> or action is needed. Never invent retrieved facts or claim an action succeeded
> without a result.

Apply the same boundary to the provider prompt, consultation tool description,
and active session instructions. Remove broad triggers such as substantive
requests or careful reasoning from the default path. If essential information
must come from the user, ask a brief clarification live. Missing information
already supplied in the conversation does not need to be retrieved again.

Keep the existing permissions, action approvals, progress, interruption, and
result-delivery behavior. An explicit operator setting that forces consultation
must not silently override the intended default: inspect the effective settings
and include any necessary adjustment in the existing configuration lifecycle.

### Status

**Approval:** Production approved. **Approval reference:** The requester replied
"Approved to implement" to this exact proposal on 2026-10-09 and then
"Approved and ship it" after the publication approval request. Scope includes
publication, validation, landing, rollout, rollback, and task cleanup.

The implementation passes 116 focused runtime tests, ten patch-manifest checks,
both TypeScript checks, independent review, and installed DEV validation.
Publication and shipping are explicitly approved. Required repository checks,
source merge, and the cumulative release pipeline are next. Production remains
unchanged.

## Agent section

### State

- Task worktree: `voice-conversation-default`, based on freshly fetched main.
- Related shipped behavior: [plan 050](050-talk-conversation-progress.md).
- `talk-conversation-progress.patch` updates the provider prompt, shared tool
  description, and automatic/substantive session instructions. Proxy mode keeps
  broad delegation wording only under its existing always-consult policy.
- The effective native voice route has no forced-consult setting or conflicting
  operator prompt. No configuration change is required. Existing host-controlled
  adapters retain their separate policy selection and explicit always behavior.

### Scope and acceptance criteria

- Conversation-only reasoning, explanation, brainstorming, and iterative
  follow-ups need no consultation, including while unrelated work is pending.
- Missing stored memory, fresh web/tool information, and external actions use
  the existing consultation path.
- Returned facts support subsequent discussion without repeated retrieval.
- New information requirements or changed actions may trigger a new request;
  progress and result receipts must not repeat accepted work.

### Architecture and decisions

Change prompt policy through existing builders and maintained source patches.
No new router, model, service, polling, or authorization mechanism. Inspect the
effective provider/session policy before deciding whether configuration changes
are necessary. Do not change explicit always-mode semantics for other users.

### Implementation

The provider instructions now reserve delegation for missing information and
external actions. The shared tool description no longer lists reasoning. Auto
and substantive session instructions support direct conversation and result
reuse. Existing always-mode instructions and task-control checks are preserved.
The shared suite adds `src/talk/agent-consult-tool.test.ts` under `unit-src`.

### Validation

Check final composed provider payloads so later instruction layers cannot
reintroduce broad delegation. Exercise conversation-only turns, missing-memory
retrieval, fresh web lookup, actions, and follow-up reuse with recording fixtures.
Scripted tests prove wiring and policy composition, not actual model judgment.
Real voice acceptance must confirm that discussion and iteration stay live.
Run focused tests, installed DEV checks, retained independent review, and the
accumulated `node packages/e2e/bin/openclaw-test-env.mjs ci` release gate.

Focused execution: `node scripts/run-vitest.mjs run` on the shared consult-tool
test and five provider tests (progress, gateway-direct, gateway-bridge,
session-lifecycle, and provider-routing) passes 116 tests in 29.40 seconds.
`pnpm --filter e2e exec vitest run tests/patch-suite.test.ts` passes ten tests.
All 28 public and six companion patches apply to the pinned base and produce
the exact tested source tree. Core and extension TypeScript checks pass.

The maintained DEV controller passes four installed integration scenarios. A
network-disabled probe against that exact installed runtime verifies compiled
session instructions, the tool description, the provider browser request,
explicit always mode, and disabled-tool policy. It invokes no consultation or
external action. The DEV lease was released after the controller joined and
retired its local payload. Cumulative release and real voice acceptance remain.

### Rollout and rollback

Follow the existing one-artifact DEV, TEST, and PROD promotion after approval.
Restore the prior runtime and any changed configuration together on failure.
Verify final installed prompts separately from physical conversational quality.

### Review log

The retained independent reviewer found no material defects or security
architecture deviations in the complete diff. Physical model behavior remains
distinct from prompt assertions and needs a real voice acceptance check.

### Checklist

- [x] Identify source wording and write the concise proposed replacement.
- [x] Approve the implementation design.
- [x] Align active prompts and configuration; add and run focused regressions.
- [x] Complete independent source review.
- [x] Validate the installed DEV runtime and release its slot.
- [x] Obtain explicit publication permission.
- [ ] Land the reviewed change after required repository checks.
- [ ] Complete cumulative release and real voice acceptance.
