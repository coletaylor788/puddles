# Launch the persisted browser

Status: Awaiting review recheck
Issue: https://github.com/coletaylor788/puddles/issues/85
Last updated: 2026-08-04

## Human section

### Design

This work gives Cole a short, safe way to open the existing browser profile on the Mac mini and sign in by hand. The browser already runs in its isolated container with a host-mounted profile, so the guide will reconnect to that running browser instead of starting a separate copy or opening profile files directly.

The installed version creates a password-protected viewer but does not expose its temporary observer link through the command line or to the browser agent. The guide therefore uses a local terminal snippet on the Mac mini. It finds the browser-agent container and loopback viewer port, reads the rotating noVNC password into a shell variable, and opens the viewer directly without printing the password or link. Cole will enter credentials inside the remote browser view, then close only the outer viewer tab so the browser and its saved session remain available.

The guide will explain how to confirm the container and persistent profile wiring without listing profile contents. If Chromium cannot start because of stale profile locks, recreating only the browser agent's browser container is safe because the profile lives outside the container and startup removes stale singleton files. The connection snippet must be rerun after a recreate because the viewer password and port can change.

### Status

Independent review found that the documented observer-link request cannot work on the installed version because the link never reaches the agent or a command-line result. The finding is fixed. The replacement path selected the live browser, retrieved its rotating password without printing it, and reached the local viewer. The same reviewer is checking the complete diff again. Nothing is blocked.

## Agent section

### State

- Phase: Review recheck
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
- OpenClaw 2026.7.1-2 creates a short-lived observer URL internally but does not add it to the agent system prompt, embedded result, sandbox list output, or another command-line surface. The first guide draft incorrectly assumed the agent could return it.
- The supported local workaround reads `OPENCLAW_BROWSER_NOVNC_PASSWORD` into a shell variable and obtains `noVncPort` from `openclaw sandbox list --browser --json`. The snippet passes both directly to the local browser through the standard noVNC URL. It must not echo either value.
- The noVNC password is rotating container state, not the persisted website credential. It still grants browser-view access and must remain confined to the Mac mini.
- Closing the outer noVNC viewer tab is the normal end state. Closing Chromium would stop the browser process. Browser-only recreate is reserved for startup or stale-lock recovery and preserves the host-mounted profile.
- This remains a documentation-only change. No runtime configuration or deployment is needed.

### Implementation

- [x] Find the existing persisted-browser launcher and nearby documentation.
- [x] Trace how the launcher selects, opens, and closes the saved profile.
- [x] Identify non-secret checks that confirm the expected profile is active.
- [x] Correct `docs/openclaw-setup/06-opening-the-persisted-browser.md` to use the proven local connection path without printing secret values.
- [x] Link the new guide from `docs/openclaw-setup/README.md`.
- [x] Keep the plan and issue synchronized after research and implementation.
- [x] Validate the guide's commands, links, formatting, and secret-safety language.

### Validation

- Completed: Confirmed the installed `openclaw agent`, `openclaw sandbox list`, and `openclaw sandbox recreate` command shapes through built-in help.
- Completed: Confirmed the current browser runtime with redacted output that reported only four booleans: running, persistent profile mount present, profile override present, and noVNC loopback-only.
- Invalidated by review: Command flags matched installed help, but the first draft's agent-request flow was not connected to the generated observer URL and could not work.
- Completed: `git diff --check` passed.
- Completed: Relative documentation targets exist.
- Completed: The issue body contract and plan section contract passed structural checks.
- Completed: A focused scan of the changed guide and plan found no credential values, access tokens, private keys, or password assignments.
- Completed: The Human section contains no code pointers or commands.
- Completed: Ran the replacement connection path against the current browser container without invoking `open`. Redacted boolean output confirmed container selection, noVNC port selection, an eight-character alphanumeric password, viewer reachability, and the local `open` command. No password, URL, port, or container name was printed.
- Completed: Confirmed the installed bridge builds the direct noVNC target with `autoconnect`, remote resize, and the password in the URL fragment.
- Not applicable: The managed OpenClaw test environment did not run because this change only adds operating instructions and does not change executable behavior, patches, configuration, or test code.

### Rollout and rollback

- Rollout is the documentation merge. No production deployment, browser restart, or external account mutation is in scope.
- Rollback is reverting the documentation commit if the instructions are inaccurate or unsafe.
- Cole performs the website sign-in directly on the Mac mini after the documentation lands.

### Review log

- Review worker: project session `d7981b46-0f3f-4ec9-99a5-3ea32d1d0564`.
- Finding 1, critical, accepted: The guide asked `browser-agent` to return a noVNC observer URL that is not present in its system prompt, tools, or command result. The guide also prohibited the only working local password-and-port path.
- Evidence: The reviewer traced `noVncUrl` through the installed 2026.7.1-2 source and bundle. It stops in `SandboxContext.browser`; `EmbeddedSandboxInfo`, the system prompt, and `openclaw sandbox list` do not expose it.
- Remediation completed: The guide now selects the running browser-agent container, reads the port and rotating password into local variables, opens the standard fragment-based noVNC URL without echoing either value, and clears the password variable. Focused live-path validation passed without opening the user's browser or printing private values.

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
