# Control memory fixture timing and cleanup

This test-only patch follows the cold-recall regressions on OpenClaw v2026.9.6.
Two fixtures can return a hook result before their simulated embedded run has
finished. The cold fixture releases its delayed writer in teardown. The
unavailable-result fixture can settle from transcript polling while cleanup is
still pending. Replacing shared test state at either point lets the old run
write into the next case or consume its one-shot cleanup mock.

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

The runtime cold-recall override is retired. These joins remain necessary for
the retained delayed-provider and cleanup fixtures. The cumulative manifest
retains the complete Active Memory group. The index
fixture now runs in upstream's database-worker project. Removing the
cold fixture join deterministically fails its new leftover-session assertion.
Rollback removes this patch from the source build; it changes no runtime state.
