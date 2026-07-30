# Coalesce split iMessage message parts

- **Status:** In progress - landing final reviewed reconciliation
- **Issue:** https://github.com/coletaylor788/puddles/issues/28
- **Last updated:** 2026-07-30
- **Owner:** Cole Taylor

## Human design

### Problem

Messages.app can emit one composition as separate text, link-preview, image, and
trailing-text rows. The sandwich correction is landed and tested. Its original
local promotion temporarily replaced the combined `2026.7.1-2` runtime with an
unmarked source package reporting `2026.7.1`, so later promotion guards could
not prove the installed patch stack. Recovery restored the exact predecessor,
and a first marker-aware promotion correctly rolled back when its required
public pull-request tuple changed. The stable reviewed tuple has now promoted
the complete combined runtime with a durable patchset marker and the sandwich
continuation state machine, and both exact candidates have landed. Production
is healthy; only final plan landing and tracker reconciliation remain.

### Outcome

Eligible same-sender direct-message text, payload, and trailing-text rows from
one composition become one logical inbound turn across observed Messages.app
latencies. Production also exposes a durable identity accepted by combined
promotion guards. Reconciliation first restored the prior marked package from
recovery snapshot `20260730T042702Z-32096` without changing cron state or
delivering messages, then promoted the exact reviewed combined tuple with
recovery snapshot `20260730T084333Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`.
Public candidate `5b771f91...` landed as `ceff0eba...`, private candidate
`d97c1b30...` landed as `95bfe75f...`, and production was rechecked read-only.
Completion lands this reviewed final plan and synchronizes the trackers. Any future tuple
drift or failed runtime check must use the retained snapshot and reviewed
rollback path rather than bypassing lifecycle guards.

### Approach

Keep a matched lead-in and link buffered until the lead-in's existing absolute
deadline instead of flushing at link arrival. Admit trailing text only when its
`reply_to_guid` continues the pending payload chain and its source timestamp is
within one second of that payload; production history shows split composition
parts under 425 ms while unrelated replies are much later. A non-matching row
bypasses the held bucket and retains its existing separate-message behavior.
Reproduce the exact delayed notification through the real inbound debouncer,
expose it through cumulative `packages/e2e`, and deploy only through the
documented local wrapper. Package the source candidate with the repository's
native pnpm tooling so workspace dependencies become installable release
versions, and make the rollback artifact independently installable before the
gateway is stopped. Exercise both successful rollback normalization and the
fail-closed path when an installed workspace dependency cannot be resolved. For
this incident, the retained `2026.7.1-2` tarball and service snapshot were
validated, recovery was serialized through the existing deployment lock and
lifecycle boundaries, and current runtime/cron data were preserved. The
dependent combined lifecycle installs `PUDDLES_PATCHSET.json` only while its
exact reviewed public and private landing tuple remains stable; tuple drift
rolls back to the predecessor and requires repeated validation/review. Its test
lifecycle builds after patch application and validates the exact frozen staged
package so stale artifact assertions fail before promotion. Final checks verify
the marker, installed sandwich continuation state machine, package/service
identity, gateway health, iMessage connectivity, unchanged cron hash, and
absent deployment lock without delivering messages.

### Safety and rollout

The behavior remains opt-in, sender/conversation scoped, size bounded, and
fail-open when no safe key exists. Any post-payload hold must be narrowly
eligible, require both an explicit reply chain and a one-second source-time
bound, preserve the first absolute deadline, and have regressions for unrelated
text and timeout dispatch. Automated tests use temporary worktrees and deny
delivery; production investigation remains read-only. On the target host,
`MINI_HOST` stays unset. Rollback disables coalescing or redeploys the prior
reviewed patch stack. Promotion rejects candidate or rollback tarballs that
retain `workspace:` dependency protocols or cannot be normalized before
stopping the gateway. Recovery must not restore the old runtime-state clone
because doing so could rewind cron or other post-snapshot state; only the
validated prior package and matching service definition may be restored while
the gateway is safely quiesced. The combined lifecycle retains the same target
lock and atomic rollback guards. Automated checks remain read-only and must not
deliver messages. All retained snapshots remain available if landing or
post-landing checks fail. Only the exact reviewed and promoted public/private
tuple could land; both merge commits and public post-merge workflows now
provide the durable repository identity for the installed marker.

## Agent details

### State

Read-only correlation found rows 7071/7072/7073 created at 00:24:16.206Z,
00:24:21.554Z, and 00:24:21.668Z with an exact reply chain. The URL started a
turn at 00:24:22Z, while the trailing row started a second turn at 00:24:30Z.
The correction retains a matched payload through the first absolute deadline
and admits only bounded exact-chain continuations. The implementation,
packaging, rollback, cumulative integration, and exact frozen combined graph
passed their focused, full-lifecycle, reusable, terminal, and remote checks.
Recovery first restored the safe `2026.7.1-2 (0790d9f)` predecessor from
`20260730T042702Z-32096`; a transient marker-aware promotion then rolled back
when its public tuple moved. Stable public candidate `5b771f91...` and private
candidate `d97c1b30...` subsequently passed full combined validation and terminal
review. Their atomic promotion created snapshot
`20260730T084333Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c` and installed marker
deployment `8491ddf6-668b-487d-8623-7c7dff0a0e31`, SHA-256
`c48b5745394a3bc697b3b9bc5c8d5e29bcd0746acdcd295ae8f6cda9234789c8`.
The marker identifies all six public and both private patches. Package, CLI,
gateway, and plist report `2026.7.1-2 (0790d9f)`; the installed bundle contains
`isIMessageSplitContinuation` and `dmCoalescePayloadStateByKey`; configuration
is valid; the gateway is loaded, running, reachable, and healthy; iMessage is
configured, running, and working; the cron-tree SHA-256 remains
`ec493dd79dc7fdcf8b4ca12087d2322934da7cd2a92eb46490c3342f5a0f1279`; and the
deployment lock is absent. Private PR #6 landed as
`95bfe75f342ad1c2959d956ca4f4221627ce9a10` and public PR #48 landed as
`ceff0eba07b6f7644a7fea95eded87a4bcc2801b`; Integration run `30528271011` and
CodeQL run `30528271254` passed on the exact public merge.

