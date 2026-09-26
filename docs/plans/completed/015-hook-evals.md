# Plan 015: Hook evaluation datasets and prompt quality

**Status:** Complete
**Issue:** Not recorded
**Last updated:** 2026-09-26

## Human section

### Design

The evaluation suite measures how well the security classifiers and redactor perform on labelled synthetic examples. It separates model accuracy from infrastructure failures and records enough input identity to compare prompt revisions.

### Status

The evaluation harness, seed cases, expanded datasets, and saved baselines are complete. This plan records the delivered measurement tooling; its saved results are historical measurements, not a certification of current model quality.

## Agent section

### State

Complete. Audited against the repository and selected read-only Mini evidence on 2026-09-26. This archive records delivered work and its current implementation.

### Scope and acceptance criteria

- Evaluate secrets, sensitive content, PII, injection, and complete regex-plus-model redaction.
- Keep production prompts centralized; report precision, recall, F1, false-positive rate, category/difficulty breakdowns, and small-sample warnings.
- Save prompt and dataset hashes, source revision, error counts, retry settings, and both production and valid-only metric views.
- Retain seed cases and generation/independent-validation tooling.

### Architecture and decisions

- The CLI requires an explicitly configured provider module; no credential-skip success is part of the current contract.
- Production metrics count classifier infrastructure failures as blocks (predicted positive), matching current fail-closed hooks. The original fail-open description is obsolete.
- The historical phase 2a datasets contain 529 secrets, 525 sensitive, 525 PII, 509 injection, and 215 redact cases.
- Historical phase 2a redactor precision 0.867 and false-positive rate 0.354 show classifier quality limits; sensitive recall 0.877 is below 0.90. These are saved historical metrics, not current model measurements.
- The target taxonomy covers credential/identity formats, personal medical/financial facts versus general questions, contact details, direct/indirect injection and benign quoted instructions, and exact-string redaction across formats, languages, lengths, tones, and sources.

### Implementation

- `packages/mcp-hooks/evals/` contains CLI, runner, scoring, case loader, generation configuration, datasets, seeds, and baselines.
- `packages/mcp-hooks/src/prompts.ts` and `src/classify.ts` are shared with production.

### Validation

- Inspected eval component documentation, source inventory, dataset files, and phase-by-phase baseline record.
- Mini checkout contains the eval dataset tree; evaluations are development artifacts and need no running service.

No real model eval was run during this audit. Large-dataset expansion and later prompt tuning are removed from this completed harness scope at the owner’s request; retained baseline metrics remain available for comparison.

### Rollout and rollback

This change only updates the plan and moves it to the completed archive. No production configuration, process, account, message, or tracker changes. Future implementation or deployment follows the current repository development workflow and the relevant component setup guide. Historical in-place patching and restart recipes are not a current release procedure.

### Review log

The audit reconciles the original design with the evidence listed above. No remaining implementation work is assigned to this archived plan.

### Checklist

- [x] Compare the plan with source and Mini installation.
- [x] Correct implementation differences and completion limits.
- [x] Archive the completed plan.
