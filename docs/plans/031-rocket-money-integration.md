# Plan 031: CLI gateway for Rocket Money and weather

**Status:** Design recorded; implementation deferred
**Issue:** None
**Last updated:** 2026-09-26

## Human section

### Design

Build Rocket Money and weather command-line tools and skills inside Puddles. Rocket Money keeps native GraphQL semantics for broad financial exploration, with updates limited to existing transaction categories and dates. Weather includes location lookup, current conditions, and hourly and daily forecasts. A shared provider interface makes further integrations possible without forks.

A native service on the Mini validates each request, obtains private credentials, executes HTTPS, and inspects the complete response before releasing it. Scoped Unix sockets reach that service through host-initiated OpenSSH forwarding. This avoids private TLS certificate management. The provider service replaces Envoy because the reviewed external-processing flow could stop inspection early.

API secrets and OAuth tokens stay in macOS Keychain. Rocket Money uses a dedicated private Chromium profile managed through Playwright. Initial sign-in may be interactive; normal renewal should be unattended. Raw source data goes to isolated readers, while authorized writes return bounded receipts.

### Status

The design and supporting research are recorded. No runtime is installed and no financial updates have been made. Browser silent login was observed, but unattended renewal on the Mini, free-account coverage, and the effect of changing dates on budgets still require verification.

Implementation is deferred at the requester’s direction. The first step is to prove scoped transport and failure handling with synthetic credentials, then validate authentication and deliver both integrations. Weather provider selection remains part of that work.

## Agent section

### State

This is the canonical current design. The requester accepted the provider-service direction and requested that the design be checked in for later implementation. Research date: 2026-09-26. No CLI, skill, proxy, or Mini service has been installed; no financial mutations have been performed.

### Scope and acceptance criteria

- **Rocket Money reads:** broad financial exploration, transaction details, filters, batches, pagination, and aggregates, subject to the free account's actual access.
- **Rocket Money updates:** existing transaction category and transaction date only, using explicit transaction IDs. This covers moving a Venmo reimbursement into the intended budget month; its effect on budgeting will be verified.
- **Native GraphQL:** preserve source documents, variables, field names, aliases, and response envelopes. No replacement financial schema or silent query rewriting.
- **Weather:** location lookup, current conditions, and hourly/daily forecasts, with clear units, time zones, and data freshness; delivered through a working CLI and skill.
- **Ready to extend:** a documented provider interface, starter module, and reusable contract tests. New integrations add provider code and registration without forks or changes to the shared request pipeline.

V1 excludes other financial writes, a management UI, transparent support for arbitrary existing CLIs, and system-wide Internet filtering. The private bridge and provider executor must pass acceptance checks before live credentials.

### Architecture and decisions

#### Recommendation

Build **Rocket Money and weather CLIs + skills in Puddles**, backed by a native macOS provider service. That service owns the complete operation: validate the request, obtain credentials, execute HTTPS, inspect the response, and release the permitted result. Use maintained libraries and **no forks**.

```text
Sandbox CLI                      Mini host
(network: none)                   provider service
      │                          policy · auth · Keychain
Linux Unix socket ── SSH tunnel ── macOS Unix socket
                                       │
                                 verified HTTPS
                                       │
                              Rocket Money / weather
```

A restricted Linux relay exposes the socket inside Docker. The host initiates a persistent OpenSSH reverse forward into that relay. Setup provisions SSH keys and pinned identity; supervision reconnects automatically. Upstream HTTPS uses normal server-certificate/hostname verification. There is no private CA or TLS certificate-renewal work for the user.

Use **Starlette/Uvicorn + HTTPX** for the application, **Keychain/keyring + Authlib** for API credentials/OAuth, and **Playwright Chromium** for Rocket Money's private browser session. Envoy and `ext_proc` are removed from v1. The [audit](031-cli-gateway/envoy-security-review.md) and [decision record](031-cli-gateway/security-resolution.md) explain that choice; this document is the canonical current design.

#### Authentication and boundaries