### Scope and acceptance criteria

- Near-simultaneous lead-in text plus a standalone URL preview from the same
  account, direct conversation, and sender dispatches as one logical turn.
- Lead-in text, a URL-preview row, and trailing text from one Messages.app
  composition dispatch as one logical turn in source order.
- The exact 5.348-second lead-in-to-link gap, 114 ms link-to-trailing source gap,
  and delayed trailing notification run through the real inbound debouncer.
- The production event shape observed around the reported link test is covered
  by a committed regression and produces one logical inbound turn.
- The latest post-deployment failure is correlated by row and runtime-start
  time, and its 12.4-second boundary is covered by a committed regression.
- The third post-deployment failure is correlated by Messages row and agent-run
  timing, proving classifier bypass rather than delayed URL-preview arrival.
- Short payload-referential questions may wait for the bounded split-send
  window needed for observed URL previews; unrelated complete questions remain
  immediate.
- Lead-in text plus a real image attachment dispatches as one logical turn.
- Rapid but genuinely separate short text messages remain separate turns.
- A text message sent after a completed text-plus-link composition remains a
  separate turn when it is outside the observed composition boundary.
- Complete URL-bearing prose, control commands, reactions, outgoing echoes, and
  group messages preserve immediate behavior.
- Control commands remain immediate even when their source row also carries
  media; they never join held conversational text.
- Invalid conversation anchors fail open instead of sharing pending state.
- Replay GUID handling and recovery, catchup, and cursor ordering remain safe.
- Coalescing stays opt-in and requires attachment ingestion for image context.
- Every maintained OpenClaw patch regression is committed, mapped, and run by
  the cumulative shared integration lifecycle.
- Local deployment uses no SSH; remote deployment occurs only with an explicit
  approved `MINI_HOST`.
- Production runs a reviewed `main` artifact with valid configuration and a
  healthy iMessage provider.
- Production package, CLI, gateway, and service identities agree on the durable
  predecessor version marker `2026.7.1-2`; the combined preflight accepts that
  pre-marker package without `PUDDLES_PATCHSET.json`.
- Final production contains the bounded sandwich continuation state machine and
  a patchset marker tied to the exact landed public/private candidates.
- Recovery leaves current cron, runtime configuration, and message state
  unchanged and performs no message delivery.

### Architecture and decisions

- Reuse `channels.imessage.coalesceSameSenderDms` and the existing bounded
  split-send window rather than adding configuration.
- Hold a payload through the existing first absolute deadline only when it joins
  an eligible lead-in. Standalone payloads remain immediate.
- Resolve that deadline from explicit positive inbound timing when configured;
  explicit zero remains immediate, and only the default compatibility path
  upgrades payload-referential lead-ins to 15 seconds.
- Treat a following row as composition continuation only when it has the same
  safe key, replies to the pending payload or continuation GUID, has parseable
  source timestamps, and was created zero to 1,000 ms afterward. Update the
  continuation anchor for another explicitly chained part without extending the
  deadline.
- Once a payload has joined a lead-in, another payload may retain that deadline
  only by satisfying the same continuation chain. An unchained payload flushes
  the pending composition and dispatches separately without inheriting its wait.
- Record that a payload joined independently of whether its GUID and timestamp
  can anchor a continuation. Missing or malformed metadata disables continuation
  admission but cannot let a later lead-in or payload reuse the old deadline.
- Pack the candidate with pnpm so workspace dependency protocols are rewritten
  to concrete installable versions. Clone and normalize any workspace
  dependencies in the installed-package rollback snapshot before npm packing,
  then validate both tarball manifests before stopping the gateway.
- Treat package/service version disagreement as an invalid promotion even when
  gateway health is green. A `2026.7.1-2` predecessor without
  `PUDDLES_PATCHSET.json` remains valid because the reviewed combined preflight
  requires the exact version, not a predecessor patchset manifest.
- Reuse the deployment lock, gateway stop/readiness bounds, validated recovery
  tarball, and retained plist rather than copying an ad hoc build. Do not restore
  the runtime-state clone during this reconciliation because that would rewind
  unrelated post-snapshot state, including cron.
- A new lead-in after a pending payload flushes the prior composition and starts
  a fresh absolute deadline so back-to-back sandwich compositions retain their
  own continuations.
- Base link classification on the observed normalized inbound shape rather than
  assuming Messages.app always emits a standalone URL row.
- Never promote structurally excluded non-URL balloons into continuations, even
  when they are quickly reply-chained.
