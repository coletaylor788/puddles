# Configured MCP in restricted CLI runs

Restricted Claude runs expose only OpenClaw's loopback tool server. Their catalog
previously omitted configured MCP tools, so an allowed tool could be unavailable
to the model. Link's installed browser qualification exposed this gap.

CLI preparation now acquires configured tools through the existing session MCP
runtime and effective policy. The run owns the lease. Its grant retains the tools
only on the host, alongside the existing prepared capabilities. The gateway adds
them before the ordinary policy pipeline and exact grant filter. Execution keeps
the existing hooks, approval handling, grant lifetime checks, and contained
scripting surface. Ordinary HTTP callers do not receive these tools.

The child still receives only the loopback server and no native tools. Raw MCP
server settings are not merged into restricted client configuration. Name
collisions preserve the existing host tool. Failure and normal cleanup await
lease release; grant replacement fences previously cached tools.

Regressions cover allowed and denied roles, sandbox and empty grant limits,
exclusive client configuration, preparation failures, awaited cleanup, warm
grant transfer, and revocation during execution hooks. Remove this patch when
upstream supplies equivalent policy and lifecycle behavior. Roll back through
the normal application release path.
