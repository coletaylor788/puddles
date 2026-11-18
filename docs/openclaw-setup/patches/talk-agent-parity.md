# Talk parity now provided by OpenClaw

The runtime patch is retired on OpenClaw `v2026.11.3`. Native Talk now uses the
ordinary agent permission and approval chain. It also starts consultation work
under independent admission with detached work, so closing the offer request
does not close an accepted consultation's work scope.

This matches the former `talk.realtime.confirmationPolicy: standard` behavior.
Remove that retired setting through an exact, reviewed configuration transition.
The former `high-impact` selection is a different behavior and must not be
silently mapped to the native default.

The cumulative application suite retains native permission, owner, revocation,
relay readiness, consultation, cancellation and work-admission regressions. The
remaining Talk overlap patch retains the two integration cases that prepare a
real context engine after the offer scope closes before or during consultation.

Retiring this patch does not prove the separate native CLI voice repair. That
repair follows the stable upgrade's complete production lifecycle.