- Also hold question-terminated prompts of at most eight words only when they
  contain an explicit deictic reference plus a payload noun, or match the narrow
  “how/what about this one?” comparison shape. Do not hold common unrelated
  questions or complete URL-bearing prose.
- Treat a punctuationless final clause as referential only when it starts with a
  narrow interrogative, remains at most eight words, and contains the existing
  deictic plus payload-kind or comparison signals.
- Preserve the existing terminal whole-question and punctuationless
  final-sentence candidate for deictic matching. Use a separate final
  comma-delimited candidate for `what is/what's the <payload noun>` only when
  preceding setup contains a Unicode letter or number and ends in
  comma-plus-whitespace; support straight and curly apostrophes.
- Use a 15-second absolute deadline only for payload-referential lead-ins.
  Preserve the first pending deadline when later eligible rows arrive, keep the
  existing seven-second compatibility deadline for short unfinished captions,
  and do not widen ordinary text batching.
- Treat a deadline as closed once wall time reaches it even if its timer callback
  is delayed; flush the overdue bucket before enqueueing a later row.
- A non-matching or control row retains its existing immediate behavior and does
  not join the pending composition.
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
- Third reopened correction: evaluate a final comma-delimited clause through the
  existing narrow payload-question guards. Permit `what is/what's the <payload
  noun>` only when a preceding setup clause is present, so `New test, what's the
  link` receives the bounded referential hold while a standalone punctuated
  question and ordinary complete prose remain instant. A punctuationless
  three-word standalone question retains the pre-existing seven-second caption
  fallback rather than being upgraded to 15 seconds.
- The clean pinned fixture implements the exact production prompt,
  `Okay you failed. New test, what’s the link`, adds its 669 ms row timing to the
  monitor table, and runs the same prompt through the real debouncer while
  retaining the prior long-gap timing boundary.
- The complete source patch was regenerated from that fixture, normalized only
  for patch-file whitespace, applied to a second pinned fixture, and reproduced
  all four patched source and test files byte-for-byte.
- Review remediation requires lexical setup before the definite-payload
  exception; punctuation-only delimiter prefixes remain ordinary standalone
  questions.
- Terminal-review remediation additionally requires the lexical prefix to end
  in comma-plus-whitespace, so period and exclamation sentence boundaries do
  not activate the definite-payload exception.
- Final terminal remediation separates candidates so comma parsing cannot
  remove the payload noun from existing deictic questions such as
  `Check this link, is that the one?`.
- Exact-timing remediation parameterizes the real-debouncer regression for the
  669 ms comma-delimited production shape and the prior 12.416-second
  punctuationless shape, using distinct row IDs that preserve replay ordering.
- Fourth reopened correction: correlate Cole's successful text-plus-link prefix
  and separately delivered trailing text, reproduce the exact three-row order
  through the real debouncer, and change only the demonstrated premature-flush
  boundary.
- Correlation identified rows 7071/7072/7073 as an explicit reply chain. The URL
  and trailing text were adjacent and created 114 ms apart, but the current
  `enqueueInboundEntry` flushes every payload immediately, before the delayed
  trailing notification can join.
- The implementation retains a matched payload until the existing first
  deadline, classifies only reply-chained source-time-bounded rows as
  continuations, merges contiguous lead-in/payload/continuation units, and
  leaves standalone payloads and non-matching rows immediate.
- Deployment remediation switches the source candidate to lifecycle-disabled
  `pnpm pack`, validates that its manifest has no workspace protocols, rewrites
  workspace dependencies in the npm-packed rollback artifact from the installed
  dependency versions, and validates that artifact before stopping the gateway.
- Review remediation adds a deployment-harness variant with a missing installed
  workspace dependency manifest and requires the wrapper to fail before any
  launchd or package mutation. The variant uses the same real tarball path as
  successful normalization rather than mocking the helper result.
- Production reconciliation validates the retained prior package and service
  snapshot, determines the marker contract used by subsequent combined
  promotion guards, and restores a guard-compatible identity through serialized
  recovery without changing cron or delivering messages.
- Final rollout updates the combined manifest to a stable current public
  candidate, reruns the complete frozen-graph lifecycle and reviews, promotes
  atomically, verifies sandwich symbols and health read-only, then lands only
  the exact promoted public/private tuple.

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
- Cole's first manual question-plus-link smoke after that deployment failed.
  Read-only correlation identified the comma-clause classifier bypass.
- The corrected focused coalescer and monitor suites pass all 73 tests. Coverage
  includes the exact curly-apostrophe prompt, the 669 ms URL-preview timing,
  the real debouncer, standalone punctuated questions, and unrelated comma
  clauses.
- The exported patch applies cleanly to pinned OpenClaw `a1063aa` and its four
  outputs match the focused-test fixture byte-for-byte.
- The third-correction managed lifecycle passes repository build and lint, 238
  workspace tests, 297 cumulative mapped OpenClaw tests, one isolated
  browser-entrypoint candidate test, and candidate deregistration.
- After review remediation, the 73 focused tests pass again, including
  punctuation-only comma and sentence-delimiter prefixes. The regenerated patch
  reapplies cleanly and reproduces all four fixture files byte-for-byte.
- The post-remediation managed lifecycle passes repository build and lint, 238
  workspace tests, 297 cumulative mapped OpenClaw tests, one isolated candidate
  test, and candidate deregistration.
