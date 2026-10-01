# Select reviewed merged source for a release

Status: Focused validation and retained independent review pass. Ready for merge.
Issue: https://github.com/coletaylor788/puddles/issues/200
Last updated: 2026-09-30

## Human section

### Design

A failed release needs a reviewed repair. The batch selector currently chooses
the newest default-branch tip, which can also include unrelated features merged
while the repair was under review. Let the owner select an exact already merged
commit without changing the artifact or deployment contracts.

An optional `reviewedHead` in each repository specification selects that commit.
The selector still fetches the default branch and verifies that the selected
commit is its ancestor and contains the deployed base. It derives the tree and
requires owner attribution for every included commit. Omitting the option keeps
the current behavior of selecting the latest merged tip. Unmerged commits remain
ineligible. The release still needs its normal accumulated CI, installed checks
and rollback evidence.

### Status

The selector and documentation support explicit merged commit selection. Real
Git regressions cover earlier merged source, the default tip, unmerged source,
selection before the deployed base and missing ownership. All 21 focused tests and the package type check pass. Retained
independent review clears the complete change. Production is unchanged.

## Agent section

### State

- This is a bounded repair encountered during an approved production release.
- Worktree: `/Users/cole/.codex/worktrees/b51a/puddles`.
- Branch: `codex/select-merged-release-head`, base `8535586bf204fb4e9731e2348003c04d9c6b86fa`.

### Scope and acceptance criteria

- Accept only an exact 40-character commit SHA for `reviewedHead`.
- Prove deployed base <= selected head <= freshly fetched default-branch tip.
- Derive the selected tree and attribute every commit in the selected range.
- Preserve default selection, correction attribution and receipt schemas.

### Architecture and decisions

The existing activation contract already permits a selected merged ancestor of
the default branch. The batch selector adds the same bounded choice before build.
No artifact is relabeled, and no failed candidate evidence is reused for changed
inputs. Later merges remain eligible for a later release.

### Implementation

Update `packages/e2e/src/merged-batch.mjs`, its CLI wording and deployment
coordination guide. Add real local Git repositories to test selection and both
ancestry boundaries through the actual Git command runner.

### Validation

Run the new `merged-batch.test.ts` and existing `deploy-coordination.test.ts`
through the package's Vitest runner. Run the package type check and required
repository checks. The shared cumulative suite includes the new tests.

### Rollout and rollback

Merge after retained review and focused checks. Use the selector to register the
replacement candidate and run the accumulated gate, then promote the exact
artifact through DEV, TEST and PROD. Preserve healthy production and its verified
recovery copy until that candidate passes every gate.

### Review log

The retained reviewer confirmed that optional exact merged selection fits the
existing activation and receipt contracts. The full implementation review passes. The reviewer identified an annotated-tag
object mismatch; exact commit-object validation and a real Git regression resolve
it. Each fixture commit has distinct content to prove the selected tree.

### Checklist

- [x] Minimal correction scoped within the approved release.
- [x] Selector, documentation and committed regression prepared.
- [x] Focused tests and retained review.
- [ ] Required repository checks and merge.
- [ ] Replacement candidate CI, DEV, TEST and production verification.
