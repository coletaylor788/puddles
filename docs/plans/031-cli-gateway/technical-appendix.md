# CLI gateway: technical appendix

[Plan 031](../031-rocket-money-integration.md) is the current design. These are planned contracts, not installed capabilities. CLI-backed OpenClaw tools replace the previous sandbox socket/SSH design. Installation is shared; authorization is per agent and tool.

## Tool dispatch and local transport

A Puddles OpenClaw plugin registers three named tools using the public tool factory API. Each factory captures `ctx.agentId` from trusted runtime context. Protected host configuration maps that identity to provider accounts and allowed tools. Missing identity or configuration denies access. Check the current grant on each execution so a cached factory cannot retain revoked permission.

| Tool | Client invocation | Permitted host operation |
|---|---|---|
| `rocket_money_read` | Fixed `rmoney` executable with native requests on stdin | Reviewed queries, bounded query batches/pagination, safe auth/operation status. |
| `rocket_money_write` | Same executable and native envelope | Exactly category/date mutations under the write contract. |
| `weather_curl` | Credential-free client forwards native curl argv and optional stdin | Registered weather runner executes the fixed stock curl binary. |

Tool parameters carry the source request, not an arbitrary command string. Rocket Money accepts native `{query, variables, operationName}`; weather accepts `argv: string[]` and optional request-body input. Use argument arrays with no shell evaluation. Executable paths, environment, account, service location, and scope come from protected configuration/runtime context. Workspace files must be explicitly resolved within the caller's workspace; no model-supplied host document/config path.

The plugin runs in the existing OpenClaw host process. Its CLI connects over **one private macOS Unix socket** to the provider service. Use HTTP over that socket for framing, with Starlette/Uvicorn on the service side. No sandbox mount, new Linux container, SOCKS routing, SSH key, relay, or private TLS certificate is needed. The sandbox continues to use OpenClaw's existing tool channel.

The socket and its parent directory allow only the dedicated service identity and the trusted OpenClaw host identity to connect. Verify permissions and peer identity on macOS. The plugin supplies agent identity and named-tool scope on this trusted connection; the service checks the protected grant again. A caller-provided identity would be forgeable on an agent-accessible socket, so neither direct socket access nor arbitrary host exec may be granted to these agents. This trusts the OpenClaw process and operator-installed plugins. It does not isolate a malicious host plugin from that process's authority.

The service selects the provider/account from protected policy and rejects unknown routes or scopes. No arbitrary network proxy, command execution endpoint, plugin loading, profile selection, or credential export. Service unavailability returns an error with no alternate direct network path. Removing a grant blocks subsequent dispatch; it cannot undo an upstream write already sent.

## Weather curl contract

A read-only Mini check on 2026-09-26 found the installed workspace `skills/weather/SKILL.md` and bundled skill both naming `https://wttr.in/` and the `https://wttr.is/` fallback. Their examples include `format=j1`, `j2`, `3`, `v2`, custom percent format strings, and `?0`. An older managed-skill copy names Open-Meteo; that does not automatically authorize another destination. No installed skill was edited.

Use the actual stock curl binary behind `weather_curl`, preserving native HTTP arguments and endpoint output. Example tool arguments:

```json
{
  "argv": [
    "--fail", "--silent", "--show-error", "--max-time", "20",
    "https://wttr.in/London?format=j1"
  ]
}
```

The same runner supports native URLs for text, custom format strings, terminal output, and PNG:

```sh
curl --fail --silent --show-error --max-time 20 'https://wttr.in/London?format=3'
curl -s 'https://wttr.in/London?format=%l:+%c+%t+%h+%w'
curl -s 'https://wttr.in/London?T'
curl -s 'https://wttr.in/Berlin.png'
```

These are the commands the tool represents; an agent does not need host shell access. Do not invent `weather forecast` or a new weather JSON schema. Support HTTP methods, headers, inline/stdin request bodies, URL/query encoding, and endpoint-supported response formats through curl's existing syntax.

