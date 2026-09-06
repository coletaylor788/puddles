---
name: safe-feature-development
description: "Implement features safely through local validation, retained full-diff review, immutable validation-worker handoff, configured promotion, production validation, and rollback. Use whenever an agent is asked to implement a feature or behavior change."
compatibility: "Requires the target repository's existing build, test, deployment, and rollback tools. Uses repository-provided test and production lifecycles when available."
metadata:
  author: Cole Taylor
  version: "1.11.0"
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

The parent orchestrator owns worker creation and failure routing. It assigns one
implementation worker and, only after an immutable candidate handoff, exactly
one distinct sibling validation and deployment worker. Neither child creates,
spawns, or directly delegates to the other.

Treat an approved implementation request as authorization for the implementation
worker to own all code, configuration, and documentation changes, local and test
validation, the single retained independent review, commit, push, pull-request
updates, review remediation, conflicts, and remote checks. A controlling
instruction may explicitly stop or limit those actions, and repository
permissions and protections always apply.

After one exact candidate is reviewed, remotely green, and mergeable, the
implementation worker reports its immutable handoff to the parent orchestrator,
then stops and waits. The handoff contains the repository and pull request,
exact head and base pins, required check results, reviewed private and manifest
inputs when applicable, release command and input paths, and rollback
prerequisites. The implementation worker does not promote and does not create
the validation and deployment worker.

The sibling validation and deployment worker runs only the repository's
scripted release lifecycle. It must not edit files, change pins, commit, push,
resolve conflicts, make design decisions, invoke review, or create workers. On
failure it reports the failed stage and durable evidence to the parent
orchestrator, then stops. It must not fix the failure or retry with changed
inputs. The parent routes the failure to the same implementation worker. That
worker owns every correction and reruns affected local validation and the
retained review before returning a new immutable handoff with a new run.

The implementation worker creates exactly one independent reviewer after
initial local validation and records that reviewer's agent or session identity
in the plan or other durable run state. Every remediation recheck resumes that
same identity. A fresh replacement is allowed only when the retained reviewer
failed or is irrecoverably unavailable. Record the prior identity, failure
reason, and replacement identity before using it, and require the replacement
to review the complete current diff. The parent orchestrator and validation and
deployment worker never create review agents.

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
   - During implementation, run only the smallest targeted checks that cover
     the current edits. Batch related targets and all planned fixes. Do not run
     the full configured integration pool after each edit, pin update, focused
     failure, or review exchange.
   - After all planned candidate changes are complete and targeted checks pass,
     run the full configured integration pool once immediately before sending
     the candidate to the retained reviewer. Persist the candidate head or input
     hash with the successful result.
   - Reuse that full result only while the recorded candidate inputs are
     unchanged. Remote CI and the validation and deployment worker's later
     public and combined gates do not trigger another local full run.

5. **Audit the full change**
   - Launch a fresh independent subagent that did not implement the change.
     Require it to invoke and follow the repository-local `adversarial-review`
     skill against the complete feature diff. This is the implementation
     worker's only independent reviewer. Record its agent or session identity in
     the plan or other durable run state and retain its worker handle for the
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
   - After accepted fixes, return to local implementation and batch the complete
     remediation. Run targeted checks while iterating. After all fixes are final
     and targeted checks pass, run the full configured integration pool once on
     the final remediated candidate, persist its head or input hash, then resume
     that same reviewer through the retained worker handle. Tell it which
     findings were addressed, disputed, revised, or withdrawn, what files or
     behavior changed, and which validation reran, and require it to re-check
     the complete current diff. Do not run the full pool once per finding, launch
     a new review worker for a routine remediation re-check, or require a new
     finding or code change in each round. Repeat with the same reviewer until no
     actionable, high-confidence findings remain unresolved.
   - If the reviewer requests no candidate-file changes, do not rerun the local
     full pool. Reuse the successful result bound to the unchanged candidate
     head or input hash.
   - If the retained reviewer fails or cannot be resumed, launch a fresh
     independent replacement only after recording the prior identity and
     failure reason in the plan or other durable run state. Record the
     replacement identity, require a complete-current-diff review, and retain
     its worker handle for the rest of the remediation loop. Never skip or
     narrow review because the original worker is unavailable.
   - After all in-diff plan, checklist, and other bookkeeping is final, create
     the landing candidate commit and resume the retained reviewer for one final
     complete-current-diff check. Do not launch a second terminal reviewer.
     Record the clean result and reviewed commit outside the candidate diff.
     Write it into the pull request in the next step, or in the final report when
     the repository does not use pull requests. Commit ids do not belong in the
     issue.

