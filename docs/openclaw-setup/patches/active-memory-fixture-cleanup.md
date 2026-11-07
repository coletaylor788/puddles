# Control memory fixture timing and cleanup

This test-only patch follows the cold-recall regressions on OpenClaw v2026.9.6.
Several fixtures can return a hook result before their simulated embedded run has
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
and joins it before leaving the case. Existing output and failure assertions stay intact. No production timeout or
teardown retry changes are made.

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

The rotated embedded-transcript fixture controls its clock while retaining real
filesystem reads. After its initial transcript write, it advances the actual
poll interval and waits for the held stale read. Embedded completion stops the
watcher before that read is released. Cleanup stays held until the stale read
has drained, so a missing post-read stopped check remains observable. The
fixture joins recall cleanup and removes its own rotated transcript before the
next test. Its recall budget and grounded-answer assertions are unchanged.

A later full run failed the stale-read variant while the prior custom-tool case
passed. Both unchanged rotated variants passed in isolation. This result does
not prove the historical cause; the correction addresses the fixture's real-clock
sensitivity and missing cleanup join without changing runtime behavior. All five corrected focused cases and all 226 tests in the file pass. Temporarily
removing the post-read stopped guard fails the grounded-context assertion as
expected; the original watcher is restored after the negative check. A fresh
complete application run remains required.

The harness-native outcome table also fixes its clock while retaining real
filesystem work. Its mocked agent supplies tool evidence and completes
immediately, so classification should not depend on disk work finishing within
a real one-second timer. It joins the underlying recall before shared fixture
reset. All five expected classifications, including terminal errors with a
summary, retain their assertions and the configured 1,000 ms budget. Dedicated
deadline tests keep their original clocks and behavior.

A full run reported `timeout_partial` instead of `ok` for the successful-summary
row. The precise scheduling or I/O delay is unproven; this is not evidence of a
runtime defect. The corrected five-row table and all 226 tests in the file pass,
including the separate deadline regressions. The complete application release
must still pass before deployment.

The runtime cold-recall override is retired. These joins remain necessary for
the retained delayed-provider and cleanup fixtures. The cumulative manifest
retains the complete Active Memory group. The index
fixture now runs in upstream's database-worker project. Removing the
cold fixture join deterministically fails its new leftover-session assertion.
Rollback removes this patch from the source build; it changes no runtime state.
