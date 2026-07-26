# Coalesce split iMessage message parts

- **Status:** Complete - delayed link correction merged, deployed, and validated
- **Issue:** https://github.com/coletaylor788/puddles/issues/28
- **Last updated:** 2026-07-26
- **Owner:** Cole Taylor

## Human design

### Problem

Messages.app can emit one composition as separate text, link-preview, and
attachment rows. Processing each row immediately starts multiple agent turns,
so the first response lacks later payload context. Image batching works, but two
successive production link smokes still split after the link-aware classifier
was deployed. The latest text omitted a terminal question mark and reached the
runtime 12.4 seconds before its URL-preview row, so it missed both the narrow
question classifier and the seven-second compatibility hold. The fix must cover
that real link-preview shape without merging genuinely separate messages.

### Outcome

Eligible same-sender direct-message text and payload rows from one composition
become one logical inbound turn across the observed image and link-preview
latencies. Unrelated complete messages, commands, reactions, groups, outgoing
echoes, and rapid separate texts retain their prior behavior. The exact
production timing shapes remain committed to the cumulative integration pool.

### Approach

Recognize a bounded punctuationless payload question only when the final clause
has an interrogative shape, deictic reference, and payload noun or narrow
comparison phrase. Give that classified referential path a 15-second absolute
deadline, while short captions keep the existing seven-second compatibility
hold and ordinary messages remain immediate. Later eligible rows reuse the
first deadline instead of restarting it. Exercise the real debouncer across the
exact 12.4-second runtime gap through the cumulative `packages/e2e` runner, then
deploy through the documented local wrapper.

### Safety and rollout

The behavior remains opt-in, sender/conversation scoped, size bounded, and
fail-open when no safe key exists. Any longer wait must be payload-referential,
explicitly capped, and covered by timeout and separate-message regressions.
Automated tests use temporary worktrees and deny delivery; production
investigation remains read-only. On the target host, `MINI_HOST` stays unset.
Rollback disables coalescing or redeploys the prior reviewed patch stack.

## Agent details

### State

The first link correction is merged, validated, and deployed, but Cole's second
live question-plus-link smoke still split. Read-only correlation found Messages
rows 6813/6814 only 0.8 seconds apart, while their OpenClaw runs began 12.4
seconds apart. The correction recognizes the punctuationless final question and
gives only payload-referential lead-ins a 15-second absolute deadline. After
review found that trailing debounce could restart that deadline, the
implementation now preserves the first deadline and focused suites pass 72
tests against the real debouncer. The revised complete lifecycle passes all
repository and cumulative integration gates, and independent re-review found no
actionable defects. The correction is merged, its exact `main` Integration run
passed, and local production runs the reviewed artifact with healthy gateway and
iMessage state.

### Scope and acceptance criteria

- Near-simultaneous lead-in text plus a standalone URL preview from the same
  account, direct conversation, and sender dispatches as one logical turn.
- The production event shape observed around the reported link test is covered
  by a committed regression and produces one logical inbound turn.
- The latest post-deployment failure is correlated by row and runtime-start
  time, and its 12.4-second boundary is covered by a committed regression.
- Short payload-referential questions may wait for the bounded split-send
  window needed for observed URL previews; unrelated complete questions remain
  immediate.
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
- Treat a punctuationless final clause as referential only when it starts with a
  narrow interrogative, remains at most eight words, and contains the existing
  deictic plus payload-kind or comparison signals.
- Use a 15-second absolute deadline only for payload-referential lead-ins.
  Preserve the first pending deadline when later eligible rows arrive, keep the
  existing seven-second compatibility deadline for short unfinished captions,
  and do not widen ordinary text batching.
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
- Second reopened correction: rows 6813/6814 were created 0.8 seconds apart, but
  OpenClaw runs began 12.4 seconds apart. The source patch must recognize the
  exact punctuationless final question and use the debouncer's per-entry timing
  hook for a 15-second referential hold.
- The fixture extracts a bounded trailing interrogative clause, reuses the
  existing deictic and payload-kind signals, and leaves declarative
  punctuationless text instant.
- The monitor assigns 15 seconds only when the default seven-second compatibility
  timing is active. Explicit user-configured iMessage debounce timing remains
  authoritative.
- The monitor records the first compatibility deadline per coalescing key,
  resolves later debounce intervals against its remaining time, and clears only
  the matching deadline when that bucket flushes.
- The complete source patch was regenerated from the minimal pinned fixture,
  reapplied to a fresh detached fixture, and compared byte-for-byte across all
  four patched source and test files.

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
- The complete managed lifecycle passes repository build and lint, 237 workspace
  tests, 292 mapped OpenClaw tests, one candidate test, and verified candidate
  deregistration with the hardened patch at `01ca706`.
