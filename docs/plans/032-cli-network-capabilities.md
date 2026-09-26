# Plan 032: CLI-only capabilities across the sandbox boundary

**Status:** Design recorded; implementation deferred
**Issue:** None
**Last updated:** 2026-09-26

## Human section

### Design

Expose network capabilities through installed service command-line tools. A native service outside the sandbox validates each operation and owns authentication, HTTPS execution, and response inspection. A restricted OpenSSH bridge carries requests from scoped sandbox sockets to fixed host listeners. Small weather integrations and richer Rocket Money operations share transport conventions while preserving the provider’s native data semantics.

The trusted service enforces access even when a caller reproduces a command-line request directly. Raw provider responses go to isolated readers. Separately authorized writes return bounded receipts to the main agent. Credentials, active policy, and backend administration stay outside agent-writable mounts.

### Status

The boundary design is aligned with the Rocket Money and weather plan. No runtime access or configuration has changed. Implementation is deferred; transport, caller separation, authentication renewal, and response isolation still need runtime verification.

## Agent section

### State

The newer design is in [consolidated Plan 031](031-rocket-money-integration.md) and the task “Design Rocket Money integration.” Plan 031 is canonical for the auth stack, full weather scope, provider-owned execution/OpenSSH topology, local API, CLI syntax, and Puddles repository ownership. This plan owns the CLI-only and ingress/authorization requirements; its examples below are aligned with that design.

The newer proposal specifies:

- Independent `rmoney` CLI and skill; still a proposal, not an implemented CLI.
- Native Rocket Money GraphQL documents, variables, and field names.
- Broad financial read exploration through a maintained, restricted view of the real schema.
- Exactly two remote writes: transaction category and transaction date.
- Native GraphQL permits only the two approved mutation fields; no unrestricted mutation, arbitrary HTTP, or general transaction-patch endpoint.
- Public-client research identified the GraphQL endpoint and operation contracts. Standalone authenticated requests, session transfer/renewal, and write behavior still require verification.

The latest discussion further requires credentials outside the sandbox on the Mini and unattended renewal when supported. This plan defines where those controls run; it does not claim a verified refresh mechanism or guarantee that reauthentication will never be required.

### Scope and acceptance criteria

Expose one model-facing access pattern: **use the installed service CLI**.

A command can be as thin as `weather api --path <path>` or as expressive as `rmoney graphql --document query.graphql`. Every network-backed command crosses a private transport to trusted execution outside the sandbox. There is no model-facing generic curl route or website-exception list to teach.

Keep provider-specific behavior in its CLI package and reuse transport plumbing. Thin commands need only a protected service definition and a small frontend; they do not each need a bespoke API, data schema, or daemon. Rich integrations reuse their existing restricted core. No MCP is required.

V1 uses a native provider application and restricted OpenSSH reverse Unix-socket forwarding as specified in Plan 031. The application owns validation, auth, upstream HTTPS execution, and inspected response release; no Envoy filter or automatic forwarding fallback participates. A generic command runner, arbitrary URL fetch endpoint, and broad credential-injecting proxy are outside this design.

### Architecture and decisions

#### One interface pattern, different amounts of service logic

```text
Sandbox                                      Outside sandbox

weather api --path <path> -> private transport --------> protected weather handler
                                              -> allowed path/query validation
                                              -> fixed weather HTTPS origin

rmoney CLI ----> private CLI socket --------> rmoney backend
                                              -> GraphQL validation
                                              -> account/session management
                                              -> Rocket Money HTTPS API
```

Provision a separate relay/socket volume and a fixed scoped host listener for each distinct trust scope, starting with owner reader and owner writer as needed. A shared transport can dispatch only to operator-installed service handlers. The request cannot select a host executable, shell command, plugin path, or upstream origin. Shared policy conventions do not require one process, one credential store, or a shared blast radius.

Neither service exposes a generic HTTP bypass. The rmoney backend must have no authenticated-forwarding escape hatch.

“CLI-only” describes the enforced operation surface. It is not executable attestation: a sandbox process could reproduce the CLI's local request with curl. That is safe only if the backend applies exactly the same constraints regardless of client. User-Agent headers, executable names, and client-side validation are not authorization.

#### Thin command: weather api --path <path>

Example interface, illustrative rather than installed:

```sh
weather api --path <approved-provider-path> --params params.json
```

The `weather` frontend sends a service-scoped request. Protected backend configuration maps that service to one fixed HTTPS origin and its allowed routes. Keep the provider's paths, query parameters, and response format where permitted; the command is a thin facade, not a new weather data model. The example path is a placeholder pending provider selection and contract verification.

The trusted handler enforces:

- Exact upstream origins and permitted methods/routes.
- Approved query parameters, headers, request sizes, and timeouts.
- A provider-relative path and native parameter values only: reject absolute URLs, authority overrides, ambiguous encodings, and traversal that escapes allowed routes. No `--url`, `--proxy`, arbitrary headers, caller-selected upstream host, CONNECT, or protocol upgrade.
- No ambient credentials; remove caller cookies/authentication and unnecessary forwarded headers.
- Handle redirects explicitly. A redirect must not create a generic external or credential-bearing route.
- Deny host/LAN/metadata and other inappropriate destinations at the transport/network boundary, including IPv6 and DNS changes.
- Exclude unknown routes by default.

