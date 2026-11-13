# Vercel browser plugin

Registers stock Vercel agent-browser tools through OpenClaw's plugin API, like
the email integration. The Gateway owns the MCP client. Claude sees the tools
through OpenClaw's existing bridge and keeps its native workspace tools.

The build reads the selected tool catalog from pinned Vercel MCP in an isolated
temporary home. It preserves upstream descriptions and schemas, and passes the
server's native instructions through an agent-scoped OpenClaw prompt hook. Registration is
synchronous; the server starts on the first permitted call. Calls are serialized,
forward cancellation, preserve native results and errors, and never retry actions.
Gateway shutdown closes the connection. The application stop helper owns native
browser session and container cleanup.

Configure `plugins.entries.agent-browser.config` with the host-owned launcher
`command`, `args`, optional `env`, and the permitted `agentId`. Add the exact
`agent_browser_*` tool names to that agent's normal and sandbox tool allowlists.
Do not also register the controller in `mcp.servers`. Other agents receive no
browser plugin tools. Vault management stays outside the agent tool catalog.

Use `pnpm --filter puddles-agent-browser build` and
`pnpm --filter puddles-agent-browser test`. Tests use synthetic data and fake MCP
servers; they never connect to a real account. See the
[browser package](../../packages/agent-browser/README.md) for credential setup,
isolation, accepted limitations, and installed acceptance.