- **Secrets:** macOS Keychain through Python `keyring`, explicitly using its macOS backend, for API keys and OAuth tokens.
- **Standard OAuth:** Authlib's async OAuth client, with refreshed tokens persisted to Keychain.
- **Browser auth:** Playwright for Python with its managed Chromium build and a dedicated private host profile. Visible browser for initial sign-in/MFA; headless for normal session maintenance. Browser state stays outside the repo and all agent mounts.

The provider runs under a dedicated macOS service identity. The model receives neither upstream secrets nor access to its browser/debugger. Headless renewal and reboot/unlock behavior are acceptance checks, not yet verified capabilities.

The service restricts callers, accounts, destinations, and operations. Validation or auth failures block forwarding. Cookies and tokens never appear in CLI output or logs. Updates receive read-back verification; uncertain writes are reconciled before retry.

**Verified:** Rocket Money's silent-login route restored your browser from its inactivity logout screen without password entry or MFA. **Still to prove:** renewal in the Mini service, restart/reboot behavior, and the underlying session lifetime. The acceptance target is initial setup plus exceptional repair, with no scheduled manual login.

#### A. Architecture and execution boundary

The private socket carries service-scoped HTTP requests into a trusted native application. It has no generic forwarding fallback, shell endpoint, or alternate-origin parameter. The ASGI application uses a protected registry to select installed provider modules. Client checks improve errors; the host repeats every security check.

| Component | Owns | Does not receive |
|---|---|---|
| Sandbox CLI and skill | Native request construction, help, formatting | SSH keys, provider credentials, browser state |
| Linux SSH relay | Scoped socket and encrypted byte transport | Provider credentials, host home, Docker daemon socket |
| Host service | Caller policy, execution, response release, recovery | Agent-selected executable/module/configuration paths |
| Provider modules | Native validation, auth integration, response rules | Authority to expand a caller's configured grants |
| Private state | Keychain credentials, browser state, bounded write journal | Agent filesystem access |

The relay sees request/response data and can exercise its provisioned scope if compromised. It is trusted transport. Provider modules share the host process's trust and are reviewed deployed code; an interface or Python type is not a sandbox against a malicious module.

##### Execution sequence

1. **Admit:** bind the request to the trusted listener scope; enforce route, provider/account grants, method, media type, and limits. Ignore no security-relevant ambiguity: reject duplicate/unknown control fields and malformed JSON.
2. **Validate:** parse the complete native payload, resolve the chosen GraphQL operation/variables, classify read or one of the allowed writes, and validate every requested field and argument. Construct an immutable validated operation. No provider request is sent at this stage.
3. **Authorize and prepare:** verify required capability and response audience. For a write, register its request ID and check current expected values. Obtain/renew the private session only for an authorized operation. Renewal may call the fixed identity-provider endpoints; it cannot execute the user's financial operation.
4. **Execute:** the shared executor builds a request to the registered fixed origin/path, attaches applicable credentials internally, and calls HTTPX. No redirects, arbitrary URLs, caller credentials, ambient proxy overrides, or hidden retries. Credential rotation and account locking are handled by the private session manager.
5. **Inspect:** read a bounded response, including decoded-size checks. Process applicable cookie rotation privately. Validate native JSON and the allowed response shape/audience, remove credential-bearing metadata, and preserve permitted native data/errors. No upstream bytes are yielded to the client before this completes.
6. **Verify and release:** reconcile writes through bounded private reads, record their outcome, then emit either the allowed native envelope or a restricted main-agent receipt. Exceptions, absent return values, cancelled tasks, and incomplete inspection produce a sanitized error, never passthrough data.

A pre-execution rejection results in zero business-operation calls. Once execution begins, a timeout, disconnect, crash, or failed response check may mean a write succeeded. That case is recorded as uncertain and reconciled; there is no automatic rollback or replay. Releasing a safe error does not imply that the upstream action was undone.

##### Defaults and limits

Require explicit protected settings and a registered provider; absent config fails startup. Disable application debug mode, API docs/admin routes on capability listeners, forwarded identity headers, server access logs, and HTTP-client debug/trace. Construct responses explicitly instead of copying upstream headers. `Set-Cookie`, auth material, internal diagnostic headers, and raw exceptions never enter CLI output.

