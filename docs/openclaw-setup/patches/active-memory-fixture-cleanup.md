# Join delayed Active Memory fixtures

This test-only patch follows the cold-recall regressions on OpenClaw v2026.11.3.
The prompt hook may return before its recall child finishes writing transcripts
and cleaning its session. Tests must join that child before shared fixture state
is reset. No runtime deadlines, cancellation, or cleanup policy change.

The cold-provider table retains all three configured readiness/deadline cases.
Its teardown releases the provider, joins recall, and checks that no temporary
recall session or recorded transcript remains. The timed-out child may outlive
the prompt result, so releasing the provider alone is insufficient.

The custom-tool evidence table keeps stable's failed-memory-search case and
restores the earlier same-custom-tool retry case. A controlled clock advances
only the intended retry delay after the failed transcript write. Both writes
have gates, and teardown releases the retry and joins the hook and child before
checking cleanup. The failed custom-tool timeout case and five-row harness
outcome classification table had no exact stable replacements. They remain
explicit regressions here, retaining their success, failure, error-payload,
partial-context, and grounded-summary expectations. The custom timeout case
holds cleanup while observing the timeout result, then releases and joins it.

The rotated-transcript test retains stable's stale-read behavior and restores
the earlier non-stale row. It drives the native poll interval after the initial
transcript exists, holds cleanup until the stopped watcher has discarded the
stale read, joins recall, and removes the rotated file owned by the fixture.
Both rows retain the grounded-context assertion and check for leftover sessions
and transcripts.

Stable already joins recall in its provider-missing terminal-result case and
checks that the session disappeared. This patch adds its transcript-emptiness
check. Stable's rejected-timeout-partials cases already join with
`Promise.allSettled`; they remain unchanged. Its terminal-cleanup deadline and
direct-abort cases are related coverage, not substitutes for the restored
custom-tool and harness outcome cases. No blanket upstream-equivalence claim
is made for the old fixture patch.

The cumulative application suite must run `extensions/active-memory/index.test.ts`
in stable's `extension-database-workers` project, along with the other selected
Active Memory tests. The complete file passes all 109 cases on composed stable
source, including the restored regression families. Source review, lint and
patch application checks pass. The final candidate still requires the complete
application and installed release gates.

Rollback removes this test patch from the source build. It changes no runtime
state.
