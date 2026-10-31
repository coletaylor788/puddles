# Explicit repository check selection

## Human section

### Design

A repository whose full application suite runs during production CI may have no
separate PR checks. Accept an explicit empty `requiredChecks` list for that case.
Missing or malformed policy still fails. Any reported pending or failed check
still blocks promotion, as do source drift and the existing application gates.

### Status

**Approval:** Production approved. **Approval reference:** The requester approved
removing redundant application checks and retaining only scoped tooling checks.
Implementation and focused validation are in progress. No application behavior,
queue, deployment, backup, or rollback policy changes.

## Agent section

`ci-source.mjs` accepts `[]` without skipping the check/status inventory or source
verification. Regression coverage exercises no-check merge eligibility and
reported failures. Update the integration guidance and install the reviewed tool
between idle transactions after the independent release suite passes.
