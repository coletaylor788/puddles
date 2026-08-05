# Launch the persisted browser

Status: Reviewing
Issue: https://github.com/coletaylor788/puddles/issues/85
Last updated: 2026-08-04

## Human section

### Design

This work gives Cole a short, safe way to open the existing browser profile on the Mac mini and sign in by hand. The browser already runs in its isolated container with a host-mounted profile, so the guide will reconnect to that running browser instead of starting a separate copy or opening profile files directly.

The connection uses the short-lived observer link that the browser agent receives when its sandbox starts. Cole will request that link from a terminal on the Mac mini and open it in a browser on the same desktop. The link stays on the mini and the guide will not read or print the container's long-lived password. Cole will enter credentials inside the remote browser view, then close only the outer viewer tab so the browser and its saved session remain available.

The guide will explain how to confirm the container and persistent profile wiring without listing profile contents. If the link expires, Cole can request a fresh one. If Chromium cannot start because of stale profile locks, recreating only the browser agent's browser container is safe because the profile lives outside the container and startup removes stale singleton files.

### Status

The persisted browser guide is written, linked, and validated. It keeps the temporary viewer link on the Mac mini, avoids the noVNC password, and covers sign-in, normal exit, and profile-preserving recovery. Independent review is next. Nothing is blocked.

## Agent section

### State

- Phase: Independent review
- Repository: `coletaylor788/puddles`
- Tracking task: `6hCggCRc8j5Q7CjV`
- Tracking issue: `#85`
- Publication boundary: Do not include credentials, profile contents, private account data, or provider-specific details.

### Scope and acceptance criteria

- Document how to launch the repository-managed persisted browser profile on the Mac mini.
- Keep authentication manual and local to the Mac mini.
- Explain how to confirm the intended profile is in use without exposing private data.
- Include safe shutdown and profile-lock recovery steps supported by the existing implementation.
- Reuse the current launcher and documentation structure. Do not add a second launch mechanism.
- Do not print, copy, inspect, or document secrets, cookies, tokens, history, or stored account data.

### Architecture and decisions

- The source of truth is the sandboxed `browser-agent` browser documented in `docs/plans/023-durable-browser-agent-login.md` and patched by `docs/openclaw-setup/patches/browser-userdata-dir-fix.patch`.
- The current runtime has a running browser-agent browser container, a read-write mount at `/profile`, `OPENCLAW_BROWSER_USER_DATA_DIR=/profile`, and noVNC published only on loopback. These facts were checked through redacted boolean output. No profile contents, credentials, tokens, passwords, port numbers, or container identifiers were printed.
- OpenClaw 2026.7.1-2 injects a short-lived, one-use noVNC observer URL into the sandboxed agent's system context. The URL bootstraps noVNC without putting its password in query or header logs.
- The user requests the observer URL through a local, non-delivering `openclaw agent` turn. The URL may appear in the Mac mini's terminal, so `docs/openclaw-setup/06-opening-the-persisted-browser.md` treats it as a temporary secret and tells the user not to copy it into chat, notes, logs, or issue comments.
- The old workaround that reads `OPENCLAW_BROWSER_NOVNC_PASSWORD` from the container is not used. It exposes the long-lived password and is unnecessary on the installed version.
- Closing the outer noVNC viewer tab is the normal end state. Closing Chromium would stop the browser process. Browser-only recreate is reserved for startup or stale-lock recovery and preserves the host-mounted profile.
- This remains a documentation-only change. No runtime configuration or deployment is needed.

### Implementation

- [x] Find the existing persisted-browser launcher and nearby documentation.
- [x] Trace how the launcher selects, opens, and closes the saved profile.
- [x] Identify non-secret checks that confirm the expected profile is active.
- [x] Add `docs/openclaw-setup/06-opening-the-persisted-browser.md` with launch, sign-in, shutdown, and recovery instructions.
- [x] Link the new guide from `docs/openclaw-setup/README.md`.
- [x] Keep the plan and issue synchronized after research and implementation.
- [x] Validate the guide's commands, links, formatting, and secret-safety language.

### Validation

- Completed: Confirmed the installed `openclaw agent`, `openclaw sandbox list`, and `openclaw sandbox recreate` command shapes through built-in help.
- Completed: Confirmed the current browser runtime with redacted output that reported only four booleans: running, persistent profile mount present, profile override present, and noVNC loopback-only.
- Completed: Every documented command matches the installed CLI help.
- Completed: `git diff --check` passed.
- Completed: Relative documentation targets exist.
- Completed: The issue body contract and plan section contract passed structural checks.
- Completed: A focused scan of the changed guide and plan found no credential values, access tokens, private keys, or password assignments.
- Completed: The Human section contains no code pointers or commands.
- Not applicable: The managed OpenClaw test environment did not run because this change only adds operating instructions and does not change executable behavior, patches, configuration, or test code.

### Rollout and rollback

- Rollout is the documentation merge. No production deployment, browser restart, or external account mutation is in scope.
- Rollback is reverting the documentation commit if the instructions are inaccurate or unsafe.
- Cole performs the website sign-in directly on the Mac mini after the documentation lands.

### Review log

- No review has run yet.

### Checklist

- [x] Todoist tracking comment points to issue `#85`.
- [x] Issue body has the plan link plus only `Summary` and `Status`.
- [x] Initial two-section plan exists.
- [x] Existing behavior and safety boundaries are researched.
- [x] Documentation is implemented.
- [x] Applicable validation passes.
- [ ] Independent adversarial review is clean.
- [ ] Pull request is merged and the default branch is verified.
- [ ] Issue and Todoist task are moved to review state.
