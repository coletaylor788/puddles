# Session return grant

Permit one agent to return an answer to an existing conversation owned by another
agent while their ordinary cross-agent access remains denied. Configure
`{"senderAgentId":"main","targetAgentId":"household"}` and enable the plugin.

This uses OpenClaw's native scoped session-access API. It grants only `send`,
only between the configured agents, and only for the target's current session
incarnation. It grants no status, history, list, or reverse access. Worker,
cron, and hook sessions cannot request or receive this grant. The plugin checks
current configuration, live session entries, and the current run's loaded plugin
registry. Runtime cleanup retires the provider.

The ordinary agent pair must remain denied. An absent, disabled, or failed plugin
therefore leaves access denied. The sender's instructions still decide whether
the owner authorized the answer and select its exact original conversation.
This plugin does not authorize answer content or replace that instruction boundary.

Exact-session grants suppress OpenClaw's separate peer and announcement turns.
The target's initial turn handles source delivery: use the native current-source
message tool for an external chat, or preserve the already-visible forwarded
answer in a native conversation. The plugin adds no tool, transport, approval
flow, or communication patch.

Run `corepack pnpm --filter session-return-grant test` and
`corepack pnpm --filter session-return-grant lint` from the repository root.
