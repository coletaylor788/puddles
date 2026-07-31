# Puddles

A collection of [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers for productivity tools. These servers enable AI assistants like Claude to interact with your productivity apps.

## Servers

| Server | Description | Status |
|--------|-------------|--------|
| [gmail-mcp](./servers/gmail-mcp/) | Gmail integration - read, search, and manage emails | ✅ Ready |

## Quick Start

Each server is self-contained with its own dependencies and setup instructions. See the individual server READMEs for details.

### Gmail MCP

```bash
cd servers/gmail-mcp
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

See [servers/gmail-mcp/README.md](./servers/gmail-mcp/README.md) for full setup instructions including Google OAuth configuration.

## Configuring Claude

After installing a server, configure Claude to use it.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gmail-mcp": {
      "command": "/path/to/puddles/servers/gmail-mcp/.venv/bin/python",
      "args": ["-m", "gmail_mcp"]
    }
  }
}
```

Restart Claude Desktop after saving.

### Claude Code (VS Code / CLI)

Edit `~/.claude/claude.json`:

```json
{
  "mcpServers": {
    "gmail-mcp": {
      "command": "/path/to/puddles/servers/gmail-mcp/.venv/bin/python",
      "args": ["-m", "gmail_mcp"]
    }
  }
}
```

### Finding Your Path

Run this from a server directory to get the exact Python path:

```bash
echo "$(pwd)/.venv/bin/python"
```

## Architecture

```
puddles/
├── packages/
│   └── mcp-hooks/          # TypeScript security hooks library (egress + ingress)
├── openclaw-plugins/       # OpenClaw plugins consuming mcp-hooks
├── servers/
│   └── gmail-mcp/          # Gmail MCP server (Python, self-contained)
│       ├── .venv/          # Server-specific virtual environment
│       ├── pyproject.toml  # Server dependencies
│       ├── src/            # Server source code
│       ├── tests/          # Server tests
│       └── docs/           # Server documentation
├── scripts/
│   └── mac-mini/           # Host scripts for the Mac Mini server
├── docs/
│   ├── plans/              # Cross-cutting implementation plans
│   └── openclaw-setup/     # Mac Mini setup guides
└── .github/
    └── copilot-instructions.md  # Development guidelines
```

**Two ecosystems coexist:**

- **Python servers** (`servers/`) — each MCP server is fully self-contained
  with its own `pyproject.toml` and virtualenv. Install per-server.
- **TypeScript packages + plugins** (`packages/`, `openclaw-plugins/`) —
  managed as a [pnpm workspace](https://pnpm.io/workspaces). Run
  `pnpm install` at the repo root to bootstrap; plugins reference
  `packages/mcp-hooks` via `"workspace:*"`.

### Secret architecture

For OpenClaw host integrations, every long-lived user-supplied credential uses
the shared mode-600 JSON store at `~/.openclaw/secrets.json`. Organize values
under `providers.<service>` and reference them from `openclaw.json` with a file
`SecretRef`; do not make an ad hoc `.env`, inline config value, or
service-specific plaintext file the operator-managed source of truth.

If a runtime surface cannot consume SecretRefs, its setup script may derive the
smallest possible compatibility projection from the shared store. That
projection must be marked, mode 600, lifecycle-owned, removed when its final
consumer is rolled back, and documented as non-canonical. Never commit the
store, projections, tokens, account data, or credential-bearing logs.

See [OpenClaw and agent sandboxing](./docs/openclaw-setup/03-openclaw-and-agent-sandboxing.md#9-secretref--getting-credentials-out-of-the-config)
for the provider shape, JSON-pointer convention, rotation, and safe update
rules.

## Adding a New Server

1. Create a new directory under `servers/`
2. Add `pyproject.toml`, `src/`, `tests/`, and `README.md`
3. Create a virtual environment: `python -m venv .venv`
4. Add the server to the table above

## Adding a New OpenClaw Plugin

See [`openclaw-plugins/README.md`](./openclaw-plugins/README.md) for plugin
conventions. New plugins are picked up automatically by `pnpm install` via
the `openclaw-plugins/*` workspace glob.

## Development

See [.github/copilot-instructions.md](./.github/copilot-instructions.md) for development guidelines.

## License

MIT