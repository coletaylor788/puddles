# Include patch-added source in native build discovery

**Status:** Production approved; corrected build and fresh DEV tests passed; release qualification pending
**Issue:** [#259](https://github.com/coletaylor788/puddles/issues/259)
**Last updated:** 2026-10-19

## Human section

### Design

Native plugin discovery reads the Git index when building an OpenClaw checkout.
Patches can create files that are present on disk but absent from that index.
The same discovery code reads all source files when Git metadata is absent, so
a copied prepared workspace can require compiled entries the build omitted.

```mermaid
flowchart LR
    A[Owned prepared OpenClaw source] --> B[Existing authored-input inventory]
    B --> C[Add new files to index with intent-to-add]
    C --> D[Versioned build cache]
    D --> E[Native incremental build]
    E --> F[Fresh artifact and DEV qualification]
```

Before the public application builder checks its cache, it gives native Git
discovery the same authored files already used in the source fingerprint.
`git add --intent-to-add` records each new path without staging its contents.
The existing application owner record, OpenClaw package identity, and exact Git
root constrain this operation to managed prepared source. Public and companion
author checkout indexes are not preparation targets. Ignored generated files
stay excluded. Existing staged contents stay intact; a staged deletion recreated
on disk fails before any index changes.

The preparation version participates in the input fingerprint so an old cache
cannot reuse output built with the incomplete inventory. Native OpenClaw build
code remains unchanged. The regression loads the actual native collector,
checks newly patched entries, and compares discovery against a physical copy
without Git metadata. A stub for only an outer Git call is insufficient because
the collector starts its own Git process.

### Status

**Approval:** Production approved within the existing implementation and shipping
scope. The requester said "once tested, approved to ship" and authorized work on
the Mini and deployment. On 2026-10-19 the release manager assigned this narrow
shared preparation correction under that authority. This adds no agent access
or communication changes.

The focused cache, ownership and preparation tests and actual native collector
regression pass. Retained independent review cleared the complete change. The
Household replacement build passes native readiness and exact transfer checks,
and all 12 fresh DEV acceptance cases pass. Independent shutdown closure and
credential retirement also passed. Other consumers remain under their owners' qualification. Prior
evidence is not relabeled for replacement output; the normal release lane and
capacity checks still apply.

## Agent section

### State

Implementation belongs to the Household owner on its existing public feature
branch. The release manager coordinates other consumers. The change is shared
build preparation, not a dependency on Household runtime behavior. The correction
is published separately and the Household owner has rebuilt and staged its
replacement through the maintained lifecycle. Fresh DEV tests passed; full
release qualification and source merge remain pending.

### Scope and acceptance criteria

- Native discovery includes patch-added authored paths before compilation.
- Existing authored-input enumeration defines the indexed set.
- Managed source ownership and exact Git root are checked before index writes.
- Existing staged changes and ignored outputs remain intact.
- Old cache identities cannot reuse incomplete output.
- Real native discovery agrees in indexed and physically Git-free fixtures.
- Changed artifacts repeat DEV and release qualification.

### Architecture and decisions

`application-source.mjs` shares the existing cached-plus-nonignored-new-file
inventory with `applicationSourceInputs`. It validates all new paths before one
literal, NUL-delimited intent-to-add operation. It rejects recreated staged
deletions and unsupported directory entries before mutation. It then confirms
that all selected paths appear in the native index.

`buildApplicationCore` calls preparation before computing its cache identity.
The fingerprint includes the source preparation version. Both public and
companion application builds use this public entrypoint. DEV and TEST continue
to consume the same resulting artifact and use their existing configuration
preparation; there is no environment-specific source workaround. The legacy
transaction runner is outside this change.

### Implementation

- `packages/e2e/src/application-source.mjs`: inventory and guarded indexing.
- `packages/e2e/src/application-build-cache.mjs`: preparation and invalidation.
- `packages/e2e/README.md`: prepared-source contract.
- `packages/e2e/tests/application-source.test.ts`: ownership and index safety.
- `packages/e2e/tests/application-build-cache.test.ts`: reuse and invalidation.
- `packages/e2e/tests/candidate.application-source.test.ts`: real nested native
  discovery and a physically Git-free copy, registered in the cumulative suite.

### Validation

Eight focused preparation, cache and output-ownership tests pass. The actual
native collector regression passes against the pinned prepared source in a
separate temporary fixture. Its index and source files are the only source data
mutated by the regression. The fixture is removed afterward. These results do
not by themselves qualify a rebuilt application or replace installed DEV checks.
The replacement build completed in 151 seconds. Readiness with all nested native
Git calls disabled reported no missing entries, and both previously omitted
compiled modules were present. Exact transfer validation passed, followed by all
12 fresh installed DEV cases in 468 seconds. The manager independently verified
shutdown and credential retirement.

### Rollout and rollback

Review and publish the correction before affected owners rebuild. Preserve old
frozen artifacts and their receipts while the manager coordinates replacement
builds and qualification. A changed artifact starts at DEV and follows the full
application suite, TEST, backup, read-only PROD checks and source merge. Do not
amend old expected hashes or replay consumed evidence. Reverting the correction
would restore incomplete discovery and does not make an affected candidate
release-ready.

### Review log

The retained independent reviewer cleared the complete current public diff and
all new files on 2026-10-19 with no material findings or architecture deviations.
The review confirmed native indexing, cache invalidation, both build consumers
and the physical Git-free regression. The same reviewer cleared the replacement
DEV and transfer controls. Candidate compilation and fresh DEV tests now pass;
the full release gates remain outstanding.

### Checklist

- [x] Reproduce the nested native discovery mismatch.
- [x] Implement guarded native indexing and cache invalidation.
- [x] Pass focused and actual native collector regressions.
- [x] Complete retained review.
- [x] Publish the shared correction as a separate commit for release owners.
- [x] Rebuild Household and pass fresh DEV tests under manager coordination.
- [x] Complete independent Household DEV closure.
- [ ] Complete qualification for other consumers.
- [ ] Complete release, merge and cleanup.