- Both disposable pinned fixtures used to generate and verify the source patch
  were removed and OpenClaw worktree registrations pruned.
- After terminal-review remediation, all 73 focused tests pass again, including
  lexical period and exclamation prefix exclusions. The regenerated patch
  reapplies cleanly and reproduces all four fixture files byte-for-byte.
- The terminal-remediation managed lifecycle passes repository build and lint,
  238 workspace tests, 297 cumulative mapped OpenClaw tests, one isolated
  candidate test, and candidate deregistration.
- After separating classifier candidates, all 73 focused tests pass, including
  `Check this link, is that the one?`, while the exact production prompt and all
  comma-boundary exclusions remain green. The regenerated patch reapplies
  cleanly and reproduces all four files byte-for-byte.
- The separated-candidate managed lifecycle passes repository build and lint,
  238 workspace tests, 297 cumulative mapped OpenClaw tests, one isolated
  candidate test, and candidate deregistration.
- Fresh independent review verified the full diff, classifier semantics, patch
  pre/postimage hashes, pinned preimages, test mapping, and documentation with
  no actionable high-confidence findings. Residual validation gaps remain the
  final post-deployment Messages.app smoke and transport reconnect/teardown
  races not exercised by source-level notification mocks.
- The final separated-candidate fixtures were removed and OpenClaw worktree
  registrations pruned.
- PR #38 passed all CodeQL checks at exact reviewed commit `b99bff1f`, but
  GitHub reports the branch conflicts with current `main`.
- Current `main` merged as `c61294b`; the synchronized managed lifecycle passes
  repository build and lint, 238 workspace tests, 297 cumulative mapped
  OpenClaw tests, one isolated candidate test, and candidate deregistration.
- Exact-timing focused suites pass all 74 tests. Both observed gaps advance the
  real fake clock, remain undispatched before payload arrival, and produce one
  merged dispatch. The regenerated patch reapplies cleanly and reproduces all
  four files byte-for-byte.
- The exact-timing managed lifecycle passes repository build and lint, 238
  workspace tests, 298 cumulative mapped OpenClaw tests, one isolated candidate
  test, and candidate deregistration.
- Fresh independent review verified current-main ancestry, merge resolution,
  both real-debouncer timing paths, cursor/replay ordering, mapped test
  discovery, and clean patch application with no actionable high-confidence
  findings. Residual validation gaps remain the final post-deployment
  Messages.app smoke and RPC reconnect/teardown races outside source-level
  notification mocks.
- The final real-timer fixtures were removed and OpenClaw worktree registrations
  pruned.
- A fresh independent reviewer verified patch preimages, clean application,
  mapped test discovery, and the complete comma-boundary remediation with no
  actionable high-confidence findings. Residual validation gaps are the final
  post-deployment Messages.app smoke and transport reconnect/teardown races not
  exercised by source-level notification mocks.
- PR #38 merged as `e82db0e6441496f06acae4dd066804ef7d526c14`.
  Integration run `30222444716` and CodeQL run `30222444475` passed on that
  exact `main` commit.
- The local deployment wrapper completed from clean disposable Puddles and
  OpenClaw worktrees pinned to `e82db0e` and `a1063aa`. It applied all five
  patches, built and installed OpenClaw, ran doctor, restarted the gateway,
  rebuilt the browser image, and recreated the browser-agent runtime. The
  read-only production checks passed: OpenClaw reports `2026.6.11 (a1063aa)`,
  the active config is valid, the loopback gateway is reachable and active, the
  event loop is not degraded, iMessage is running with no last error, both
  coalescing and attachment ingestion are enabled, and the installed bundle
  contains the separate referential/definite candidates plus the 15-second
  referential deadline.
- Both disposable deployment worktrees were removed, their registrations were
  pruned, and the temporary Corepack shim was deleted.
- PR #39 publishes this plan-only rollout closeout. Its cumulative Integration
  and CodeQL pull-request checks passed.
- The fourth production sandwich shape has not yet been correlated or reproduced;
  focused and cumulative validation must be rerun after the evidence-driven fix.
- Read-only production correlation confirms the first transcript turn contained
  rows 7071/7072 and the second contained row 7073. The first agent pipeline
  started at 00:24:22Z and the second at 00:24:30Z. The source rows provide both
  exact timestamps and a 7071 -> 7072 -> 7073 `reply_to_guid` chain.
- The pinned fixture now keeps only matched lead-in/payload pairs through their
  existing first deadline and admits continuations only through an exact reply
  chain with a zero-to-1,000 ms source-time gap. The observed delayed
  text-link-text sequence produces one dispatch through the real debouncer.
- All 87 focused coalescer and monitor tests pass. The regenerated patch applies
  with the complete six-patch stack to a second clean pinned fixture, and all
  four iMessage outputs reproduce byte-for-byte. The monitor coverage includes
  a joined payload with no GUID and a malformed timestamp, proving that the next
  composition gets a fresh bucket while the malformed row cannot anchor a
  continuation.
- The complete managed lifecycle passes repository build and lint, 281 workspace
  tests, 332 cumulative mapped OpenClaw tests, one isolated browser-entrypoint
  candidate test, and candidate deregistration.
- The complete six-patch stack now applies to production OpenClaw
  `2026.7.1-2 (0790d9f)`. The only incompatible preimage was unrelated comparison
  context in the yield patch; narrowing that hunk without changing its code
  makes it apply to both the pinned and production releases. All 336 mapped
  source tests pass on the production release, including the 87 iMessage tests.
