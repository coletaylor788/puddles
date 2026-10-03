# Talk authorization and consultation lifetime

This patch targets OpenClaw 2026.9.6. It adds an optional way to use ordinary
agent authorization in Talk and fixes reader delegation after voice setup ends.

## Authorization

Set `talk.realtime.confirmationPolicy` to `standard` to use the same tool
permissions and approval chain as text. This skips only the additional spoken
confirmation check. Ordinary tool policies, approval requirements, caller
identity, delegation restrictions and execution guards still apply. Tool calls
are checked before hooks and again after tool-owned parameter finalization.

Omitting the setting or choosing `high-impact` preserves upstream behavior.
The setting belongs to trusted Gateway configuration, not tool arguments or
client session requests. This patch does not grant additional tools to a child
agent or treat a read-only task description as an enforced permission.

## Consultation lifetime

Provider callbacks can retain the async context of the request that created
the voice session. That request can finish while a consultation is still using
the callback. Context-engine initialization then fails with
`Async work scope is closed`, before the delegated reader can access a tool.

Start consultation work outside the setup request's async work scope. Preserve
the other async context, including authenticated caller identity. The existing
consultation Gateway admission, embedded agent and completion owners retain
responsibility for cancellation, shutdown and accepted work after hangup.
Closed-scope checks remain unchanged elsewhere.

## Validation and rollback

Registered regressions prepare a real context engine after setup closes before
or during a consultation, preserve caller context, check ordinary tool denial
in standard mode, and retain existing confirmation, cancellation and hangup
coverage. Tests use synthetic requests and mocked tool execution, without live
model calls or external writes.

Configuration migration selects the policy only with a runtime that understands
it. Roll back the runtime and matching configuration through the normal managed
activation recovery path.
