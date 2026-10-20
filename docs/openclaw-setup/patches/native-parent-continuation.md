# Native parent continuation

Use upstream `sessions_yield` and its durable requester-owned continuation.
OpenClaw 2026.9.6 contains the parent-final automatic-delivery and stale-child
announcement fixes. Custom blocking gather and its durable handoff are retired
together. Source framing remains in `untrusted-agent-results.patch`, including
native reply, announcement and bounded cron fallback paths.

The patch changes test synchronization only. The empty-parent retry fixture must
join worker I/O before advancing fake time past its retry deadline. Final parent
reply and no-raw-send assertions remain unchanged. The cumulative selection
covers native yield ownership, staggered children, overlapping parent turns,
late child announcement rejection and recovery after restart.

Existing custom handoff records must be reconciled through reviewed application
preparation before activation. Runtime patch removal alone is not cutover proof.
Keep read-only production checks and recording fixtures for delivery acceptance.