6. **Prepare remote integration**
   - Push the exact retained-review candidate and create or update a non-draft
     pull request. Include the committed regression and exact validation command
     and results required by the repository. Record the retained review result
     and the reviewed commit identifier here.
   - Wait for all required remote checks. Resolve actionable review feedback,
     unresolved review threads, merge conflicts, and integration failures
     yourself. Any candidate change invalidates the retained review result. Use
     targeted checks while batching all fixes, then run the full integration
     pool once on the final candidate and resume the retained reviewer before
     pushing and repeating remote integration gates. A remote full run does not
     require another unchanged local full run.
   - When the retained-review candidate is remotely green, mergeable, and has
     no unresolved required review, record its exact head commit and the current
     base-branch commit. Report the immutable handoff to the parent orchestrator,
     then stop and wait. Include the repository and pull request, exact public
     head and base head, required check results, private head and manifest inputs
     when applicable, release command and input paths, and rollback
     prerequisites.
   - The implementation worker must not start promotion or create the validation
     and deployment worker. The parent orchestrator alone creates exactly one
     distinct sibling validation and deployment worker for the handoff.
   - The parent orchestrator and validation and deployment worker must not
     create review agents. Review identity and remediation remain owned by the
     implementation worker.

7. **Promote through the configured lifecycle**
   - The parent-created validation and deployment worker first validates that
     the supplied head, base, checks, and private inputs still match. It then
     uses the approved automatic test-to-production lifecycle on that exact
     candidate. It does not rebuild outside that lifecycle, manually copy
     artifacts, or add another approval gate unless a controlling instruction
     explicitly requires one.
   - The validation and deployment worker must not edit code, configuration,
     documentation, or pins, resolve conflicts, make design decisions, invoke
     review, or create workers. It may only invoke staged scripts, verify hashes,
     receipts, and checks, promote exact artifacts, run read-only production
     validation and merge gates, and land when every gate passes.
   - Promotion must durably record recovery state before destructive work and
     use atomic replacement where supported.
   - If the task explicitly forbids production impact, do not promote. Validate
     promotion, interruption recovery, and rollback against test fixtures.
   - If no configured safe promotion lifecycle exists, do not invent production
     access. Finish test-environment validation and report that deployment was
     not run.

8. **Validate production and roll back on failure**
   - After promotion, run the configured production integration, health, and
     smoke checks. Automated production tests must be read-only and must use
     explicit production state and configuration paths.
   - On any post-promotion failure, revert production to the recorded snapshot,
     reload production, revalidate production health, return a nonzero result,
     report the structured failure to the parent orchestrator, and stop.
   - The parent orchestrator routes any release failure to the same
     implementation worker. If a candidate change is required, that worker makes
     it, batches all corrections, and uses targeted checks while iterating. Once
     those checks pass, it runs the full configured integration pool once on the
     final candidate, resumes the retained reviewer for the complete current
     diff, pushes the new exact candidate, and returns a new immutable handoff
     with a new run. The validation and deployment worker never makes the fix
     itself or retries with changed inputs. A passed stage may be reused only
     when the scripted lifecycle verifies matching input and output hashes.
   - Preserve the original failure. Surface rollback or cleanup failures as
     additional errors rather than hiding them.

9. **Land and close out**
   - Immediately before merge, fetch the pull-request state again and confirm its
     head and base are the exact remotely approved commits recorded before
     promotion, and that the head completed applicable promotion and production
     validation. Confirm required checks and review remain green and the pull
     request remains mergeable.
   - If the head, approved base, required checks or review, or mergeability
     changed after promotion, roll back the promoted candidate using the
     recorded recovery state, revalidate production health, preserve the
     remote-state failure, surface rollback failures as additional errors,
     report to the parent orchestrator, and stop. The parent routes the evidence
     to the same implementation worker, which updates and revalidates the
     candidate before another handoff.
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
     errors, report to the parent orchestrator, and stop.
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
- the reusable-worker full-diff audit loop is clean for the landing candidate;
- the implementation worker returned one immutable, reviewed, remotely green
  candidate handoff to the parent orchestrator, which created one distinct
  sibling validation and deployment worker;
- managed processes and temporary state are cleaned up;
- configured promotion and read-only production validation succeeded, or
  production was explicitly out of scope and promotion and rollback were proven
  in fixtures, or no configured promotion lifecycle exists and that limitation
  was reported;
- when the repository uses pull requests, the same retained-review candidate
  that completed applicable promotion and production validation is remotely
  green, required review is resolved, the pull request is merged, and the
  expected default-branch result is verified, unless a controlling instruction
  or concrete policy or permission blocker explicitly prevents landing; and
- the final tracker report accurately states the landed result, validation,
  residual risks, and any explicit landing blocker for the requester's final
  validation and task-completion decision.

## Puddles lifecycle

When `packages/e2e/bin/openclaw-test-env.mjs` exists on the active branch, use
its `ci` command as the configured managed lifecycle. Follow the safety model and
commands in `packages/e2e/README.md`.

For OpenClaw source patch deployment, follow
`docs/openclaw-setup/patches/README.md` and use
`docs/openclaw-setup/patches/apply-and-deploy.sh`. An unset `MINI_HOST` means
local deployment on the target Mac mini. Set it only for an intentional,
approved remote deployment.
