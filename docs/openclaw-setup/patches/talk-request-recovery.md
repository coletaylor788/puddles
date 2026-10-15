# Talk request recovery

This patch follows the existing public patch set on OpenClaw 2026.9.6. It keeps
natural task-status questions on the host control path and avoids interpreting
ordinary discussion beginning with "also" as an instruction to queue work.
Precise status questions also match after earlier discussion in a continuous
transcript. This leaves transcript context and mutating-control classification
unchanged.

Calling the consultation runner no longer produces an optimistic spoken receipt.
Actual host progress and results establish what happened. A refused overlapping
request gets its own response, while the original request retains its result
and the call remains open. Rapid overlapping input cannot silently displace a
request without reporting its refusal.

If the original request fails before starting, or finishes before extra input
reaches it, known non-admission preserves the original outcome and call. The
Gateway still checks the exact call owner. Accepted input with an uncertain
receipt is not classified as a safe refusal or replayed.

After a terminal outcome, the live model can send another contextual request.
This adds no automatic retry loop, steering capability, or queue. Reader behavior
and the selected harness adapter remain unchanged. Cancellation and connection
ownership still fence late results.

The cumulative suite runs source regressions and the installed Talk concurrency
scenario. Its backend and provider are recording doubles with network access
denied. Separate real-model DEV checks measure delegation decisions. See the
[approved plan](../../plans/voice-control-after-harness-migration.md).

Rollback restores the previous managed runtime and configuration. This patch
adds no persistent state or configuration.