For a small weather surface, use a protected service definition for origin, allowed paths/methods, permitted query fields, and limits. A shared thin handler can interpret it using existing HTTP libraries. Use explicit validation for query values; a path matcher alone does not validate query data. The sandbox frontend may validate for useful errors, but the backend repeats all security checks.

The command's name does not make arbitrary arguments safe. Permitted path/query values still disclose information to the provider. Bound their scope deliberately; GET-only is not a zero-exfiltration guarantee.

#### Rich command: rmoney frontend and trusted execution

Proposed split within the **same rmoney package**:

- **Sandbox frontend:** help, schema discovery, reading query/variable files, formatting, and connecting to a configured local backend. No upstream credentials.
- **Trusted backend on the Mini:** authoritative GraphQL validation, the two approved write operations, account binding, authentication/renewal, upstream execution, pagination/resource bounds, audit, and write verification.
- **Shared core:** schema metadata and operation definitions reused between sandbox frontend and trusted backend. Client validation improves errors; backend validation is mandatory.

The model-facing interface stays recognizable:

```sh
rmoney graphql --document comparison.graphql --variables months.json
rmoney graphql --document change-category.graphql --variables change-category.json
rmoney graphql --document change-date.graphql --variables change-date.json
```

Files contain native query/mutation documents and variables; examples do not imply installed commands. Preserve GraphQL query text, variables, operation names, field names, and response structure. A transport envelope is acceptable; introducing an unrelated finance schema is not necessary.

The backend parses and validates GraphQL structurally against allowed real financial fields and arguments. It resolves fragments/aliases, validates variables, rejects mutations/subscriptions in read requests, excludes credentials/internal opaque payloads, and bounds depth/complexity/results. A query can have side effects: the newer proposal identifies `budgetPlan(createCurrentPlan: ...)` as a concrete case requiring restriction.

Do not reduce broad read exploration to only fixed persisted queries. The revised choice is flexible GraphQL reads within the reviewed financial schema, plus exactly two server-enforced writes. Category propagation is disabled as specified by rmoney. Both writes retain expected-value checks, per-item outcomes, uncertain-write handling, and read-back verification.

Files supplied by the frontend are transferred as content; the backend must not accept arbitrary host paths, executable paths, environment overrides, shell commands, cookie jars, config paths, or alternate upstream URLs.

The backend is more than an auth-injecting proxy: it is the authoritative rmoney implementation. Otherwise a process could skip the CLI's checks and obtain authenticated execution of arbitrary GraphQL.

##### Deployment decision

Use the native Starlette/Uvicorn provider application with HTTPX for upstream execution. The host service account initiates reverse Unix-socket forwarding into restricted Linux OpenSSH relay containers. The relay's SSH port is host-loopback-only; the sandbox sees only its scoped Linux socket and remains at `network: none`. There is no new inbound SSH service or private TLS CA on the Mini.

Each host listener binds a fixed trusted scope. The application owns complete validation, private auth, upstream execution, bounded response inspection, and write reconciliation. A handler failure or missing validation result cannot trigger automatic forwarding. Library/transport choice does not replace application policy checks.

