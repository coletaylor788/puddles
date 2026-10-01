# Security architecture decision: provider-owned execution

**Status:** Design updated September 26, 2026; implementation deferred.

The current specification is [Plan 031](../031-rocket-money-integration.md) and its [technical appendix](technical-appendix.md). This file records the decision, not a second implementation contract.

## Decision

Use Apple PIM-style CLI-backed OpenClaw tools with shared host installation and per-agent tool grants. The directly invoked CLI application owns request validation, credential custody, and execution. Reuse the public OpenClaw plugin API, HTTPX, stock curl, Keychain/keyring, Authlib, Playwright, and maintained GraphQL parsing libraries. No upstream forks.

The [Envoy audit](envoy-security-review.md) found that successful early processor closure can skip further inspection. Owning validation and execution in the same application removes that split in authority. Validation failure cannot fall through to a generic proxy. This does not certify future code or protect against a compromised trusted host plugin.

The existing OpenClaw tool channel carries agent requests to host tool handlers. Each handler directly spawns the application, passes its request on stdin, and collects stdout/exit status. A separate service, socket, HTTP listener, per-agent image, relay, or private TLS certificate is unnecessary. Public HTTPS still validates certificates and hostnames.

The CLI runs as the trusted OpenClaw host account. Caller identity comes from tool factory context and protected configuration, never model arguments. Grant checks occur at dispatch and inside the CLI. Direct host execution would bypass this boundary and cannot be exposed to these agents. Credentials remain in the host Keychain/private files outside all agent mounts. The separate credential-service identity is removed; the host account and its installed code remain trusted.

Weather uses native curl arguments behind a fixed runner, with explicit destination, filesystem, configuration, environment, and resource restrictions. The weather application never loads finance credentials. Curl runs under the same trusted host account, so strict file/config restrictions are required; no separate OS-user isolation is claimed. Exact argument support and safe workspace transfers must be tested before readiness is claimed.

Return native bodies with separate execution status. Rocket Money cookie/auth headers remain private; no general response scanner or special agent receipt is added. Disable raw access/debug dumps and protect logs, state, code, and configuration. Standard provider errors remain source responses; uncertain writes require reconciliation, never blind replay.

Persist credentials and write intent between invocations. Use cross-process account locks for auth/browser state and write execution, atomic state updates, and bounded child-process cleanup. On-demand renewal uses the same CLI; no continuously running auth service is required. Verify session persistence and crash recovery before claiming readiness.

## Current specification

- [Tool dispatch and process lifecycle](technical-appendix.md#tool-dispatch-and-process-lifecycle).
- [Installation and per-agent permissions](technical-appendix.md#agent-installation-and-access).
- [Weather curl boundaries](technical-appendix.md#weather-curl-contract).
- [Managed execution](technical-appendix.md#managed-executor-and-limits) and [credential renewal](technical-appendix.md#authentication-contract).
- [Provider extension contract](technical-appendix.md#provider-extension-contract).
- [Delivery and acceptance gates](../031-rocket-money-integration.md#implementation).

## Checklist

- [x] Record the selected tool model and consolidate requirements in Plan 031.
- [x] Preserve the original source audit and API evidence.
- [ ] Complete Plan 031's runtime acceptance checklist before claiming deployment readiness.
