# Retain one verified recovery backup

Status: Initial source landed; older-producer compatibility in validation.
Issue: [#262](https://github.com/coletaylor788/puddles/issues/262)
Last updated: 2026-10-09

## Human section

### Design

Historical snapshots remain large even after a newer usable backup exists. Add an
explicit policy that retains one fully verified current backup and retires all
superseded payloads once their consumers stop. Keep original journals, failures,
receipts and deployment metadata as compact evidence.

```mermaid
flowchart LR
  Release[Healthy release context] --> Capture[Reserved capture]
  Capture --> Verify[Isolated materialization and verification]
  Verify --> Pointer[Publish current backup]
  Pointer --> Retention[Existing maintenance owner]
  Retention --> Consumers[Check exact ownership and consumers]
  Consumers --> Retire[Journal superseded payload retirement]
```

#### Recovery authority

Capture and isolated validation must finish before the current reference changes.
Validate original snapshots again after inspecting the isolated copy. Keep the
previous reference on capture or validation failure. A retirement failure after
publication retains the verified new authority and pending plan. Verification retains interpreter and browser
requirements for the current replacement.

#### Retirement

The single-backup policy has no implicit predecessor or newest-two hold. Explicit
holds, unknown references and active consumers still block their exact payloads.
Retirement validates old producer identity and unchanged planned inventory, not
whether the obsolete interpreter remains installed. A failed old snapshot keeps
its original failure and recorded hashes; no snapshot is rebaselined.

Remove only known payload directories through resumable tombstones. Original
metadata stays at its path so deployment baseline readers can still identify
historical transactions. Register isolated materializations at their producer;
after validation, retain their proof and retire the duplicate payload. Historical
unregistered materializations require exact explicit path and identity records.
Unknown paths and unrelated artifact-pool references remain outside this policy.

#### Recurrence

Use the existing activation publisher and maintenance scheduler. A healthy
activation publishes the exact post-release backup target. Maintenance captures
and validates a replacement when the published deployment changes, then runs
bounded retirement. Reserve both copies alongside other host reservations before
capture. Older publishers can supply their matching original target and healthy
journal instead; maintenance verifies unchanged service bytes and derives the
actual interpreter after claiming ownership. Capture uses the existing bounded stop/restart workflow; retirement does
not stop the service. Partial work retains the existing owner and recovery journals.

### Status

**Approval:** Production approved.
**Approval reference:** Approved one-verified-replacement design.
**Scope:** Verified replacement, superseded backup payload retirement, duplicate
materialization closeout and recurring maintenance. Active consumers and unknown
ownership remain protected.

Implementation and source validation are complete. Required repository checks
and installed host acceptance remain separate delivery stages.

## Agent section

### State

Work uses an isolated feature branch based on current main.

### Scope and acceptance criteria

Retain one verified backup without an implicit historical count hold. Keep exact
original compact evidence, block unknown consumers and resume interrupted removal.
Do not require obsolete interpreter availability when retiring superseded bytes.

### Architecture and decisions

Extend the existing retention mode, current-backup producer and maintenance
controller. Keep the prior retention policy compatible unless explicitly selected.
Leave deployment metadata readable after payload retirement.

### Implementation

The current-backup helper owns verification and materialization registration.
Activation publishes the post-release backup target. Maintenance selects current
backup authority and refreshes after a changed healthy release. The retention
extension reuses policy validation, replacement verification and host consumers.

### Validation

Focused regressions cover invalid replacement, missing obsolete interpreter,
current/predecessor payload retirement, original failure preservation, live
consumers, changed references, exact interrupted resume, materialization identity,
and automatic replacement after a healthy release. All 675 applicable public
tooling tests pass, with suites requiring process, ACL or package-cache access
run under normal host permissions. TypeScript checking passes.

### Rollout and rollback

Land reviewed source with required checks. Install the complete capture,
materialization and maintenance closure. Select the explicit policy only after
a verified current backup exists. A source rollback must preserve pending plans
and retirement journals; payload deletion cannot be undone by reverting code.

### Review log

The retained independent reviewer reviewed the complete behavior diff and
focused evidence. Capture identity, exact materialization selection and deployed
interpreter findings were corrected with regressions. No material findings remain.

### Checklist

- [x] Approved design and isolated source.
- [x] Focused regressions and applicable tooling gates.
- [ ] Retained source review and required repository checks.
- [ ] Merge and exact host-tooling handoff.
- [ ] Host owner verifies replacement and bounded retirement.
