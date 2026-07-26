# Coalesce split iMessage message parts

- **Status:** In progress - heuristic hardened, cumulative revalidation pending
- **Issue:** https://github.com/coletaylor788/puddles/issues/28
- **Last updated:** 2026-07-25
- **Owner:** Cole Taylor

## Human design

### Problem

A single Messages.app composition can arrive as separate text, link-preview, and
attachment rows. Processing each row immediately starts multiple agent turns,
so the first response can lack the link or image context. The fix must not merge
genuinely separate rapid messages or make iMessage delivery less reliable.
Production smoke evidence now shows images coalescing while a newly sent link
still triggered a response without the link context. Read-only correlation found
two examples where a four-to-six-word question explicitly referring to “this”
arrived one second before its URL-preview balloon, but the question dispatched
immediately because the original lead-in classifier allowed only unfinished
fragments of at most three words.

### Outcome

Eligible same-sender direct-message parts arriving within the existing bounded
split-send window become one logical inbound turn. Complete messages, commands,
reactions, groups, outgoing echoes, and separate short texts retain their prior
behavior. Every maintained OpenClaw patch has visible cumulative integration
coverage in the required pull-request workflow.

### Approach

Extend the provider-neutral OpenClaw source patch with a narrow bounded class for
short questions that both refer deictically to an accompanying payload and
either name a payload type or use the specific “how/what about this one?” shape.
Hold those prompts for the existing split-send window so an immediately
following URL-preview balloon can join them. Keep unrelated complete questions
instant and preserve separate text turns. Keep focused tests inside the patch
and expose every regression through the isolated cumulative `packages/e2e`
runner. Do not drive configured agents or live systems from the required pool.
Deploy only through the documented local-or-explicit-remote wrapper.

### Safety and rollout

The behavior is opt-in through the existing same-sender DM coalescing setting,
uses bounded text, attachment, row-count, and time limits, and fails open when a
safe conversation key cannot be formed. Automated tests use temporary
worktrees, focused source harnesses, and recording mocks; they never connect to
the configured gateway, send messages, or mutate personal data. On the target
host, `MINI_HOST` stays unset; only an intentional remote deployment sets it.
Production investigation is read-only and scoped to the reported time window.
Rollback disables coalescing and redeploys the prior reviewed patch stack.

## Agent details

### State

The original coalescing patch is merged and deployed, and the cumulative
integration lifecycle is active on `main`. Read-only correlation reproduced
Cole's link failure and showed that complete payload-referential questions were
dispatched before their URL balloons. A narrow correction and the observed
regression are implemented in an isolated pinned OpenClaw fixture; cumulative
validation passed before review. Review-driven heuristic and timeout hardening
now pass focused tests; cumulative revalidation, fresh review, merge, and safe
redeployment remain.

### Scope and acceptance criteria

- Near-simultaneous lead-in text plus a standalone URL preview from the same
  account, direct conversation, and sender dispatches as one logical turn.
- The production event shape observed around the reported link test is covered
  by a committed regression and produces one logical inbound turn.
- Short payload-referential questions may wait for the bounded split-send
  window; unrelated complete questions remain immediate.
- Lead-in text plus a real image attachment dispatches as one logical turn.
- Rapid but genuinely separate short text messages remain separate turns.
- Complete URL-bearing prose, control commands, reactions, outgoing echoes, and
  group messages preserve immediate behavior.
- Invalid conversation anchors fail open instead of sharing pending state.
- Replay GUID handling and recovery, catchup, and cursor ordering remain safe.
- Coalescing stays opt-in and requires attachment ingestion for image context.
- Every maintained OpenClaw patch regression is committed, mapped, and run by
  the cumulative shared integration lifecycle.
- Local deployment uses no SSH; remote deployment occurs only with an explicit
  approved `MINI_HOST`.
- Production runs a reviewed `main` artifact with valid configuration and a
  healthy iMessage provider.

### Architecture and decisions

- Reuse `channels.imessage.coalesceSameSenderDms` and the existing bounded
  split-send window rather than adding configuration.
- Hold only short unfinished lead-ins. Standalone payloads flush immediately
  unless they can join the immediately preceding eligible lead-in.
- Base link classification on the observed normalized inbound shape rather than
  assuming Messages.app always emits a standalone URL row.
- Also hold question-terminated prompts of at most eight words only when they
  contain an explicit deictic reference plus a payload noun, or match the narrow
  “how/what about this one?” comparison shape. Do not hold common unrelated
  questions or complete URL-bearing prose.
- Scope pending state by account, valid conversation anchor, and sender.
- Preserve limits of 4,000 text characters, 20 attachments, and 10 source rows.
- Require `channels.imessage.includeAttachments: true` for image ingestion.
- Keep the source patch reproducible against pinned OpenClaw 2026.6.11.
- Treat tests embedded only in a patch as undiscoverable until the shared runner
  applies that patch and executes its mapped tests.
