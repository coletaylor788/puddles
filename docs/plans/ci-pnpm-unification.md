# One pnpm version for release tooling

## Human section

### Status

**Approval:** Production approved.
**Approval reference:** The requester asked to use the ordinary default store and one pnpm version, alongside standing approval for required CI fixes. The existing upgrade selects pnpm 12.15.0.

The application upgrade passed production, merged, and closed its submission. This branch is refreshed from its pnpm 12.15.0 root/verifier contract. Existing application workspaces and submitted output remain unchanged. Tooling checks and merge are in progress.

### Design

Release tooling still selects pnpm 12.4.0 while the application upgrade uses 12.15.0. Align the independent release package, its generated lockfile, its workflow bootstrap, and executable recovery tooling to 12.15.0. Workflow regression coverage verifies the bootstrap and lockfile agree with the package pin. Historical test fixtures remain historical.

Both products retain their independent tests. Use the normal default host package store for tooling installs. Move existing managed workspace store bindings only after active submissions close; preserve current dependencies and recovery references during that later host migration.

## Agent section

Paired worktrees are task-owned siblings under `/private/tmp/ci-pnpm`, branch `ci/pnpm-unification`. No application source or OpenClaw patch changes. Regenerate lockfiles with the pinned manager, verify frozen installs, run the complete independent tooling suites and retained review. Publish paired PRs, then coordinate merging after application source closure. No controller reinstall is needed if generated controller bytes are unchanged.

Retained independent review found no actionable issue. Frozen installs passed under pnpm 12.15.0 using the default store. The private suite passed 384 tests. Public controller tests passed 169 tests; three native backup timeout cases passed in a complete 67-case file recheck with unchanged deadlines. After rebase, affected workflow and helper tests are repeated, with full checks required on the published head.
