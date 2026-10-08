# Deploy when the configured interpreter is already current

Status: All 56 focused tests, package type check and retained independent review pass.
Issue: https://github.com/coletaylor788/puddles/issues/203
Last updated: 2026-09-30

## Human section

### Design

Repeated deployments can use the same Node executable as the running service.
Activation currently rejects that valid target because it requires distinct
old and new interpreter paths. Accept the same canonical path only when its
digest, version, platform and architecture match exactly.

Keep the interpreter declaration in the target. Activation still verifies the
binary, compares it with the build toolchain, checks the service argument and
snapshots the service for rollback. An alias that resolves to the desired path
remains unsupported. Different executables retain the existing migration flow.

### Status

The bounded validation repair is implemented. Tests cover activation, exact
service and runtime rollback, and rejection before shutdown for conflicting
identities, aliases, service arguments and build toolchains. All 56 focused tests
and the package type check pass. Changed source requires its own release proofs.

## Agent section

### State

- Authorized repair within the existing production release.
- Branch: `codex/retain-current-interpreter`.
- Base: `70c11b08ec9da0f163f02fdf2a6985c9d34d3bc2`.

### Scope and acceptance criteria

Allow matching literal and canonical interpreter paths only with equal identity
fields. Preserve runtime proof comparison, executable hashing, service checks,
snapshots and rollback. Reject mismatches before installation or shutdown.

### Implementation and validation

Update `validateNodeMigration` in `packages/e2e/src/native-activation.mjs`.
Extend `native-interpreter-migration.test.ts` in the cumulative integration pool.
Run that focused suite, package type checks, retained independent review and
required repository checks before merging.

### Rollout and rollback

Select the reviewed merged repair for a new immutable candidate. Run cumulative
CI, DEV and TEST against that candidate before production activation. Retain
existing healthy production and its recovery copy. Do not remove interpreter
metadata from an already sealed target or reuse old proofs for changed source.

### Review log

The retained reviewer confirmed the narrow repair and rejected removing the
interpreter declaration because that would skip runtime and service checks.
Complete implementation review found no actionable issues. The reviewer also
independently reran all 56 interpreter tests under the maintained Node runtime.

### Checklist

- [x] Repair scoped within the approved release.
- [x] Implementation and regression prepared.
- [x] Focused checks and retained review.
- [ ] Required checks and merge.
- [ ] Replacement CI, DEV, TEST and production proof.
