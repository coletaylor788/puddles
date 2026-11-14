# Native Skill Workshop access from sandboxed agents

OpenClaw now saves Workshop mutations immediately. It versions every change,
supports history and undo, and exports pending legacy proposal drafts during
Doctor repair without activating them. Puddles uses those native behaviors and
does not restore the retired proposal workflow.

OpenClaw's configured Workshop factory still hides `skill_workshop` from an
ordinary sandboxed run unless the run carries a human personal-library
capability. Existing Puddles installations also grant the configured Workshop
tool to approved iMessage, background, and delegated sandbox agents. Those
paths cannot mint the human Gateway capability, so removing the old patch
would silently remove their existing access.

The reduced patch removes only that sandbox construction gate and its matching
unavailable-tool diagnostics. It keeps the configured factory, agent and run
scope, normal allow and deny policy, review guard, native immediate mutation,
version history, undo, and current-authority checks. Sandboxed agents still
need `skill_workshop` in their effective tool policy.

## Native ownership

The cumulative suite runs native regressions for immediate saves, version and
restore history, review undo, human personal-library authority and revocation,
agent-scoped Gateway methods, and Doctor export of pending or quarantined
legacy drafts. Applied legacy skills stay live and are not activated again.
The patch-owned regression proves that a configured sandbox agent receives the
native Workshop tool and records an immediate versioned change.

## Validation and delivery

The patch tests and native Workshop regressions are registered in
`packages/e2e/openclaw-patch-suite.json`. The final candidate runs through
`node packages/e2e/bin/openclaw-test-env.mjs ci`. Tests use isolated fixture
state and never edit the live assistant's skill library.

The managed build composes this patch with the selected stack. Use the installed
`build`, `ci-dev` and `ci-prod` entrypoints. CI owns installed qualification,
deployment, recovery, merge and cleanup. Do not edit generated distribution chunks.
