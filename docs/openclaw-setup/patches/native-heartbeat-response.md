# Native heartbeat response patch retired

OpenClaw 2026.11.5 replaces authored heartbeat configuration with native Cron
automation. Doctor converts supported existing schedules. The old patch depended
on a `heartbeat_respond` tool that this release no longer constructs, so retaining
its prompt and filter changes would not provide the old runtime behavior.

The patch is removed. Native Cron handles quiet `NO_REPLY` completion, announced
alerts, isolated run history and the main conversation's continuation. The
installed scenario retains those behavior checks with ordinary model output and
recorded delivery. This is a compatibility retirement, not a new automation path.

Two tests for the deleted custom heartbeat runner are retired. Native system
prompt, terminal resolution, coding tool and stock Copilot tests remain selected
independently. Fixture unit tests pass; the new installed Cron scenario must pass
on the complete candidate before release.
