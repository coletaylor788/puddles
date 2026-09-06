# Per-agent QMD mcporter support

Status: In progress
Issue: https://github.com/coletaylor788/puddles/issues/108
Last updated: 2026-09-05

## Human section

### Design

OpenClaw can keep its memory search process running between queries, which makes searches much faster. The running process is tied to one agent's memory index, but the current configuration shares one process across all agents. Other agents can then receive empty search results even though their own memory contains matches.

This change lets each agent select its own long-lived memory search process or opt out and use direct searches. Existing setups keep their current behavior unless an agent adds an override. The deployment uses the repository's guarded patch pipeline, which snapshots the current install, restarts the gateway, checks readiness, and restores the prior state if the candidate fails.

### Status

The source patch and focused OpenClaw regression already exist. The first managed test run found that the new patch was missing from the shared cumulative test manifest, so production deployment is paused while that registration and the repository lifecycle are completed.

The live gateway is offline because the earlier deployment stopped after unloading it. The installed package and runtime state remain present, and the managed deploy has a preserved copy of the prior package.

## Agent section

### State

- Phase: Completing test registration before production recovery.
- Current result: The Mac mini is reachable through a persistent SSH control connection. The gateway LaunchAgent is unloaded and port 18789 is not listening.
- Candidate: Mini repository commit `aea6255` imported as `64f1fbe`; OpenClaw source commit `98ffe2a0c46` is clean and already contains the patch.
- Recovery evidence: `~/.openclaw-deploy-backups/20260905T233626Z-21891/openclaw-2026.7.1.tgz` preserves the previous package. The interrupted run did not create a runtime snapshot or leave deployment locks.
- Blockers: The cumulative patch manifest must include the new patch before promotion.

### Scope and acceptance criteria

- Preserve the existing global mcporter behavior when no agent override is configured.
- Allow an agent to override `enabled`, `serverName`, and `startDaemon` field by field.
- Allow an agent to disable mcporter and fall back to direct QMD searches.
- Register the focused regression in the cumulative OpenClaw patch suite.
- Pass `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Complete independent adversarial review and terminal review.
- Deploy through `docs/openclaw-setup/patches/apply-and-deploy.sh`.
- Confirm the gateway service, local port, and payload-free health probe are healthy.
- Keep production validation read-only. Do not send messages or mutate account data.

### Architecture and decisions

- Reuse the existing source patch stack and deployment wrapper.
- Merge configuration in precedence order: global memory settings, agent defaults, then the matching agent entry.
- Keep each agent's memory index isolated by allowing a distinct mcporter server name.
- Treat an explicit per-agent disable as authoritative.
- Map the patch's changed OpenClaw regression into the shared test pool.
- Use the existing local deployment path on the Mac mini with `MINI_HOST` unset.
- Do not modify the mini's uncommitted documentation correction.

### Implementation

- `docs/openclaw-setup/patches/qmd-mcporter-per-agent.patch` adds the schema, types, resolver merge, labels, help text, and focused regression.
- `docs/openclaw-setup/patches/qmd-mcporter-per-agent.md` documents the failure mode, configuration, and focused validation.
- `docs/openclaw-setup/patches/apply-and-deploy.sh` applies the patch after the existing stack.
- `packages/e2e/openclaw-patch-suite.json` maps the new patch to `packages/memory-host-sdk/src/host/backend-config.test.ts`.

### Validation

- First mini command: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- First result: Workspace build and tests passed through 126 tests. The manifest guard failed because the deployment listed eight patches while the shared suite listed seven.
- Required rerun: `node packages/e2e/bin/openclaw-test-env.mjs ci`.
- Production checks: `openclaw --version`, `launchctl print gui/502/ai.openclaw.gateway`, listener inspection on port 18789, and `openclaw gateway health --port 18789`.

### Rollout and rollback

- Run the managed test pool from the reviewed repository candidate.
- Push the candidate and wait for required remote checks before production promotion.
- On the Mac mini, run `OPENCLAW_SRC=~/git/openclaw bash ~/git/puddles/docs/openclaw-setup/patches/apply-and-deploy.sh` with `MINI_HOST` unset.
- The wrapper preserves the installed package, runtime state, service definition, and browser image before replacement.
- Installation, migration, restart, or readiness failure triggers automatic rollback and checks the restored gateway.
- If post-deploy read-only validation fails outside the wrapper, redeploy the prior reviewed patch stack from the recorded source and recovery state.

### Review log

- Independent review: Pending.
- Terminal candidate review: Pending.

### Checklist

- [x] Inspect the interrupted production deployment without mutating live state.
- [x] Preserve the user's mini repository changes.
- [x] Import the committed source patch into the assigned worktree.
- [x] Register the focused regression in the cumulative patch manifest.
- [x] Create and link the tracking issue.
- [ ] Pass the full managed integration lifecycle.
- [ ] Complete retained-worker adversarial review.
- [ ] Create and terminal-review the landing candidate.
- [ ] Pass remote checks and required review.
- [ ] Promote through the managed deployment wrapper.
- [ ] Validate the live gateway with read-only checks.
- [ ] Merge and verify the default branch.
