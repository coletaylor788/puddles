# Plan 013: OpenClaw plugin workspace scaffold

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The repository provides a common home and build configuration for OpenClaw plugins. Plugins declare their identity and tool surface, register through a supported entrypoint, and share libraries through the package workspace.

### Status

The scaffold is complete and supports the maintained plugins. The current layout uses source entrypoints under each plugin and the current supported SDK.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Root pnpm workspace discovers packages and plugins.
- Shared TypeScript configuration and root build/test/lint scripts support plugin development.
- Plugin manifests, component overview, and installation examples document the conventions.

### Architecture and decisions

- Maintained source entrypoints are `src/plugin.ts`, not the original top-level `plugin.ts` sketch.
- Secure wrappers depend on `mcp-hooks`; a plugin such as `scoped-memory` need not depend on that library.
- The public scaffold does not require any provider-specific subscription, adapter, or web plugin.

### Implementation

- `pnpm-workspace.yaml`, root `package.json`, and `tsconfig.base.json` provide the scaffold.
- `openclaw-plugins/README.md` documents manifests, SDK entrypoint, bundling, registration, and package conventions.

### Validation

- Inspected workspace manifests and component overview.
- Mini checkout has secure mail/calendar plugin directories, and both have configured installed bundle paths.

The hygiene audit reads source, installed artifacts, and selected configuration. It does not repeat live tool calls, send messages, or certify current end-to-end behavior. Earlier test claims are historical evidence, not fresh test results.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
