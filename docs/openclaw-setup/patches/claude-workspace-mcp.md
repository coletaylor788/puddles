# Host MCP for workspace profiles

An explicit Claude profile can set `hostMcp: true` to route configured MCP tools
through the existing OpenClaw bridge while retaining its native workspace tools.
Without this option, workspace profiles expose configured MCP directly to Claude,
which does not use the host bridge's permission handling.

The option selects an exclusive loopback MCP configuration and a filtered host
grant. It does not impose a native tool cap. Caller caps, including an empty cap,
remain stronger. A disabled bridge fails preparation; cleanup releases the
configured tool lease. Profiles without the option keep their existing behavior.

Apply after `claude-configured-mcp.patch`. Regressions cover profile selection,
retained Bash/file tools, exclusive MCP configuration, empty caps, and bridge
failure. Roll back through the normal application release path. Remove when
upstream supports this independent host-MCP selection.
