# Current-attempt silent reply evidence

OpenClaw 2026.9.6 now classifies silent replies from the current attempt's
assistant record, including its completed response. That upstream owner covers
the maintained behavior, so this patch retains regression tests only. It adds
no runtime override.

The terminal-resolution tests exercise streamed, current, and completed silent
responses for both explicit optional replies and internal notifications.
Historical assistant messages cannot supply a required answer. Direct
conversations still recover visible output when their policy requires it.
The installed iMessage pool separately checks group silence and direct-answer
recovery through recording adapters.

`src/agents/embedded-agent-runner/run/terminal-resolution.test.ts` remains in
the accumulated pool under `agents-embedded-agent-run`. Follow the
[managed lifecycle](./README.md) for installed validation and deployment.
