# Fix cron email reader failures

**Status:** Complete and verified in production
**Issue:** [#43](https://github.com/coletaylor788/puddles/issues/43)
**Last updated:** 2026-07-31

## Human section

### Design

The cron scheduler starts main. Main owns the email rules, decisions, archive
actions, and final report. Main starts reader to list and read email. Reader never
labels, archives, or decides what to do.

The last working scheduled runs and the first failing run used the same cron
instructions and the same main model. No repository-managed deployment occurred
between them. The working runs named reader in the first spawn call. The failing
run omitted the target, received an error, then named main. That created a second
main child with the cron job's limited write tools, so it could not read email.

This was an unhandled model-call variation, not a change to the intended
architecture. The scheduler still starts main. The runtime fix applies only to
spawn calls made inside that cron session. When explicit target policy is active,
an omitted target is rejected with usable worker names. A retry that names the
requester is also rejected. A retry that names reader succeeds. Installations
that intentionally need same-agent cron children can opt into that behavior.

The regression replays the exact three-call sequence. It does not assume the
model chooses reader correctly on the first attempt. This closes the gap in the
earlier smoke, which selected reader immediately.

### Status

The design reset, reproduced-path fix, promotion, landing, and post-landing
checks are complete. The reviewed build is running in production. The installed
policy rejects a missing target and an accidental second main child, then accepts
reader. The gateway is healthy, and a fixed no-match email read succeeds.

The cron definition was not changed or run. No message was sent, and no mailbox
content was changed. Production validation called the installed policy directly
instead of driving a live main model turn.

## Agent section

### State

- Public PR #56 and the matching host deployment candidate are merged.
- Both main branches contain the exact reviewed candidates.
- Production runs the reviewed combined patch set.
- The gateway is healthy after landing.
- The rollback snapshot remains available. No rollback was needed.
- The targeted writing-contract suite passes 9 tests.
- The public managed lifecycle and host combined lifecycle pass on the landed
  tuple.

### Scope and acceptance criteria

- Do not edit or run the cron job.
- Do not send messages or mutate Gmail during automated validation.
- Preserve scheduler startup of main.
- Main remains the decision and mutation owner.
- Reader remains the read-only email worker.
- An omitted worker target must fail with usable worker names.
- A retry that names the requester must fail without creating a second main
  child.
- A retry that names reader must succeed with reader Gmail tools.
- `requireAgentId=false` must preserve intentional implicit and explicit
  same-agent cron children.
- Existing ACP command-policy and cross-agent isolation protections must remain.

### Architecture and decisions

- The scheduler launch of main is outside `sessions_spawn`. The new guard does
  not affect scheduler startup.
- The guard applies to `sessions_spawn` calls made by the main cron session.
- Native and ACP paths share the same cron self-target policy.
- Native repair errors list configured non-requester agents.
- ACP repair errors list only candidates accepted by ACP target resolution and
  policy. Aliases that resolve back to the requester are excluded.
- Working and failing runs used the same prompt and model alias. The system must
  handle either tool-call choice safely instead of relying on deterministic model
  output.

### Implementation

- Maintained patch:
  `docs/openclaw-setup/patches/subagent-cross-agent-spawn-fix.patch`
- Patch explanation:
  `docs/openclaw-setup/patches/subagent-cross-agent-spawn-fix.md`
- Native implementation and coverage inside patched OpenClaw:
  `src/agents/subagent-spawn.ts` and `src/agents/subagent-spawn.test.ts`
- ACP implementation and coverage inside patched OpenClaw:
  `src/agents/acp-spawn.ts` and `src/agents/acp-spawn.test.ts`
- Shared target policy inside patched OpenClaw:
  `src/agents/subagent-target-policy.ts`
- Cumulative manifest:
  `packages/e2e/openclaw-patch-suite.json`
- The source patch is generated from a formatted disposable OpenClaw worktree at
  `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`.

### Validation

- The two last working scheduled runs called reader directly.
- The first failing scheduled run omitted the target, then retried main.
- Working runs called `sessions_spawn(agentId="reader")` first.
- The failed run omitted `agentId`, then retried `agentId="main"`.
- The cron tool policy does not include `agents_list`.
- Working and failing prompts differ only in the current-time line.
- Working and failing runs used the same model family.
- Focused formatted source coverage passed 224 tests across four files.
- The current-base full managed run passed build and lint, 298 repository tests,
  seven
  prompt snapshots, 470 mapped source tests, the browser candidate test, and
  cleanup.
- Exact-head integration and code analysis checks passed remotely.
- Prior independent and terminal runtime reviews found no actionable issues and
  verified all 17 embedded patch blobs.
- Terminal review of the final public candidate found no actionable issues.
- The exact host candidate passed 15, 37, and 10 host tests with no failures or
  skips.
- The combined lifecycle passed 633 mapped patched-source tests across 24 files,
  the browser candidate test, root and UI builds, staged validation, and cleanup.
- Independent review of the complete public and host tuple found no actionable
  issues.
- The installed production bundle and real configuration reject an omitted
  target, reject an explicit second-main retry, and accept explicit reader.
- `requireAgentId=false` still allows an intentional same-agent cron child, and
  non-cron sessions are not treated as cron.
- Production validation performed one fixed no-match `list_emails` request with
  a maximum of one result. It returned no matches.
- The final deployment did not run cron or a live main model turn. It did not
  send a message or mutate mailbox content.
- A prior production promotion replayed the real three-call sequence with
  no delivery: omission denied, second main denied, reader accepted, one fixed
  no-match Gmail read returned `READ_OK`, and main returned `CRON_READER_OK`.
- Required managed command:
  `node packages/e2e/bin/openclaw-test-env.mjs ci`

### Rollout and rollback

- The reviewed host-combined lifecycle staged and validated the package before
  atomic replacement.
- A verified rollback snapshot captured package, configuration, and browser
  state before promotion.
- The gateway restarted cleanly after the atomic exchange.
- Read-only production validation passed before and after landing.
- The host deployment candidate merged first. Public PR #56 merged second.
- Both main branches were verified to contain the reviewed commits.
- Rollback was not needed. The verified snapshot remains the restore point.

### Review log

- The first landed fix covered missing targets and direct reader success, but its
  smoke skipped model repair after an error.
- Cole's real run exposed omission followed by an explicit second-main retry.
- Review added ACP pre-resolution handling, routable target filtering, resolved
  self-alias filtering, and coverage of the unset cron default.
- Final runtime reviews were clean. Plan review found public operational
  identifiers and an outdated pull request description. Both were corrected.
- Independent re-review of the corrected complete diff found no actionable
  issues.
- Terminal review of the final current-base candidate found no actionable issues.
  Its remote integration and analysis checks also passed.
- Review found that recording those results in a new plan commit made the claims
  self-invalidating. The corrected plan left the gates pending until the final
  exact-head results were recorded in pull request metadata.
- Pull request metadata recorded the final exact-head checks and terminal result
  without creating another runtime candidate.
- Independent review of the final combined deployment tuple found no actionable
  issues. The host repository intentionally has no remote check workflow, so its
  complete local combined lifecycle is the recorded gate.

### Checklist

- [x] Capture the exact failed scheduled transcript.
- [x] Find the last working scheduled reader transcripts.
- [x] Compare working and failing prompts, models, tool calls, and deployment
  timing.
- [x] Explain why the earlier smoke missed the failure.
- [x] Add the exact three-call regression.
- [x] Implement and review the runtime guard and ACP filtering.
- [x] Complete focused and full managed validation.
- [x] Prove the real sequence in a read-only production harness.
- [x] Validate the rewritten plan on the current public base.
- [x] Complete fresh current-base review.
- [x] Complete terminal review of the final exact public head.
- [x] Publish and check the final exact public head.
- [x] Update and validate the matching host deployment pin.
- [x] Promote the final exact tuple.
- [x] Land the host deployment candidate and public PR #56.
- [x] Run post-landing production checks.
- [x] Rewrite issue #43 with the landed result.
- [x] Merge the completion plan and close issue #43.
- [x] Update the Todoist task for Cole's review.
