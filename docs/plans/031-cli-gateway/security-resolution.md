# Security architecture decision: provider-owned execution

**Status:** direction accepted for the design rework, September 26, 2026; runtime implementation pending.

The current specification is [Plan 031](../031-rocket-money-integration.md). This file records the decision, not a second implementation contract. Its earlier proposal has been consolidated into the plan's execution, authentication, transport, API, and acceptance sections.

## Decision

Replace Envoy/`ext_proc` with a native provider application that owns validation, private authentication, HTTPS execution, response inspection, and release. Reuse Starlette/Uvicorn, HTTPX, OpenSSH, Keychain/keyring, Authlib, Playwright, and maintained GraphQL parsing libraries. No upstream forks.

The [Envoy audit](envoy-security-review.md) found that successful early processor closure can skip further inspection. Keeping execution in the provider service removes that particular split in authority. It does not prove the future application bug-free or protect against compromise of trusted provider code.

The same change removes private mTLS certificate management. Public provider HTTPS still verifies server certificates and hostnames. A host-initiated restricted SSH reverse forward connects scoped Linux sockets to fixed macOS sockets using dedicated unattended keys and pinned relay identity. No new inbound SSH listener on the Mini is required.

Logging and dependency risks remain: use protected explicit settings, allowlisted operational logs, no raw access/debug dumps, artifact verification, and independent network controls. The relay remains trusted transport, while the host service owns provider credentials.

## Current specification

- [Execution sequence and library boundaries](../031-rocket-money-integration.md#a-architecture-and-execution-boundary).
- [Credential custody and renewal](../031-rocket-money-integration.md#b-credential-and-authentication-lifecycle).
- [Delivery phases and acceptance gates](../031-rocket-money-integration.md#e-delivery-phases-and-acceptance-gates).
- [Provider extension contract](../031-rocket-money-integration.md#h-provider-interface-and-extension-contract).
- [SSH provisioning, scope separation, and recovery](../031-rocket-money-integration.md#i-sandbox-to-host-connection).
- [Native CLI/local API and error outcomes](../031-rocket-money-integration.md#k-local-api-cli-and-error-contract).

## Checklist

- [x] Record the user's selected design direction and consolidate its requirements in Plan 031.
- [x] Preserve the original source audit and API evidence.
- [ ] Complete the implementation and runtime acceptance checklist in Plan 031 before claiming deployment readiness.
