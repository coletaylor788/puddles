# Harness tool work ownership

This patch targets OpenClaw 2026.9.6. A reused harness connection can deliver
later tool callbacks from the async context of its first attempt. When that
attempt has ended, memory search and reader initialization fail with
`Async work scope is closed` even though the current run is authorized.

Capture work ownership when the host capability is created. Enter that owner
for direct execution, preparation, and execution of a prepared tool. Discard
only the transport's unrelated work scope and ancestry. Existing caller binding,
permission checks, source guards, cancellation and result validation remain.
The current owner joins cooperating descendants. A closed owner still rejects
new work; the patch never reopens it or grants a fresh scope to a stale tool.

The cumulative regression reuses one transport across consecutive attempts,
exercises both execution paths, checks caller identity, waits for descendant
cleanup, and rejects closed owners and revoked tools. No model calls or live
external operations are needed. Roll back through the normal managed runtime
activation procedure.
