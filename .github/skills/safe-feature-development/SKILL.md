---
name: safe-feature-development
description: "Implement features safely from research through test-environment integration, full-diff architecture audit, configured promotion, production integration validation, and automatic rollback. Use whenever an agent is asked to implement a feature or behavior change."
compatibility: "Requires the target repository's existing build, test, deployment, and rollback tools. Uses repository-provided test and production lifecycles when available."
metadata:
  author: Cole Taylor
  version: "1.8.0"
---

# Safe Feature Development

Track feature development in a repository plan. The plan holds the detail. Its
issue is a short prose summary and status that links to the plan.

Use this workflow for feature implementation, behavior changes, migrations,
runtime configuration, plugins, integrations, and deployment automation. Follow
more specific repository instructions as additional constraints. Never weaken a
global safety or publication boundary.

## How to write

These rules cover everything a person reads: plans, issues, issue comments, pull
request descriptions, and commit messages.

- Write like you are explaining it to a coworker at their desk. Normal
  conversation.
- Short sentences. Everyday words. If a simpler word works, use it.
- Never use an em dash. Use a period, a comma, or parentheses instead.
- Do not stack nouns into long technical phrases. Break the idea into separate
  sentences.
- Human facing parts are real paragraphs, not bullet lists. Lists are fine in
  the plan's Agent section, where they track concrete items.
- Skip filler words like leverage, utilize, holistic, robust, comprehensive,
  seamless, and ensure-that padding. Just describe the thing.
- Do not narrate the process or list everything you did. Say where things stand
  now and what it means.
- Do not write like a policy document or a legal contract.
- Assume the reader is an experienced software engineer who understands agent
  systems but does not know OpenClaw's internals or vocabulary.
- When OpenClaw is relevant, explain an unfamiliar part the first time it
  matters. Say what it does, where it sits in the request or runtime flow, and
  why that detail affects the current decision. Use familiar agent-system ideas
  as a bridge, but do not treat an internal name as an explanation.
- Match the depth to the current decision. Give enough context to reason about
  the change without reading the source first, then stop. Do not add unrelated
  internals or a general tutorial.

## Ownership and checkpoints

The parent orchestrator creates and routes separate workers when a feature will
be promoted. Do not let an implementer create its own validator.

The feature implementer owns research, design, the requested code, focused
tests, the committed regression, related documentation, and retained
adversarial review. It produces an exact frozen candidate. It does not own the
full release proof, packaging, production deployment, or failures in release
infrastructure.

The validation and deployment worker owns full cumulative validation, artifact
sealing, deployment, read-only production checks, rollback, and landing. It
owns failures in validation, packaging, receipts, environment setup, transport,
deployment, and rollback tooling. It fixes those failures on its own branch,
adds focused regression coverage, lands the repair through the smallest
repository-approved integration path, records the landed tooling identity
separately, and resumes the same release without asking the implementer or
requester to restart it.

The frozen feature is a hard boundary. The validation and deployment worker
must not change feature source, feature patches, feature lockfiles, or sealed
artifact contents. If evidence identifies a feature or artifact defect, route
the exact failure to the same implementer. The implementer fixes it, runs
focused tests, resumes its retained reviewer, and returns a new frozen
candidate. The validation and deployment worker then reruns only the proofs
invalidated by that candidate change.

Treat an approved implementation request as authorization for the orchestrator
and both workers to complete their assigned parts of the lifecycle. This
includes commit, push, non-draft pull request creation or update, remote-check
and review remediation, validation, deployment, rollback, merge, and
post-landing verification. A controlling instruction may explicitly stop or
limit those actions, and repository permissions and protections always apply.

Pause before implementation only when the requester explicitly asks to review,
approve, or iterate on the design. Record the current design in the plan and
wait at that checkpoint. After approval, or when no design checkpoint was
requested, continue autonomously through landing. Do not turn pull-request review
or merge into a routine requester handoff. Return the landed result for the
requester's final validation and task-completion decision.

## Requesting requester help

Ask the requester for help only after normal autonomous resolution paths are
exhausted and a concrete permission, safety boundary, missing fact, or material
decision genuinely requires their input. Before asking, update the plan and the
issue status with the blocker.

Every help request must be concise and self-contained. It must:

- name the exact blocker and the affected feature, environment, or lifecycle
  step;
- summarize the relevant evidence and what the worker already tried or
  verified;
- explain why the worker cannot safely or correctly resolve it without the
  requester;
- ask for one exact decision, fact, permission, configuration change, or action;
  and
