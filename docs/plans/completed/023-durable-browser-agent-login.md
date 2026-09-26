# Plan 023: Persistent browser-agent profile and noVNC login

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The browser worker stores its profile outside its disposable container, so recreating the container can preserve login state. A local graphical browser session lets the human complete login challenges. The model uses the resulting session without receiving account credentials.

### Status

The browser-agent profile override, persistent mount, and graphical login configuration are implemented on the Mini. The maintained source patch also removes stale browser singleton locks before startup.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Store the browser-agent profile outside the workspace and its synchronized notes.
- Pass the profile path into the browser entrypoint and preserve it across container recreation.
- Enable non-headless browsing and local noVNC for human login.
- Keep the browser tool surface and human credential-entry boundary unchanged.

### Architecture and decisions

- `browser-userdata-dir-fix.patch` is a source patch; the original `apply-browser-userdata-dir-fix.mjs` dist patcher is retired.
- The entrypoint reads `OPENCLAW_BROWSER_USER_DATA_DIR`, creates its directory, and removes stale Chromium singleton files.
- The browser-agent config supplies `/profile` and a host bind, with `headless=false`; noVNC is inherited from enabled sandbox browser defaults.
- Profiles are sensitive state and remain outside the ordinary workspace. Persistence does not remove future site reauthentication requirements.
- Per-tier browser profiles were explicitly outside this plan’s delivered scope.

### Implementation

- `docs/openclaw-setup/patches/browser-userdata-dir-fix.patch` and its companion `.md` describe the maintained implementation.
- The shared regression runs a patched entrypoint with fake browser/display/CDP probes and checks path selection and lock cleanup.
- Mini sandbox entrypoint has the profile variable and singleton cleanup; browser-agent configuration has the matching bind.

### Validation

- Read Mini selected browser defaults and browser-agent overrides: inherited `enableNoVnc=true`, explicit `headless=false`, profile variable `/profile`, and persistent profile bind.
- Read installed sandbox entrypoint and confirmed both profile override and singleton cleanup.
- Inspected current patch documentation and cumulative fixture description.

No container was recreated and no account login or cookies were read. This establishes the installed persistence mechanism, not current login validity for any website. Upstream contribution options and later per-tier expansion have been removed from the completed scope.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