- The exact final PR commit passed the same complete lifecycle, CodeQL, and
  pull-request Integration checks before merge.
- Read-only post-deployment checks confirm OpenClaw 2026.6.11 at the pinned
  `a1063aa` source, loopback gateway connectivity, the exact narrowed matcher in
  the installed bundle, and a running iMessage account with no last error.
- Focused coalescer and monitor suites pass 72 tests. They exercise the exact
  punctuationless prompt through the real debouncer across its 12.4-second gap,
  prove payload arrival produces one merged dispatch, prove repeated lead-ins do
  not extend the first deadline, reject declarative text, and preserve explicit
  timing overrides.
- The reviewed candidate passes the complete managed lifecycle with repository
  build and lint, 238 workspace tests, 296 cumulative mapped OpenClaw tests, one
  isolated browser-entrypoint candidate test, and candidate worktree
  deregistration. One stale candidate registration from an earlier run was
  separately removed and pruning confirmed no managed candidate remains.
- Pull-request Integration and CodeQL passed, PR #36 merged as `a7e13fe`, and
  the first Integration run on that exact `main` commit passed.
- Local read-only production checks confirm OpenClaw 2026.6.11 at pinned source
  `a1063aa`, valid configuration, a reachable loopback gateway, a healthy event
  loop, the exact deadline implementation in the installed bundle, and a
  running iMessage account with no last error.

### Rollout and rollback

Production rollout uses
`docs/openclaw-setup/patches/apply-and-deploy.sh` from a reviewed Puddles
`main` worktree with `OPENCLAW_SRC` pinned to the approved OpenClaw checkout.
`MINI_HOST` was unset for local deployment. The absolute-deadline correction was
deployed from disposable worktrees pinned to merged Puddles `a7e13fe` and
OpenClaw `a1063aa`; all five reviewed patches applied, the package and browser
image rebuilt, and the gateway restarted. Automated validation remained
read-only and all disposable worktrees were removed. Cole's review action is the
documented question-plus-link smoke test.

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
  missing standalone-timeout coverage. Both were hardened before promotion.
- A fresh independent review of the hardened complete feature diff at `e2f5ce3`
  found no actionable high-confidence defects. Residual automated boundaries are
  the real debouncer timer implementation and the final Messages.app smoke test.
- After review bookkeeping, the exact promotion commit `1e8fdaa` passed the
  complete lifecycle again and a second fresh independent review found no
  actionable high-confidence defects.
- Pull request #34 merged as `a4bde1f`; the first Integration run on that exact
  `main` commit passed.
- A third fresh independent review of the exact PR commit `691010e` found no
  actionable high-confidence defects before merge.
- Cole reopened the task after the deployed question-plus-link smoke still
  split, with an observed longer delay for links than images. Fresh validation
  and independent review are required after the timing correction.
- The timing-correction review found that repeated eligible rows could restart
  the generic trailing-debounce timer and that the measured-gap regression used
  a mock rather than the real clock. The implementation now preserves the first
  absolute deadline, both real-timer regressions pass, and the complete lifecycle
  is green.
- A fresh replacement reviewer re-checked the complete corrected diff and found
  no actionable high-confidence defects. Remaining validation boundaries are the
  final live Messages.app smoke and transport reconnect/teardown races not
  exercised by the real-debouncer fake-clock tests.
- A terminal fresh reviewer found no actionable high-confidence defects in exact
  commit `8353a3e747b568085242f0410b648bbd39f5b088`. Pull-request checks passed
  before merge.

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
- [x] Obtain a clean independent review of the complete correction diff.
- [x] Narrow the heuristic so common deictic questions remain immediate.
- [x] Cover standalone held-question timeout and policy behavior.
- [x] Rerun the complete cumulative lifecycle after review hardening.
- [x] Merge the correction and confirm the cumulative workflow on `main`.
- [x] Deploy through the approved lifecycle and validate production read-only.
- [x] Return issue #28 and Todoist to Ready for review.
- [x] Correlate the second post-deployment link smoke by row and dispatch time.
- [x] Add a regression for the measured link-preview delay boundary.
- [x] Correct only the bounded payload-referential link timing path.
- [x] Rerun focused tests after the timing correction.
- [x] Rerun the complete cumulative lifecycle after review correction.
- [x] Obtain a clean independent review of the complete timing correction.
- [x] Merge the timing correction and verify the exact `main` Integration run.
- [x] Deploy locally and validate production read-only.
- [x] Document the Ready for review handoff for issue #28 and Todoist.
