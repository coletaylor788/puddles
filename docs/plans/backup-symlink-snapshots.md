# Preserve symbolic links in recovery snapshots

Status: Reviewed; validation in progress
Issue: https://github.com/coletaylor788/puddles/issues/344
Last updated: 2026-11-06

## Human section

### Design

Backup capture currently applies artifact link validation to writable application
state. Browser profiles can contain symbolic links whose text is a version marker
rather than an existing file. Resolving such a link aborts capture after the old
backup has been invalidated.

Use a separate snapshot hash that records each link's text and permissions without
following it. Copy and restore already preserve links verbatim. Keep artifact
hashing strict. Ordinary backup digests stay compatible, and changed link text
still prevents restore. A capture failure continues to restart unchanged production.

### Status

**Approval:** Production approved. **Approval reference:** The requester approved
all fixes required for the deterministic CI plan, including pushing fixes and
transferring them to the trusted target. This is a focused correction within that
scope; it does not change application behavior or backup retention.

Implementation and retained review are complete. Focused release and rollback
regressions pass. The independent release suite, source landing, installation
between closed tickets, and a maintained backup recapture remain to be verified.

## Agent section

### State

The correction is isolated on `codex/backup-symlink-snapshots`. No application
source or deployed application state is edited by this patch.

### Scope and acceptance criteria

Preserve dangling, external, absolute, cyclic and internal links in state snapshots.
Reject modified backup link text before stopping production. Keep existing artifact
link rejection and valid backup digests unchanged. Restore production health and
a valid single backup through maintained commands after tool adoption.

### Architecture and decisions

`files.mjs` shares the hash encoding between strict `treeHash` and
`snapshotTreeHash`. Only the latter skips resolving link targets. `backup.mjs`
uses snapshot hashing for capture comparisons and verification. Copy retains its
existing non-dereferencing behavior and canonical root checks.

### Implementation

Changed the two hash call sites in capture, the verification call site, package
documentation and controller regressions. No configuration or manifest format change.

### Validation

Focused controller tests: 38 passed. Full independent release suite is running.
Tests exercise successful release and rollback with synthetic state links,
external-file preservation, tampered link rejection and strict artifact hashing.

### Rollout and rollback

Land reviewed source, install the receipt-bound tool on both hosts between closed
CI tickets, and retain prior executables while referenced. Use the maintained
backup command to recapture the one invalid generation and verify healthy
production. Do not edit backup contents or application state by hand. Keep feature
owners informed before a fresh submission. Existing snapshots without unsupported
links retain identical digests; an older tool cannot verify newly supported links.

### Review log

The retained reviewer returned CLEAR for the complete implementation diff.
No material findings remain. Documentation bookkeeping does not change behavior.

### Checklist

- [x] Reproduce the failing link behavior and implement the focused correction.
- [x] Pass focused tests and independent review.
- [ ] Pass the full release package suite and required checks.
- [ ] Merge and verify installation on both hosts.
- [ ] Recapture and verify the single backup; confirm production health.