### Host execution boundary

Full endpoint access does not give curl arbitrary access to the host. The runner must validate the complete argv, including short/combined flags, repeated options, `--next`, extra URLs, and options with file or routing effects. Use a documented supported option set for the pinned curl version; reject unknown options rather than hoping they are harmless. Do not silently drop options. This is native curl HTTP support with explicit host-safety restrictions, not a promise to permit every curl flag.

- Permit only HTTPS to the exact registered weather hosts on port 443. Reject URL credentials, IP literals, non-public resolved addresses, other schemes, proxy overrides, `--connect-to`, caller-controlled `--resolve`, and TLS-verification overrides. Pin each connection to its validated address. Disable ambient proxy settings and curl's default config loading (`-q` first).
- Do not enable curl's unrestricted redirect following. Support redirects only through an implementation that checks each new destination before connection; otherwise reject redirect-following options explicitly. No redirect may escape the two registered origins. Verify method/body behavior if bounded redirects are added.
- Run curl as a separate unprivileged weather worker identity with a minimal environment, empty private working directory, and no access to the credential service's home or Keychain. The service launches only the fixed runner using operator-provisioned identity switching, never an arbitrary command supplied by the model. This is a shared host installation, not an image per agent.
- File-bearing arguments (`@file`, `--config`, `.netrc`, cookie jars, client certificates, output/trace paths, and similar options) may not address host files. Workspace uploads/downloads require explicit transfer by the tool wrapper, symlink-safe path checks, and per-call staging owned by the weather worker. Reject unimplemented file options. Binary stdout can be returned as a bounded artifact without granting a host output path.
- No credentials are supplied to curl. Keep stdout separate from bounded stderr/exit metadata; do not emit environment or raw argv in routine logs. Disallow diagnostic modes that expose unrelated process state or write uncontrolled host files.

Curl normally returns the body. Preserve text and JSON bytes; binary output becomes a tool artifact. Do not automatically return upstream headers or semantically inspect weather content. Explicit public-weather `-i`/`-I` requests retain native curl behavior where allowed. These weather headers contain no gateway-injected auth; Rocket Money headers stay private regardless of tool arguments.

Design limits: two active weather requests per agent, 10-second connect deadline, 30-second normal deadline, five-minute absolute deadline, and 32 MiB total output per invocation. Apply hard limits outside curl so arguments cannot raise them. Workspace transfer, runner identity provisioning, safe argv parsing, and exact supported options need implementation tests before describing weather as ready.

## Apple PIM precedent

Read-only source inspection on the Mini found `apple-pim-cli` version 3.7.2 at commit `0370689795a9a563721784d460841717a3c1dce7`:

- `openclaw/src/index.ts` registers five `apple_pim_*` tools through `api.registerTool((ctx) => ...)`. The factory receives workspace context. Handlers invoke a shared CLI runner directly; no MCP server is involved in this plugin.
- `openclaw/lib/cli-runner.js` resolves installed binaries and calls `child_process.spawn(cliPath, args, ...)` with a timeout. The installed `calendar-cli` symlink points to the repository's shared Swift release binary.
- Its configuration/profile overrides are convenience and workspace isolation features, not evidence of an unforgeable per-agent permission boundary. Its runner inherits process environment and can include argv in errors. Do not copy those behaviors into credential-bearing HTTP execution.

Reuse the supported tool factory and shared-executable pattern, with protected grants and sanitized execution context. Puddles' [calendar wrapper](../../../openclaw-plugins/secure-apple-calendar/src/plugin.ts) also separates read/write tools and checks actions at runtime. Its MCP transport and response filters are not required here. See [plugin conventions](../../../openclaw-plugins/README.md).

## Managed executor and limits

The private local HTTP handler uses Starlette/Uvicorn and HTTPX. Only managed adapters, initially Rocket Money, use this lifecycle:

