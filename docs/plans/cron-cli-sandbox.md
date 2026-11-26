# Sandboxed scheduled runs through the managed CLI

## Human section

### Design

Scheduled runs currently reject the managed Claude CLI before its tools can reach the existing Docker sandbox. Extend the existing `cli-sandbox-handoff.patch` with the same narrow bundled-Claude exception already qualified for delegated children. Keep the separate captured-runtime authority check and all native tool permissions. Other CLI backends remain refused. This changes no job definitions, schedules, model selection, delivery policy or sandbox settings.

The prototype must prove actual cron execution through the Gateway, managed CLI, MCP and Docker. Compare the baseline refusal with the candidate. Verify permitted workspace read/write and shell operations, outside-file and symlink refusal, host-exec refusal, disabled native shell/file tools, missing-image refusal, repeated scheduled runs, creator-inherited sandbox requirements and cleanup. Use recording adapters for external delivery. Add durable regressions and qualify the integrated artifact before release.

### Status

**Approval:** Production approved, conditional on successful cron containment verification. **Approval reference:** On November 26 the requester asked to verify crons remain sandboxed as children did, then extend the guard removals if they do. This approves a narrow expansion of the existing sandbox handoff patch for Claude crons. Any materially broader change remains outside scope.

The packaged prototype passes cron containment and the existing chat regression. Real native subscription verification is registered for DEV/TEST using the established target login. Review and CI release remain pending; production has not changed.

## Agent section

- Baseline: merged OpenClaw 2026.11.5 composition with previously approved child exceptions.
- Current main still rejects sandboxed CLI crons in `src/cron/isolated-agent/run-admission.ts`; latest stable discovered November 26 is v2026.11.10. The exact stable tag source also retains the blanket rejection, so an upgrade alone does not fix this case.
- Retain `assertCronRuntimeAuthorityCandidate`; an API-only captured authority cannot be reused by CLI.
- Register changed native tests in the cumulative public manifest and installed cron boundary evidence in the maintained companion suite.
- Retained independent reviewer: `/root/cron_review`.
- Release through the installed build, ci-dev, ci-prod lifecycle after prototype, committed regressions and retained review.

### Validation

- Baseline installed cron runs reproduced the exact `cannot honor the sandbox` refusal.
- Candidate installed cron suite passed in 79.8 seconds, including positive workspace file/shell tools, outside and symlink refusal, gateway/node host overrides, nested MCP/Code Mode, read-only mounts, per-agent and per-job tool caps, repeated isolated occurrences, same-run background process collection, missing-image refusal before inference, container inspection and cleanup.
- Existing installed Claude chat suite passed in 44.6 seconds after sharing its fixture with cron. Both suites used real Gateway, bundled Claude executable, MCP and Docker with deterministic inference. The runner verified the artifact was unchanged and closed its scratch.
- Native cron admission: 18 checks passed. Native background completion admission: 16 existing checks passed. This does not claim installed asynchronous cron wake delivery; the cron fixture intentionally collects its background process within the originating run.
- Cumulative patch manifest: six checks passed. Private inventory/overlay: 30 checks passed. Qualification/transcript/cleanup lifecycle: 58 checks passed.
- Exact patch composition: reverse the existing handoff patch from the composed baseline, apply the expansion, compare every touched file with the prepared prototype: all 43 match.
- Local real-provider attempt reached Claude but had no usable managed subscription login. No containment claim comes from that failed inference. Test consumers and Docker containers were independently verified stopped. The maintained DEV/TEST qualifier uses the target's established native subscription, exact cron/native session identity and five tool-result checks; that gate remains pending.

### Release scope

The private control uses the existing fresh-slot and artifact-binding release path.
It changes no job definitions, schedules or policy. DEV/TEST qualify real cron
file/shell behavior; PROD acceptance remains read-only. No upgrade or original
harness/configuration migration is replayed. The ordinary full application suite,
retained review, exact source checks and CI deployment gates remain required.

### Review

The retained reviewer completed the full public/private diff review on November 26 with no unresolved material findings. This clears qualification; real subscription DEV/TEST and deployment remain pending.
