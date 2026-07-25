# secure-apple-calendar

OpenClaw plugin that wraps the [apple-pim](https://github.com/omarshahine/Apple-PIM-Agent-Plugin)
MCP server's `calendar` tool with security hooks from
[`mcp-hooks`](../../packages/mcp-hooks/).

It registers **two** OpenClaw `AnyAgentTool`s, both backed by apple-pim's
single `calendar` MCP tool:

| OpenClaw tool | Allowed actions | Typical agent |
|---|---|---|
| `calendar_read` | `list`, `events`, `get`, `search`, `schema` | sandboxed reader |
| `calendar_write` | `create`, `update`, `delete`, `batch_create` | main / write-capable agent |

Each tool's `execute()`:

1. **Action gate** — rejects out-of-set actions before anything else (defence
   in depth on top of the schema enum); the bridge is never spawned for a
   rejected call.
2. Inspects the `action` arg to decide which hooks apply (see table below).
3. Runs **egress** hooks first on mutation actions (`calendar_write`):
   - `ContactsEgressGuard` whenever the event has attendees. Each attendee
     email is checked against `trustedAttendeeDomains` (case-insensitive
     domain short-circuit) and then against iCloud Contacts via
     `ContactsTrustResolver`. Any untrusted attendee blocks the call with
     an action-oriented reason naming the offender.
   - When there are no attendees the call passes through unhooked —
     nothing leaves the user's iCloud account.
4. Calls the underlying MCP tool only if egress allowed.
5. Pipes the text result through **ingress** hooks (`InjectionGuard` +
   `SecretRedactor`) on read actions (`calendar_read`) before returning it
   to the agent.

If any hook returns `block`, the agent receives a sentinel message instead
of the raw content / instead of a successful mutation. If all hooks return
`allow` the original MCP result passes through unchanged.

The other four apple-pim tools (`reminder`, `contact`, `mail`, `apple-pim`)
are intentionally **not registered** by this plugin — defense in depth on
top of any apple-pim per-domain config.

## Per-action hook map

| Action | Ingress | Egress |
|---|---|---|
| `list`, `schema`, `delete` | — | — |
| `events`, `get`, `search` | InjectionGuard + SecretRedactor | — |
| `create`, `update`, `batch_create` (no attendees) | — | — |
| `create`, `update`, `batch_create` (any attendee) | — | ContactsEgressGuard |
| any unknown action | InjectionGuard + SecretRedactor | — (fail-closed for reads) |

## Why this lives in `execute()`

OpenClaw's `tool_result_persist` and `before_message_write` lifecycle hooks
are **synchronous** and reject `Promise`-returning handlers. The hooks need
to await an LLM call, so they can't live there. Wrapping the registered
tool's `execute()` is the only place where async work can run between the
MCP call and the result the agent sees on its next turn.

See [Plan 010](../../docs/plans/010-secure-gmail-plugin.md) for the full
architecture rationale (the same constraint shaped secure-gmail).

## Threat model notes

- **apple-pim already datamarks PIM content** at the source (sentinels
  around event titles, descriptions, etc). Our `InjectionGuard` is the
  second line — it inspects the marked text and uses an LLM to flag
  injection attempts that survived the markup.
- **External calendars (Google, Outlook, etc.) work the same as iCloud**
  calendars from this plugin's perspective — apple-pim talks to EventKit
  which exposes any calendar added to macOS Calendar.app at the OS level.
  The agent sees the same risk surface regardless of source.
- **Attendees are extracted from `args.attendees[].email`**, including
  inside `args.events[]` for `batch_create`. ContactsEgressGuard treats
  the entire attendee list as the recipient set; ALL must be trusted
  (via `trustedAttendeeDomains` or iCloud Contacts) for the call to
  proceed.
- **Trust comes from iCloud Contacts** (read via the `contacts-cli`
  Swift binary) plus the `trustedAttendeeDomains` allowlist. There is no
  runtime allow/deny ladder; to grant trust, add the recipient to
  Contacts. The agent can do this through apple-pim's `contact create`
  if you've registered that tool — but ContactsEgressGuard never names
  Contacts in its block reason, so the agent must learn this from your
  own instruction set.
- **Egress content is focused on free-text fields the agent could leak
  through**: title, location, notes, url. IDs / calendar names / dates /
  durations are excluded — they're not meaningful exfil channels and only
  inflate LLM cost.
- **Calendar invites still route through the source provider's mail
  server.** ContactsEgressGuard evaluates the attendee email — if it's
  a Gmail address, the invite goes through Gmail regardless of which
  calendar the event lives in.

## Install in OpenClaw

### Prerequisites — apple-pim and auth

1. **apple-pim Swift CLIs** installed and built. Clone
   [`Apple-PIM-Agent-Plugin`](https://github.com/omarshahine/Apple-PIM-Agent-Plugin)
   and run:
   ```bash
   cd Apple-PIM-Agent-Plugin
   ./setup.sh --install      # builds the Swift binaries (calendar, reminders, etc)
   cd mcp-server && npm install && npm run build   # builds the MCP server
   ```
2. **Calendar permission** granted to whichever process spawns the
   apple-pim CLIs (typically OpenClaw via this plugin) — macOS will prompt
   on first use; if it doesn't, grant manually in System Settings →
   Privacy & Security → Calendars.
3. **(Optional) External calendars** — to surface Google / Outlook
   calendars, add the account in System Settings → Internet Accounts and
   enable Calendars. Sync latency means newly-created events take seconds
   to a minute to appear in EventKit.
4. **An `LLMClient` implementation** — a Node module resolvable from the
   gateway whose default export implements `mcp-hooks` `LLMClient`. See
   [`packages/mcp-hooks/README.md`](../../packages/mcp-hooks/README.md) for
   the contract and a sample adapter. The plugin loads it via
   `loadLLMProvider(config.llmProvider, { model, ...llmProviderOptions })`.

Verify:

```bash
ls /abs/path/to/Apple-PIM-Agent-Plugin/mcp-server/dist/server.js && echo "apple-pim mcp: OK"
```

### (Recommended) apple-pim domain config

Even though this plugin only registers `calendar`, you can disable other
apple-pim domains at the source for belt-and-suspenders. Create
`~/.config/apple-pim/config.json`:

```json
{
  "items": {
    "mail":      { "enabled": false },
    "reminders": { "enabled": false },
    "contacts":  { "enabled": false }
  }
}
```

### Build, install, enable

```bash
# from the repo root, build the plugin's dist/ first
pnpm install
pnpm --filter secure-apple-calendar build

# then link + enable in OpenClaw
openclaw plugins install -l ./openclaw-plugins/secure-apple-calendar
openclaw plugins enable secure-apple-calendar
openclaw plugins doctor   # surfaces load errors if any
```

After enabling, add the config block below.

## Configuration

| Key | Required | Default | Purpose |
|---|---|---|---|
| `applePimMcpCommand` | ✅ | — | Command to spawn the MCP server. Typically `"node"`. |
| `applePimMcpArgs` | | `[]` | Args appended to the command (path to apple-pim's `mcp-server/dist/server.js`). |
| `applePimMcpCwd` | | — | Working directory for the subprocess. |
| `applePimMcpEnv` | | — | Extra env vars passed to the subprocess. |
| `configDir` | | — | Gateway-level default `APPLE_PIM_CONFIG_DIR`. Overridden per-agent if `<workspaceDir>/apple-pim/config.json` exists. See [Per-agent calendar filtering](#per-agent-calendar-filtering). |
| `trustedAttendeeDomains` | | `[]` | Email domains whose attendees auto-pass the egress guard without a Contacts lookup. Case-insensitive; leading `@` accepted. |
| `llmProvider` | ✅ | — | Node module specifier whose default export implements `mcp-hooks` `LLMClient` (see [`packages/mcp-hooks/README.md`](../../packages/mcp-hooks/README.md)). |
| `llmProviderOptions` | | `{}` | Extra opts forwarded to the provider constructor (merged with `{ model }`). |
| `model` | | — | Model id forwarded to the provider constructor. |
| `auditLogPath` | | `~/.openclaw/logs/secure-apple-calendar-audit.jsonl` | JSONL audit log. |

### OpenClaw config example

```json
{
  "plugins": {
    "load": {
      "paths": ["/Users/<you>/git/puddles/openclaw-plugins/secure-apple-calendar"]
    },
    "entries": {
      "secure-apple-calendar": {
        "config": {
          "applePimMcpCommand": "node",
          "applePimMcpArgs": [
            "/Users/<you>/git/Apple-PIM-Agent-Plugin/mcp-server/dist/server.js"
          ],
          "trustedAttendeeDomains": ["example.com"],
          "llmProvider": "my-llm-adapter",
          "model": "haiku-4-5"
        }
      }
    }
  }
}
```

### Per-agent calendar filtering

`secure-apple-calendar` resolves a per-agent `APPLE_PIM_CONFIG_DIR` at tool
registration time, so each agent can see a different subset of calendars.
This is the same allow/blocklist mechanism `apple-pim-cli` already honors —
single source of truth.

**Where the file goes** (one of `<workspaceDir>/apple-pim/config.json`):

OpenClaw's default-agent gets `defaults.workspace` as its `workspaceDir`;
non-default agents get `<defaults.workspace>/<agentId>`. So with the common
`defaults.workspace = "~/.openclaw/workspace"`:

| Agent | Config path |
|---|---|
| Default agent (e.g. `main`) | `~/.openclaw/workspace/apple-pim/config.json` |
| Other agent (e.g. `reader`) | `~/.openclaw/workspace/reader/apple-pim/config.json` |

If you've set per-agent `workspace` overrides in `~/.openclaw/config.json`,
substitute that path instead.

**Schema** — apple-pim's `PIMConfiguration` Codable struct (Swift). All four
domain blocks are **required** (non-optional in Swift); omitting any one
makes the entire file fail to decode and apple-pim silently falls back to
defaults (warning is stderr-only). For a calendar-only restriction:

```json
{
  "calendars": {
    "enabled": true,
    "mode": "allowlist",
    "items": ["Personal", "Work", "US Holidays"]
  },
  "reminders": { "enabled": false, "mode": "all", "items": [] },
  "contacts":  { "enabled": false, "mode": "all", "items": [] },
  "mail":      { "enabled": false },
  "default_calendar": "Personal"
}
```

- `mode`: `"all"` | `"allowlist"` | `"blocklist"`
- `items`: exact macOS Calendar.app names (case + punctuation matter)
- `default_calendar`: name used when `create` doesn't specify one (omit
  for read-only agents)
- `reminders`/`contacts`/`mail` blocks must be present even though this
  plugin doesn't expose those tools — they're required by apple-pim's
  decoder. Setting `enabled: false` makes them defense-in-depth.

Source of truth: `swift/Sources/PIMConfig/PIMConfiguration.swift` in
[`Apple-PIM-Agent-Plugin`](https://github.com/omarshahine/Apple-PIM-Agent-Plugin).

**Resolution priority** (first match wins):

1. `<workspaceDir>/apple-pim/config.json` exists → use that dir as
   `APPLE_PIM_CONFIG_DIR`
2. Plugin config `configDir` (gateway-wide default)
3. `process.env.APPLE_PIM_CONFIG_DIR` at gateway start
4. Fall back to apple-pim's own `~/.config/apple-pim/`

**Bridge sharing:** agents that resolve to the same config dir share one
apple-pim subprocess (cached for the gateway lifetime). Two agents with no
per-agent config both share the global default bridge.

**Cache invalidation:** *editing* an existing per-agent `config.json` takes
effect on the next bridge spawn (no restart needed — the env var still
points at the same dir, apple-pim re-reads on startup, and bridges are
spawned lazily). *Adding* a new config file is the same — the factory's
`existsSync` check has already locked in the path. *Removing* a config
file requires a gateway restart so the factory re-resolves.

**Backward compat:** if no per-agent config exists anywhere, behavior is
identical to before this feature shipped — one shared bridge against
`~/.config/apple-pim/`.

**Quick verification** — to confirm decoding succeeded, run any
`calendar_read action=list` and check the apple-pim mcp-server's stderr
in the gateway log. A line like `Warning: failed to parse ...
config.json: The data couldn't be read because it is missing` means
you're missing one of the four required domain blocks.

### Per-agent tool allowlist split

Recommended: give the sandboxed reader agent only `calendar_read`, and
give the main agent only `calendar_write` (or both, if main also browses
the calendar). The OpenClaw allowlist is the source of truth — the
plugin enforces the action gate at runtime, but the allowlist is what an
operator audits.

Example `agents.list[0]` (main) `tools.allow` additions:

```json
"calendar_write"
```

Example `agents.list[2]` (reader) `tools.allow` + `sandbox.tools.alsoAllow`
additions:

```json
"calendar_read"
```

## Development

```bash
# from the repo root
pnpm install

# from this directory
pnpm test    # isolated tests (mocked MCP + hooks; no auth)
pnpm lint    # tsc --noEmit
pnpm build   # emits dist/
```

All committed automated tests are isolated, credential-free, and included by
the default repository test command.

## Manual integration smoke test

1. Confirm apple-pim's MCP server and Swift CLIs are installed.
2. Confirm an LLM provider is wired up via `llmProvider` in the OpenClaw config (and any provider-specific env vars are set).
3. Add the OpenClaw config block above.
4. Start an OpenClaw session and ask the agent: "What's on my calendar
   tomorrow?". Verify it returns events and that
   `[secure-apple-calendar] registering calendar tool` appears in the
   OpenClaw logs at startup.
5. Ask: "Create an event 'Coffee with Alice' tomorrow at 10am with
   alice@example.com" (where `example.com` is in `trustedAttendeeDomains`).
   Verify it goes through without an approval prompt.
6. Ask: "Create an event with stranger@unknown-domain.com" (where
   `stranger@unknown-domain.com` is **not** in iCloud Contacts and not
   in `trustedAttendeeDomains`). Verify ContactsEgressGuard blocks with
   a reason naming the recipient.
7. Ask: "Create a personal event titled 'todo' with no attendees".
   Verify it goes through unhooked (no recipient = no egress check).

## Layout

```
secure-apple-calendar/
├── openclaw.plugin.json   # manifest (id + configSchema)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── plugin.ts          # default-exported plugin: register(api)
│   ├── mcp-bridge.ts      # spawns apple-pim mcp-server via stdio
│   ├── wrap-tool.ts       # wrap one MCP tool with per-call ingress + egress
│   └── action-map.ts      # per-action hook routing for `calendar`
└── tests/
    ├── action-map.test.ts
    ├── bridge-cache.test.ts
    ├── plugin.split.test.ts
    ├── prefilter.test.ts
    └── wrap-tool.test.ts
```
