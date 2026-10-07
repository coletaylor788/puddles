# Plan 031 appendix: Deferred future scope

Companion to the [trusted-host MCP proposal](031-rocket-money-integration.md), revised 2026-10-07. This appendix records future implementation validation and optional expansions. It does not schedule tests or authorize account mutations now.

## Testing and TEST environment

Dedicated testing remains deferred as requested: fixtures, regression harnesses, sandbox-boundary checks, installed DEV/TEST rehearsal, cumulative CI and release evidence. Before real credentials or writes are activated, the implementation must demonstrate the applicable checks below. Deferral from the current design task is not evidence that the security boundary already works.

- Use synthetic credentials and transactions for automated tests. Normal test agents must not access production passwords, password-manager tokens, cookies, profiles or host-debugger endpoints. Trusted host/debug work stays outside that sandbox boundary.
- Check that only authorized main tools reach the server, that account identity cannot be forged through arguments, and that shell/path/URL/header/GraphQL escapes cannot expose credentials or expand operations. Inspect errors and logs for secret disclosure.
- Exercise session reuse across turns, expiry, one bounded login attempt, concurrent calls, MFA/challenge recovery through the host viewer, service restart and profile persistence. No test should silently switch to a live account.
- Cover exact transaction identity, expected-value conflicts, inclusive thresholds, refunds/currencies, missing/conflicting rules, partial pagination, no-ops, disabled category propagation, month/year ambiguity, read-back mismatch and unknown-outcome reconciliation without replay.
- Validate current provider contracts and account entitlements separately. Prior code and synthetic transfer results are not proof of live Rocket Money authentication, mutation behavior or budget effects.
- Complete applicable cumulative CI, immutable-artifact DEV/TEST promotion and rollback checks for executable infrastructure before activation. Do not count historical CLI checks as MCP/runtime proof.

Ordinary pre-write checks and post-write read-back remain required behavior inside each financial operation; they are not deferred.

## Weather and reusable integrations

Weather tools, household tool assignments, a general provider framework, generic secret brokering, public CLI distribution and extension starters remain deferred. Rocket Money gets one host-owned integration; restoring its execution boundary does not restore all of the former gateway's scope.

## Additional finance automation

Scheduled/proactive triage, review queues, local flags and richer reporting remain future work. The minimal write-outcome journal belongs to the current MCP design because it prevents blind replay. Broad financial exploration is in scope within the reviewed API catalog and actual account capabilities; arbitrary endpoints and unreviewed queries are not.

Amounts, notes, splits, provider categorization rules, payments/transfers, account changes and subscription actions remain excluded. They require a separate explicit scope decision.

## Superseded research

The browser-worker skill design, session-transfer proposal and native 1Password/Claude proposal with a host approval script have been superseded. They are historical research, not additional implementations waiting to be completed.

Retain the historical host client on `codex/cli-gateway-design-flow` as reuse material. Its final architecture used a CLI-backed OpenClaw plugin, not MCP. The new proposal reuses compatible provider logic and adds the MCP interface without automatically reviving the older daemon, SSH or proxy designs. Do not infer present PR status or deployment readiness from archived notes.
