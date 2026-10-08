# Plan 006: Monorepo reorganization

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The repository separates self-contained Python service integrations from shared libraries, host scripts, and OpenClaw plugins. Each service keeps its own dependencies, tests, and setup documentation; the root explains how the pieces fit together.

### Status

The reorganization is complete. The current repository name is Puddles, and the later TypeScript workspace extends the original service layout.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Gmail source, tests, dependency metadata, and service-specific plans live under the service directory.
- The root overview links to component setup and development instructions.
- Historical local-folder and client-path migration is complete as recorded in the original checklist; current per-client configuration remains deployment-specific.

### Architecture and decisions

- The original `productivity-mcp-servers` name is historical. The current root is `puddles`.
- Python services remain independent; `packages/` and `openclaw-plugins/` now form a pnpm workspace.

### Implementation

- `servers/gmail-mcp/{src,tests,docs}` and `servers/gmail-mcp/pyproject.toml` hold the relocated service.
- `README.md`, `pnpm-workspace.yaml`, and `.github/copilot-instructions.md` describe the current layout.

### Validation

- Repository paths and root overview match the intended separation.
- Mini checkout contains `servers/gmail-mcp`, `packages/mcp-hooks`, and `openclaw-plugins`; its configured Gmail interpreter exists.
- The original 2026-02-01 completion record reports passing moved tests and client-path verification.

The audit verifies the resulting repository layout and configured Mini interpreter. It does not inspect unrelated desktop client settings or rerun the historical migration.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