1. **Validate:** check the trusted caller/tool grant, route, fixed account binding, method, media type, size, and complete native request. Reject malformed/duplicate control fields. Parse effective GraphQL operations/fields/arguments and allow only reviewed reads or the two specified mutations.
2. **Prepare:** obtain/renew private auth for an allowed request. Register write IDs and read expected state before a mutation. Only approved private auth/preflight calls occur here.
3. **Execute:** send accepted native GraphQL through HTTPX to the fixed HTTPS origin. Use normal certificate verification, `trust_env=False`, and no automatic redirects or hidden mutation retries.
4. **Return body:** retain the native JSON body, including provider `data`, `errors`, and `extensions`. Do not forward upstream headers. Process applicable `Set-Cookie` privately and emit only handler-owned headers needed for the local protocol, such as Content-Type and Content-Length. No generic semantic inspection, field rewriting, agent routing, or special main-agent receipt.
5. **Record write outcome:** for mutations, perform bounded read-back and persist verification status separately from the native provider response. An uncertain operation is never automatically re-executed.

Reject auth/credential-exporting fields at request validation. Keep local auth exceptions and secret-bearing diagnostics out of transport errors and logs. The handler may parse JSON and validate transport correctness; that is not a general content filter. Unexpected response formats produce a transport error, not fabricated GraphQL data.

A validation failure means no requested business operation executes. A timeout, disconnect, crash, or invalid response after dispatch may still leave a successful upstream write. Record unknown outcome and reconcile it; do not imply that returning an error undid the action.

Design defaults: 1 MiB request, 16 MiB decoded response per operation, 20 operations per batch, two concurrent upstream operations per account, serialized writes, 10-second connect and 30-second normal-operation deadlines. Explicit page/result budgets bound pagination. Auth has a separate bounded deadline. The client may lower limits, not raise protected host policy. Native GraphQL responses can be buffered to enforce size/protocol limits; weather has its own bounded curl output handling.

Disable access/debug/trace dumps and admin/docs endpoints on the managed route. Log generated request ID, registered provider/operation, status, duration, and safe error code only. Keep the private write journal separate, with minimal original/desired values and outcomes, finite retention, and no credentials or whole response bodies. Protect active code, policy, keys, and parent directories outside agent-writable mounts.

