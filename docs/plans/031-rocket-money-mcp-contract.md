# Rocket Money MCP contract

Proposed interface for [Plan 031](031-rocket-money-integration.md). This is a review contract, not an implemented or live-verified API. The tools belong to the Rocket Money server; the shared browser auth provider stays internal to the trusted host.

## Common contract

| Rule | Contract |
|---|---|
| Account and caller | Bound by trusted runtime configuration. No model-supplied account, role or authorization claim. |
| Inputs | JSON objects. Required fields are listed below. Reject unknown fields. IDs are nonempty opaque strings from reads, never labels or guessed identifiers. |
| Credentials | No tool accepts or returns passwords, cookies, tokens, browser/profile paths, debugger addresses, arbitrary URLs or headers. |
| Authentication | Validated business calls may request bounded session repair from shared auth. Interactive challenges return `NEEDS_USER_LOGIN`. |
| Execution | One provider request per read call; one transaction/field per write call. No implicit pagination or batch mutations. |
| Results | JSON in MCP structured results. Native financial data is permitted; authentication material and raw diagnostics are excluded. |
| Limits | Host policy sets finite request, response and execution budgets. Callers cannot raise them. An exceeded limit returns a bounded error, never silently truncated JSON. |

The schemas below use TypeScript notation for review. All properties are required unless marked `?`; `JsonObject` means an object containing JSON values. Implement these constraints in MCP input/output schemas. Tool descriptions include the supported read catalog and query templates; do not require the model to guess provider fields or use live introspection.

## 1. `rocket_money_status`

Inspect integration readiness without triggering login or changing account data.

```typescript
type Input = {};
type Output = {
  status: "ok";
  authentication: "ready" | "expired" | "renewing" | "needs_user_login" | "unavailable" | "unknown";
  observedAt: string | null; // UTC timestamp of the last auth observation
  guidance: string | null;  // Safe instructions, never an authenticated viewer URL
} | ToolError;
```

This reports last observed state; `ready` does not guarantee the next request will succeed. Each business call handles its actual authentication result. No refresh flag or model-callable login tool is exposed.

## 2. `rocket_money_read`

Execute one supported native GraphQL read operation.

```typescript
type Input = {
  query: string;
  variables?: JsonObject;  // Default: {}
  operationName?: string; // Required when the document names multiple operations
};
type Output = {
  status: "ok" | "partial";
  result: {
    data: JsonObject | null;
    errors?: JsonObject[];
    extensions?: JsonObject;
  };
} | ToolError;
```

Parse and validate the selected operation, including fragments, aliases, directives and effective variables, against the reviewed read catalog. Reject mutations, side-effectful query fields and credential-bearing fields. Execute only the selected operation. Preserve approved native financial field names and source envelopes; unreviewed response metadata must not expose secrets.

The caller supplies filters, page size and cursor through the native query/variables. Pagination remains explicit. `partial` means usable data accompanied by provider errors; a final page must be established from the provider's page information, not from `status: "ok"`. Errors without usable data return `ToolError` with `PROVIDER_ERROR` and permitted provider error details.

## 3. `rocket_money_set_category`

Change one transaction to an existing category.

```typescript
type Input = {
  requestId: string;          // UUID; stable for this exact intended operation
  transactionId: string;
  expectedCategoryId: string; // Observed current category ID
  categoryId: string;         // Existing target category ID
};
type Output = WriteOutcome | {
  requestId: string;
  status: "in_progress";
} | ToolError;
```

Read the transaction and confirm the expected category before dispatch. A mismatch returns `conflict`. If expected and requested categories already match the actual value, return `unchanged`. The server fixes category propagation to false; there is no caller option to enable it. Missing or unresolved category IDs require a new read or clarification, not an inferred category.

## 4. `rocket_money_set_date`

Change one transaction's editable date.

```typescript
type Input = {
  requestId: string;     // UUID; stable for this exact intended operation
  transactionId: string;
  expectedDate: string;  // Valid calendar date: YYYY-MM-DD
  date: string;          // Valid calendar date: YYYY-MM-DD
};
type Output = WriteOutcome | {
  requestId: string;
  status: "in_progress";
} | ToolError;
```