Use the canonical [Plan 031 connection design](031-rocket-money-integration.md#i-sandbox-to-host-connection) and [local API contract](031-rocket-money-integration.md#k-local-api-cli-and-error-contract). Do not add a daemon-free command runner, model-accessible auth/config endpoint, or parallel proxy route. Both integrations share transport conventions while preserving native provider data semantics.

#### Ingress remains independent of transport

CLI availability and response trust are separate configuration decisions:

| Service access | Model interface | Raw response audience |
|---|---|---|
| Weather read | weather api --path <path> | Isolated reader by default |
| Rocket Money restricted operations | rmoney / native GraphQL | Owner-authorized isolated reader |
| Explicit reviewed projection | service CLI | main, only for the projected fields |
| Authorized write | restricted CLI | main receives a bounded receipt; external text remains reader-only |

Using a CLI does not sanitize responses. For the initial design, provision raw-read capabilities only to existing reader workers. Main delegates reads as it does today. This avoids introducing a new broker job/summary protocol just to preserve isolation.

Where main needs a raw-read request interface, the existing orchestration must deliver its response to the reader rather than main. Do not expose a raw endpoint to main and rely on the CLI to hide the result: another process can call the endpoint directly. Separate read/write audiences and enforce them at the trusted boundary.

Weather descriptions and financial merchant/notes/errors remain external content even from approved services. Supplying raw weather directly to main would be an explicit change to the current reader boundary. It is not implicit in installing a CLI.

An optional later direct-main path can construct numeric/enum-only results using reviewed code outside the sandbox. That introduces service-specific code and should be added only for a concrete need. A jq filter inside main's sandbox is not an isolation boundary.

#### Protected configuration and credentials

Keep ordinary integration settings in their natural owners:

- Protected weather service definition: fixed upstream, permitted paths/methods/query values, and limits.
- rmoney installation: maintained GraphQL policy and the two allowed mutations.
- rmoney private runtime storage: account state, cookies, and any supported renewal material.
- Sandbox/orchestrator configuration: which trust tier/session can reach which listener and consume which results.

All active policy, backend executables, credentials, and configuration live outside agent-writable mounts. Protect parent directories and deployment tools too. Agent skills can explain usage and propose changes; they cannot activate access. Transport admin/reload APIs and rmoney login/config endpoints must not be exposed through the agent-facing listener. CLI flags and workspace environment variables cannot override backend policy or select alternate credentials/upstreams.

Assign identity through trusted provisioning, not client headers. Separate owner, household, friends, and reader access. A shared sandbox/UID/socket cannot distinguish distrustful sessions without an additional trusted session mechanism; use separate execution scopes when grants differ. Read access does not grant either write capability, and worker authority must not expand through delegation.

Upstream cookies/tokens never enter the sandbox. Initial interactive login and any provider-required reauthentication happen through an operator-only path. The rmoney backend persists rotations and performs only verified supported renewal. It returns a sanitized authentication status when renewal fails. No guessed refresh endpoint or guarantee of indefinite unattended login.

Keep logs bounded and sanitized. Avoid query/body logging for finance. No raw provider errors, secret-bearing headers, or unfiltered mutation return objects in main's receipts.

### Implementation

1. Prove the actual Mini transport and caller separation.
2. Implement a thin weather CLI and protected service handler, callable from the reader; verify the provider's actual contract.
3. Add a private backend mode to rmoney that reuses its restricted core and owns authentication.
4. Verify query exploration preserves native GraphQL, while direct socket calls cannot bypass restrictions.
5. Add main-accessible bounded write receipts only with separately authorized write access.
6. Test policy tampering, direct network/DNS bypass, absolute/authority-relative URLs and encoded paths passed to weather, alternate hosts, redirects, extra parameters/headers, cross-tier access, oversized responses, and raw-content leakage into main.
7. Test GraphQL fragments/aliases, side-effectful read arguments, arbitrary mutations, credential fields, invalid account selection, stale writes, partial failure, and expired auth.
8. Test pre-execution failures, response inspection failures, SSH reconnects, and uncertain writes, then update deployment docs after runtime verification.

### Validation

Keep ordinary sandboxes at `network: none` and provision only their intended Linux socket mounts. Prove the planned OpenSSH reverse socket bridge on Docker Desktop/OpenClaw; a macOS socket is never bind-mounted into Linux. Never give the sandbox the Docker daemon socket or relay SSH keys.

Test denial of direct Internet/DNS, host services, relay SSH, other containers/scopes, and backend administration. An alternate sandbox network is not an automatic fallback if socket provisioning fails. Proxy environment variables are convenience, not enforcement.

The older setup guide describes a deployment without network denial; local OpenClaw source defaults ordinary sandbox networking to none. Neither establishes the Mini's current effective configuration. Verify its deployed version, overrides, mounts, and escape paths such as elevated host execution before making the guarantee.

### Rollout and rollback

Implementation and deployment are deferred. Prove the scoped bridge and backend policy before provisioning live capabilities. Revoke access by removing trusted grants and socket mounts and closing affected connections. An unavailable bridge must never fall back to direct network access. Use Plan 031 for write reconciliation and provider recovery.

### Review log

- [consolidated Plan 031](031-rocket-money-integration.md), read 2026-09-26; its account/API findings are the other task's recorded research, not independently re-probed here.
- [Puddles hooks architecture](../../packages/mcp-hooks/docs/architecture.md).
- [OpenSSH reverse socket forwarding](https://man.openbsd.org/ssh#R); current controls are specified in Plan 031.
- [curl Unix sockets](https://curl.se/docs/manpage.html#--unix-socket).
- [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

The landing revision adopts the current repository plan format without changing the accepted CLI and ingress boundaries. Runtime checks remain pending.

### Checklist

#### Proposal
- [x] Review the newer independent rmoney CLI design and latest auth/GraphQL requirements.
- [x] Adopt CLI-only access for both thin weather and rich authenticated integrations.
- [x] Preserve the existing reader ingress boundary and protected configuration.
- [x] Keep shared transport internal and enforce every service's restrictions outside the sandbox.
- [x] Align deployment and CLI examples with the provider-service/OpenSSH design in Plan 031.

#### Implementation and verification
- [ ] Prove deployed sandbox transport, identity, and isolation.
- [ ] Implement and verify a thin weather CLI and protected backend handler.
- [ ] Implement rmoney trusted backend using its shared restricted core.
- [ ] Verify session custody, supported renewal, and failure behavior.
- [ ] Verify query/write constraints cannot be bypassed by raw socket requests.
- [ ] Pass ingress, cross-tier, network, and configuration-tampering tests.
- [ ] Update deployment documentation after verification.
