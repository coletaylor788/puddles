# Rocket Money OpenClaw adapter

Exposes the five Rocket Money MCP tools to main only. The adapter retains one
host subprocess across turns, rechecks configuration on each call, and runs all
returned text through the existing InjectionGuard and SecretRedactor hooks.
Raw MCP metadata and provider diagnostics never reach the model.

Configure `command` (absolute Python 3.11), `stateDir` (absolute private host
state), `llmProvider` (the existing trusted classifier), and optional
`chromeExecutable`. `writesEnabled` defaults to false. Explicitly grant the
five tools to main in both its allowlist and sandbox tool policy.

Build with `pnpm --filter rocket-money build`, then include the Python runtime
as described in the [server README](../../servers/rocket-money-mcp/README.md).
Deploy through the normal immutable artifact lifecycle. The main runtime skill
and desktop launcher are operator configuration, not bundled personal policy.
