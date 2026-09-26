# Plan 016: Mac Mini agent host setup

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The Mac Mini runs the personal assistant in a dedicated user session. Local bridges reach Apple productivity apps and Gmail, while restricted agents use containers and explicit tool permissions. Remote management and encrypted-disk recovery support unattended operation.

### Status

The baseline host setup is complete. The running installation uses native iMessage, a user-session gateway, secure mail and calendar wrappers, and containerized worker roles. This record covers that delivered setup.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Dedicated agent account and remote access for operating the gateway.
- Working gateway and messaging channel with paired clients and local service access.
- Apple PIM and Gmail integrations with restricted worker tool sets.
- Docker workspace isolation, readable mirrored skills, and user-owned runtime data.
- FileVault and a recoverable disk-unlock plus GUI-login path.
- Reusable setup instructions and service scripts.

### Architecture and decisions

- Current messaging is the native `imessage` channel, not the original BlueBubbles setup.
- The current gateway is loaded in the user GUI LaunchAgent domain; the old claim that only a system LaunchDaemon is authoritative no longer describes the installation.
- FileVault disk unlock and user GUI login remain distinct steps. Apple-dependent services require the user session.
- The active main, debug, reader, and browser roles are extended by a wiki maintainer and household workers. Use current agent configuration rather than the draft four-agent tool table.
- Provider adapters and deployment-specific credentials are configured outside the public reference. Historical plaintext/SecretRef migration details are not a universal current auth contract.
- Source, runtime state, browser profiles, and synchronized notes have different persistence needs; the original proposal to move all state into a synchronized Documents directory is not the current layout.

### Implementation

- `docs/openclaw-setup/README.md` indexes the maintained setup guides.
- `scripts/mac-mini/` contains unlock, package-update, skill-mirror, native iMessage health/self-heal, and deployment helpers.
- The calendar wrapper, contacts trust, per-agent PIM configuration, and browser-profile work are documented in their dedicated completed plans.

### Validation

- Mini read-only probes report FileVault on, Docker and Tailscale installed, and `unlock-self.sh` present.
- Gateway, native iMessage self-heal, and skill mirror LaunchAgents are loaded.
- Selected config confirms native iMessage, secure mail/calendar entries, QMD, and eight configured agent roles.
- The original record documents tested encrypted-disk recovery and GUI-login scripts.

No reboot, unlock, GUI login, message delivery, or live PIM operation was performed in this audit. SIP is currently disabled; the historical BlueBubbles rationale is retained as history, not as a requirement for native iMessage. Later speculative operational tooling and product features have been removed from this completed setup scope.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
