# Plan 033: Shared cumulative integration test pool

**Status:** Complete — 2026-07-25

## Summary

Adopt the existing provider-neutral E2E package as the repository's shared test
pool, expose OpenClaw patch regressions as committed and executable artifacts,
and require every future behavior change to extend and rerun the accumulated
pool.

## Test lifecycle

`packages/e2e/bin/openclaw-test-env.mjs ci` is the managed pull-request
lifecycle. It runs the repository build, lint, and offline tests, creates a
detached OpenClaw worktree at the pinned upstream revision, applies every
maintained source patch in deployment order, and runs every mapped regression
test. The source checkout and its production configuration remain unchanged.

The live gateway suite remains a separate read-only command because it requires
host configuration. Writes continue to use recording mocks and never target
real channels or personal-data services.

## Implementation

1. Merge the existing E2E package into the active feature branch.
2. Add a manifest that maps every deployed OpenClaw patch to cumulative test
   targets.
3. Add an isolated worktree runner and pull-request workflow.
4. Commit regression coverage for local-default and explicit-remote deployment.
5. Document mandatory test-pool contribution rules for future changes.

## Validation

- Run E2E package tests, including patch-manifest and deployment-topology cases.
- Run the managed lifecycle against the pinned local OpenClaw checkout.
- Confirm the entire patch stack applies in a detached worktree and all mapped
  OpenClaw tests pass.
- Run an independent full-diff review.

Final result: repository build and lint passed; 225 workspace tests, 289 mapped
OpenClaw tests, and the isolated browser-entrypoint candidate test passed. Three
independent adversarial passes resolved all findings and ended clear.

## Rollout and rollback

The change affects repository validation only; it does not deploy or mutate the
running gateway. Rollback is reverting the workflow, runner, and package
adoption. Temporary worktrees are removed on both success and failure.

---

## Checklist

### Implementation
- [x] Existing shared E2E package adopted
- [x] Cumulative OpenClaw patch manifest added
- [x] Isolated managed lifecycle runner added
- [x] Deployment topology integration tests committed
- [x] Pull-request integration workflow added
- [x] Repository contribution instructions updated

### Testing
- [x] Integration tests written
- [x] E2E package tests passing
- [x] Full cumulative patch suite passing
- [x] Repository build and lint passing
- [x] Independent full-diff review clean

### Cleanup
- [x] Temporary worktrees and test state removed
- [x] No unused code or dead configuration

### Documentation
- [x] E2E README updated
- [x] Patch lifecycle README updated
- [x] Plan marked complete with date
