# CLI gateway plugin

Registers three optional tools from the trusted OpenClaw tool-factory context.
`main` receives Rocket Money read/write and weather; `household` receives weather.
Other identities receive none. Grants are checked again on every invocation.
A fixed host executable receives native input on stdin and returns JSON on stdout.
The model cannot supply identity, command, policy path, or setup mode.

Build and test with `corepack pnpm --filter cli-gateway build` and
`corepack pnpm --filter cli-gateway test`. Configure absolute `cliPath`,
`configPath`, and `invocationStateDir`; see the [setup guide](../../scripts/mac-mini/cli-gateway/README.md).

The host and installed plugins are trusted. This plugin is not a host sandbox.
Agent exec must remain inside an offline sandbox with no access to this runtime,
state, process control, or container control sockets. Installed OpenClaw must
honor the tool factory identity and tool/sandbox allowlists. That compatibility
must be reverified after the in-progress OpenClaw upgrade before activation.

Subprocesses use no shell, a minimal environment, bounded input/output/time, and
process-group cancellation. Writes get persistent IDs scoped to agent, session,
and tool-call ID. Interrupted writes expose that ID for status lookup. Tool help
is available without network or account login.