- state what the worker will do after the answer and any material consequence
  of the available choices.

Include the tracking issue when the request occurs outside the repository.
Never send a vague status-shaped question, ask whether an unexplained subsystem
is "enabled", or delegate routine worker-owned design execution, review, CI,
conflict resolution, merge, landing, or verification. If the needed requester
action cannot be described clearly enough to satisfy this contract, continue
investigating instead of asking.

## Required loop

1. **Research**
   - Read repository instructions, current plans, component documentation, and
     the affected runtime topology before editing.
   - Trace existing behavior, trust boundaries, helpers, tests, deployment
     surfaces, and rollback mechanisms. Reuse existing patterns.
   - Identify production state, credentials, delivery channels, external
     mutation surfaces, ports, processes, and artifacts that must stay isolated.

2. **Plan**
   - For significant work, create or update the repository's expected plan
     artifact. After one H1 title, include a compact metadata block containing
     only `Status`, `Issue`, `Last updated`, and optionally `Owner`.
   - After the title and metadata, the plan must contain exactly two top-level
     sections in this order:
     1. `## Human section`, with exactly `### Design` and `### Status`, in that
        order.
     2. `## Agent section`, with exactly `### State`,
        `### Scope and acceptance criteria`, `### Architecture and decisions`,
        `### Implementation`, `### Validation`, `### Rollout and rollback`,
        `### Review log`, and `### Checklist`, in that order.
   - `### Design` explains the problem and how the solution works. Give enough
     detail that someone can understand the architecture: what the pieces are,
     how they fit together, and what the important choices were and why. It must
     not contain file paths, function names, class names, command names, commit
     SHAs, line numbers, or any other code pointer. Write normal paragraphs, the
     way you would say it out loud. A few paragraphs at most. When OpenClaw is
     involved, do not rely on its internal names as shorthand. Explain the
     relevant part's job, its place in the request or runtime flow, and why it
     matters to this design.
   - `### Status` says where the work stands, readable at a glance. What is
     done, what is next, what is blocking. Two short paragraphs at most. Present
     tense, no chronology.
   - The `Agent section` is where code pointers, file paths, commands, commit
     ids, and evidence belong. Keep it complete and consistent with the
     `Human section`.
   - Do not add another top-level section, an append-only status log, or a
     second copy of the design narrative elsewhere in the plan.
   - On every substantive change, re-read and rewrite both sections so the plan
     reads as one coherent current design and current operational state.
     Requirements, decisions, steps, evidence, risks, and checklist state all
     stay current and synchronized. Do this after research, and again after
     implementation, validation, rollout, or review changes. Never append a
     fragment instead of updating the whole plan.
   - The issue body is exactly a plan link, then two prose sections, and nothing
     else:

     ```markdown
     [Plan: `docs/plans/<file>.md`](<absolute url>)

     ## Summary

     <Exactly one paragraph, kept current. What we are building or fixing and
     why it matters. Plain language.>

     ## Status

     <One paragraph, two at the absolute most. Where the work stands right now,
     what happens next, and anything blocking. No history, no evidence dumps, no
     command output.>
     ```

   - There is no `## Done` section. Do not add one.
   - No bullet lists and no numbered lists anywhere in the issue body. Prose
     only.
   - Rewrite both issue sections in full on every update so they describe the
     present, not an append-only log.
   - Detail, evidence, commands, commit ids, validation transcripts, and
     chronology live in the plan, never in the issue.
   - Issue comments follow the same rule: short prose status only.
   - Settle any material design ambiguity before implementation. Do not stop
     after planning when implementation was already requested and the design is
     approved.
   - If the requester explicitly asked to review, approve, or iterate on the
     design, pause here with the plan current and ask the exact unresolved
     design question using the requester-help contract above. Otherwise, do not
     add a human approval gate.

3. **Implement and freeze the feature candidate**
   - The implementer iterates locally using the repository's established
     development workflow and runs focused tests that cover the changed
     behavior.
   - Use mocks or fakes for local testing and iteration when exercising a live
     dependency is unnecessary.
   - Route external writes and delivery in tests through deny-by-default mocks
     or recording adapters. Unknown mutations must return explicit errors, and
     automated tests must not deliver real messages.
   - Add or update tests and directly relevant documentation with the code.

