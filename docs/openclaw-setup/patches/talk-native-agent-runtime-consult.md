# Talk native agent runtime consultation

This patch follows the existing Talk patch set on the pinned OpenClaw source.
It routes a realtime consultation through the authenticated native gateway
command entrypoint. That entrypoint uses the same configured command-line
runtime selection, native session resume, and provider fallback path as normal
agent turns.

The adapter keeps the prepared OpenClaw session and binds the exact operational
run instance before execution. It carries the admitted sender status, tool
limits, operator authority, model choice, timeout, cancellation, transcript
recorder, session tool overrides, and source-current fence into the native
command. Public command ingress cannot supply the internal commentary flag.
The command does not deliver an ordinary channel reply. Talk owns the returned
result and uses a silent internal runtime so the command does not print that
result as console output.

CLI preamble events become Talk progress updates only while the same admitted
run remains current. Yielded work keeps its native metadata and requester-final
owner. The outer Talk lane continues to own overlap, cancellation, and result
delivery.

The source suite includes a composed boundary regression. It invokes the Talk
adapter, native gateway command, production runtime selector, and a recording
CLI runtime. The embedded API candidate is a failing test double, so a selector regression
cannot contact a provider. The regression covers a configured model without a
per-run override and an explicitly selected model. Additional tests cover
authority, transcript targeting, cancellation, progress, continuation
ownership, import failure, session tool overrides, and public-ingress
sanitization.

The installed DEV and TEST qualification uses the existing native subscription
fixture. It proves real CLI login, stable session identity, and exact synthetic
workspace tool evidence without allocating a realtime provider session.

Rollback restores the previous managed runtime and configuration. This patch
adds no persistent state or configuration.
