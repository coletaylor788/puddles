# Approved session send

A policy plugin for one fixed cross-agent question route. It uses OpenClaw's
native pre-call approval and scoped session-access SDK. It does not register a
replacement tool or patch agent-to-agent communication.

Configure the calling agent and a canonical destination:

```json
{
  "requesterAgentId": "household",
  "targetSessionKey": "agent:main:main"
}
```

OpenClaw identifies the calling agent. Interactive conversations belonging to
that agent can request approval regardless of channel or sender. The hook checks
the native agent, session, run, and current session incarnation. Child, cron, and
hook sessions retain their restrictions. The scoped provider matches the native
requester session's agent and the fixed target.

The plugin entry must be explicitly enabled. Native `tools.agentToAgent` policy
must deny the ordinary requester/target pair. The plugin fails closed if it does
not. The SDK grant permits only `send` to the exact target session; it grants no
history, search, status, discovery, or alternate-target access. Native tool policy
must expose `sessions_send` only to the intended interactive agent. Its workers
retain their existing restrictions.

The validated harness is native Copilot. The manifest declares both startup and
Copilot run activation. OpenClaw also uses `discovery` registration for prepared
agent runs, so the plugin registers its policy there. A process-wide scoped grant
is refused unless the current native request registry contains this loaded
plugin and its approval hook. Unsupported run registries fail closed. Do not
enable another harness without proving that same composition.

Put question instructions in the requester's agent-level `AGENTS.md` so native
app and channel conversations receive the same guidance. Replace old manual
message-relay instructions. Tell the agent to use `sessions_send` with the fixed
target, a complete short question, and `timeoutSeconds=600`, then use the returned
answer in the originating conversation. Every follow-up needs a fresh approval.
Do not retry uncertain sends or promise later delivery. The plugin registers no
conversation-specific prompt override.

Every question requires native approve-once or deny. Configure native plugin
approval forwarding to a fixed authenticated owner target and include the
requester agent in its forwarding filter. This plugin never sends approval
messages itself and does not treat the requesting sender as an owner.

Calls accept `sessionKey`, `message`, and an optional `timeoutSeconds` of 600.
The complete origin, destination, and quoted question must fit the native
512-character summary. Control characters and hidden formatting are rejected.
A positive wait returns the matching answer as the native tool result. Scoped
sends create no detached ping-pong, announcement, or watch. A wait timeout can
return `accepted` without a reply; it guarantees neither target completion nor
later delivery. Any further question requires another approved call.

Configuration changes disable the old registration until plugin reload.
Runtime cleanup removes the grant. Native admission rejects replaced or archived
target sessions after grant resolution. Approval binds the final tool arguments;
it does not approve the exact answer or authorize main's other tools.

Run `pnpm --filter approved-session-send test` and `build` for focused checks.
The cumulative application suite includes `candidate.household-approval.test.ts`,
which installs the bundle outside its source tree, resolves the actual candidate
SDK, and exercises native approval, session storage, and the native send executor
with recording Gateway calls. This composed test is not a deployed DEV check.
See the [plan](../../docs/plans/household-native-approvals.md) for release acceptance.
