---
name: safe-feature-development
description: "Implement features safely from research through test-environment integration, full-diff architecture audit, configured promotion, production integration validation, and automatic rollback. Use whenever an agent is asked to implement a feature or behavior change."
compatibility: "Requires the target repository's existing build, test, deployment, and rollback tools. Uses repository-provided test and production lifecycles when available."
metadata:
  author: Cole Taylor
  version: "1.2.0"
---

# Safe Feature Development

Track feature development in an issue. Keep it current as the living source of
truth, with a brief human-readable summary first and the detailed agent status,
decisions, validation, rollout, rollback, and review log after it.

Use this workflow for feature implementation, behavior changes, migrations,
runtime configuration, plugins, integrations, and deployment automation. Follow
more specific repository instructions as additional constraints. Never weaken a
global safety or publication boundary.

## Required loop

1. **Research**
   - Read repository instructions, current plans, component documentation, and
     the affected runtime topology before editing.
   - Trace existing behavior, trust boundaries, helpers, tests, deployment
     surfaces, and rollback mechanisms. Reuse existing patterns.
   - Identify production state, credentials, delivery channels, external
     mutation surfaces, ports, processes, and artifacts that must stay isolated.

2. **Plan**
   - For significant work, create the repository's expected plan artifact with
     design, APIs, safety model, implementation order, validation, rollout,
     rollback, and a live checklist.
   - Resolve material design ambiguity before implementation. Do not stop after
     planning when implementation has already been requested and the design is
     approved.

3. **Implement locally and deploy to the test environment**
   - Implement and iterate locally using the repository's established
     development workflow, then deploy the candidate through the configured test
     environment lifecycle.
   - Use mocks or fakes for local testing and iteration when exercising a live
     dependency is unnecessary.
   - Route external writes and delivery in tests through deny-by-default mocks
     or recording adapters. Unknown mutations must return explicit errors, and
     automated tests must not deliver real messages.
   - Add or update tests and directly relevant documentation with the code.

4. **Validate and iterate**
   - Run applicable formatter, lint, type check, unit test, and build gates, then
     run the configured integration test suite against the deployed test
     environment.
   - Exercise success, denial, malformed input, interruption, cleanup,
     concurrency, promotion, and rollback paths that the change affects.
   - Verify the exact requested outcome, not a proxy. A skipped suite, missing
     model or dependency, leaked process, occupied port, or success-shaped
     fallback is not green.
   - Add integration coverage for the feature to the repository's main
     integration test pool. Do not rely on ad hoc tests that are absent from the
     full configured run.
   - Fix failures locally, redeploy to the test environment, and repeat until
     all required pre-promotion gates are green.

5. **Audit the full change**
   - Review the entire diff and all new files, not only the latest fix.
   - Check architecture, security, isolation, data flow, state ownership,
     failure atomicity, process lifecycle, path and symlink handling,
     concurrency, backward compatibility, and rollback.
   - Look specifically for whack-a-mole fixes: a local correction that moves the
     same risk to another agent, plugin, command, profile, or failure boundary.
   - Launch a fresh independent reviewer that did not implement the change.
     Instruct it to invoke the repository-local `adversarial-review` skill and
     review the complete feature diff.
   - Resolve every actionable, high-confidence finding by returning to local
     implementation, correcting it, redeploying to the test environment, and
     rerunning applicable local gates plus the full configured integration test
     pool. Then launch another fresh adversarial reviewer and repeat the full
     audit until no actionable, high-confidence findings remain unresolved.
   - If the diff changes after a clear review for any reason, run the relevant
     validation again, redeploy and rerun the full configured integration pool
     when the change can affect it, and obtain a fresh adversarial review.

6. **Promote through the configured lifecycle**
   - If the repository provides an approved automatic test-to-production
     lifecycle and deployment is in scope, use that lifecycle after all
     pre-promotion gates pass. Do not manually copy artifacts or add an
     additional approval gate unless a controlling instruction explicitly
     requires one.
   - Promotion must durably record recovery state before destructive work and
     use atomic replacement where supported.
   - If the task explicitly forbids production impact, do not promote. Validate
     promotion, interruption recovery, and rollback against test fixtures.
   - If no configured safe promotion lifecycle exists, do not invent production
     access. Finish test-environment validation and report that deployment was
     not run.

7. **Validate production and roll back on failure**
   - After promotion, run the configured production integration, health, and
     smoke checks. Automated production tests must be read-only and must use
     explicit production state and configuration paths.
   - On any post-promotion failure, revert production to the recorded snapshot,
     reload production, revalidate production health, return a nonzero result,
     and restart the workflow from local implementation and test-environment
     deployment.
   - Preserve the original failure. Surface rollback or cleanup failures as
     additional errors rather than hiding them.

## Completion gate

Feature work is complete only when:

- the requested behavior is implemented and documented;
- all applicable local and test-environment gates are green;
- the full-diff audit and fresh adversarial review are clean;
- managed processes and temporary state are cleaned up;
- configured promotion and read-only production validation succeeded, or
  production was explicitly out of scope and promotion and rollback were proven
  in fixtures, or no configured promotion lifecycle exists and that limitation
  was reported;
- any task tracker handoff accurately states validation and residual risks; and
- commit or push occurs only when the controlling instructions request it.

## Puddles lifecycle

When `packages/e2e/bin/openclaw-test-env.mjs` exists on the active branch, use
its `ci` command as the configured managed lifecycle. Follow the safety model and
commands in `packages/e2e/README.md`.

For OpenClaw source patch deployment, follow
`docs/openclaw-setup/patches/README.md` and use
`docs/openclaw-setup/patches/apply-and-deploy.sh`. An unset `MINI_HOST` means
local deployment on the target Mac mini. Set it only for an intentional,
approved remote deployment.
