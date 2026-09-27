# Native requests and CLI equivalents

The model calls a named tool. The wrapper runs `puddles-cli --config <protected policy> --agent <trusted identity> --tool <tool name>` and sends the tool arguments on stdin. Equivalent CLI syntax is for the trusted host operator, not an alternate agent execution path. `puddles-cli --help` explains process flags; `{"mode":"help"}` provides scope-specific usage without logging in.

Read categories:

```json
{"mode":"graphql","request":{"query":"query { viewer { transactionCategories { id label } } }"}}
```

Read a page of transactions:

```json
{"mode":"graphql","request":{"query":"query Explore($after: String) { viewer { transactions(first: 50, after: $after) { edges { node { id name amount currency date posted_date authorized_date pending category { id label } service { id name } } } pageInfo { hasNextPage endCursor } } }","variables":{"after":null},"operationName":"Explore"}}
```

Use `mode: "paginate"` with the same `request`, `path: ["viewer","transactions"]`, `cursorVariable: "after"`, and `maxPages: 5`. Returned `pages` retain native envelopes and `coverage` indicates whether pagination finished. Inspect the catalog for supported arguments such as date/amount bounds, category/account IDs, text `query`, and source ordering. Confirm amount units/signs and filter types; do not invent them.

Category update (write tool):

```json
{"mode":"graphql","request":{"query":"mutation SetTransactionCategory($input: SetTransactionCategoryInput!) { setTransactionCategory(input: $input) { updatedTransactions { id category { id label } } } }","variables":{"input":{"transactionNodeId":"<id>","transactionCategoryNodeId":"<existing category id>","categorizeAllRelatedTransactions":false}},"operationName":"SetTransactionCategory"},"expected":{"transactionCategoryNodeId":"<current category id>"}}
```

Date update, only under the skill's title-month rule:

```json
{"mode":"graphql","request":{"query":"mutation ChangeTransactionDate($input: ChangeTransactionDateInput!) { changeTransactionDate(input: $input) { transaction { id date } } }","variables":{"input":{"transactionNodeId":"<id>","date":"2026-09-01"}},"operationName":"ChangeTransactionDate"},"expected":{"date":"2026-10-08"}}
```

`batch` takes `requests: [<native envelopes>]` and, for writes, an equally sized `expected` array. At most 20 items. One mutation per envelope. The CLI rejects unreviewed reads, credential fields, and other mutations. For `viewer.budgetPlan`, `createCurrentPlan` must explicitly be false.

`{"mode":"status"}` reports local auth state. `{"mode":"operation_status","requestId":"<uuid>"}` reports `verified`, `not_applied`, `conflict`, or `unknown`. A process/connection failure after dispatch may mean a write succeeded. Retain the tool's request ID and reconcile before considering another request.