- After the portability-only patch-hunk change, the complete pinned-release
  managed lifecycle passes again with the same build, lint, 280 workspace-test,
  332 mapped-source-test, candidate-test, and cleanup coverage after the
  metadata-safe payload-state remediation and synchronization with current
  `main`.
- The deployment fixture now rejects an unresolved candidate workspace
  dependency before package installation or gateway shutdown and proves a
  normalized rollback tarball can reinstall. All 34 deployment-topology tests
  and E2E type checking pass. Real isolated-prefix installs also pass for both
  pnpm-packed candidate and normalized prior-package tarballs.
- After packaging remediation, the complete managed lifecycle passes build,
  lint, 281 workspace tests, 332 mapped OpenClaw tests, the isolated candidate
  test, and worktree cleanup.
- The fresh packaging-remediation review reran all 34 deployment-topology tests
  and found one actionable coverage gap: rollback normalization failure was not
  driven through the integration harness.
- The accepted review regression passes with 35 deployment-topology tests, all
  66 isolated E2E workspace tests, and E2E TypeScript checking. It proves a
  missing installed workspace dependency manifest exits before `launchctl
  bootout` or `npm install -g`.
- The complete post-review managed lifecycle passes build and lint, 282
  workspace tests, 332 mapped OpenClaw tests, the isolated candidate test, and
  worktree cleanup.
- The fresh replacement reviewer independently reapplied the iMessage patch,
  passed all 87 focused tests, passed all 35 deployment-topology tests, all 66
  isolated E2E tests, E2E type checking, and all 282 workspace tests, and found
  no actionable high-confidence defects.
- Exact candidate `af5bdf2` passed terminal review, pull-request Integration,
  and all CodeQL checks. PR #51 merged as `863666f`; Integration and CodeQL
  passed again on that exact `main` commit.
- Local promotion from clean OpenClaw `0790d9f` recorded recovery snapshot
  `20260730T042702Z-32096`, applied all six patches, built and installed the
  candidate, migrated state, rebuilt the browser image, restarted the gateway,
  and passed readiness.
- Post-landing read-only checks confirm source revision `0790d9f`, valid
  configuration, a loaded service, healthy gateway, configured/running
  iMessage, concrete installed package dependencies, and the bounded
  continuation logic in the installed bundle.
- The corrected plan-only closeout passed terminal review and pull-request
  checks, merged as `c873bb0`, and passed Integration and CodeQL on that exact
  `main` commit.
- The final Ready for review plan state passed terminal review and pull-request
  checks, merged as `f7a049a`, and passed Integration and CodeQL on that exact
  `main` commit. Issue #28 was set to Ready for review, and Todoist received the
  signed result comment before `agent` was replaced with `ready_for_review`.
- Reconciliation evidence: live CLI/package version is `2026.7.1` at source
  `0790d9f`; `PUDDLES_PATCHSET.json` is absent; the loaded plist comment remains
  `OpenClaw Gateway (v2026.7.1-2)`; gateway health passes and iMessage is
  configured/running. Snapshot `20260730T042702Z-32096` contains normalized
  `openclaw-2026.7.1-2.tgz` with concrete `@openclaw/ai` version `2026.7.1` and
  the matching service plist.
- The target recovery path acquired the deployment lock, created safety snapshot
  `20260730T063203Z-51528`, installed the retained package, preserved the live
  plist, and passed readiness. Before/after configuration SHA-256 remained
  `5cbd61ceb8181d1f49a960aab01e2fed2f9a1c71f9ab8858702359c425de4ff3`;
  cron-tree SHA-256 remained
  `ec493dd79dc7fdcf8b4ca12087d2322934da7cd2a92eb46490c3342f5a0f1279`.
  CLI/gateway now report `2026.7.1-2 (0790d9f)`, config is valid, the service is
  loaded/running, connectivity is OK, and iMessage is running.
- The first combined retry recorded snapshot
  `20260730T063718Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c` and failed its
  pre-swap validator with `installed guard artifact is missing: Required for
  scheduled/cron callers`. Automatic rollback restored the prior package,
  configuration, browser entrypoint, and healthy gateway. The same configuration
  and cron-tree hashes remain unchanged.
- The corrected combined lifecycle passed its full frozen-graph validation,
  retained review, and terminal review, then temporarily promoted atomically
  with recovery snapshot
  `20260730T071847Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`.
  Its candidate marker recorded deployment
  `ff7bd5fc-c2b9-4878-9053-1a1f8d62ad85`, all six public patches, and both
  combined private patches. Marker SHA-256 is
  `afc128c50526cd0a9572cd1e3cf87c9ed5c559c50ca55d7a511d493117cd02be`.
  The public head then changed before landing, so the lifecycle atomically
  restored the exact predecessor. Current package, CLI, gateway, and plist report
  `2026.7.1-2 (0790d9f)` with no `PUDDLES_PATCHSET.json`; configuration is valid,
  the service is loaded/running, gateway connectivity is OK, iMessage is
  configured/running, the deployment lock is absent, and cron-tree SHA-256 remains
  `ec493dd79dc7fdcf8b4ca12087d2322934da7cd2a92eb46490c3342f5a0f1279`.