Use calendar dates without time-zone conversion. This edits the transaction date, not its authorization or posting timestamp. Check the expected date before dispatch; return `conflict` on mismatch and `unchanged` on an already-satisfied request. Main remains responsible for applying its private date-correction rule and obtaining clarification when needed.

## 5. `rocket_money_operation_status`

Inspect a previous write and reconcile an uncertain result through a read. Never dispatch a mutation.

```typescript
type Input = { requestId: string }; // UUID used for the original write
type Output = WriteOutcome | {
  requestId: string;
  status: "in_progress" | "not_found";
} | ToolError;
```

For an unresolved operation, a successful read can establish whether the intended state is currently present. A different observed value does not prove the original write failed; it may have been changed afterward. Keep that outcome `unknown` unless there is definitive evidence that the write was not dispatched. `not_found` is not permission to replay: the record may be absent or outside retention.

## Result and error types

```typescript
type WriteOutcome = {
  requestId: string;
  transactionId: string;
  field: "categoryId" | "date";
  status: "verified" | "unchanged" | "conflict" | "blocked" | "unknown";
  expected: string;
  requested: string;
  observed: string | null;
  observedAt: string | null; // UTC timestamp
  error?: { code: string; message: string };
};

type ToolError = {
  status: "error";
  error: {
    code: "INVALID_INPUT" | "ACCESS_DENIED" | "UNSUPPORTED_QUERY" |
          "NEEDS_USER_LOGIN" | "AUTH_UNAVAILABLE" | "BUSY" |
          "PROVIDER_ERROR" | "LIMIT_EXCEEDED" | "REQUEST_ID_REUSED";
    message: string; // Bounded and credential-free
    providerErrors?: JsonObject[]; // Reviewed financial errors only
  };
};
```

| Write status | Meaning |
|---|---|
| `verified` | Read-back observed the requested value. This verifies current state, not which actor caused it. |
| `unchanged` | Preflight observed the intended value; no mutation was sent. |
| `conflict` | Preflight differed from the expected value; no mutation was sent. |
| `blocked` | Login, policy or another pre-dispatch condition prevented the mutation. |
| `unknown` | The mutation may have executed, but its intended result could not be verified. |

A write may return `ToolError` before an operation is accepted. After acceptance, operational failures use `WriteOutcome`: `blocked` only when no mutation was dispatched, otherwise `unknown` unless verified. Missing transactions or unreadable current values block the write. A preflight conflict takes precedence over treating an independently changed target as a successful no-op.

## Retry and identity rules

- Persist the operation identity before sending the mutation. Bind `requestId` to the configured account, tool and exact normalized arguments.
- Reusing that ID with identical arguments returns the recorded outcome or `in_progress`; it does not execute the mutation again. Retain a deduplication marker if detailed outcomes are retired; an expired record cannot become a fresh operation.
- Reusing it with different arguments returns `REQUEST_ID_REUSED` and preserves the original record.
- After a timeout or lost tool response, use `rocket_money_operation_status` with the original ID. Do not generate a fresh ID to bypass an uncertain outcome.
- After a confirmed `blocked` or `conflict` outcome, a newly authorized attempt uses a new ID and freshly read expected values. Repairing login alone never replays a mutation.

## Example calls

Synthetic identifiers illustrate the contract; they are not live account data.

```json
{
  "name": "rocket_money_set_category",
  "arguments": {
    "requestId": "00000000-0000-4000-8000-000000000001",
    "transactionId": "transaction-example",
    "expectedCategoryId": "category-before",
    "categoryId": "category-after"
  }
}
```

```json
{
  "name": "rocket_money_operation_status",
  "arguments": {
    "requestId": "00000000-0000-4000-8000-000000000001"
  }
}
```

## Auth implementation note

Chrome's password manager is the starting credential store in the private host profile. An external manager is optional. Chrome documents automatic sign-in and optional device authentication for filling passwords; these do not establish unattended Rocket Money login in the selected automation environment. Validate that flow without weakening browser protections. See [Google's password-manager documentation](https://support.google.com/chrome/answer/95606?hl=en).

Contract validation and runtime testing remain in the [deferred appendix](031-rocket-money-deferred.md).
