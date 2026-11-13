# Native browser integration

This package pins and packages stock Vercel agent-browser. The
[OpenClaw browser plugin](../../openclaw-plugins/agent-browser/README.md) registers
its selected native MCP tools with the Gateway. Normal agent permissions control
access, and Claude reaches Vercel only through OpenClaw's tool bridge. The launcher
starts Chromium in Docker and passes its authenticated CDP endpoint to Vercel.
Vercel owns tool schemas, login, credential storage, and browser actions.

The trusted launch specification contains an immutable existing browser image,
local Docker endpoint, and separate paths for controller state, browser profile,
and downloads. Only profile and downloads are mounted into Chromium. Use the
existing OpenClaw browser image, which supplies the CDP relay and owner viewer.
Do not enable the old browser controller for the same profile at the same time.

## Credentials and owner access

The owner saves entries with the packaged upstream `auth save` command. Use the
same isolated `HOME` as the service (`stateDir/home`) and a separate
`AGENT_BROWSER_SOCKET_DIR` for owner commands (`stateDir/owner-sockets`). Supply
passwords through `--password-stdin` from an owner-controlled secret source. Never put passwords in command arguments, chat,
repository files, or logs. Close the owner CLI session after administration.

The browser agent receives native `auth_list` and `auth_login`, not vault
management tools. Saved entries need no password-release approval on subsequent
logins. Websites can still require MFA or another owner action. The owner viewer
uses the container's loopback-published port and protected viewer password.

The host application stops services, calls `launch.mjs stop SPEC`, then performs
its normal sandbox cleanup before backup or rollback. The stop command closes
Vercel's native background session and the exact owned container. Profile data
remain on disk. Chromium buffers cookie writes, so abruptly stopping a newly
created session can lose recent state before it reaches disk.

## Boundaries

Claude's workspace profile protects the vault, key, browser profile, controller
state, and Docker socket from native Bash and file tools. Chromium cannot read
the host vault because it is not mounted. These controls do not make the trusted
Vercel process itself filesystem-confined: native screenshots accept an output
path and can overwrite an existing writable host file with image bytes. This
file-corruption risk is accepted; use the configured screenshot directory during
normal work.

Eval remains available. The browser instructions forbid inspecting authentication
material, including cookies and browser storage. This is behavioral guidance,
not technical secrecy for tokens that a website makes readable by JavaScript.

## Validation

Run `node --test test/*.test.mjs` with the supported Node toolchain. The tests use
only synthetic auth data and require local Unix sockets for the native daemon.

The installed acceptance entrypoint is:

```text
node qualify-installed.mjs PACKAGED_BROWSER TRUSTED_SPEC SCRATCH DISPOSABLE_ROOT
```

It requires an explicitly disposable environment, a local Docker daemon, and the
pinned image already present. It tests native login, eval, snapshots, screenshots,
CDP authentication, absence of the vault in Chromium, and persistent-profile
reuse. The companion's installed provider qualification separately checks the
real Claude harness and authentication instructions. Production acceptance is
read-only and never logs in or invokes an agent.
