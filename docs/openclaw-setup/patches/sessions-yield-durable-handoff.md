# Persist gathered completion ownership

The blocking `sessions_yield` path records which child completions it returns.
The original handoff map was process-local and capped, so a gateway restart or
map eviction could lose that correlation while the durable completion remained
pending. Recovery could then deliver the same completion as a new requester
turn.

This patch stores the requester session, exact tool-call ID, and gathered run
relationship in each existing durable subagent record before `sessions_yield`
returns. The update covers the whole gathered batch and rolls memory back if
SQLite persistence fails. The process-local map remains only a fast path.

Announcement recovery reads the durable handoff when the fast path is absent.
It acknowledges the completion only after finding the exact successful
`sessions_yield` tool result with the matching gathered run ID in the requester
transcript. Missing or unrelated transcript evidence remains retryable.

Regressions cover persistence failure, SQLite round-trip, exact transcript
matching, and recovery after the bounded process-local map evicts the handoff.
