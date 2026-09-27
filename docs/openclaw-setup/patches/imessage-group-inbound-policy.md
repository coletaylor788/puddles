# iMessage group event policy

OpenClaw 2026.9.6's iMessage adapter marks every inbound message as a user
request. That ignores `messages.groupChat.unmentionedInbound: "room_event"`
and the corresponding per-agent setting. An unmentioned group message then
requires a visible answer even when the model deliberately returns `NO_REPLY`.

This patch reuses the existing channel event classifier and policy resolver.
It passes the same classification to the host admission binding and the
message context. Direct messages, mentions, control commands and aborts remain
user requests. The default group policy stays unchanged. Explicit per-agent
policy takes precedence over the global setting.

The route regression checks both context and admission evidence for those
cases. The shared classifier tests remain in the cumulative pool. Installed
scenarios exercise silent group completion and required direct replies through
the recording bridge. The terminal-completion patch remains test-only because
the defect occurs before terminal processing, at inbound classification.

Follow the [managed lifecycle](./README.md) for validation and deployment.
