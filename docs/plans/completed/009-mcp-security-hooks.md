# Plan 009: MCP security hooks library

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

A shared library checks outgoing content and incoming tool results. Outgoing non-message content is classified for leaks; calendar recipients are checked against trusted contacts or domains. Incoming content is checked for injected instructions and secrets before a wrapper returns it to the agent. The application supplies a model adapter.

### Status

The library is implemented and used by the installed mail and calendar wrappers. The original persistent approval ladder has been replaced by contacts-based trust in code. Its calendar deployment still needs a usable Contacts helper; that remaining work is tracked in the pending Contacts plan.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Reusable egress leak checks, ingress injection checks, and regex plus model secret redaction.
- Consumer-independent model interface; transport and parsing failures become degraded block decisions.
- Destination trust for deliberate external sends, with secrets and sensitive content blocked.
- Unit coverage and component documentation; no requirement for a global guard plugin or network proxy.

### Architecture and decisions

- These guards run only on the tool paths wired to them. There is no global scan of every execution result, file read, or web response, and no interactive approval ladder.
- `LLMClient.classify(content, systemPrompt, options)` returns assistant text, not the draft structured result. Hooks parse classification results.
- `loadLLMProvider()` loads an external adapter. The public library ships no concrete adapter or mandatory model.
- Plan 018 replaces `SendApproval` and `TrustStore` with `ContactsEgressGuard` and `ContactsTrustResolver`; no persistent approval escalation remains.
- `LeakGuard` classifies secrets, sensitive content, and PII. Contacts-based egress uses recipient trust plus optional secrets/sensitive classifiers, without the old PII trust ladder.
- `SecretRedactor` always applies its regex pass to full content; an optional prefilter scopes the model pass. Classifier errors fail closed.

### Implementation

- `packages/mcp-hooks/src/` contains egress, ingress, contacts, classifier, logging, provider-loader, and prefilter modules.
- `packages/mcp-hooks/tests/` covers hook behavior, contacts trust, labels, logging, provider loading, and code-fence stripping.

### Validation

- Contacts deployment limitation: `contactsCliPath` is unset and the gateway service PATH does not resolve `contacts-cli`; lookup therefore fails closed. Pending Plan 018 owns configuration and gateway-context validation. Approved domains bypass lookup but retain content checks.
- Bounded deployed-bundle inspection confirms injection and redaction errors return `action: "block"` with degraded details; neither bundle contains a fail-open path marker.
- Inspected `packages/mcp-hooks/README.md`, `src/llm-client.ts`, `src/classify.ts`, hook code, and test inventory.
- Mini configured mail/calendar bundles contain classification logging; calendar bundle contains `ContactsEgressGuard`.
- The Mini loads both wrappers from its installed classifier stack.

The hygiene audit reads source, installed artifacts, and selected configuration. It does not repeat live tool calls, send messages, or certify current end-to-end behavior. Earlier test claims are historical evidence, not fresh test results.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
