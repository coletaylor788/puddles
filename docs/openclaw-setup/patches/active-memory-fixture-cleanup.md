# Control memory fixture timing and cleanup

This test-only patch follows the cold-recall regressions on OpenClaw v2026.9.6.
Three fixtures can return a hook result before their simulated embedded run has
finished. The cold fixture releases its delayed writer in teardown. The
unavailable-result fixture can settle from transcript polling while cleanup is
still pending. Replacing shared test state at either point lets the old run
write into the next case or consume its one-shot cleanup mock.

The custom-tool timeout fixture also holds cleanup until its timeout result is
observed, then releases and joins the recall owner before returning. It retains
the original timeout, failed-tool event, absent-context assertion, and rejection
of partial timeout context. The following custom-tool success assertion includes
the existing recall diagnostics if it fails. Its deadline and expected answer
are unchanged.

Track each affected recall through its complete session cleanup. The cold
fixture asserts that no recall session or transcript remains. The unavailable
fixture deliberately holds cleanup after terminal polling wins, then releases
and joins it before leaving the case. Existing timing, output, and rotated
transcript assertions stay intact. No production timeout or teardown retry
changes are made.

The custom-tool retry fixture also uses a fake clock. It waits for the failed
transcript write, advances the intended 75 millisecond retry delay, then waits
for the successful write and recall result. Slow filesystem operations no longer
consume its one-second recall budget. Its success and context assertions remain
unchanged. Teardown releases the retry and joins the recall before shared state
is reset.

A full application run failed the following custom-tool success assertion. That
case passed alone and with three neighboring timeout cases. The missing join is
a demonstrated isolation gap, but those results do not establish it as the cause
of the full-run failure. The correction does not claim a runtime defect or waive
the next complete application run.

The runtime cold-recall override is retired. These joins remain necessary for
the retained delayed-provider and cleanup fixtures. The cumulative manifest
retains the complete Active Memory group. The index
fixture now runs in upstream's database-worker project. Removing the
cold fixture join deterministically fails its new leftover-session assertion.
Rollback removes this patch from the source build; it changes no runtime state.
