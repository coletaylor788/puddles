# Plan 019: Classifier timeouts and structured logging

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

Model-backed security checks must return or fail within a bounded time. The shared hooks label their calls and log durations, while the configured adapter bounds network requests and token exchange. Failures remain visible to the calling tool.

### Status

Timeouts and diagnostic logging are implemented and present in the Mini classifier stack. The network implementation now belongs to the externally supplied adapter rather than the public hooks package.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Bound classify requests, disable unbounded SDK retries, and abort timed-out transport work.
- Bound token exchange and warn about slow calls.
- Emit start/done/slow/timeout/error events with caller labels and sanitized metadata.
- Preserve fail-closed hook behavior on adapter errors.

### Architecture and decisions

- Public `LLMClient` is an interface; the package cannot enforce an adapter timeout itself. Adapter compliance is therefore part of the deployment contract.
- The delivered adapter supports `requestTimeoutMs`, `slowCallMs`, and `tokenExchangeTimeoutMs`; the original defaults were 30s, 10s, and 15s. Actual deployments may configure them.
- `classifyBoolean()` logs `classify_start/classify_done` and forwards labels. Redaction labels its direct adapter call `secret-redact`.
- The old `llm-client-timeout.test.ts` location in public source is obsolete after provider separation; public label/logger tests remain.

### Implementation

- `packages/mcp-hooks/src/{llm-client,classify,logger}.ts` define the public contract and structured diagnostics.
- The deployed external classifier adapter contains request timeout, slow-warning, token-exchange timeout, abort-signal, retry, and timeout-event code.

### Validation

- Inspected public interface, classifier labels, logger, and corresponding tests.
- Read only exact deployed adapter module text and confirmed `requestTimeoutMs`, `slowCallMs`, `tokenExchangeTimeoutMs`, `AbortSignal.timeout`, `llm_call_timeout`, and `maxRetries` markers.
- Installed mail/calendar bundles contain `classify_start`.

This verifies installed code, not a timed real-provider request. Provider-specific implementation details and credentials stay outside the public plan. Bridge/process watchdogs are not part of this completed classifier change.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
