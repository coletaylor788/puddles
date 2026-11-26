# Native Skill Workshop access from sandboxed agents

OpenClaw now saves Workshop mutations immediately. It versions every change,
supports history and undo, and exports pending legacy proposal drafts during
Doctor repair without activating them. Puddles uses those native behaviors and
does not restore the retired proposal workflow.

OpenClaw 2026.11.5 no longer blocks the configured Workshop factory for sandboxed
runs. The previous factory change is removed from this patch. Native tool policy
now provides the existing access directly.

The remaining patch removes an obsolete diagnostic that still says a sandboxed
agent cannot receive the tool. It changes no construction, authorization or
mutation behavior. Agent and run scope, allow and deny policy, review guards,
version history, undo and current-authority checks remain native.

## Native ownership

The cumulative suite runs native regressions for immediate saves, version and
restore history, review undo, human personal-library authority and revocation,
agent-scoped Gateway methods, and Doctor export of pending or quarantined
legacy drafts. Applied legacy skills stay live and are not activated again.
The patch-owned regression checks that the diagnostic accepts the supported
sandboxed grant. Native tool tests cover access and immediate versioned changes.

## Validation and delivery

The patch tests and native Workshop regressions are registered in
`packages/e2e/openclaw-patch-suite.json`. The final candidate runs through
`node packages/e2e/bin/openclaw-test-env.mjs ci`. Tests use isolated fixture
state and never edit the live assistant's skill library.

The managed build composes this patch with the selected stack. Use the installed
`build`, `ci-dev` and `ci-prod` entrypoints. CI owns installed qualification,
deployment, recovery, merge and cleanup. Do not edit generated distribution chunks.
