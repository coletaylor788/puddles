# Fix cron email reader failures

**Status:** Public candidate sealed; preparing the matching host deployment
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

The design reset, current-base validation, exact-head checks, and terminal
review are complete. The reproduced-path code and new plan format pass the full
cumulative suite. Production is healthy on the prior build after rollback. The
matching host deployment pin, promotion, landing, and post-landing checks
remain. The cron definition has not been changed.

## Agent section

### State

- Public PR #56 is open. Its runtime patch is the reviewed reproduced-path fix.
- The matching host deployment candidate is paused for this final plan update.
- Production is healthy on the prior reviewed build after rollback.
- The current worktree includes the latest public `main` and this rewritten plan.
- The pull request now describes the runtime change and cumulative validation.
- The published candidate passed all exact-head remote checks and terminal
  review without actionable findings.
- The targeted writing-contract suite passes 9 tests.
- The complete managed lifecycle passes build and lint, 298 repository tests,
  seven prompt snapshots, 470 mapped source tests, the browser candidate test,
  and cleanup.
- The host deployment pin must now be updated to the resulting exact public head
  before promotion.

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
- Terminal review of the complete final public candidate found no actionable
  issues.
- A prior production promotion replayed the real three-call sequence with
  no delivery: omission denied, second main denied, reader accepted, one fixed
  no-match Gmail read returned `READ_OK`, and main returned `CRON_READER_OK`.
- Required managed command:
  `node packages/e2e/bin/openclaw-test-env.mjs ci`

### Rollout and rollback

- Use the reviewed host-combined lifecycle only.
- Record and verify a rollback snapshot before package replacement.
- Production validation stays read-only and uses fixed no-match Gmail queries.
- Do not run cron as a production test.
- Recheck the exact public head and host deployment candidate, including bases,
  checks, reviews, and mergeability, immediately before promotion and merge.
- Roll back on any staged, production, tuple, merge, or post-landing failure.

### Review log

- The first landed fix covered missing targets and direct reader success, but its
  smoke skipped model repair after an error.
- Cole's real run exposed omission followed by an explicit second-main retry.
- Review added ACP pre-resolution handling, routable target filtering, resolved
  self-alias filtering, and coverage of the unset cron default.
- Final runtime reviews were clean. Fresh plan review found public operational
  identifiers and an outdated pull request description. Both are corrected.
- Independent re-review of the corrected complete diff found no actionable
  issues.
- Terminal review of the exact current-base candidate found no actionable
  issues. Its remote integration and analysis checks also passed.

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
- [x] Complete terminal review.
- [x] Publish and check the final exact public head.
- [ ] Update and validate the matching host deployment pin.
- [ ] Promote the final exact tuple.
- [ ] Land the host deployment candidate and public PR #56.
- [ ] Run post-landing production checks.
- [ ] Update the issue and Todoist task for Cole's review.
