# Gather subagent results inside the requester turn

The patch targets OpenClaw 2026.9.6. When a requester calls `sessions_yield`
with children still running, it waits in that turn and returns their results
as the tool response. The requester can then synthesize one answer. Without
this path, child completion can fall back to a raw channel reply after the
requester has yielded.

Gathering includes only announced descendants owned by the current requester
agent and turn. Collector runs keep their explicit wait path. An explicit
`waitFor: "message"` goes to the upstream pause owner without gathering. The
current release's guard for earlier async tool results runs before gathering. A timeout
reports pending work, and read failures remain errors instead of claiming that
results were consumed. Transitional registry entries without child keys are
ignored by descendant traversal.

The announcement path remains retryable while gathering. It acknowledges a
completed child only when the requester transcript contains the exact successful
`sessions_yield` result and matching run ID. The separate
[durable handoff patch](./sessions-yield-durable-handoff.md) preserves that
relationship across restart and bounded cache eviction.

The accumulated pool includes tool behavior, scoped descendant collection,
registry traversal, interrupted completion recovery, and exact transcript
handoff checks. Use the [managed lifecycle](./README.md) for builds,
installed message fixtures, delivery, and rollback. Historical in-place bundle
edits and live message tests are not part of this upgrade workflow.
