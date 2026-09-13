# Current-attempt silent reply evidence

OpenClaw 2026.9.3 removes a deliberate silent token from the texts collected
for delivery. Its terminal resolver checks only those texts when deciding
whether an empty reply is intentional. An allowed group silence therefore
looks like a missing answer and incorrectly triggers another model request.

The patch uses the existing current-attempt assistant record when the delivery
texts contain no visible text. A completed response from this attempt is also
valid evidence. Historical assistant messages are not. Existing conversation
policy, error, abort, pending-call, and side-effect checks remain authoritative.
Direct conversations still recover a visible answer when their policy forbids
silence.

The patch targets stable source
`1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`. Its terminal-resolution regression
is registered in the cumulative patch manifest under `agents-embedded-agent-run`.
It covers streamed, current, and completed silent evidence, rejects historical
evidence, and retains required-answer recovery. The installed iMessage pool
separately requires zero sends and one model request for group silence, and one
send after two model requests for direct recovery.

Reapply through the documented native runner. Do not change installed chunks.
Remove the patch only after upstream retains equivalent current-attempt
evidence and both installed scenarios still pass.
