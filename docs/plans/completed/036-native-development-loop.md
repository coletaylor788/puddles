# Native development and delivery

**Status:** Complete
**Issue:** [#112](https://github.com/coletaylor788/puddles/issues/112)
**Last updated:** 2026-09-26

## Human section

### Design

A native test process runs the real installed gateway with its own configuration, sessions, indexes, workspace, ports and processes. Scripted models and recording adapters exercise message handling and tools without contacting real accounts. The host is trusted; isolation protects production uptime and writable state.

Scripts own preparation, builds, tests, packaging, installation and durable stage results. A resumed run reuses successful work only while its real inputs and outputs match. Releases carry the complete runtime dependency graph and any declared additional artifacts. Source integration happens before activation; activation uses rehearsed bytes, verifies read-only health and restores the prior state on failure.

One implementation owner and one retained independent reviewer handle repairs. Local extensions can add private validation without making public source or CI depend on private configuration. Later delivery work separates build, source proof and target proof while retaining these foundations.

### Status

The native loop is implemented, integrated and exercised by the completed artifact-delivery workflow. The Mini retains the matching successful build and physical-target proof, along with a healthy development-instance record. The earlier release-worker handoff is complete. This record covers delivery infrastructure; it does not claim a production version upgrade.

## Agent section

### State

Complete. Native-loop source integrated through #113 at `8cf0a92`. Subsequent artifact delivery integrated through #117 at `042b732`. On 2026-09-26 the Mini retains physical target proof with `status: passed` for build `bb5c4422fbb62c7716aa3041353e8547e9ab8908a8089f7c6904ad16231eb1c6`.

### Scope and acceptance criteria

- Run the real installed runtime with separate writable state and recording-only external effects.
- Cover conversation, split messages, tools, errors, silence and state isolation.
- Preserve `node packages/e2e/bin/openclaw-test-env.mjs ci` as the cumulative gate.
- Bind reusable evidence to actual source, test, environment, toolchain and artifact inputs.
- Install complete archives offline and bind additional artifacts to the same tested bundle.
- Integrate source before activation, retain locks and snapshots, and support automatic and explicit post-activation rollback.
- Preserve failed state and refuse superseded or drifted rollback ownership.
- Keep optional extensions and host checks explicit; public CI requires no private resources.

### Architecture and decisions

- `packages/e2e/src/native-fixture.mjs`, recording plugins and `scenarios/imessage.mjs` exercise real channel handling with synthetic models.
- `native-pipeline.mjs` and `native-state.mjs` keep durable stage evidence and invalidation reasons.
- `native-package.mjs` packages the materialized production graph, including upstream bootstrap assets and bundled skills.
- `native-extension.mjs` adds declared inputs and bounded commands; `additionalInstalledDirs` exposes installed auxiliary packages.
- `native-activation.mjs` stages bytes before shutdown, snapshots complete state, verifies mapped subtrees, and owns recovery.
- Fingerprints ignore only generated root caches and the root package-manager freshness timestamp. Real dependency bytes, settings, modes and nested files remain inputs.
- Public hosted CI now uses the measured ARM profile documented in the completed artifact-delivery plan. The original Intel-only runner choice is obsolete.
- Source integration is outside the runtime rollback transaction. The latest-activation marker and exact deployed identities guard explicit rollback.

### Implementation

- The native fixture, pipeline, package, extension, integration and activation modules are present in `packages/e2e/`.
- Portable root and auxiliary artifacts install without registry resolution.
- Bounded public diagnostic export exposes only sanitized output from the current public run.
- Root cache and pnpm freshness normalization preserve unchanged-input reuse; incompatible fingerprint policies refresh normally.
- Activation stages additional package subtrees before downtime and restores complete state on failure.
- The deployment wrapper supports explicit rollback and intentional remote interpreter selection.
- Current command and lifecycle documentation are in `packages/e2e/README.md` and `docs/openclaw-setup/patches/README.md`.

### Validation

- Original focused validation covered real macOS clone/swap rollback, native runtime scenarios, pipeline invalidation, deployment topology and package selection. Corrected focused selections passed up to 131 tests; these are historical counts.
- The later completed delivery proof reports all eleven combined installed scenarios, healthy physical rehearsal, injected compare-and-swap failure and rollback.
- Audit: source modules and shared tests exist; Mini retained build ID matches its passed physical-target proof. The DEV current record reports healthy. Current production remains installed OpenClaw `2026.7.1`.
- The audit did not start DEV, TEST, a model, or a production operation. Historical gate results remain attributed to their recorded candidates.

### Rollout and rollback

The infrastructure is integrated and used by the completed delivery workflow. Activation and explicit rollback use `docs/openclaw-setup/patches/apply-and-deploy.sh` with exact receipts and target ownership. Dependency installation, builds and GitHub merges do not run during gateway downtime.

### Review log

Retained review resolved package asset omissions, browser-tag collision, rollback interpreter selection, dependency/proof invalidation, worktree cleanup, extension inputs and fixture timing. The audit replaces the obsolete implementation-worker handoff with the integrated result and current hosted topology.

### Checklist

- [x] Implement native fixtures and committed scenarios.
- [x] Deliver durable exact-input pipeline and offline packaging.
- [x] Deliver additional-artifact activation and guarded rollback.
- [x] Retain independent review and accumulated validation.
- [x] Integrate the delivery infrastructure and confirm retained Mini proof.
