# Configured MCP in restricted CLI runs

OpenClaw 2026.11.3 natively prepares configured MCP tools through the session
runtime and serves them through its loopback bridge. Its host-only grant stores
the tools, preserves server instructions, applies ordinary agent and requester
policy, and owns cleanup. Ordinary HTTP callers do not receive the extra tools.
Native catalog and grant checks also fence retired or transferred authority.
The old custom grant fields and tool resolver are no longer needed.

The remaining compatibility change propagates exceptional acquisition or tool
materialization failures after native cleanup. The previous patch rejected these
failures; silently proceeding without the tools would hide them. Ordinary server
connection failures remain native catalog diagnostics, including last-good
catalog retention and retry behavior.

The explicit Claude profiles retain exact MCP preauthorization names. Wildcards,
permission expressions and non-MCP names are rejected. Tighter per-run tool caps
still replace native profile permissions, and host tool policy remains active.

Regressions retain policy, sandbox, empty-cap, ordinary-HTTP, name collision,
cleanup, warm-grant transfer and hook-time revocation coverage using native
bundled-tool APIs. Additional failures cover cancelled or retired acquisition and
materialization errors, proving lease release and joined cleanup before rejection.
Native preparation tests continue to exercise a synthetic MCP server across
ordinary and completion turns. No external service or account writes are used.

Apply after the profile patch. Remove the remaining compatibility delta when
native behavior and these regressions agree. Use the normal application release
path for deployment and recovery.