4. **Audit and freeze the feature candidate**
   - Before freezing the candidate, the implementer launches a fresh independent
     subagent that did not implement the change.
     Require it to invoke and follow the repository-local `adversarial-review`
     skill against the complete feature diff. Retain its worker handle for the
     entire remediation loop.
   - Triage every finding using engineering judgment before changing the
     implementation. Accept and resolve concrete, well-supported defects that
     materially affect requirements, correctness, safety, or regression risk.
     Challenge speculative, duplicate, already-resolved, or non-actionable
     feedback; do not make churn changes merely to satisfy a reviewer.
   - For a significant finding you dispute, resume the same reviewer with the
     contrary evidence and rationale, ask it to re-evaluate the concern, and
     converge on an accepted fix, a revised finding, a withdrawal, or an explicit
     residual risk or blocker. If focused evidence-based discussion cannot
     resolve a material disagreement, escalate it for a decision instead of
     repeating review cycles.
   - After accepted fixes, return to local implementation and rerun applicable
     focused gates. Then resume that same reviewer through the retained worker
     handle. Tell it which findings were addressed, disputed, revised, or
     withdrawn, what files or behavior changed, and which focused validation
     reran. Require it to re-check the complete current diff. Do not launch a new
     review worker for a routine remediation re-check. Repeat with the same
     reviewer until no actionable, high-confidence findings remain unresolved.
   - If the diff changes after a clear review for any reason, run the relevant
     focused validation and resume the same reviewer with the change and
     validation summary for another complete-current-diff review. The full
     cumulative pool remains the validation and deployment worker's
     responsibility after the candidate is frozen.
   - A remediation re-check may be clean. Do not require a new finding or code
     change in each review round.
   - If the retained reviewer fails or cannot be resumed, launch a fresh
     independent replacement, require a complete-current-diff review, and retain
     the replacement's worker handle for the rest of the remediation loop. Never
     skip or narrow review because the original worker is unavailable.
   - After all in-diff plan, checklist, and other bookkeeping is final, create
     the landing candidate commit and run one terminal fresh review against that
     exact commit. Do not change the candidate afterward. Any change invalidates
     the terminal result and restarts validation and fresh review.
   - Record the clean terminal result and the reviewed commit identifier outside
     the candidate diff, so recording it cannot change what was reviewed. Write
     it into the pull request in the next step, when the pull request is created
     or updated. If the repository does not use pull requests, put it in the
     final report to the requester instead. Commit ids do not belong in the
     issue.

5. **Publish and hand off the frozen candidate**
   - The implementer pushes the exact terminal-reviewed candidate and creates or
     updates a non-draft pull request. Include the committed regression and
     focused validation results. Record the terminal review result and reviewed
     commit identifier here.
   - The implementer resolves actionable feature review feedback and conflicts.
     The validation and deployment worker resolves release-framework and
     integration-infrastructure failures. Any feature candidate change requires
     focused validation and retained-review recheck before a new frozen
     candidate is handed off.
   - When the terminal-reviewed candidate is remotely green, mergeable, and has
     no unresolved required review, record its exact head and base commits. The
     parent orchestrator hands those identities to the validation and deployment
     worker once. Do not merge the candidate before its applicable promotion and
     production validation complete.

6. **Validate and seal the frozen candidate**
   - The validation and deployment worker runs applicable formatter, lint, type
     check, unit test, build, and the configured full integration suite against
     the exact handed-off candidate in the test environment.
   - Exercise success, denial, malformed input, interruption, cleanup,
     concurrency, promotion, and rollback paths that the change affects.
   - Verify the exact requested outcome, not a proxy. A skipped suite, missing
     model or dependency, leaked process, occupied port, or success-shaped
     fallback is not green.
   - Confirm the committed feature regression is present in the repository's
     main integration pool. Do not accept ad hoc tests that are absent from the
     full configured run.
   - Seal the validated deployment artifacts and durably record their content
     digests with the candidate and tooling identities. Promotion must consume
     those exact artifacts and must not rebuild or repackage them.
   - The validation and deployment worker fixes failures in the validation or
     release framework, adds focused regressions, lands those repairs
     independently, and resumes the same candidate with the landed tooling
     identity.
   - Route a proven feature or artifact defect to the same implementer with the
     smallest error and durable evidence. Do not change the candidate in the
     validation worker.

7. **Promote through the configured lifecycle**
   - The validation and deployment worker uses the approved automatic
     test-to-production lifecycle on the exact remotely approved candidate after
     all pre-promotion gates pass. Do not manually copy artifacts or add an
     additional approval gate unless a controlling instruction explicitly
     requires one.
   - Promotion must durably record recovery state before destructive work and
     use atomic replacement where supported.
   - If the task explicitly forbids production impact, do not promote. Validate
     promotion, interruption recovery, and rollback against test fixtures.
   - If no configured safe promotion lifecycle exists, do not invent production
     access. Finish test-environment validation and report that deployment was
     not run.