- Current installed-bundle inspection does not find the sandwich continuation
  symbols present in the rolled-back source candidate, proving final combined
  promotion remains required rather than treating healthy predecessor recovery
  as feature completion.
- Stable public candidate `5b771f91b9c949c8752b29b2c16c004bb5e2a8ce`
  against base `6dc4e03c5b1a79ff682e76ad7eea8a6348ef4456` passed Integration
  and CodeQL. Private candidate `d97c1b30dadad688f036844dc2cd66ae95203e1a`
  against base `5293f1161a75587bd38d7e1cc8a11d517499fb69` passed full combined
  validation and terminal review.
- Atomic promotion recorded recovery snapshot
  `20260730T084333Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c` and installed
  deployment marker `8491ddf6-668b-487d-8623-7c7dff0a0e31`, SHA-256
  `c48b5745394a3bc697b3b9bc5c8d5e29bcd0746acdcd295ae8f6cda9234789c8`.
  The marker contains all six public and both private patch IDs. Read-only
  inspection finds `isIMessageSplitContinuation` and
  `dmCoalescePayloadStateByKey` in the installed bundle.
- Post-promotion checks report package, CLI, gateway, and plist identity
  `2026.7.1-2 (0790d9f)`; valid configuration; loaded/running gateway with
  successful connectivity and health probes; configured/running/working
  iMessage; unchanged cron-tree SHA-256
  `ec493dd79dc7fdcf8b4ca12087d2322934da7cd2a92eb46490c3342f5a0f1279`;
  and no deployment lock.
- Exact private candidate `d97c1b30...` merged as `95bfe75f...`, followed by
  exact public candidate `5b771f91...` as `ceff0eba...`. The public merge's
  Integration run `30528271011` and CodeQL run `30528271254` passed.
  Post-landing production checks returned the same marker, installed sandwich
  symbols, healthy gateway/iMessage state, unchanged cron hash, and absent lock.

### Rollout and rollback

The sandwich rollout used
`docs/openclaw-setup/patches/apply-and-deploy.sh` with `MINI_HOST` unset and
`OPENCLAW_SRC` pinned to clean OpenClaw `0790d9f`. The wrapper applied all six
patches, produced and validated installable candidate and rollback tarballs,
recorded recovery snapshot `20260730T042702Z-32096`, installed the candidate,
migrated state, rebuilt the browser image, restarted the gateway, and passed
readiness. Automated production validation remained read-only and did not
deliver messages. The disposable promotion worktrees and temporary package
manager shims were removed. No data migration or persistent message-state
conversion is involved.

That lifecycle intentionally completed, but its source tarball reported
`2026.7.1` and omitted a durable patchset marker. Reconciliation used the exact
serialized target path with recovery tarball
`20260730T042702Z-32096/openclaw-2026.7.1-2.tgz`, preserved current runtime state
and the matching plist, and created safety snapshot
`20260730T063203Z-51528`. The prior `2026.7.1-2` runtime is healthy and satisfies
the combined lifecycle's precondition, but it predates `PUDDLES_PATCHSET.json`.
The first reviewed combined retry failed candidate validation before package
swap and rolled back cleanly. The lifecycle was corrected so its test path
builds after applying patches and validates the exact frozen staged package with
the production validator. A first corrected promotion recorded snapshot
`20260730T071847Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`, then rolled back
when the public head changed. The stable replacement tuple repeated full
validation and terminal review before atomic promotion recorded snapshot
`20260730T084333Z-0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`. Production now
runs marked deployment `8491ddf6-668b-487d-8623-7c7dff0a0e31` with all expected
patch IDs and the installed sandwich state machine. Read-only checks preserve
the cron tree and confirm valid config, healthy gateway connectivity, working
iMessage, and an absent deployment lock. Exact private and public candidates
then landed as `95bfe75f...` and `ceff0eba...`; public post-merge Integration and
CodeQL passed, and repeated production checks returned the same healthy marked
runtime.

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
- Cole reopened the task after the reviewed and deployed absolute-deadline
  correction still failed a live link smoke. A fresh complete-diff review is
  required after the next evidence-driven correction.
- The third-correction reviewer found that a length-only setup check accepted
  punctuation-only prefixes. The accepted correction requires a Unicode letter
  or number before the final clause and adds direct negative regressions.
- The original completed reviewer cannot be resumed through the available agent
  interface; a fresh independent replacement must review the complete
  post-remediation diff.
- The fresh replacement reviewer verified the complete remediated diff,
  including Unicode-regex runtime support, test discovery, and the four-file
  OpenClaw patch, and found no actionable high-confidence defects. The residual
  validation gap is the final live Messages.app smoke after deployment.
- Terminal review of exact commit `c0c233c8060d7f290f9ab8e28383ff5cd83b9ca0`
  found the definite-payload exception accepted lexical setup separated by a
  period or exclamation mark. The accepted correction restricts the exception
  to comma-plus-whitespace and adds both negative regressions.
- Fresh complete-diff review after the comma-boundary fix found no actionable
  high-confidence defects.
- Terminal review of exact commit `d6a6c94a1dc161d356cd8cc454b440c674dc6a84`
  found comma slicing regressed an existing deictic question shape by removing
  its payload noun. The accepted correction preserves the original deictic
  candidate and uses a separate candidate only for the definite-payload
  exception.
- Fresh complete-diff review after separating the candidates found no
  actionable high-confidence defects.