Initial **design defaults**, to verify with representative queries: 1 MiB request, 16 MiB decoded response per operation, at most 20 operations per batch, at most two concurrent upstream operations per account, sequential writes, 10-second connect and 30-second normal-operation deadlines. Pagination must have an explicit page/result budget. Use separate bounded auth-renewal deadlines and report renewal in progress rather than holding requests indefinitely. All limits are protected host policy; a CLI may request lower limits but cannot raise them. Inspect each batch item before returning it; results are non-atomic and include explicit coverage/outcome information.

Keep log fields to generated request ID, provider, approved operation class, status, duration, and safe error code. Redaction is defense in depth, not permission to log raw finance or secrets. The private write journal contains minimal original/desired values and outcomes, has separate access/retention controls, and contains no credentials or whole response bodies.

Sources for reused transport behavior: [HTTPX TLS](https://www.python-httpx.org/advanced/ssl/), [environment isolation](https://www.python-httpx.org/environment_variables/), [Uvicorn socket/logging controls](https://github.com/encode/uvicorn/blob/master/docs/settings.md). These libraries are dependencies to pin and test, not evidence that our future application is already safe.

#### B. Credential and authentication lifecycle

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

Auth state is explicit: `ready`, `renewing`, `interaction_required`, or `unavailable`. One renewal runs per provider/account; waiting callers receive a bounded status. A failed or revoked session never falls back to another account. Browser and HTTP cookie updates use one coordinated account session so stale browser snapshots do not overwrite rotated API cookies. Test process restarts and concurrent API/browser updates. Standard OAuth and keyless providers use the same execution pipeline with their own auth driver.

Sources: [Authlib async token updates](https://github.com/authlib/authlib/blob/main/docs/oauth2/client/http/httpx.rst), [Playwright persistent context](https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch-persistent-context), [OS credential integration](https://github.com/jaraco/keyring), [Playwright authentication state](https://playwright.dev/docs/auth), [Playwright cookie-sharing request contexts](https://playwright.dev/docs/api/class-apirequestcontext), [Auth0 silent-login limits](https://auth0.com/docs/authenticate/login/configure-silent-authentication).

#### C. Rocket Money API contracts

Production endpoint: `https://client-api.rocketmoney.com/graphql`.

##### Native CLI interface

Proposed syntax, not installed:

```sh
rmoney graphql --document query.graphql --variables variables.json --operation-name Explore
rmoney auth status
```

The HTTP payload retains `query`, `variables`, and `operationName`. Accepted GraphQL documents are forwarded unchanged. Preserve source IDs, aliases, fragments, nulls, and the `{data, errors, extensions}` envelope; redact credential-bearing diagnostics if encountered and distinguish gateway failures from source responses.

Batch input consists of native request envelopes. The host executes them individually; it does not assume Rocket Money supports an HTTP batch-array API. Pagination helpers explicitly identify the source connection and cursor variable; return per-page source envelopes and separate coverage metadata. Do not imply complete results when a limit stops pagination. Expected-state checks and execution status are local controls, not invented Rocket Money variables.

##### Broad reads

The public client exposes a reduced schema, exact operation documents, and 52 cataloged viewer fields across transactions, categories/rules/tags, accounts, spending/income/budgets, recurring items, net worth/debt, goals/credit, and capabilities. See [read catalog](031-cli-gateway/read-catalog.json).

The catalog is discovery evidence, not an authoritative full schema or proof that every field is available on the free account. Full server introspection is disabled; some public schema types are collapsed to `Any`.

Known transaction inputs include text query, ordering, account/category IDs, amount bounds, date bounds, page size, and cursor. Validate additional cataloged filters, amount units/signs, entitlement limits, and aggregate inclusion rules through authenticated reads.

Policy must inspect field paths, fragments, aliases, effective variables, and directives. GraphQL queries can still have side effects: for example, `viewer.budgetPlan` exposes `createCurrentPlan`. Deny creation paths unless an explicitly safe contract is verified. Exclude auth/token fields, opaque credential-bearing payloads, and account-management operations. Never silently rewrite disallowed arguments.

##### Category update

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

##### Date update

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

##### Write execution

Only these two mutation fields and verified input keys are allowed; operation names do not grant authority. Selection sets must also satisfy read policy. Resolve searches to explicit transaction IDs before updates.

Read back each change. Batches and aliased mutation fields are not atomic. Expected-state checks detect staleness but are not server compare-and-swap. On a timeout, inspect current state before retrying. Restoration uses the same two operations and must not overwrite subsequent unrelated edits. Keep original values and outcomes in a private audit journal. The CLI assigns a UUID before sending a write and retains it across connection errors; the host binds it to caller scope, account, and a canonical request fingerprint. A duplicate ID with changed content is rejected. A matching completed or uncertain request returns its recorded status, never an automatic second execution. Journal an in-flight intent before sending so a restart cannot mistake an uncertain write for a new operation. This is local replay protection, not a claim of exactly-once upstream execution.

V1 excludes remote changes to amounts, names, notes, flags, tags, ignore/tax status, splits, rules, category definitions, budgets, accounts, subscriptions, payments, and transaction creation/deletion. Existing metadata may be read. Local review flags can be considered separately later.

#### F. Alternatives and the revised selection

| Option | Useful existing capability | Tradeoff for this project |
|---|---|---|
| **Provider application + HTTPX + OpenSSH** | Reuse maintained HTTP/server and secure transport libraries; provider owns the complete operation | Current proposal; we own the small dispatcher/executor and provider modules, and must prove the bridge |
| **Envoy + `ext_proc`** | Supported separate-process policy hook | Earlier choice; successful early close can skip further inspection, and adding independent gates plus private mTLS is unnecessary complexity for v1 |
| **Mitmdump + Python add-ons** | Lightweight async request/response extensions | Hook exceptions are logged rather than automatically blocking traffic; more failure/streaming safeguards for us |
| **YARP + .NET middleware** | Supported reverse-proxy library and custom transforms | Credible single-application option, but introduces .NET and still needs provider/auth code |
| **Agent Vault** | Credential injection, encrypted storage, standard OAuth refresh, TLS interception | Host/path matcher does not enforce GraphQL bodies; still needs a separate guarded Rocket Money adapter |
| **claw-wrap** | Keychain, host daemon, registered CLI execution, credential helpers | Host-execution model and Docker/macOS transport need validation; credential-helper timeout is not a natural browser-renewal interface |
| **Fully custom proxy/vault** | Complete control | More infrastructure and security lifecycle to own; unnecessary where public extension interfaces suffice |

No maintained forks are acceptable. Supported configuration, public extension protocols, and ordinary library dependencies are acceptable. Pin versions and test upgrades. The Envoy audit identified a concrete mismatch; the revised proposal uses ordinary libraries and OpenSSH without modifying upstream internals.

Sources: [mitmproxy add-ons](https://docs.mitmproxy.org/stable/addons/overview/) and [streaming/event behavior](https://docs.mitmproxy.org/stable/api/events.html); [YARP middleware](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/servers/yarp/middleware); [Agent Vault service matching](https://github.com/Infisical/agent-vault/blob/45452c396986b99b947872d709e863ae339c0f41/docs/learn/services.mdx); [claw-wrap configuration](https://github.com/dedene/claw-wrap/blob/d4140a33f6b6a156586f6e0cca87295293c7fd26/docs/CONFIG.md).

This plan consolidates the earlier standalone drafts. It is the current source for provider scope, authentication, and the revised provider-service selection. [Plan 032](032-cli-network-capabilities.md) supplies the CLI-only and reader-ingress constraints; concrete transport/API decisions here update the earlier deployment examples there.

#### G. Weather deliverable

Weather is a first-class v1 integration alongside Rocket Money. The proposed baseline is:

- Resolve place names or accept coordinates; surface ambiguous locations rather than silently choosing one.
- Read current conditions and hourly/daily forecasts for the resolved location.
- Support explicit units and location time zones; expose source timestamps and forecast valid times. Preserve provider distinctions between observations and modeled current conditions.
- Provide a usable CLI and skill for everyday weather questions, including a machine-readable native API path. Preserve source field names and parameters there rather than inventing a common provider schema.
- Handle missing data, unsupported ranges, stale results, quota limits, and outages explicitly. Missing values are not zero.

Choose the actual provider after checking geographic coverage, available fields/horizon, usage terms, quotas, and authentication. Use private API-key/OAuth storage if required, or the same policy pipeline with no upstream credential if it is a public API. Do not require a paid subscription without agreement. Historical weather, severe-weather alerts, and additional weather products are not promised by this baseline.

Acceptance includes live current/hourly/daily reads, location disambiguation, units and time-zone checks, source/freshness reporting, and deterministic failure tests. Weather delivery can proceed while Rocket Money-specific session questions are being resolved.

#### H. Provider interface and extension contract

Ship one shared executor with a protected registry of installed provider modules. Keep endpoint-specific policy in code. Small fixed-origin services may reuse a declarative definition plus a validator; browser-session and GraphQL rules belong in explicit modules. Do not build a general plugin marketplace or load code from request paths.

| Interface responsibility | Input → output | Constraint |
|---|---|---|
| Registration | Operator-installed module → provider ID, origins, routes, auth driver, limits | No caller registration/reload endpoint |
| Validate/classify | Caller scope + native request → immutable validated operation | Complete structural validation; deny-by-default; fixed account/origin binding |
| Auth lifecycle | Provider/account → private ready session or typed repair status | Keyless, API key, standard OAuth, or browser driver; never serialize secrets |
| Build request | Validated operation + private session → HTTPX request | Only shared executor sends; preserve native accepted payload |
| Inspect result | Operation + bounded upstream result → safe native result | Required before release; reject opaque unsafe data and secret-bearing metadata |
| Verify write | Recorded intent + result → bounded verification reads and outcome | Cannot invoke new write kinds or expand caller authority |
| Contract fixtures | Synthetic inputs/results → expected decisions | Reuse denial, leakage, failure, replay, and native-shape tests |

Illustrative internal type names such as `ValidatedOperation` are application controls, not a new Rocket Money or weather schema. Typed values help keep the executor ordered but do not sandbox trusted Python modules.

Adding a supported HTTP/GraphQL provider requires its module, protected registration and scope grants, auth setup if any, CLI/skill, and fixtures. It must not modify existing providers or executor control flow. New protocols or response streaming require a separate design decision. Prove the interface with a test-only provider built from the starter; no third production integration is required.

#### I. Sandbox-to-host connection

Use **host-initiated OpenSSH reverse Unix-socket forwarding**. For each distinct trust scope, provision a separate Linux relay instance/socket volume and a fixed native host listener. Start with owner-reader and owner-writer as needed; do not prebuild access for unrelated users. The application listener context binds scope and account grants; paths/headers supplied in a request cannot change that context.

| Scope | Permitted requests | Permitted response |
|---|---|---|
| Owner reader | Rocket Money allowed financial reads; weather reads | Inspected native source envelopes in an isolated reader |
| Owner writer | Category/date mutations on explicit transaction IDs, with private verification reads | Bounded receipt/status; no raw financial/error text to main |
| Future scoped caller | Only separately provisioned grants | Defined by that caller's trusted audience policy |

A read grant never implies write access. A writer's private preflight/read-back calls do not expose a general read endpoint. Unknown scopes/providers/accounts fail closed. Skills and delegation cannot enlarge grants.

##### Connection setup

1. The relay container runs a restricted OpenSSH `sshd`, with its SSH port published only on Mini loopback. It has no gateway keys, provider credentials, host-home mount, or Docker socket. Its own persistent SSH host key stays outside agent mounts.
2. The native service account holds a dedicated unattended SSH client key and pinned relay host identity. It initiates `ssh -N -T -R <linux-socket>:<macos-socket>` into the relay. The forward target is a fixed protected host socket for that scope. This introduces no inbound SSH listener on the Mini and never bind-mounts a macOS socket into Linux.
3. Allow remote Unix-socket forwarding only: `AllowStreamLocalForwarding remote`, `AllowTcpForwarding no`, `MaxSessions 0`, no PTY, X11, agent forwarding, password auth, or user RC. Protect forwarding directories and the host command configuration. TCP `PermitOpen`/`PermitListen` are not a Unix-path allowlist; scope separation comes from the separate relay/volume and fixed host target.
4. Host SSH runs with `BatchMode=yes`, `StrictHostKeyChecking=yes`, `ExitOnForwardFailure=yes`, and keepalives. launchd supervises bounded reconnects. Preserve relay host identity through restarts; replacement keys require deliberate operator reprovisioning. Never reuse a Touch ID login that would prompt during routine reconnects.
5. Mount only that scope's Linux socket directory into its intended sandbox at `/run/puddles-gateway/`, read-only with tested ownership/modes permitting connection but preventing replacement. The sandbox retains `network: none` and cannot reach relay SSH or host ports directly.
6. The CLI submits HTTP request contents through `/run/puddles-gateway/gateway.sock`. The host's scoped app validates and executes the request. SSH forwards opaque bytes and supplies no client-controlled identity claim. Caller-granted operations remain enforced even if another sandbox process reproduces the CLI request.

Uvicorn serves scoped ASGI listener contexts under the native service. Keep one coordinated auth/session manager per provider/account; avoid independent cookie stores across listeners. Verify the chosen server wiring preserves listener scope and shares session state correctly before adding credentials.

##### Startup and recovery

Provision protected code/config, relay identity/volume, host listener, and tunnel before exposing the socket mount to a worker. Publish readiness only when the scoped application is reachable; tunnel establishment alone does not prove the target socket is ready. Revoke access by removing trusted grants/mounts and closing affected connections. Clean stale sockets only in their dedicated protected directories.

A stopped service/tunnel yields unavailable, never direct Internet fallback. HTTP connection loss after a write was dispatched yields uncertain outcome; use its retained request ID for status reconciliation. FileVault unlock and service-user login availability remain prerequisites for post-reboot service readiness, distinct from provider session renewal.

The relay can inspect business data and exercise its fixed scope if compromised. Restrict its filesystem/network privileges and maintain artifact updates. Separate relays reduce cross-scope reach; they do not eliminate the trust placed in the relay and host OS. Independent egress controls must cover the host provider/browser as well as sandbox restrictions.

Sources: [OpenSSH reverse forwarding](https://man.openbsd.org/ssh#R), [sshd forwarding controls](https://man.openbsd.org/sshd_config#AllowStreamLocalForwarding), [session denial](https://man.openbsd.org/sshd_config#MaxSessions). Mini runtime behavior and permissions remain acceptance tests, not verified deployment claims.

#### K. Local API, CLI, and error contract

All examples are planned interfaces. Routes are registered per scoped listener; there is no general URL/command endpoint or caller-selected backend account.

| Local route | Payload | Result |
|---|---|---|
| `POST /v1/providers/rocket-money/graphql` | Native `{query, variables, operationName}` | Inspected native envelope for readers; restricted receipt for writers |
| `POST /v1/providers/rocket-money/graphql/batch` | Bounded array of native envelopes | Ordered per-item results/outcomes; host executes separate calls |
| `POST /v1/providers/weather/request` | Provider-relative path and native query parameters | Inspected native provider JSON |
| `GET /v1/providers/<id>/status` | None | Safe availability/auth-state enum; no session export |
| `GET /v1/operations/<request-id>` | None | Caller/account-bound write outcome or unavailable/unknown status |

The CLI assigns a UUID request ID to writes before transmission, using the `Puddles-Request-Id` transport header. For a batch, a stable parent ID and item index determine each recorded item ID; reconnect/replay cannot assign fresh IDs to completed or uncertain items. IDs correlate/reconcile operations and never grant authority. Expected-value controls, if supplied, are separate bounded transport metadata referencing the exact source fields; they are never inserted into native GraphQL variables. Document the encoding during implementation and reject unknown controls.

```sh
rmoney graphql --document query.graphql --variables variables.json --operation-name Explore
rmoney graphql --document change-date.graphql --variables change-date.json
rmoney batch --requests requests.json
rmoney auth status
rmoney operation status <request-id>
weather locations --query 'San Francisco'
weather forecast --latitude 37.77 --longitude -122.42
weather api --path <approved-provider-path> --params params.json
```

Both GraphQL reads and writes use source documents. The selected listener grant determines whether a mutation can execute; the command name is not authority. Weather convenience commands compile to the selected provider's native parameters, with a native API command constrained to registered paths/parameters. No arbitrary host, auth header, proxy, or config flags.

A permitted provider GraphQL error stays in its native `{data, errors, extensions}` envelope after inspection. A service failure uses a separate transport error, for example `{gateway_error: {code, request_id, outcome}}`; it is never disguised as a fabricated provider response. Safe codes include `POLICY_DENIED`, `INVALID_REQUEST`, `AUTH_REQUIRED`, `UNAVAILABLE`, `LIMIT_EXCEEDED`, `UPSTREAM_ERROR`, `RESPONSE_REJECTED`, and `OUTCOME_UNKNOWN`. Use stable CLI exit statuses and preserve HTTP/source diagnostics only where safe for the caller. No raw exceptions, cookies, or body excerpts in errors.

A main-agent write receipt contains only the generated request ID, approved operation kind, and outcome (`verified`, `not_applied`, `conflict`, or `unknown`), plus explicitly permitted source IDs if needed. Native financial envelopes and external text remain reader-only. Batch/pagination helpers expose item/page coverage rather than claiming atomic execution or a complete dataset.

### Implementation

#### E. Delivery phases and acceptance gates

| Phase | Deliverable | Required evidence before advancing |
|---|---|---|
| 1. Transport | Scoped host Unix listeners, restricted SSH relay, credential-free client | Mini socket connection, correct audience binding, denied cross-scope/shell/TCP access, reconnects, no fallback path |
| 2. Executor | Registered fake provider and shared lifecycle | Zero business calls on denied/failed validation; no response release on failed inspection; bounds and error outcomes exercised |
| 3. Authentication | Private Keychain and managed Rocket Money browser session | Headed setup, safe state persistence/rotation, silent renewal, idle interval, concurrency, restart, reboot prerequisites |
| 4. Integrations | Full weather and Rocket Money reads; two constrained writes | Native API compatibility, free-account coverage, live weather, authorized reversible changes and budget-date verification |
| 5. Distribution | Both skills/CLIs, protected install, extension starter | No secrets/backend admin in sandbox packages, test provider added without executor changes, operating/recovery documentation |

Weather can proceed while Rocket Money auth is being proven. Headless renewal remains a gate for delivering unattended Rocket Money access; existing-browser silent recovery alone does not pass it. No real financial writes are performed as part of this design task.

Required negative tests cover GraphQL aliases/fragments/variables/directives, side-effectful reads, mutation propagation, malformed/duplicate input, handler early return/exception, auth failure, mid-response errors, size/decompression limits, replay conflicts, client disconnects, crash recovery, cross-account state, and unfiltered data reaching main. Use synthetic canary credentials in request/response bodies, headers, trailers, logs, and errors.

Verify HTTPS rejects wrong names, expired/untrusted certificates, alternate destinations, and ambient proxy settings. Observe startup/idle/renewal/error network traffic with synthetic data. Sandbox `network: none`, scoped mounts, and unavailable host execution are mandatory. The native service/relay need separately enforced egress/DNS controls appropriate to their roles; do not claim config alone protects against a compromised process.

Implementation decisions still requiring evidence are the Mini's effective Docker/OpenSSH/UID behavior, service-account GUI/Keychain/reboot lifecycle, exact weather provider/terms, Rocket Money entitlement/response coverage, and the host egress enforcement mechanism. Resolve these in the phases above, without silently weakening isolation or buying a paid service. The design excludes system-wide interception; controls apply to the deployed gateway processes and their sandboxes.

#### J. Puddles repository ownership

All source, CLIs, skills, tests, and deployment definitions will live in **this Puddles monorepo**. No standalone repository or separate project is required. Proposed source layout (directories are not created by this planning task):

```text
packages/cli-gateway/        Python provider host, contracts, shared client transport
clis/rocket-money/           rmoney CLI, GraphQL operations, provider module, skill
clis/weather/                weather CLI, provider module, skill
scripts/mac-mini/cli-gateway/ OpenSSH relay/container/LaunchAgent provisioning and config
```

Keep each provider's CLI and host policy/session code together logically; install only its credential-free frontend and references in agent sandboxes. Deploy host code/configuration from reviewed repository content into protected runtime locations. Private credentials, browser profiles, SSH private keys, and live policy copies are never stored in Git or agent-writable source checkouts.

Existing Python and TypeScript packages can coexist; this plan does not require converting the monorepo to one runtime. Final package paths may follow established packaging conventions during implementation, but ownership stays in Puddles.

### Validation

#### D. Evidence and remaining uncertainties

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
| Application executor and OpenSSH bridge suitability | Official documentation reviewed; Mini transport and runtime not yet tested |

The anonymous silent probe returned `login_required`; the authenticated browser probe restored access. No session store was exported and no financial mutations were performed. `offline_access` does not prove that a refresh token is issued to or accessible by our integration.

Machine-readable evidence: [research-evidence.json](031-cli-gateway/research-evidence.json). Production build: `6e650d09e6`; [application bundle](https://app.rocketmoney.com/_next/static/chunks/pages/_app-50d1b9c675d9ef42.js), [transaction bundle](https://app.rocketmoney.com/_next/static/chunks/pages/transactions-62cb97afdc04e906.js). [Official category help](https://help.rocketmoney.com/en/articles/3332081-editing-and-creating-transaction-categories).

Documentation checks cover JSON validity, local links, required plan structure, and whitespace. Runtime and live integration checks remain pending; their required gates are listed above and below.

### Rollout and rollback

No rollout is authorized by this design-only task. Future installation must follow the delivery phases, protect active code and credentials outside agent-writable paths, and prove scoped access before exposing live credentials. Revoke access by removing grants and mounts and closing affected connections. Reconcile uncertain financial writes through read-back; do not automatically replay or roll them back.

### Review log

The [Envoy source review](031-cli-gateway/envoy-security-review.md) and [security decision record](031-cli-gateway/security-resolution.md) retain the evidence for replacing Envoy. Plan 032 is aligned with the selected transport and native CLI contract. This is design evidence, not a runtime security certification.

The landing revision adopts the current repository plan format. It changes document organization without changing the accepted architecture or implementation scope.

### Checklist

#### Design and evidence
- [x] Adopt the provider-owned execution design and remove Envoy/gRPC/private mTLS from v1.
- [x] Preserve both integrations, native GraphQL, narrow writes, and Puddles ownership.
- [x] Define scoped transport, credential lifecycle, execution order, provider interface, and local API.
- [x] Record known Rocket Money evidence and distinguish pending runtime checks.
- [x] Reconcile Plan 032 and retain the Envoy audit as historical evidence.

#### Foundation
- [ ] Implement and prove the scoped host/SSH/socket transport on the Mini.
- [ ] Implement the shared executor and fake provider; pass denial/failure/response-leakage tests.
- [ ] Verify trusted HTTPS, ambient-proxy isolation, protected logging/configuration, artifact verification, and egress/DNS controls.
- [ ] Verify request IDs, replay conflicts, cancellation, uncertain writes, and restart reconciliation.

#### Authentication and integrations
- [ ] Verify service-account Keychain/GUI/LaunchAgent/reboot prerequisites.
- [ ] Verify Rocket Money headed setup, cookie rotation, concurrent access, and unattended renewal through a real expiry/idle interval.
- [ ] Deliver native Rocket Money broad reads and the two restricted writes, with authorized reversible verification.
- [ ] Select/verify the weather provider and deliver location/current/hourly/daily support.
- [ ] Verify reader/main separation through raw socket requests as well as CLI commands.

#### Distribution and extensibility
- [ ] Publish both CLIs/skills, protected deployment definitions, and operator recovery instructions.
- [ ] Publish provider starter/contract tests and add a test provider without executor changes.
- [ ] Run relevant code checks, update runtime documentation, and mark implementation complete only when delivered.
