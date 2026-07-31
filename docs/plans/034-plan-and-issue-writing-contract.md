# Plan 034 - Plan and issue writing contract

**Status:** Complete
**Issue:** [#69](https://github.com/coletaylor788/puddles/issues/69)
**Last updated:** 2026-07-30

## Human section

### Design

Two things are supposed to explain a piece of work to a person: the plan in this
repo and the tracking issue on GitHub. Right now neither one does. The issue has
turned into a checkbox ledger with a state line, a last updated line, a next step
line, a blockers line, and a growing list of finished milestones. You can read
the whole thing and still not know what the work actually is. The plans have the
opposite problem. They are complete, but they are written in dense compressed
jargon, whole paragraphs of stacked nouns that read like a compliance filing.
Nobody talks that way, so nobody wants to read them.

The fix is three connected changes to the written contract, plus one knock-on
adjustment.

First, the issue gets a small fixed shape. A link to the plan, one paragraph
saying what we are building or fixing and why it matters, and one paragraph (two
at the absolute most) saying where things stand and what happens next. No lists
anywhere. Both paragraphs get rewritten in full on every update, so the issue
always describes right now instead of piling up history. Anything with a commit
id, a command, or a test transcript in it belongs in the plan.

Second, the plan splits along a more honest line. It still has two top level
sections, but the human half is now just a design explanation and a status
snapshot. The design part has to read like you are explaining the architecture to
a coworker: what the pieces are, how they fit together, what you chose and why.
It is not allowed to contain code pointers of any kind, so no file paths, no
function names, no command names, no line numbers, no commit ids. That
restriction is the whole point. If you cannot describe the shape of the thing
without pointing at a file, you have not really described it. All of that
concrete material moves down into the agent half, which stays exactly as detailed
as it is today.

Third, there is now a short set of writing rules covering everything a person
reads: plans, issues, issue comments, pull request descriptions, and commit
messages. Short sentences, everyday words, no em dashes, no stacked noun phrases,
no filler adjectives, and real paragraphs instead of bullets on the human facing
parts. The full version lives in the feature workflow skill, and a summary lives
in the always-on repo instructions so it still applies when the skill is not
loaded.

The knock-on change is small but worth knowing about. The old workflow recorded
the final clean review result in the issue, because writing it into the plan
would change the very diff that had just been reviewed. Commit ids are no longer
allowed in the issue, so that record moves to the pull request. Same safety
property, different place.

Nothing here changes what the workflow requires. Every safety gate, publication
boundary, secret handling rule, test isolation rule, ownership rule, and
lifecycle step keeps the meaning it had before. Only the wording got simpler.

### Status

The contract is done. The always-on repo instructions, the feature workflow
skill, this plan, and the tracking issue all say the same thing. The shared test
pool covers the new contract and runs green, and the review loop has no
unresolved findings.

New plans and substantively updated plans use the new structure from here on,
and new or updated issues use the new body. Older plans and issues stay as they
are. There is no runtime behavior in this change, so there is no deployment step
and nothing to promote to production.

## Agent section

### State

The change is complete and reviewed. Files changed:
`.github/copilot-instructions.md`,
`.github/skills/safe-feature-development/SKILL.md`,
`packages/e2e/tests/review-workflow.test.ts`, the new
`packages/e2e/tests/plan-and-issue-writing-contract.test.ts`, and this new plan.
`.github/skills/adversarial-review/SKILL.md` was read and left untouched because
it contains no reference to the plan or issue format.

The shared cumulative pool already asserts the wording of these two contract
documents, so this change updates the two assertions that named the old contract
and adds a new committed regression for the new one.

Existing plans and issues are deliberately not migrated. The new format applies
to new plans and to plans that get a substantive update.

### Scope and acceptance criteria

- Replace the issue body contract with exactly a plan link, `## Summary`, and
  `## Status`, both prose.
- Remove `## Done` from the contract entirely.
- Forbid bullet lists and numbered lists anywhere in an issue body.
- Require both issue sections to be rewritten in full on every update.
- Keep detail, evidence, commands, commit ids, validation transcripts, and
  chronology in the plan and out of the issue.
- Apply the same short-prose-status rule to issue comments.
- Rename `## Human design` to `## Human section` with exactly `### Design` and
  `### Status`.
- Rename `## Agent details` to `## Agent section`, keeping its eight existing
  subsections in the same order.
- Forbid code pointers in `### Design` and state that they belong in the
  `Agent section`.
- Keep the existing rules about no third top-level section, no append-only
  status log, no duplicate design narrative, and full rewrite plus
  synchronization on every substantive change.
- Add the writing style rules to `safe-feature-development/SKILL.md` near the
  top and summarize them in `.github/copilot-instructions.md`.
- Bump `safe-feature-development` from version 1.6.0 to 1.7.0.
- Update the shared cumulative pool where it asserts the old contract wording,
  and add a committed regression covering the new one.
- Simplify the wording of every section touched without weakening any safety
  rule, publication boundary, secret handling rule, test isolation rule,
  ownership or checkpoint rule, or lifecycle gate.
- Keep the repository provider-neutral. Name no model provider.
- Write this plan and the tracking issue in the new format as the first
  examples.

### Architecture and decisions

- `.github/copilot-instructions.md` stays the short always-on policy entry
  point. It carries a `## Writing style` section and one paragraph naming the
  plan and issue formats. The exact mechanics stay in the skill.
- `.github/skills/safe-feature-development/SKILL.md` owns the full contract. The
  new `## How to write` section sits directly under the intro, before
  `## Ownership and checkpoints`, so it is read before any lifecycle detail. The
  `Plan` step of the required loop carries the plan structure and the literal
  issue body template.
- The issue template is embedded as a fenced `markdown` block so there is no
  ambiguity about section names or order.
- `### Design` bans code pointers on purpose. It forces an explanation that
  stands on its own, and it gives the `Agent section` a clear job.
- The terminal review record moved from the issue to the pull request. The
  original constraint was that recording the result must not alter the reviewed
  diff. A pull request satisfies that just as well as an issue did, and it does
  not violate the new rule that commit ids stay out of issues.
- `adversarial-review` was checked and not modified. It reviews change content
  and never mentions the plan or issue format, so its version is unchanged at
  1.3.0.
- `packages/e2e/tests/review-workflow.test.ts` already pinned the skill version
  and the "issue ledger" wording, so it is updated in place. The new contract
  gets its own file, `packages/e2e/tests/plan-and-issue-writing-contract.test.ts`,
  so the pool grows instead of replacing prior coverage.

### Implementation

1. Added `## Writing style` to `.github/copilot-instructions.md` between
   `## Principles` and `## Development lifecycle`, pointing at
   `safe-feature-development` for the full version.
2. Rewrote the plan and issue paragraph in the `## Sources of truth` section of
   `.github/copilot-instructions.md` to name `Human section`, `Agent section`,
   `Summary`, and `Status`.
3. Simplified the `## Development lifecycle` wording in the same file with no
   change in meaning.
4. Bumped `safe-feature-development` frontmatter version to `1.7.0` and added
   `## How to write` under the skill intro.
5. Replaced the `Plan` step contract in
   `.github/skills/safe-feature-development/SKILL.md` with the
   `Human section` and `Agent section` structure, the `### Design` code-pointer
   ban, the `### Status` limits, and the literal issue body template with its
   no-lists, no-`Done`, full-rewrite, and issue-comment rules.
6. Updated the terminal review bullet in the `Audit the full change` step so the
   clean result and reviewed commit are recorded outside the candidate diff,
   with the pull request named as the place and a fallback for repositories
   without pull requests. Added the matching instruction to the
   `Prepare remote integration` step so no ordering gap exists.
7. Updated the `Requesting requester help` section to say "issue status" instead
   of "issue ledger".
8. Updated the two assertions in `packages/e2e/tests/review-workflow.test.ts`
   that pinned the old skill version and the old "issue ledger" wording.
9. Added `packages/e2e/tests/plan-and-issue-writing-contract.test.ts` covering
   the writing style rules in both documents, the plan structure contract, the
   issue body contract, the terminal review record placement, and structural
   conformance of this plan including the code-pointer ban in `### Design`.
10. Added this plan as the first document written in the new format.

### Validation

The shared cumulative pool runs clean:

- `node packages/e2e/bin/openclaw-test-env.mjs ci` exits 0. Package suites pass
  (`mcp-hooks` 112 tests, `e2e` 82 tests, `secure-apple-calendar` 61 tests,
  `secure-gmail` 43 tests), the patched candidate suite passes (470 tests across
  15 files), and the candidate browser entrypoint test passes.
- The new regression file and the updated
  `packages/e2e/tests/review-workflow.test.ts` both pass, 13 tests total.

Documentation checks:

- A grep for the em dash character across the two contract documents and this
  plan returns nothing, and the new regression asserts that.
- A grep for `Human design`, `Agent details`, and `ledger` across
  `.github/copilot-instructions.md` and both skills returns nothing, and the new
  regression asserts that.
- The regression extracts this plan's headings and compares them to the exact
  required list in the exact required order, and checks that the metadata block
  holds only `Status`, `Issue`, and `Last updated`.
- The regression scans `### Design` for backticks, file extensions, hex commit
  ids, function-call syntax, and directory prefixes, and finds none.
- The issue body was checked for list markers and contains none.
- `git diff --check` is clean.
- The diff was scanned for provider names and secrets and contains neither.

There is no deployment step and no production validation for this change. It
contains no runtime behavior, so nothing is promoted anywhere.

### Rollout and rollback

Rollout is a normal non-draft pull request against `main`. Once merged, new
plans and substantively updated plans use the new structure, and new or updated
issues use the new body. Older plans and issues stay as they are until something
substantive changes in them.

Rollback is a plain revert of the documentation commits. There is no deployed
artifact, no migration, and no runtime state to restore.

### Review log

The first independent review raised four findings. Three were accepted. The
shared cumulative pool already pinned the old skill version and the old "issue
ledger" wording, so it was failing; that is fixed and a new regression file
covers the new contract. The terminal review record had an ordering gap, because
it was told to go in the pull request one step before the pull request gets
created; the wording now says which step writes it and what to do when a
repository has no pull requests. The commit trailer named a model provider,
which the repository forbids in commit messages; the branch history was rewritten
without it.

One finding was disputed. The reviewer asked to migrate the contract-bearing
parts of plan 033. The request for this work explicitly said not to rewrite
existing plans or issues, and the contract itself says untouched historical
plans are not migrated. Plan 033 is a record of a completed change, not a
normative source. The normative contract lives in the repository instructions
and the workflow skill, which is what agents load. The reviewer accepted that on
re-check and the second pass returned no findings.

The result of the final review against the exact landing commit, and the merge
confirmation, are recorded in the pull request rather than here. Writing them
into this plan would change the very diff that was reviewed.

### Checklist

- [x] Read the current repository instructions and both lifecycle skills
- [x] Confirm `adversarial-review` has no plan or issue format reference
- [x] Add the writing style rules to the skill and summarize them in the repo
      instructions
- [x] Replace the plan structure contract with `Human section` and
      `Agent section`
- [x] Replace the issue body contract and remove `## Done`
- [x] Move the terminal review record out of the issue with no ordering gap
- [x] Bump the `safe-feature-development` version
- [x] Write this plan in the new format
- [x] File the tracking issue in the new format
- [x] Push the branch and open a non-draft pull request
- [x] Update the shared pool and add a committed regression for the new contract
- [x] Run the full cumulative pool green
- [x] Resolve every independent review finding