- Terminal fresh review found no actionable high-confidence defects in exact
  commit `b99bff1f42f2fda18c01f1291a0a8a5082272486`.
- Fresh synchronized review found the exact 669 ms gap was only compared with
  the resolved timeout in a monitor mock; the real debouncer still exercised
  only the prior 12.416-second gap. The accepted correction adds a 669 ms
  real-timer case while retaining the long-gap case.
- Fresh complete-diff review after exact real-timer remediation found no
  actionable high-confidence defects.
- Fresh independent review of the complete third correction plus the rollout
  closeout found no actionable high-confidence defects. The remaining manual
  boundary is Cole's final Messages.app question-plus-link smoke.
- Cole's text-link-text smoke reopened the task because the trailing text became
  a second turn. A fresh complete-diff review is required after correlation,
  implementation, and cumulative validation.
- A fresh independent complete-diff review found no actionable
  high-confidence defects. Residual gates are patch portability to production
  OpenClaw 2026.7.1-2, deployment, the live Messages.app smoke, and terminal
  review of the exact handoff commit.
- A later fresh review found explicit nonzero debounce configuration still
  caused matched payloads to flush immediately. The accepted correction derives
  the first absolute deadline from effective explicit timing while preserving
  explicit zero, and runs the exact sandwich through the real debouncer in both
  default and explicit-positive configurations.
- The next fresh review found an unchained second payload could inherit the
  first composition's deadline. The accepted correction makes it flush the
  pending pair and dispatch as a separate immediate turn; a monitor regression
  covers lead-in, chained URL, then unchained URL.
- A subsequent fresh review found media classification could precede control
  detection and merge an attachment-bearing `/stop` into held prose. The
  accepted correction detects non-empty controls independently of media before
  coalescing and proves the command dispatches ahead of a held lead-in.
- The next fresh review found a delayed timer callback could let a payload enter
  after the absolute deadline. The accepted correction clears expired state,
  flushes the overdue bucket before enqueue, and proves the late payload remains
  a separate turn.
- A later review found back-to-back sandwich compositions shared stale state and
  structurally instant balloons could be promoted by reply chaining. The
  accepted corrections start a fresh bucket on a post-payload lead-in and
  exclude all balloon metadata from continuation promotion; both paths have
  monitor regressions.
- The next fresh review found that payload-boundary state existed only when the
  joined payload had valid continuation metadata. The accepted correction always
  records that a payload joined while making its GUID/timestamp continuation
  anchor optional, so malformed metadata cannot admit a continuation or let a
  later composition reuse the old deadline. Focused and production-release
  mapped suites pass 87 and 336 tests respectively after the correction.
- A fresh independent review of the complete metadata-safe diff found no
  actionable high-confidence defects. Residual non-blocking gaps are the final
  live Messages.app sandwich smoke, transport reconnect/teardown races outside
  the source-notification harness, and anchorless RPC-repair ordering.
- After exact commit `8ae2dea` passed a clean terminal review, `main` advanced
  with a stabilization for the pre-existing 15-second debounce assertion and the
  pull request became conflicting. The synchronized patch preserves the
  sandwich implementation and adopts the stabilization's bounded timing
  assertion. Focused, cumulative, portability, byte-reproduction, and
  production-release mapped validation all pass again; fresh reusable-worker and
  terminal reviews remain required before promotion.
- A fresh reusable-worker review of exact synchronized commit `8b03058` found no
  actionable high-confidence defects. It confirmed the conflict resolution
  preserved both the current-main debounce assertion stabilization and the full
  sandwich state machine. The final exact landing candidate still requires a
  terminal fresh review.
- Exact candidate `7ae3f32` passed terminal review and all remote checks.
  Promotion built and packed successfully, but the local npm package install
  failed. Reinstalling the recorded previous package also failed, so the wrapper
  safely left the gateway stopped and retained recovery state at
  `~/.openclaw-deploy-backups/20260730T032244Z-89073`. Production recovery is the
  immediate priority; this failed promotion did not reach merge.
- Recovery verified that the prior `2026.7.1-2` package, runtime config, and
  service definition matched the retained snapshot, then restarted the gateway
  to a healthy iMessage state. The deterministic install failure came from
  `npm pack` preserving `@openclaw/ai: workspace:*`; npm 10 exits during
  dependency resolution, and the same invalid protocol made the rollback
  tarball un-installable. A pnpm-packed candidate and a normalized pnpm-packed
  prior package both install successfully in isolated prefixes.
- A fresh complete-diff packaging review found no implementation defect but
  required a regression proving an unresolved dependency in the prior installed
  package aborts rollback normalization before gateway shutdown. That accepted
  finding is fixed and the complete cumulative lifecycle is green.
- A fresh independent replacement rechecked the complete current diff and found
  no actionable high-confidence defects. Residual non-blocking gaps are the
  final live Messages.app sandwich smoke and transport reconnect/teardown races
  outside the source-notification harness.
- A fresh terminal reviewer independently verified exact immutable candidate
  `af5bdf2`, including 87 focused iMessage tests, 35 deployment tests, 282
  workspace tests, 332 mapped tests, real pnpm packaging, and production-release
  assumptions, with no actionable high-confidence findings.
- Review of the first plan-closeout commit found its checklist prematurely
  implied that the issue and Todoist handoff had already occurred. The issue
  ledger was synchronized, and the checklist now records only preparation of
  the final handoff; the Todoist result and label mutation remain the last
  external step after this plan is visible on `main`.