- Keep `packages/e2e/openclaw-patch-suite.json` cumulative and aligned with
  `apply-and-deploy.sh` patch order.
- Use cryptographic run identifiers and linear fenced-JSON parsing in shared
  test utilities.
- Keep live automated production checks read-only and deny message delivery by
  default.
- Do not treat a benign prompt or omitted `--deliver` flag as a write-safety
  boundary. The required pool must not drive configured agent profiles.
- Use focused source-level harnesses for agent behavior and recording adapters
  that reject unknown mutation for write paths.
- Exercise the managed lifecycle on macOS so target-specific shell and process
  behavior is covered.
- Make worktree, filesystem, and signal cleanup independent and idempotent.
- Run child commands asynchronously so termination can be forwarded and cleanup
  can execute before process exit.
- Reject unknown mock operations and require a unique recording directory.
- Do not retain credentialed integration files that the required lifecycle
  intentionally excludes.

### Implementation

- PR #16 added the selective iMessage coalescer, monitor integration, regression
  tests, patch documentation, and rollout guidance.
- PR #19 corrected deployment topology so an unset `MINI_HOST` always deploys
  locally and only an explicit host uses SSH/SCP.
- PR #21 recorded and completed the approved local production rollout.
- PR #26 adds:
  - the shared `packages/e2e` lifecycle and pull-request workflow;
  - a cumulative patch-to-regression manifest;
  - local/remote deployment routing tests;
  - an isolated browser-entrypoint process test;
  - real same-agent and cross-agent spawn policy regressions;
  - fail-closed manifest path checks;
  - isolated pinned dependency restoration and process cleanup; and
  - CodeQL-driven randomness and linear-parser hardening.
- `.github/copilot-instructions.md` requires every feature, behavior change, and
  bug fix to contribute committed coverage and run the entire shared pool.
- The dormant credentialed live-agent files and command were removed because
  they could execute configured write tools and were intentionally excluded
  from CI. The required pool now contains only tests that run in `ci`.
- The pull-request workflow uses `macos-latest`.
- Termination handlers run the same idempotent cleanup path as normal failure.
  Worktree removal, directory deletion, and stale-registration pruning are
  attempted independently, and all cleanup failures remain visible.
- Credentialed plugin suites and separate integration-only configurations were
  removed; a repository regression prevents integration exclusions from
  returning.
- Child commands use asynchronous process groups. Termination is forwarded with
  a bounded grace period before forced termination and cleanup.
- Cleanup double-forces candidate removal, prunes registrations immediately, and
  verifies the candidate is absent.
- Both recording mocks require explicit isolated state and reject unsupported
  operations.
- Reopened correction: correlate the reported production logs, identify why the
  link row bypassed coalescing, and update the patch and cumulative regression
  mapping without changing image or separate-message behavior.
- Read-only correlation confirmed two failures: each question row reached the
  agent before a URL-preview balloon from the same sender and chat arrived one
  second later. Messages metadata contains no shared composition identifier, so
  the correction must use a conservative prompt-shape heuristic.
- The patch now treats only bounded question-terminated prompts with explicit
  deictic payload references as lead-ins. Focused classifier and monitor
  regressions use the observed question-plus-URL shape.
- Review hardening further requires a payload noun or the narrow “how/what about
  this one?” comparison shape, and proves unmatched held questions dispatch
  alone after the bounded window.
- The exported source patch was regenerated from the isolated pinned fixture and
  reapplied cleanly to a second detached fixture.

### Validation

- Original focused OpenClaw validation: 65 coalescer and monitor tests passed,
  covering links, images, separate texts, commands, races, replay, and catchup
  cursors.
- Managed cumulative lifecycle:
  `OPENCLAW_SRC=/path/to/openclaw node packages/e2e/bin/openclaw-test-env.mjs ci`.
- CodeQL JavaScript/TypeScript and Python analyses passed after replacing
  insecure random identifiers and the backtracking fenced-JSON regex.
- Focused post-review validation passed E2E type checking and 21 isolated tests,
  including real locked-worktree cleanup, subprocess termination, test
  discovery, and fail-closed mock coverage.
- The final managed lifecycle passed repository build and lint, 237 isolated
  workspace tests, 289 mapped OpenClaw tests, one isolated browser-entrypoint
  candidate test, and verified candidate deregistration.
- A fresh independent review of the validated implementation found no
  actionable high-confidence defects. The pinned upstream revision protects
  the external debouncer contract; real-provider hook round trips remain manual
  rather than credentialed CI.
- Pull-request checks passed on the final handoff commit, PR #26 merged, and the
  first cumulative Integration workflow passed on `main`.
- New production evidence: images pass a quick smoke test, while the reported
  link composition reached the agent without link context. Exact log
  correlation reproduced two separate question-first turns followed by
  URL-balloon turns.
- Updated focused coalescer and monitor suites pass 67 tests, including a
  policy-respecting monitor regression that cannot produce one merged dispatch
  under the prior classifier.
