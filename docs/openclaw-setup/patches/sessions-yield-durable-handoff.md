# Persist gathered completion ownership

The blocking `sessions_yield` path records which child completions it returns.
The original handoff map was process-local and capped, so a gateway restart or
map eviction could lose that correlation while the durable completion remained
pending. Recovery could then deliver the same completion as a new requester
turn.

The OpenClaw 2026.9.6 patch stores the requester session, exact tool-call ID, and gathered run
relationship in each existing durable subagent record before `sessions_yield`
returns. The registry worker commits the whole gathered batch before ownership appears
in memory. A changed completion or persistence failure leaves the original
records available for recovery. The process-local map remains only a fast path.

Browser cleanup may set its dispatch timestamp while the worker waits. A proven
uncommitted save may retry with a fresh complete snapshot only when that
one-time timestamp is the sole change. An acknowledged save publishes ownership
without overwriting a newer cleanup timestamp. Changes to completion, delivery,
generation or identity still fail, and committed or uncertain saves are never
replayed.

Upstream 9.6 already persists subagent completions through its registry worker.
It does not record ownership of Puddles' blocking gather result. The remaining
patch adds that correlation through the existing asynchronous worker API; it
does not replace upstream persistence or add a second database writer.

Announcement recovery reads the durable handoff when the fast path is absent.
It acknowledges the completion only after finding the exact successful
`sessions_yield` tool result with the matching gathered run ID in the requester
transcript. Missing or unrelated transcript evidence remains retryable.

Regressions cover worker commit ordering, cleanup races before and after commit,
bounded retries, concurrent completion changes,
persistence failure, SQLite round-trip, exact transcript
matching, and recovery after the bounded process-local map evicts the handoff.
