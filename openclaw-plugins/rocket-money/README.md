# Rocket Money OpenClaw adapter

Exposes the five Rocket Money MCP tools to main only. The adapter retains one
host subprocess across tool registries and turns, rechecks configuration on each call, and runs all
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

## Shared session check

After building and bundling the Python runtime, run:

```sh
node scripts/check-shared-session.mjs dist/plugin.js /absolute/python3.11
```

Run this from the plugin directory. It loads the packaged adapter under two native
OpenClaw plugin instances, calls the real MCP status tool four times against fresh
synthetic state, and requires one subprocess connection. It does not open Chrome
or access a live account. The same command can check an installed plugin entry.
