# Security architecture decision: provider-owned execution

**Status:** direction accepted for the design rework, September 26, 2026; runtime implementation pending.

The current specification is [Plan 031](../031-rocket-money-integration.md) and its [technical appendix](technical-appendix.md). This file records the decision, not a second implementation contract.

## Decision

Replace Envoy/`ext_proc` with a native provider application that owns validation, private authentication, HTTPS execution, response inspection, and release. Reuse Starlette/Uvicorn, HTTPX, OpenSSH, Keychain/keyring, Authlib, Playwright, and maintained GraphQL parsing libraries. No upstream forks.

The [Envoy audit](envoy-security-review.md) found that successful early processor closure can skip further inspection. Keeping execution in the provider service removes that particular split in authority. It does not prove the future application bug-free or protect against compromise of trusted provider code.

The same change removes private mTLS certificate management. Public provider HTTPS still verifies server certificates and hostnames. A host-initiated restricted SSH reverse forward connects scoped Linux sockets to fixed macOS sockets using dedicated unattended keys and pinned relay identity. No new inbound SSH listener on the Mini is required.

Logging and dependency risks remain: use protected explicit settings, allowlisted operational logs, no raw access/debug dumps, artifact verification, and independent network controls. The relay remains trusted transport, while the host service owns provider credentials.

## Current specification

- [Execution sequence and library boundaries](technical-appendix.md#executor-contract-and-limits).
- [Credential custody and renewal](technical-appendix.md#authentication-contract).
- [Delivery phases and acceptance gates](../031-rocket-money-integration.md#implementation).
- [Provider extension contract](technical-appendix.md#provider-extension-contract).
- [SSH provisioning, scope separation, and recovery](technical-appendix.md#socket-transport-and-caller-scope).
- [Native CLI/local API and error outcomes](technical-appendix.md#local-api-and-cli-contract).

## Checklist

- [x] Record the user's selected design direction and consolidate its requirements in Plan 031.
- [x] Preserve the original source audit and API evidence.
- [ ] Complete the implementation and runtime acceptance checklist in Plan 031 before claiming deployment readiness.