- A fresh replacement reviewer found no actionable high-confidence findings in
  corrected closeout `d8b73e3`. It verified the plan schema, issue/Todoist state,
  merge and workflow evidence, recovery snapshot, installed version, running
  gateway, and six-patch stack before the closeout merged as `c873bb0`.
- A fresh terminal reviewer found no actionable high-confidence findings in
  final plan-state commit `74a92bb` before it merged as `f7a049a`.
- A later combined promotion detected an identity invariant that the reviewed
  lifecycle did not enforce: the installed source package lost the prior
  combined-runtime suffix and has no patchset manifest. Reconciliation review
  must verify the chosen recovery path preserves runtime/cron state and leaves a
  durable marker accepted by subsequent promotion guards.
- The first combined retry exposed a second fail-closed lifecycle gap: combined
  CI did not validate the exact post-patch frozen graph used by production.
  Retry requires full combined validation and independent review after that
  lifecycle is corrected.
- The corrected combined candidate passed complete frozen-graph validation,
  clean retained review, and clean terminal exact-commit review before promotion.
- A fresh independent review cross-checked the reconciliation evidence and found
  no initial issue, but the terminal exact-commit review correctly caught that a
  later tuple-drift rollback had removed the transient patchset marker. The plan
  now records the actual restored predecessor rather than the transient state.
  No live delivery smoke was run under the explicit no-delivery constraint.
- Review of that correction found the restored predecessor also lacks the
  sandwich continuation state machine. Healthy rollback is therefore an
  intermediate safety state, not completion; final combined promotion and exact
  tuple landing remain required.
- Stable public head `5b771f91...` and private head `d97c1b30...` passed the
  complete frozen-graph lifecycle and terminal private review. The exact tuple
  promoted successfully, passed independent read-only production checks, landed
  as public merge `ceff0eba...` and private merge `95bfe75f...`, and passed
  repeated production and public post-merge checks. A fresh review of the final
  plan-only reconciliation remains.
- The first final-reconciliation review independently verified the external
  evidence and found one inaccurate marker hash: both plan occurrences omitted
  the digest's final `8`. The accepted correction records the full 64-character
  SHA-256; a fresh replacement review remains required because the diff changed.
- The fresh replacement review independently rechecked the complete
  reconciliation, exact public/private merge commits, post-merge workflows,
  marker contents and hash, snapshot, installed symbols, health, cron hash, and
  lock state. It found no actionable high-confidence defects. The remaining
  live Messages.app smoke is intentionally excluded by the no-delivery
  constraint.

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
- [x] Correlate the third failed production link smoke across Messages and
  OpenClaw timing.
- [x] Add a committed real-path regression for the newly observed failure.
- [x] Correct the demonstrated boundary without broadening unrelated batching.
- [x] Rerun the complete cumulative lifecycle after exact real-timer coverage.
- [x] Obtain a clean independent review of the synchronized third correction.
- [x] Merge, verify `main`, deploy locally, and validate production read-only.
- [x] Return issue #28 and Todoist to Ready for review after the third smoke fix.
- [x] Correlate the text-link-text production transcript, Messages rows, and run
  timing.
- [x] Add a committed real-debouncer regression for the exact sandwich sequence.
- [x] Correct the premature payload flush without merging unrelated trailing
  messages.
- [x] Run focused tests and the complete cumulative managed lifecycle.
- [x] Obtain a clean reusable-worker adversarial review after current-main
  synchronization.
- [x] Obtain a clean terminal adversarial review of the exact landing candidate.
- [x] Recover and validate the prior production package, runtime state, service,
  gateway, and iMessage health after the failed promotion.
- [x] Produce and validate installable candidate and rollback tarballs without
  unresolved workspace dependency protocols.
- [x] Add cumulative deployment coverage for workspace-safe packaging.
- [x] Rerun the complete lifecycle after packaging remediation.
- [x] Cover rollback normalization failure before production mutation.
- [x] Repeat reusable-worker and terminal reviews after packaging remediation.
- [x] Promote the exact remotely green candidate, validate production read-only,
  then merge and verify exact `main`.
- [x] Return issue #28 and Todoist to Ready for review after the sandwich fix.
- [x] Confirm the unmarked package, missing patchset manifest, version-mismatched
  plist, retained prior package, and healthy gateway read-only.
- [x] Determine the exact combined-promotion marker contract and select the
  reviewed recovery path.
- [x] Restore the exact prior package identity without changing cron/runtime
  data or delivering messages.
- [x] Prove the combined lifecycle installed its reviewed marker transiently and
  rolled back to the exact predecessor when its landing tuple changed.
- [x] Confirm the first combined retry failed before package swap and restored
  the exact healthy predecessor without changing cron.
- [x] Verify the restored predecessor package/service identity, configuration,
  gateway health, iMessage connectivity, and absence of sandwich symbols
  read-only.
- [x] Revalidate and review the combined stack against a stable current public
  candidate.
- [x] Promote and verify the installed patchset marker and sandwich continuation
  state machine read-only.
- [x] Land only the exact public/private candidates that passed promotion and
  production validation.
- [x] Obtain a clean independent review of the corrected final reconciliation.
- [ ] Land the reconciled plan and report the exact production action and
  recovery artifact to the dependent worker.