Sources: [HTTPX TLS](https://www.python-httpx.org/advanced/ssl/), [environment settings](https://www.python-httpx.org/environment_variables/), [Uvicorn socket/log controls](https://github.com/encode/uvicorn/blob/master/docs/settings.md).

## Authentication contract

Storage and renewal are separate. Keychain can protect a token; it does not implement the provider's refresh flow. Browser profiles contain secrets and require the same protection as credential files.

| Component | Concrete choice and custody |
|---|---|
| API keys / OAuth tokens | macOS Keychain via `keyring.backends.macOS.Keyring`; explicitly select the backend and fail if unavailable, with no plaintext fallback |
| OAuth client | Authlib `AsyncOAuth2Client`; refresh/persistence callback writes the updated token set to Keychain |
| Browser | Playwright for Python, managed Chromium build, dedicated persistent context under the gateway service account |
| Browser storage | `~/Library/Application Support/PuddlesGateway/rocket-money/` under that account; directory mode 0700, state files 0600; outside repository, backups shared with agents, and sandbox mounts |
| Host process | LaunchAgent under a dedicated gateway service identity; initial setup in that identity's GUI session, headless normal operation |

Keychain stores API secrets and OAuth credentials, **not the whole Chromium profile**. Chromium profile data and any explicit Playwright storage-state snapshot are private host files. Save/load state as needed to preserve session cookies across restarts; test this rather than assuming profile persistence suffices. Never print the snapshot or expose an export command to the CLI.

`keyring` does not itself isolate a secret from other programs running as the same user/interpreter. The service identity and host-tool restrictions are part of the boundary. The agent must not be able to run arbitrary code as this identity, read its home directory, use a browser debugging port, or change its startup files.

For standard OAuth, store per-provider/account access and refresh tokens and expiry privately. Preserve existing refresh credentials when a provider does not return a replacement; perform one renewal at a time and persist a consistent token set. Use the provider's legitimate OAuth client/grant, not Rocket Money's server-held client credentials.

For Rocket Money:

1. Operator-only setup in the dedicated service account's GUI session launches its Chromium context with `headless=False` for sign-in/MFA. Verify a bounded authenticated read, then retain the private session state.
2. Keep both the Rocket Money application session and the Rocket Account identity-provider session privately; retaining only one application cookie may prevent silent recovery.
3. For normal API requests, obtain only cookies applicable to the fixed API URL from the private context, attach them only in the native provider HTTP client after validation, and keep GraphQL over HTTP. Correctly process response `Set-Cookie` updates/deletions into the same private session before removing them from CLI responses; use established cookie parsing/scope rules.
4. Normal browser maintenance uses `headless=True`. When authentication expires, navigate the saved context through `https://client-api.rocketmoney.com/auth0/auth/oidc/login` with `silentOnly=true` and the approved app return URL. Verify success with an authenticated read. Existing evidence is from the in-app browser, so repeat it in this managed Chromium context before claiming headless compatibility.
5. Coordinate simultaneous renewal attempts. Transient failures use bounded backoff; interaction-required conditions return a clear repair status without launching interactive login from a model command.
6. Restore state across process restart and test Mini reboot, including credential-store unlock behavior. LaunchAgent/browser availability depends on the service account's login session; FileVault unlock and post-reboot session availability are separate from provider login. Do not claim unattended cold-boot recovery until those prerequisites are verified.

Periodic maintenance is appropriate only if actual behavior demonstrates it renews a sliding session. It cannot override absolute expiry, revocation, or provider-required MFA. No fixed session lifetime or accessible refresh token has been established.

Auth state is explicit: `ready`, `renewing`, `interaction_required`, or `unavailable`. One renewal runs per provider/account; waiting callers receive a bounded status. A failed or revoked session never falls back to another account. Browser and HTTP cookie updates use one coordinated account session so stale browser snapshots do not overwrite rotated API cookies. Test process restarts and concurrent API/browser updates. Other managed adapters use their corresponding auth drivers. The public weather runner does not use this session manager.

Sources: [Authlib async token updates](https://github.com/authlib/authlib/blob/main/docs/oauth2/client/http/httpx.rst), [Playwright persistent context](https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch-persistent-context), [OS credential integration](https://github.com/jaraco/keyring), [Playwright authentication state](https://playwright.dev/docs/auth), [Playwright cookie-sharing request contexts](https://playwright.dev/docs/api/class-apirequestcontext), [Auth0 silent-login limits](https://auth0.com/docs/authenticate/login/configure-silent-authentication).

## Rocket Money API contracts

Production endpoint: `https://client-api.rocketmoney.com/graphql`.

### Native CLI interface

Proposed syntax, not installed:

```sh
rmoney graphql --document query.graphql --variables variables.json --operation-name Explore
rmoney auth status
```

The HTTP payload retains `query`, `variables`, and `operationName`. Accepted GraphQL documents are forwarded unchanged. Preserve source IDs, aliases, fragments, nulls, and the `{data, errors, extensions}` envelope; return the native body without forwarding upstream headers, and distinguish gateway failures from source responses.

Batch input consists of native request envelopes. The host executes them individually; it does not assume Rocket Money supports an HTTP batch-array API. Pagination helpers explicitly identify the source connection and cursor variable; return per-page source envelopes and separate coverage metadata. Do not imply complete results when a limit stops pagination. Expected-state checks and execution status are local controls, not invented Rocket Money variables.

### Broad reads

The public client exposes a reduced schema, exact operation documents, and 52 cataloged viewer fields across transactions, categories/rules/tags, accounts, spending/income/budgets, recurring items, net worth/debt, goals/credit, and capabilities. See [read catalog](read-catalog.json).

The catalog is discovery evidence, not an authoritative full schema or proof that every field is available on the free account. Full server introspection is disabled; some public schema types are collapsed to `Any`.

Known transaction inputs include text query, ordering, account/category IDs, amount bounds, date bounds, page size, and cursor. Validate additional cataloged filters, amount units/signs, entitlement limits, and aggregate inclusion rules through authenticated reads.

Policy must inspect field paths, fragments, aliases, effective variables, and directives. GraphQL queries can still have side effects: for example, `viewer.budgetPlan` exposes `createCurrentPlan`. Deny creation paths unless an explicitly safe contract is verified. Exclude auth/token fields, opaque credential-bearing payloads, and account-management operations. Never silently rewrite disallowed arguments.

### Category update

Observed source operation:

```graphql
mutation SetTransactionCategory($input: SetTransactionCategoryInput!) {
  setTransactionCategory(input: $input) {
    updatedTransactions {
      id
      ignoredFrom
      category { id label }
    }
  }
}
```

Observed native input:

```json
{
  "input": {
    "transactionNodeId": "<source transaction ID>",
    "transactionCategoryNodeId": "<existing category ID>",
    "categorizeAllRelatedTransactions": false
  }
}
```

Require explicit `false` for propagation; reject omission, null, true, unknown input keys, and other mutation routes. No custom-category or rule creation.

### Date update

Observed source operation:

```graphql
mutation ChangeTransactionDate($input: ChangeTransactionDateInput!) {
  changeTransactionDate(input: $input) {
    transaction { id date }
  }
}
```

Observed native input:

```json
{
  "input": {
    "transactionNodeId": "<source transaction ID>",
    "date": "2026-09-30"
  }
}
```

The UI submits an ISO calendar date. Keep `date`, `posted_date`, and `authorized_date` distinct. The proposed Venmo workflow inspects a reimbursement, applies the explicitly requested date/category adjustment, then checks transaction data and monthly budget/spending views. Budget inclusion and preservation of original bank-date metadata remain to be tested.

### Write execution

Only these two mutation fields and verified input keys are allowed; operation names do not grant authority. Selection sets must also satisfy read policy. Resolve searches to explicit transaction IDs before updates.

Read back each change. Batches and aliased mutation fields are not atomic. Expected-state checks detect staleness but are not server compare-and-swap. On a timeout, inspect current state before retrying. Restoration uses the same two operations and must not overwrite subsequent unrelated edits. Keep original values and outcomes in a private audit journal. The CLI assigns a UUID before sending a write and retains it across connection errors; the host binds it to the trusted agent/tool grant, account, and a canonical request fingerprint. A duplicate ID with changed content is rejected. A matching completed or uncertain request returns its recorded status, never an automatic second execution. Journal an in-flight intent before sending so a restart cannot mistake an uncertain write for a new operation. This is local replay protection, not a claim of exactly-once upstream execution.

V1 excludes remote changes to amounts, names, notes, flags, tags, ignore/tax status, splits, rules, category definitions, budgets, accounts, subscriptions, payments, and transaction creation/deletion. Existing metadata may be read. Local review flags can be considered separately later.

## Local API and CLI contract

The shared rmoney frontend sends HTTP over the private host Unix socket. The OpenClaw wrapper supplies trusted invocation context. The service checks the agent/tool grant and binds it to an account; no caller-selectable upstream URL or account credential.

| Route | Payload | Result |
|---|---|---|
| `POST /v1/providers/rocket-money/graphql` | Native `{query, variables, operationName}` | Native GraphQL body for both reads and mutations. |
| `POST /v1/providers/rocket-money/graphql/batch` | Bounded array of native envelopes | Ordered native per-item results and separate execution/coverage metadata. |
| `GET /v1/providers/rocket-money/status` | None | Auth/availability status, no session export. |
| `GET /v1/operations/<request-id>` | None | Recorded verification outcome for the configured account/grant. |

A separate `POST /v1/providers/weather/curl` route accepts native argv plus optional body input from the authorized tool. It executes only the registered curl runner, subject to the weather contract. This envelope describes CLI execution, not a weather data schema.

```sh
rmoney graphql --document query.graphql --variables variables.json --operation-name Explore
rmoney graphql --document change-date.graphql --variables change-date.json
rmoney batch --requests requests.json
rmoney auth status
rmoney operation status <request-id>
```

The CLI assigns a UUID before sending a write and retains it across retries, using `Puddles-Request-Id` on the request. A stable batch ID and item index determine each recorded item ID. IDs do not grant authority. Reuse with changed content is rejected. Expected-value controls are bounded local metadata referencing source fields, never invented GraphQL variables. Document their exact encoding during implementation and reject unknown controls.

Return native GraphQL error bodies unchanged. Gateway failures use a separate transport shape such as `{gateway_error: {code, request_id, outcome}}` and stable CLI exit statuses. Codes include `POLICY_DENIED`, `INVALID_REQUEST`, `AUTH_REQUIRED`, `UNAVAILABLE`, `LIMIT_EXCEEDED`, `UPSTREAM_ERROR`, and `OUTCOME_UNKNOWN`. No raw local exceptions, auth headers, or cookie/body excerpts in gateway diagnostics.

The managed response is body-only with handler-owned HTTP framing/content-type headers. Operation status is a separate local record (`verified`, `not_applied`, `conflict`, `unknown`), not a replacement finance schema. A duplicate completed or uncertain mutation returns recorded execution status without making a second upstream call; document this local replay response distinctly from a fresh native provider response. Partial batches and limited pagination never claim atomicity or full coverage.

## Agent installation and access

Install the Puddles plugin, credential-free CLI frontends, and fixed curl binary once on the Mini through the repository's release workflow. Keep active binaries, manifests, configuration, and parent directories outside agent-writable paths. Use explicit binary paths; do not discover executables from an agent's `PATH`. Sandbox images remain unchanged.

Load the plugin with OpenClaw's normal plugin configuration. Grant named tools through per-agent tool policy and the sandbox tool forwarding policy where required. Protected gateway configuration binds each trusted agent ID to matching tool grants and a provider account. Both layers must permit the operation. Missing or inconsistent configuration denies it. Verify current deployed OpenClaw semantics during implementation.

Illustrative grants, not live configuration:

| Agent role | Tools |
|---|---|
| Weather reader | `weather_curl` |
| Finance reader | `rocket_money_read` |
| Finance editor | `rocket_money_read`, `rocket_money_write` |
| Other agents | None unless explicitly assigned |

The distinction is enforced at execution, not just by omitting tools from model context. The read tool rejects mutations even when hidden behind aliases, batches, fragments, or misleading operation names. The write tool still cannot perform changes beyond the two approved fields. Status queries only expose records within the caller's authorized account/grant.

Distribute usage skills through the existing skill mirror and per-agent skill selection. Skills teach native GraphQL and curl arguments, available tools, and partial/uncertain outcomes. They do not install executable dependencies or grant capabilities. Do not mount the host socket or credentials into any sandbox; ordinary sandbox exec must be unable to reproduce a privileged host tool call. An agent with unrestricted host exec is outside this isolation model and needs an explicitly different trust decision.

Changing access requires protected configuration, not a new image build. Check current grants at dispatch, disable removed tools for new calls, and verify denial from already-open sessions. Revocation does not undo requests already sent upstream. Register tools synchronously using the public SDK factory API; follow [plugin conventions](../../../openclaw-plugins/README.md), [sandbox/tool policy](../../openclaw-setup/03-openclaw-and-agent-sandboxing.md), and the [skill mirror](../completed/020-sandbox-skill-mirror.md).

## Provider extension contract

Each provider supplies a named tool/skill and a protected registration:

| Execution type | Provider contribution | Shared behavior |
|---|---|---|
| Native CLI runner, as for weather | Fixed binary, native argv policy, destination policy, safe runtime identity and artifact rules | Tool grants, bounded execution, native output transport. |
| Managed HTTP adapter, as for Rocket Money | Native request validator, auth driver, fixed upstream request builder, optional write verification | Tool grants, private auth custody, HTTPS execution, body-only results, logging and limits. |

The validator produces an immutable allowed operation before execution. No missing result, exception, or absent adapter produces generic passthrough. Response handling owns protocol/size checks and private auth-header processing, not a mandatory content-filter extension. Adapters and plugin code are trusted operator-installed code.

Adding a provider requires its registration, implementation, CLI/skill, tool grant definitions, and behavior fixtures. It must not modify existing providers or the shared dispatch/execution control flow. Prove that with a test provider. No dynamic module installation, agent-controlled binary/config paths, upstream forks, or plugin marketplace.

## Package layout

Proposed locations, all within Puddles:

```text
openclaw-plugins/cli-gateway/  Named tools, trusted context, CLI invocation
packages/cli-gateway/         Host service, auth, dispatch and execution limits
clis/rocket-money/            rmoney frontend, native operations, adapter and skill
clis/weather/                Thin curl client, runner policy and skill integration
scripts/mac-mini/cli-gateway/ Shared host install, identities, socket and service
```

The weather client forwards native curl arguments; stock curl performs the HTTP request. It does not implement weather forecasts. Deploy protected host artifacts from reviewed source. Skills and bounded request/output files may enter agent workspaces; credentials, browser profiles, service configuration, and active executables may not. Python and TypeScript packages may coexist; final paths follow current repository conventions.

## Research evidence

| Finding | Evidence strength |
|---|---|
| API endpoint, cookie-based web transport, source category/date contracts | Inspected production web code and UI call sites |
| Normal GraphQL request reaches authentication checking | Anonymous request returned `GRAPHQL_REQUIRES_AUTHENTICATION` |
| Full introspection disabled | Direct read-only schema request rejected explicitly |
| Transaction details, category picker, date picker available | Inspected authenticated UI without changing data |
| Silent route requests `prompt=none`, `offline_access`, code + PKCE | Live anonymous redirect probe; callback belongs to Rocket Money's server |
| Silent recovery from inactivity logout works in the existing browser | Live navigation restored the authenticated dashboard without password or MFA |
| Mini/headless/standalone renewal, cookie rotation, maximum identity-provider lifetime | Not yet verified |
| Free-account entitlement values and successful mutations | Not yet verified; UI availability is not sufficient proof |
| Apple PIM shared CLI-backed tool pattern | Installed source inspected; new plugin permissions and local transport not yet tested |

The anonymous silent probe returned `login_required`; the authenticated browser probe restored access. No session store was exported and no financial mutations were performed. `offline_access` does not prove that a refresh token is issued to or accessible by our integration.

Machine-readable evidence: [research-evidence.json](research-evidence.json). Production build: `6e650d09e6`; [application bundle](https://app.rocketmoney.com/_next/static/chunks/pages/_app-50d1b9c675d9ef42.js), [transaction bundle](https://app.rocketmoney.com/_next/static/chunks/pages/transactions-62cb97afdc04e906.js). [Official category help](https://help.rocketmoney.com/en/articles/3332081-editing-and-creating-transaction-categories).

## Alternatives and source references

| Option | Useful existing capability | Tradeoff for this project |
|---|---|---|
| **OpenClaw tools + provider application + HTTPX/curl** | Reuse public tool factories, CLI processes, HTTP libraries, and host-local IPC; adapter owns request policy/auth/execution | Current choice; weather uses a constrained native curl runner |
| **Envoy + `ext_proc`** | Supported separate-process policy hook | Earlier choice; successful early close can skip further inspection, and adding independent gates plus private mTLS is unnecessary complexity for v1 |
| **Mitmdump + Python add-ons** | Lightweight async request/response extensions | Hook exceptions are logged rather than automatically blocking traffic; more failure/streaming safeguards for us |
| **YARP + .NET middleware** | Supported reverse-proxy library and custom transforms | Credible single-application option, but introduces .NET and still needs provider/auth code |
| **Agent Vault** | Credential injection, encrypted storage, standard OAuth refresh, TLS interception | Host/path matcher does not enforce GraphQL bodies; still needs a separate guarded Rocket Money adapter |
| **claw-wrap** | Keychain, host daemon, registered CLI execution, credential helpers | Host-execution model and Docker/macOS transport need validation; credential-helper timeout is not a natural browser-renewal interface |
| **Fully custom proxy/vault** | Complete control | More infrastructure and security lifecycle to own; unnecessary where public extension interfaces suffice |

No maintained forks are acceptable. Supported configuration, public extension protocols, and ordinary library dependencies are acceptable. Pin versions and test upgrades. The Envoy audit identified a concrete mismatch; the revised proposal uses public OpenClaw extension APIs and ordinary libraries without modifying upstream internals. Earlier SSH/SOCKS transport exploration is superseded by host-side tool execution.

Sources: [mitmproxy add-ons](https://docs.mitmproxy.org/stable/addons/overview/) and [streaming/event behavior](https://docs.mitmproxy.org/stable/api/events.html); [YARP middleware](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/middleware); [Agent Vault service matching](https://github.com/Infisical/agent-vault/blob/45452c396986b99b947872d709e863ae339c0f41/docs/learn/services.mdx); [claw-wrap configuration](https://github.com/dedene/claw-wrap/blob/d4140a33f6b6a156586f6e0cca87295293c7fd26/docs/CONFIG.md).

## Runtime validation cases

- Tool access: correct per-agent visibility and execution, deny missing/forged identity, policy mismatch, disabled tools, revoked grants in existing sessions, unauthorized status access, and read-tool mutations. Prove sandbox exec cannot reach the private socket or invoke host binaries.
- Host boundary: protected socket permissions and peer identity, explicit binary paths, clean subprocess environment, no shell evaluation, denied host config/file access, service downtime, and separate weather/credential identities.
- Native curl: skill examples, JSON/text/PNG, native methods/headers/bodies, safe workspace transfers, TLS verification, allowed fallback, destination pinning, redirects, short/repeated/combined flags, `--next`, extra URLs, file options, config files, proxy/routing overrides, symlinks, and finite byte/time limits. Unknown/unsupported options fail explicitly.
- Managed requests: aliases/fragments/variables/directives, side-effectful reads, propagation, invalid input, early return/exception, auth failure, wrong TLS certificates, redirects, ambient proxy isolation, oversize/malformed responses, and native body/error preservation.
- Credentials: synthetic canaries in private cookie/auth headers, auth errors, and logs. Prove upstream auth headers never reach the managed client response. Test browser/HTTP rotation, concurrent renewal, and process restart without printing state.
- Writes: intent before send, expected-state mismatch, duplicate IDs with changed payload, partial batches, timeouts/disconnects/crashes, read-back and unknown outcomes, and no automatic repeat/rollback.
- Distribution/extension: shared installation with unchanged sandbox images, distinct tool grants, skills without authority, and a test provider added without changing shared dispatch.

Permission enforcement, safe curl argv/worker provisioning, service-account GUI/Keychain/reboot lifecycle, and free-account coverage remain implementation gates. Apple PIM source inspection proves the reuse pattern, not the future integration's security. Resolve these in the [implementation phases](../031-rocket-money-integration.md#implementation) without silently adding destinations or weakening request policy.
