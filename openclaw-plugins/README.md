# OpenClaw Plugins

OpenClaw plugins live here. Each subfolder is a self-contained plugin that
[OpenClaw](https://openclaw.dev) loads via `plugins.load.paths` configuration.

The secure service plugins consume [`packages/mcp-hooks`](../packages/mcp-hooks/) to wrap
MCP tools and OpenClaw providers with security checks (egress leak detection,
ingress prompt-injection detection, secret redaction, send approval flows).

`scoped-memory` instead provides tools restricted to the calling agent's own
Markdown notes. It uses the existing OpenClaw memory manager, not MCP hooks.
It rejects unauthorized access and does not fall back to broader memory tools.
See its [README](scoped-memory/README.md) for configuration and access boundaries.

## Layout

```
openclaw-plugins/
├── README.md                  # this file
└── <plugin>/
    ├── openclaw.plugin.json   # OpenClaw manifest (id, name, version, configSchema)
    ├── src/plugin.ts          # plugin registration and tool factories
    ├── package.json           # SDK dependency and package scripts
    └── tsconfig.json          # extends ../../tsconfig.base.json
```

The maintained plugins are:

| Plugin | Plan | Purpose |
|---|---|---|
| `secure-gmail` | [010](../docs/plans/010-secure-gmail-plugin.md) | Wraps Gmail MCP tools with egress + ingress hooks |
| `secure-apple-calendar` | [017](../docs/plans/017-secure-apple-calendar.md) | Wraps apple-pim's calendar MCP tool with ingress + egress hooks |
| `scoped-memory` | [037](../docs/plans/037-openclaw-stable-upgrade.md) | Reads only the trusted calling agent's own Markdown notes |

## Prerequisites

The maintained release is OpenClaw 2026.9.3. These plugins compile against that
exact development dependency and import public types from
`openclaw/plugin-sdk/core`. The retired root SDK entrypoint is not exported by
this release. Use Node 24.16.0 or later on 24.x, or Node 26.1.0 or later, for
the gateway and its native dependencies.

OpenClaw must be installed. The secure service wrappers also need an
`LLMClient` implementation reachable from the gateway. See
[`packages/mcp-hooks/README.md`](../packages/mcp-hooks/README.md) for that
interface. Those wrappers load it through `llmProvider`. The scoped memory
adapter has no additional model client.

## Installing dependencies

This monorepo uses **pnpm workspaces**. From the repo root:

```bash
pnpm install
```

This links each workspace's dependencies. The secure service wrappers link
`mcp-hooks` via `workspace:*`, so library changes are picked up without
republishing. Root build, lint, and test scripts include every plugin.

## Registering a plugin with OpenClaw

Add the plugin's absolute path to your OpenClaw config:

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/Users/<you>/git/puddles/openclaw-plugins/secure-gmail",
        "/Users/<you>/git/puddles/openclaw-plugins/secure-apple-calendar"
      ]
    }
  }
}
```

Per-plugin configuration (trusted domains, model overrides, etc.) goes under
the plugin's id in OpenClaw's `plugins.entries` section, inside `config`.
See each plugin's README for its schema.

## Conventions

Every plugin ships an `openclaw.plugin.json` manifest with its identity and
configuration schema, exposes registration through its declared extension
entrypoint, and extends the root TypeScript configuration.

Secure service wrappers depend on `mcp-hooks` through the workspace and follow
its hook error policy. When a hook blocks, they surface its reason so the user
can act instead of the agent retrying blindly.

Their self-contained ESM bundles use Node's `createRequire` for bundled
CommonJS dependencies that load built-in modules. The bridge belongs to the
published bundle, not the gateway or a deployment-specific loader. The shared
regression pool installs each bundle outside the source tree and resolves its
tool factories without starting a bridge, loading credentials, or using a model.

Restrictive tools are a different boundary. The scoped memory adapter has no
hook dependency and never fails open. Missing permission, disabled memory,
invalid arguments, and backend failures cannot expose a broader read path.

See [`packages/mcp-hooks/docs/architecture.md`](../packages/mcp-hooks/docs/architecture.md)
for the underlying hook contracts.
