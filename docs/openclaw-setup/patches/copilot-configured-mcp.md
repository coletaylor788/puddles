# Configured MCP tools in Copilot

Copilot's host tool bridge constructed core tools but omitted configured MCP
servers. A permitted server could appear in configuration without supplying any
tools to the model. The Link qualification exposed this gap.

The patch materializes static configured servers through the existing session
MCP runtime. The shared final policy applies agent permissions, sandbox limits,
and the current run's allowlist before host binding and tool compaction. Host
binding retains execution hooks and attempt lifetime checks. The Copilot SDK's
separate MCP implementation remains disabled.

Tool construction failures release the MCP lease. Ordinary and deferred attempt
cleanup await its release. The neutral SDK facade uses the existing embedded
runner policy; Codex's additional approval rules remain in its own path.

Regressions cover allowed and denied tools, sandbox and run limits, execution
after the host closes, cleanup after construction failure, and awaiting cleanup.
Installed qualification uses real provider clients and the official Link CLI
against local response fixtures.

The v2026.11.3 port keeps upstream's asynchronous host constructor, SDK dispatch
context, and event-chain joins. It awaits the native capability profile before
applying policy. The neutral facade reuses the shared session runtime without
changing Codex's separate approval contract. The port does not replace stable's
configured-MCP support for Claude or its native grant lifecycle.

Remove this patch when the pinned upstream Copilot adapter provides the same
policy and lifecycle behavior. Roll back through the normal application release path.
