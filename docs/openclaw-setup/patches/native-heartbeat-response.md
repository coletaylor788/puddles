# Native heartbeat responses for the built-in runtime

Isolated heartbeat checks can complete tools without needing a visible chat answer. The native structured response records that completion and separately selects whether to notify the configured conversation. With the default reply policy, upstream currently selects this path only for the Codex harness.

This patch also selects the built-in non-CLI runtime. Explicit automatic reply mode and CLI-backed text completion retain their previous behavior. Normal chat turns keep their existing tool scope. The heartbeat prompt uses the native response tool's notification contract and avoids also requiring a separate message send.

## Configuration

The runtime selection does not bypass tool policy. If the agent uses an explicit allowlist, include `heartbeat_respond`. If its sandbox uses a restricted tool policy, include the same tool in that policy's `alsoAllow` list. Denies remain authoritative. Merely adding a name to a policy does not instantiate a tool outside heartbeat turns.

Finish a poll with one truthful structured response. Use `notify:false` for quiet completion. Use `notify:true` with a concise, self-contained `notificationText` for an update or question. Native dispatch sends it to the configured destination. Do not separately send the same notification with the message tool. Tool acceptance precedes dispatch and is not a delivery receipt.

Confirmed delivery places bounded awareness in the destination session for its next ordinary reply. Intervening heartbeats leave this context queued. This existing context is memory-resident and capped at 1,000 characters; durable task details belong in the existing task record.

## Validation and rollback

The cumulative manifest registers selector, prompt, tool assembly, terminal completion, and destination-awareness regressions. The committed native heartbeat scenario uses a real Gateway with synthetic provider responses and recorded iMessage delivery. It runs the persisted monitor through native cron execution, seeds its checklist with revision-checked scratch updates, and asserts that checklist reaches the model. It checks three fresh heartbeat sessions, quiet completion, a single question, an intervening poll, and the question in the next main reply prompt. The tool assembly regression checks agent and sandbox grants independently and preserves denial when either is missing.

Run the accumulated release command from the repository root:

```sh
node packages/e2e/bin/openclaw-test-env.mjs ci
```

Rollback uses the prior verified artifact and its configuration snapshot through the maintained activation helper. Removing a patch from a deployed tree in place is unsupported.
