# Puddles CLI integrations

Host applications for the `rocket_money_read`, `rocket_money_write`, and
`weather_curl` OpenClaw tools. The plugin invokes a fixed executable with JSON on
stdin. There is no listening service or sandbox socket. Python 3.11+ is required;
browser authentication and Keychain custody target macOS.

## Development

```sh
python3 -m venv packages/cli-gateway/.venv
packages/cli-gateway/.venv/bin/pip install -e 'packages/cli-gateway[dev]'
packages/cli-gateway/.venv/bin/python -m pytest packages/cli-gateway/tests -q
packages/cli-gateway/.venv/bin/python -m ruff check packages/cli-gateway/src packages/cli-gateway/tests
corepack pnpm --filter cli-gateway build
corepack pnpm --filter cli-gateway test
```

Tests use synthetic sessions, an HTTP recording adapter, temporary state, and a
fake curl process. They do not sign into an account or change real transactions.
The cumulative CI runner includes both the Python tests and plugin workspace tests.

## Request contract

All three executable names (`puddles-cli`, `rmoney`, `puddles-weather`) use the same
host invocation contract. Names are aliases, not separate command parsers:

```sh
printf '%s' '{"mode":"help"}' | /absolute/install/.venv/bin/rmoney \
  --config /absolute/install/policy.json --agent main --tool rocket_money_read
```

Only the trusted plugin supplies identity, executable, policy path, and stable
write request ID. Agent-side shell execution is not an alternate transport.
`mode=help` is offline and describes modes and curl options. `mode=catalog` returns
the exact source-derived GraphQL selection policy. Query input is the native
`{query,variables,operationName}` envelope inside `request`; provider GraphQL
bodies are returned unchanged. Status and batch coverage are local metadata.

Read policy currently covers 53 viewer fields, including transactions, merchants,
categories, balances, budgets, and accounts. It is a reviewed subset derived from
the web application's reduced schema, not full server introspection. Unsupported
fields fail closed. Adding a field requires reviewing its behavior and explicit
selection policy. Free-account availability must still be verified on the host.

Writes permit only `setTransactionCategory` (propagation false) and
`changeTransactionDate`. Each needs the current field in `expected`. The CLI reads
before sending and reads back afterward. The provider exposes no proven atomic
compare-and-set, so another client can still race the check. UUID journals prevent
replaying the same invocation, including after crashes. `operation_status` reports
verified, unknown, conflict, or not-applied outcomes; a batch returns item IDs and
is not atomic. Never treat a successful transport response as proof a write applied.
Unknown outcomes require fresh reads and human resolution, not automatic replay.

Weather accepts curl's native HTTPS arguments to wttr.in and wttr.is within the
published option policy. DNS must resolve only to public addresses and the chosen
address is pinned for the request. Ambient curl configuration, proxy variables,
redirect following, host files, and output paths are unavailable. UTF-8 output is
returned as `body`; binary output as `bodyBase64`. Response limits are 32 MiB for
curl and 16 MiB per GraphQL response. The plugin limits aggregate output to 48 MiB.

## Authentication and state

The operator performs one headed login using `--setup` from a real terminal. The
managed Chromium profile and cookie state live under the protected installation's
state directory. API requests preserve cookie rotation. Expired sessions invoke a
bounded headless silent-login attempt under a cross-process account lock. Identity
is pinned at setup and checked before requests; a different viewer is rejected.
No password, cookie, token, provider header, or browser storage is a tool result.
Provider response bodies themselves are returned without a semantic scanner.

`Keychain` explicitly selects the macOS backend for API keys and standard OAuth
tokens. `OAuthTokens` refreshes and persists rotation for future API integrations.
Rocket Money uses the private browser profile, not an unproven OAuth refresh-token
flow. Weather needs no credential. Standard OAuth helpers are extension building
blocks, not an additional configured service.

Silent restoration on the standalone managed browser, reboot/keychain behavior,
and actual category/date budget effects remain pre-merge host acceptance gates.
No claim of guaranteed permanent noninteractive login is made: provider session
revocation or MFA can require operator interaction. There is no fallback that asks
an agent to access credentials or perform login.

State includes browser data, account identity, locks, operation journals, and
plugin invocation IDs. Files are private; no financial payloads are logged. Keep
journals while retries are possible. Do not delete journals to resolve an unknown
write: doing so removes its duplicate protection. Each journal directory stops accepting new IDs at 10,000 entries.
Retention is operator-managed; records never expire into accidental replay.

## Extension point

A new trusted provider module can call `registry.register(name, handler)`. A
handler receives protected configuration, trusted caller identity, native input,
and optional request ID. Use the existing private state, lock, Keychain/OAuth
helpers. Define endpoint/argument policy in code and tests. Expose a trusted installed distribution entry point under `puddles_cli.providers`
that calls registration. Add its explicit OpenClaw tool schema and an
operator grant. The dispatch mechanism requires no provider-specific changes;
registration alone never grants an agent access. Modules cannot be supplied by a
request or dynamically loaded from agent files.

See [host setup](../../scripts/mac-mini/cli-gateway/README.md),
[plugin](../../openclaw-plugins/cli-gateway/README.md), and
[plan 031](../../docs/plans/031-rocket-money-integration.md).
