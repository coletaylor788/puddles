# Plan 020: Workspace skill mirror

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The mirror gives agents readable copies of bundled skills inside their writable workspace. It only refreshes directories that it owns and leaves user-authored skills alone. A scheduled local service updates those copies as source content changes.

### Status

The mirror, installer, and scheduled service are implemented and installed. The current script mirrors bundled and locally managed skill roots.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Copy skill directories into the configured workspace with ownership markers.
- Never replace a destination without the mirror marker.
- Refresh changed owned content and remove owned copies no longer present in the sources.
- Run periodically and at user login; record best-effort failures.

### Architecture and decisions

- Actual sources are the global OpenClaw `skills` directory followed by `~/.openclaw/skills`; the script does not discover plugin manifest skill arrays.
- The fingerprint is derived from file content. The marker records OpenClaw version as metadata; version alone does not trigger refresh.
- The service uses its own LaunchAgent, not a gateway startup shim.
- `--dry-run` avoids copying/removing skills but still writes logs and creates bookkeeping paths, so it was not invoked as a supposedly read-only production probe.
- The initial BlueBubbles example is historical. Current source skills and the native iMessage channel have changed.

### Implementation

- `scripts/mac-mini/mirror-openclaw-skills.sh`, `install-openclaw-skills-mirror.sh`, and `ai.openclaw.skills-mirror.plist` implement the mirror.
- The sandbox setup guide documents why writable workspaces need readable local skill copies.

### Validation

- Inspected the complete mirror script, including no-clobber, fingerprint, refresh, and garbage-collection paths.
- Mini skill-mirror LaunchAgent is loaded; workspace has mirrored skills and the sampled `apple-notes/.openclaw-mirror` marker exists.
- Original completion record documents no-clobber and attachment smoke checks.

No mirror run or delivery test was performed. Plugin-manifest discovery, an upstream contribution, and optional gateway startup synchronization are removed from the completed delivered scope.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
