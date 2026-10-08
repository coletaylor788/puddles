# Talk follow-up rejection and concurrent work

This patch targets OpenClaw 2026.9.6. A second voice request can arrive while
the agent is still working. Talk tries to inject that request into the active
run. Some harnesses cannot accept the guarded injection that binds input to
the exact caller and run. Previously, that refusal aborted the original task
and closed the whole realtime connection.

The Gateway now distinguishes this confirmed pre-injection refusal from an
execution failure. The voice provider reports that the additional request was
not accepted and asks the user to repeat it after the earlier task finishes.
The original work, its result owner, and the live conversation remain active.
This does not add a task queue or enable unguarded injection. Accepted input
with an uncertain receipt is never replayed.

## Coverage

The cumulative pool includes the following layers. Provider tests use the real
public GPT-Live event decoder and delegation controller with recording transport
and backend doubles. They need no live credentials or model calls.

| Layer | Scenarios and assertions |
| --- | --- |
| Public voice protocol | Transcript before or after delegation notice, duplicate notices, missing user input, repeated follow-up refusals, continued input and subsequent requests |
| Work and completion | Pending reads, parallel results returning out of order, recorded effects executing once, tool failure, yielded reader result, result racing steering rejection |
| Ownership | Original result retains its request, delayed child result delivered once, cancel and hangup fence late output, reconnect uses a new owner |
| Error handling | Unsupported steering keeps the call alive, unknown and uncertain failures keep existing handling, failed rejection delivery performs fatal cleanup without an unhandled promise |
| Gateway and tools | Exact caller and run checks, readiness races, unchanged spoken confirmation rules, standard-policy tool restrictions, reused tool callbacks and descendant work ownership |

The controller's tool-shaped doubles test timing and result routing. They do
not establish real calendar access or tool authorization. The pool retains the
actual Gateway, approval and host-capability suites for those boundaries.
Physical microphone, audio routing and device reconnect behavior still require
client testing. A passed mock scenario is not proof of an iOS audio session.

## Rollback

Use the managed deployment transaction to restore the preceding runtime and
its matching configuration. This patch adds no configuration or stored state.
