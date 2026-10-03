# Bounded production backup retention

Status: Implemented and reviewed; source integration and host rollout pending.
Issue: https://github.com/coletaylor788/puddles/issues/211
Last updated: 2026-10-02

## Human section

### Design

Successful activations retain full recovery generations. Superseded healthy and
rolled-back generations accumulate because the existing backup retirement
operation only handles the current legacy activation pointer. Add a separate
maintenance operation for exact superseded generations. Preserve the active
recovery, its predecessor, referenced generations and all uncertain consumers.

```mermaid
flowchart LR
  Release[Healthy production activation] --> Context[Durable target and receipt context]
  Context --> Maintenance[Scheduled maintenance owner]
  Maintenance --> Plan[Exact bounded retirement plan]
  Plan --> Guards[Recovery, references and consumer checks]
  Guards --> Retire[Journal, rename and remove]
```

#### Recovery authority

The operator selects a verified current backup or the current healthy activation
as replacement authority. Activation verification checks its release receipt,
original snapshots, installed runtime and service, retained interpreter, browser
image and workshop snapshots. It does not treat an old backup reference as proof
that its external dependencies still exist. Historical references remain intact.

#### Exact selection

Maintenance keeps the current activation, its recorded coordination baseline,
at least the two newest generations, explicit holds and backup references.
Candidates must have a terminal healthy or rolled-back journal, complete snapshot
identities and known producer entries. A minimum age adds a cooling period.
An explicit transaction list can restrict the initial retirement batch.

The plan binds exact journals, directory identities, top-level entries, recovery
reference digests, policy and target. The host checker inspects open files,
process arguments, Docker mounts, queued work and artifact references. Unreadable
or ambiguous evidence blocks cleanup. Live candidates remain retained.

#### Removal and recurrence

Apply holds PROD maintenance ownership and the existing backup lock. It checks
all pending candidates and fresh consumers before each rename and recursive
removal. Exact tombstones and external journals allow interruption recovery;
compact results survive removed data. Changed recovery references stop a stale
plan. The operation never moves the current activation pointer.

A healthy production activation publishes local target and receipt context.
Maintenance runs separately, so cleanup cannot interrupt activation or rollback.
The host launcher claims a bounded maintenance slot and runs one bounded batch;
subsequent successful scheduled calls reconsider newly superseded generations.
Untouched stale plans can be refreshed. Failed or forcibly interrupted controllers
retain their lease and journal for explicit owner inspection and resume; the
scheduler does not recover locks or partially applied plans by assumption. No runtime build or gateway restart is needed for maintenance.

### Status

The maintenance helper, consumer checker and scheduled owner are implemented.
Focused backup and consumer checks pass. Independent review has no unresolved
findings. Pinned-toolchain checks pass; source integration remains.
Operational installation and the initial exact batch belong to the maintenance
owner after source lands.

## Agent section

### State

Implementation is authorized by the existing reviewed backup-retirement proposal.
The engineering owner uses `codex/mini-backup-retention`; the maintenance owner
verifies actual recovery and consumer state and installs the host schedule.

### Scope and acceptance criteria

Retire only superseded terminal activation generations with exact unchanged
producer metadata and no recovery, reference or consumer hold. Preserve current
activation, predecessor, historical backup references and uncertain consumers.
Normal maintenance recurs automatically. Failed controllers retain ownership
for explicit inspection. Never stop or restart the gateway for retention.

### Architecture and decisions

Use existing activation recovery verification and PROD coordination. Current
backup replacement retains its existing verifier. A required pinned executable
checks host consumers. Exact external journals preserve removal progress.
Nested metadata inventories detect changes without reading every payload byte.
The activation publisher records local context after healthy completion; the
scheduled owner runs later outside the activation transaction.

### Implementation

- `native-backup-retention.mjs` owns planning, exact apply and resumable lifecycle.
- `openclaw-backup-retention.mjs` exposes `plan`, `apply` and `run`.
- `openclaw-backup-consumers.py` checks host consumers through bounded reads.
- `native-activation.mjs` publishes recovery-local receipt and root context only
  after a production activation is healthy. Publication failure reports pending
  maintenance without rolling back a healthy service.
- Machine targets, policies, inventory, receipts and capacity reports remain local.

### Validation

Focused regressions cover terminal selection, current and predecessor protection,
references, live consumers, changed candidates, interrupted deletion, exact
resume, bounded recurring runs and context publication. Python host-checker tests
run from the accumulated TypeScript pool. Retain an independent adversarial
reviewer through remediation. The maintenance owner verifies real current
recovery and consumer evidence before applying the reviewed initial batch.

### Rollout and rollback

The implementation is host maintenance tooling. Validate real planning and
maintenance execution without building or deploying an unrelated runtime.
Source integration and host installation remain distinct from a new runtime
release. Activation context publication ships with the maintained release tool.


### Review log

Retained independent review identified empty-candidate handling and stale
untouched plans; both are corrected with regressions. Forced interruption retains
the existing ownership contract rather than adding unsafe lock recovery. Review
also required cumulative Python coverage and typed fixtures; both are included.
Final full-diff review is clear. The focused pinned-Node checks passed 174 tests,
including 47 backup tests, 65 activation topology tests, 56 interpreter tests,
five runner tests and the cumulative Python checker wrapper. Typecheck passed.
Required repository checks must be green before source lands.

### Checklist

- [x] Approved scope and isolated implementation.
- [x] Exact retirement, consumer checks and scheduled maintenance owner.
- [x] Committed regression content prepared.
- [x] Final pinned-toolchain checks and retained review.
- [ ] Source merge with required checks.
- [ ] Maintenance owner installs schedule and validates the exact initial batch.
