# Coalesce split iMessage message parts

- **Status:** In progress - validation green, terminal review pending
- **Issue:** https://github.com/coletaylor788/puddles/issues/28
- **Last updated:** 2026-07-24
- **Owner:** Cole Taylor

## Human design

### Problem

A single Messages.app composition can arrive as separate text, link-preview, and
attachment rows. Processing each row immediately starts multiple agent turns,
so the first response can lack the link or image context. The fix must not merge
genuinely separate rapid messages or make iMessage delivery less reliable.

### Outcome

Eligible same-sender direct-message parts arriving within the existing bounded
split-send window become one logical inbound turn. Complete messages, commands,
reactions, groups, outgoing echoes, and separate short texts retain their prior
behavior. The deployed channel remains sourced only from reviewed `main`
artifacts, and every maintained OpenClaw patch has visible cumulative integration
coverage.

### Approach

Maintain the provider-neutral OpenClaw source patch against the pinned release.
Hold only short unfinished lead-ins, key pending state by account, valid
conversation anchor, and sender, and append only an immediately following
standalone URL preview or real attachment. Keep focused tests inside the patch
and expose every patch regression through the isolated cumulative
`packages/e2e` runner. Do not drive configured agents or live systems from the
required pool. Deploy only through the documented local-or-explicit-remote
wrapper.

### Safety and rollout

The behavior is opt-in through the existing same-sender DM coalescing setting,
uses bounded text, attachment, row-count, and time limits, and fails open when a
safe conversation key cannot be formed. Automated tests use temporary
worktrees, focused source harnesses, and recording mocks; they never connect to
the configured gateway, send messages, or mutate personal data. On the target
Mac mini, `MINI_HOST` stays unset; only an intentional remote deployment sets
it. Rollback disables coalescing and redeploys the prior reviewed patch stack.
Production validation is read-only except for a user-originated manual smoke
message.

## Agent details

### State

The coalescing implementation, deployment-topology correction, and production
rollout are merged. Production was restored from `origin/main` commit
`162056737e1539998c9db836e2440659ef554e71` after an invalid legacy config and
stale LaunchAgent definition prevented the gateway from restarting. The current
config validates, the 2026.6.11 gateway is healthy, and the iMessage provider and
`imsg rpc` child are running without a reported channel error.

PR #26 adds the missing cumulative integration pool. Its post-`main`-sync
terminal review found four lifecycle gaps. The implementation removes the
unsafe dormant live-agent suite, keeps all required behavior in isolated
workspace, patch, deployment, and candidate tests, runs CI on macOS, and makes
worktree cleanup independent and signal-aware. The revised complete lifecycle
is green; a fresh terminal review remains required before push and merge.

Production smoke validation is complete: a user-originated message received
after the latest restart was processed and answered. The initial reply failure
was caused by Messages.app losing its process-local `imsg` bridge injection;
restoring injection and reconnecting the gateway restored threaded replies.
Production remains stable and is out of scope for the remaining isolated test
infrastructure corrections.

### Scope and acceptance criteria

- Near-simultaneous lead-in text plus a standalone URL preview from the same
  account, direct conversation, and sender dispatches as one logical turn.
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

### Validation

- Original focused OpenClaw validation: 65 coalescer and monitor tests passed,
  covering links, images, separate texts, commands, races, replay, and catchup
  cursors.
- Managed cumulative lifecycle:
  `OPENCLAW_SRC=/Users/puddles/git/openclaw node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Latest post-review run passed repository build and lint, 229 isolated
  workspace tests, 289 mapped OpenClaw tests, and one isolated
  browser-entrypoint candidate test.
- CodeQL JavaScript/TypeScript and Python analyses passed after replacing
  insecure random identifiers and the backtracking fenced-JSON regex.
- Production config validation passes.
- Production health reports the iMessage account enabled, configured, running,
  with no last error, pending restart, or reconnect attempt.
- The installed package contains `buildIMessageDmCoalesceKey`, and a live
  `imsg rpc --json` child is attached to the gateway.
- A user-originated message at 20:53:55 was processed and produced an outbound
  reply at 20:54:09 after bridge injection was restored.
- Cleanup verification found no registered candidate worktree or temporary test
  directory after the managed run.
- Remaining validation: obtain a fresh clean review and confirm the first
  Integration workflow run on `main`.

### Rollout and rollback

Production rollout uses
`docs/openclaw-setup/patches/apply-and-deploy.sh` from a detached Puddles
`main` worktree with `OPENCLAW_SRC` pinned to the local OpenClaw checkout.
`MINI_HOST` is unset on the target Mac mini. The latest recovery rebuilt and
installed the reviewed patch stack, repaired the invalid config with
`openclaw doctor --fix`, installed the current gateway LaunchAgent definition,
and restarted it. Temporary worktrees, package-manager shims, tarballs, and
source diffs were removed afterward.

Rollback:

1. Restore `~/.openclaw/openclaw.json.bak` if config repair must be reverted.
2. Unset `channels.imessage.coalesceSameSenderDms`.
3. Remove the coalescing patch from the reviewed patch list.
4. Rebuild and deploy the prior pinned stack locally with `MINI_HOST` unset.
5. Validate config, gateway health, iMessage probe status, and process state.

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
  passes; a fresh review is pending.
- Production validation observed a successful inbound-to-outbound turn after
  restoring `imsg` bridge injection. Automated delivery remains prohibited.
- A fresh terminal review is required after all four findings are resolved and
  the complete lifecycle passes.

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
- [ ] Obtain and record a clean terminal independent review for the exact
  handoff diff.
- [ ] Push and merge PR #26.
- [ ] Confirm the first cumulative Integration workflow run on `main`.
- [ ] Update issue #28 to Ready for review and complete the Todoist handoff.