- The managed cumulative lifecycle passes repository build and lint, 237
  workspace tests, 291 mapped OpenClaw tests, one candidate test, and verified
  candidate deregistration.
- Hardened focused coalescer and monitor suites pass 68 tests; common unrelated
  deictic questions remain instant and unmatched referential questions flush
  alone.

### Rollout and rollback

Production rollout uses
`docs/openclaw-setup/patches/apply-and-deploy.sh` from a reviewed Puddles
`main` worktree with `OPENCLAW_SRC` pinned to the approved OpenClaw checkout.
`MINI_HOST` is unset for local deployment.

Rollback:

1. Unset `channels.imessage.coalesceSameSenderDms`.
2. Remove the coalescing patch from the reviewed patch list.
3. Rebuild and deploy the prior pinned stack with the documented topology.
4. Validate configuration, gateway health, and iMessage channel status.

No data migration or persistent message-state conversion is involved.

### Review log

- Multiple independent adversarial reviews of the implementation and cumulative
  test infrastructure found lifecycle, cleanup, test-discovery, and security
  gaps; all actionable findings were corrected and revalidated.
- PR #26 CodeQL initially found three high-severity utility findings; all were
  fixed and both language analyses are green.
- The terminal independent review after syncing current `main` found four
  actionable issues: unsafe live write capability, live behavioral suites
  omitted from CI, missing macOS CI coverage, and incomplete interruption
  cleanup. The implementation has addressed all four and the complete lifecycle
  passes.
- A fresh review found excluded credentialed plugin suites, incomplete
  stale-registration cleanup, blocked signal handlers, fail-open recording
  mocks, and unnecessary operational detail in this public plan. All five
  corrections are implemented and pending full validation.
- A fresh independent review of the validated corrections found no actionable
  high-confidence defects.
- A second fresh independent review of the exact published handoff diff also
  found no actionable high-confidence defects before merge.
- Cole reopened the task after a production link smoke test exposed a behavior
  not represented by the existing link regressions. A new independent review is
  required after the correction and complete lifecycle pass.
- The first correction review found no actionable defects but identified a
  broader-than-intended false-positive surface for common deictic questions and
  missing standalone-timeout coverage. Both are being hardened before promotion.

### Checklist

- [x] Implement selective iMessage part coalescing.
- [x] Cover image, link, command, separate-message, replay, race, and catchup
  behavior in focused tests.
- [x] Document the source patch, deployment, and rollback.
- [x] Merge and deploy the coalescing implementation.
- [x] Correct local-versus-remote deployment guidance and tests.
- [x] Add the cumulative shared OpenClaw integration runner and manifest.
- [x] Expose embedded patch regressions through the managed lifecycle.
- [x] Add deployment-topology and browser-entrypoint integration coverage.
- [x] Strengthen repository instructions for mandatory cumulative coverage.
- [x] Resolve CodeQL findings and pass both language analyses.
- [x] Pass the complete managed lifecycle after syncing current `main`.
- [x] Restore production from reviewed `main`, validate config, and confirm
  healthy gateway and iMessage process state.
- [x] Observe one user-originated inbound iMessage after the latest restart.
- [x] Remove unsafe configured-agent tests and retain behavior in isolated
  source, deployment, candidate, and recording-mock tests.
- [x] Ensure every retained package integration test runs in the managed `ci`
  command.
- [x] Run the required workflow on macOS.
- [x] Make temporary worktree cleanup signal-aware and resilient to partial
  failures.
- [x] Pass the complete managed lifecycle after resolving review findings.
- [x] Remove or safely replace excluded credentialed plugin integration files
  and enforce that retained integration tests run.
- [x] Make child execution asynchronous and prove signal cleanup in a subprocess.
- [x] Force and verify stale worktree deregistration after cleanup failures.
- [x] Make recording mocks require state and reject unknown operations.
- [x] Remove host-specific operational detail from public artifacts.
- [x] Rerun the complete managed lifecycle after fresh-review corrections.
- [x] Obtain and record a clean independent review of the validated
  implementation.
- [x] Push and merge PR #26.
- [x] Confirm the first cumulative Integration workflow run on `main`.
- [x] Prepare issue #28 and the Todoist ready-for-review handoff.
- [x] Correlate read-only production logs with the reported link test.
- [x] Add a focused regression for the observed split-link event shape.
- [x] Correct link coalescing without broadening separate-message batching.
- [x] Run focused tests and the complete managed cumulative lifecycle.
- [ ] Obtain a clean independent review of the complete correction diff.
- [x] Narrow the heuristic so common deictic questions remain immediate.
- [x] Cover standalone held-question timeout and policy behavior.
- [ ] Rerun the complete cumulative lifecycle after review hardening.
- [ ] Merge the correction and confirm the cumulative workflow on `main`.
- [ ] Deploy through the approved lifecycle and validate production read-only.
- [ ] Return issue #28 and Todoist to Ready for review.
