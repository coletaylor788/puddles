# News feed and inbox cron investigation

Status: Reinvestigating root cause
Issue: https://github.com/coletaylor788/puddles/issues/84
Last updated: 2026-08-04

## Human section

### Design

The scheduler is healthy, but the prior proposal assumed the worker-target check was the right foundation. Cole wants the system to handle coordination from a plain-language cron description. The model should not need low-level instructions about worker identifiers, result delivery modes, or orchestration tools.

The investigation is returning to the last genuinely working inbox triage run and the first broken run. It will compare what each run actually accomplished, which agent identity did the read work, which tools that agent received, what runtime and configuration were installed, and whether the final report and mail actions were correct. A green scheduler status alone does not count as working.

The goal is to find the system regression that made normal main-to-reader delegation stop working. The named-worker check, prompt changes, gather-only proposal, and suppression changes are all unapproved hypotheses until that timeline is proven. The final design must let a normal cron description work without teaching the model runtime plumbing.

### Status

The prior gather-only proposal is withdrawn. The root-cause investigation is open again and starts from the working-to-broken transition.

Nothing has changed in code, configuration, prompts, schedules, services, or deployments.

## Agent section

### State

- Phase: Read-only root-cause reinvestigation
- Approval gate: Required before code, configuration, prompt, schedule, deployment, service, or external-state changes
- Todoist task: `6hCQCRgQPm8Fq8X3`
- Tracking issue: `https://github.com/coletaylor788/puddles/issues/84`
- Current direction comment: `6hCWQC9QvwMvV3x3`
- Repository: `coletaylor788/puddles`
- Branch: `coletaylor788-investigate-cron-failures-m8fq8x3`
- Runtime mutation performed by this worker: None

### Scope and acceptance criteria

- Identify the last inbox run that completed correct triage behavior, not merely a green status.
- Identify the first run that failed the intended behavior.
- Compare prompts, model family, agent identity, resolved tools, inherited policy, configuration, runtime package, gateway lifecycle, result handoff, mail actions, and final delivery.
- Determine why plain-language reader delegation worked before the transition.
- Determine whether the named-worker check fixed the root cause, masked it, or added a second failure.
- Determine whether the cross-agent tool-policy patch, a runtime update, configuration drift, session state, model behavior, or completion handling caused the transition.
- Separate scheduler status defects from incorrect or missing work.
- Preserve the requirement that main owns decisions and mutations while reader owns untrusted reads.
- Require the eventual system to route that architecture from ordinary language without prompt-level runtime plumbing.
- Do not trigger production jobs, read live message or mail content beyond sanitized metadata, mutate mail, or send messages during research.

### Architecture and decisions

- Confirmed facts retained from prior research:
  - The scheduler and gateway are running.
  - Inbox has one historical missed trigger during a host outage.
  - Recent inbox and news runs can finish useful work while child completion handling records errors.
  - The first scheduled news run completed but hit unnamed spawn denials, a child session lock, and completion retry expiry.
  - Current main configuration requires explicit worker identifiers.
- Prior conclusions now treated as hypotheses:
  - The named-worker check may be a repair for model variation rather than the root regression.
  - The cross-agent tool-policy change may have altered how omitted targets behave.
  - Completion suppression is defective, but it may be independent of the original inbox break.
  - A gather-only result mode may avoid completion races, but it violates the new requirement if cron authors must specify it.
- Root-cause standard:
  - A run is working only if the correct agent reads evidence, main receives that evidence, main applies the intended decisions, mutations are confirmed, and the final report reaches the expected handoff.
  - Scheduler `ok`, a short summary, or a completed child is insufficient by itself.
- Investigation boundaries:
  - Use sanitized metadata and structural transcript comparisons.
  - Do not publish personal content, recipients, credentials, internal account data, or raw messages.
  - Trace repository and installed runtime history without modifying the local patched source checkout.

### Implementation

- [x] Verify the Todoist tracking comment and issue contract after the new direction.
- [x] Withdraw the gather-only proposal before further research.
- [ ] Enumerate inbox runs around every behavior transition.
- [ ] Classify each run by actual read, decision, mutation, report, and delivery outcome.
- [ ] Reconstruct the last correct run and first incorrect run tool call by tool call.
- [ ] Compare exact prompt and model inputs where retained evidence permits.
- [ ] Correlate runtime package and configuration changes to the transition.
- [ ] Trace agent target defaulting and tool-policy resolution before and after the transition.
- [ ] Re-evaluate why the named-worker check was added and whether it should remain, narrow, or disappear.
- [ ] Re-evaluate completion gathering only after the original break is understood.
- [ ] Write the root cause and a system-level fix that keeps cron descriptions plain.
- [ ] Update the issue and ask one concrete approval question.

### Validation

- Read-only evidence sources:
  - Live cron history and stored run entries
  - Sanitized main and child transcripts
  - Subagent registry execution, completion, delivery, and tool-policy metadata
  - Secure integration audit metadata without message content
  - Gateway startup, restart, and error logs
  - Installed package timestamps and markers
  - Repository, patch, configuration, and deployment history
  - Prior issue 43 plan and candidate evidence
- Required comparisons:
  - Last correct run versus first incorrect run
  - Green-but-wrong versus green-and-correct runs
  - Omitted target versus explicit reader target
  - Same-agent versus cross-agent child tool resolution
  - Runs before and after each runtime deployment
  - Runs before and after model-family changes
  - Runs before and after prompt or session-target changes
- No implementation validation runs before approval.

### Rollout and rollback

- No rollout occurs during root-cause research.
- Do not edit prompts as a temporary workaround.
- Do not change or disable the named-worker check until its role is proven.
- Do not add gather-only behavior until the plain-language system contract is settled.
- Any eventual fix must use the managed test and patch lifecycle, preserve a verified recovery snapshot, and keep production checks synthetic and read-only.

### Review log

- 2026-08-03: Initial investigation found a healthy scheduler, one historical host outage, target denials, and completion retry failures.
- 2026-08-04: A deeper pass found unsafe assumptions in broad completion suppression and proposed gather-only mode.
- 2026-08-04: Cole rejected prompt-level orchestration as the system contract and asked for the original inbox regression to be proven from the last working run.
- 2026-08-04: The gather-only proposal and named-reader prompt proposal are withdrawn pending root-cause evidence.

### Checklist

- [x] Tracker contract is current.
- [x] Stale gather-only proposal is withdrawn.
- [x] No behavior or external state was changed.
- [ ] Last correct inbox run is proven.
- [ ] First incorrect inbox run is proven.
- [ ] Working-to-broken delta is complete.
- [ ] Named-worker check is classified as root fix, mitigation, or regression.
- [ ] Completion failures are separated from the original behavior failure.
- [ ] Plain-language cron system contract is designed.
- [ ] Final fix, validation, rollout, and rollback are documented.
- [ ] Cole approves implementation.
