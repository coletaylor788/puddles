# Approved session send

A policy plugin for one fixed cross-agent question route. It uses OpenClaw's
native pre-call approval and scoped session-access SDK. It does not register a
replacement tool or patch agent-to-agent communication.

Configure exact interactive requesters and a canonical destination:

```json
{
  "requesterAgentId": "household",
  "targetSessionKey": "agent:main:main",
  "requesters": [{
    "sessionKey": "agent:household:imessage:direct:fixture-person",
    "channel": "imessage",
    "accountId": "default",
    "senderId": "fixture-person"
  }]
}
```

Use real host-observed session and sender identities in deployment configuration.
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

Set `plugins.entries.approved-session-send.hooks.allowConversationAccess=true`
to enable the route-specific prompt guidance. It replaces older relay directions
only in the configured household conversations.

Every question requires native approve-once or deny. Configure native plugin
approval forwarding to a fixed authenticated owner target and include the
requester agent in its forwarding filter. This plugin never sends approval
messages itself and does not treat the requesting sender as an owner.

Calls accept `sessionKey`, `message`, and an optional `timeoutSeconds` of 60.
The complete origin, destination, and quoted question must fit the native
512-character summary. Control characters and hidden formatting are rejected.
A positive wait returns the matching answer as the native tool result. Scoped
sends create no detached ping-pong, announcement, or watch. A wait timeout can
return `accepted` without a reply; it does not cancel main or promise later
delivery. Any further question requires another approved call.

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