8. **Validate production and roll back on failure**
   - The validation and deployment worker runs the configured production
     integration, health, and smoke checks after promotion. Automated production
     tests must be read-only and must use explicit production state and
     configuration paths.
   - On any post-promotion failure, revert production to the recorded snapshot,
     reload production, revalidate production health, return a nonzero result,
     and then diagnose the failure.
   - Preserve the original failure. Surface rollback or cleanup failures as
     additional errors rather than hiding them.
   - After rollback, repair release infrastructure in the same worker and resume
     the unchanged candidate. Return to the implementer only when evidence shows
     a feature or artifact defect.

9. **Land and close out**
   - The validation and deployment worker fetches the pull-request state
     immediately before merge and confirms its head and base are the exact
     remotely approved commits recorded before promotion. Confirm that the head
     completed applicable promotion and production validation, required checks
     and review remain green, and the pull request remains mergeable.
   - If the base advanced only because a fast-lane release-infrastructure repair
     landed, confirm the feature head and diff are unchanged, the repair does not
     change artifact contents or proof meaning, and the pull request remains
     mergeable. Record the new base and landed tooling identity without
     invalidating unaffected proofs or redeploying the unchanged candidate.
   - If the head, approved base, required checks or review, or mergeability
     changed after promotion for any other reason, roll back the promoted
     candidate using the recorded recovery state, revalidate production health,
     update and revalidate the candidate against the current base, and restart
     at the applicable review and remote-integration step. Preserve the
     remote-state failure and surface rollback failures as additional errors.
   - If the candidate and gates still match, merge it using the repository's
     configured method. Do not stop at an open pull request or a
     `Ready for review` state unless a controlling instruction explicitly
     requires a stop before landing, repository policy or permissions block the
     merge, or a material decision genuinely requires requester input. When
     requester input is genuinely required, use the requester-help contract
     above rather than handing off the lifecycle step.
   - After the merge command, re-fetch the pull request and default branch. If
     the exact candidate cannot be confirmed landed, treat the landing as
     failed: roll back the promoted candidate, revalidate production health,
     preserve the landing failure, surface rollback failures as additional
     errors, and restart remote integration.
   - Once landing is confirmed, verify the default branch contains the expected
     change and required post-merge checks pass. Run any configured post-landing
     production validation and use the documented rollback on failure.
   - Mark the repository issue complete and report the landed outcome, validation
     status, and residual risks for the requester's final validation and
     external task-completion decision. Feedback after landing starts a new
     implementation cycle rather than retroactively making routine integration
     a requester responsibility.

## Completion gate

Feature work is complete only when:

- the requested behavior is implemented and documented;
- all applicable local and test-environment gates are green;
- the reusable-worker full-diff audit loop and terminal fresh adversarial review
  are clean;
- managed processes and temporary state are cleaned up;
- configured promotion and read-only production validation succeeded, or
  production was explicitly out of scope and promotion and rollback were proven
  in fixtures, or no configured promotion lifecycle exists and that limitation
  was reported;
- when the repository uses pull requests, the same terminal-reviewed candidate
  that completed applicable promotion and production validation is remotely
  green, required review is resolved, the pull request is merged, and the
  expected default-branch result is verified, unless a controlling instruction
  or concrete policy or permission blocker explicitly prevents landing; and
- the final tracker report accurately states the landed result, validation,
  residual risks, and any explicit landing blocker for the requester's final
  validation and task-completion decision.

## Puddles lifecycle

When `packages/e2e/bin/openclaw-test-env.mjs` exists on the active branch, use
its `ci` command as the validation and deployment worker's configured managed
lifecycle. The implementer runs focused tests while iterating. Follow the safety
model and commands in `packages/e2e/README.md`.

Pure release-infrastructure repairs use a fast lane. They require focused safety
and regression tests, an independently landed repair, and a separately recorded
landed tooling identity. They reuse completed feature proofs and sealed
artifacts when their inputs are unchanged. A repair that changes feature code,
artifact contents, artifact construction, or the meaning of a completed proof
leaves the fast lane and returns to the applicable implementer.

For OpenClaw source patch deployment, follow
`docs/openclaw-setup/patches/README.md` and use
`docs/openclaw-setup/patches/apply-and-deploy.sh`. An unset `MINI_HOST` means
local deployment on the target Mac mini. Set it only for an intentional,
approved remote deployment.
