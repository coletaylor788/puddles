# Plan 031 appendix: Deferred validation and future scope

Companion to the [Rocket Money MCP design](031-rocket-money-integration.md).

## Deferred validation

The implementation is now approved. The following checks are required before activation; future scope remains below. Validate:

| Area | Required evidence |
|---|---|
| Auth boundary | Normal model tools and test sandboxes cannot read passwords, cookies, tokens, profiles or debugger endpoints. Use synthetic credentials in automated tests. |
| Session lifecycle | Reuse across turns, expiry, bounded renewal, concurrent callers, restart persistence and owner-assisted MFA recovery, Chrome saved-login behavior and device-authentication prompts. |
| Browser-to-HTTP integration | The shared provider supplies a usable authenticated client and retains session updates without exposing authentication material. |
| API contract | The [five-tool contract](031-rocket-money-integration.md#mcp-tool-contract), schema validation, supported queries, account entitlements, pagination and the two allowed mutations. |
| Write integrity | Identity/current-value conflicts, individual-only category changes, read-back mismatch and unknown-outcome reconciliation without replay. |
| Main's rules | Exact rule matching, ambiguity handling and title-based date corrections. Private account data stays out of fixtures. |
| Delivery | Applicable focused checks, cumulative CI, isolated DEV/TEST validation and rollback before activation. |

Pre-write checks and post-write read-back are normal operation behavior, not deferred tests. Historical CLI or browser experiments do not prove the new integration.

## Future scope

Scheduled triage, review queues and richer reporting remain future work. Additional consumers of the shared auth provider can be considered separately; they are not required to deliver Rocket Money.

Other financial writes require an explicit scope decision. A general MCP integration framework, generic credential broker and public CLI distribution are not part of this design.
