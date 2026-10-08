# Cold recall regressions

This is a test-only patch for OpenClaw v2026.9.6. Its upstream implementation
already fixes the old cold-recall failure. Active Memory reserves enough time
for optional trigger lookup to settle before the preflight watchdog fires, then
continues required recall. The previous runtime override is removed.

A negative-control run with the unmodified 2026.9.6 plugin recalled a provider
that became ready after 1850 milliseconds. It also passed the upstream trigger
timeout, exhausted-preflight, and recall-settlement regressions. The old patch's
remaining difference was stricter accounting across preflight and recall. That
behavior is not required for this upgrade.

The retained regressions verify successful cold continuation and failure when
the configured recall allowance is exhausted. They check that required recall
receives its configured model timeout and setup grace unchanged. The optional
preflight remains separately bounded by upstream. No production timeout,
configuration, provider fallback, source selection, or stored memory changes.

The cumulative suite retains the plugin's index, trigger, config, and escalation
tests. Its index test runs in the database-worker project. The fixture cleanup
patch joins delayed synthetic work before the next test replaces shared state.
Installed cold-provider validation still runs without prewarming, as described
in the upgrade plan.

Rollback removes this test patch from the source build. Runtime behavior is
already the upstream implementation.
