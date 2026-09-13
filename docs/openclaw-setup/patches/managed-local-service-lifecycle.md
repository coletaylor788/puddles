# Join gateway-owned local services

OpenClaw v2026.9.3 starts local provider processes directly. A model child can
outlive its router, and launchd label removal does not prove either process
has exited. This patch uses the existing service relay for POSIX providers.
Its independent group anchor owns graceful termination and the bounded hard
kill of descendants. Windows keeps the existing process-tree path.

The host retains the relay until the group is gone, even after router exit.
Shutdown joins construction before cleanup, so a late startup cannot escape
the stop operation. Reacquisition waits for the preceding stop. One-shot hosts
can still exit normally because a ready relay can be unreferenced.

A small record in the selected state directory binds the gateway, relay, and
group anchor to their existing process start identities. The anchor is recorded
before the native service starts. After gateway loss, recovery signals only a
matching live anchor. It never kills an unverified numeric process group. An
incomplete record, changed identity, or surviving group blocks replacement.
The generic relay's stricter escaped-lineage behavior remains unchanged.

The installed process SDK exposes identity capture and a graceful-first stopped
service join. Activation captures the gateway identity before disabling its
service, then joins the gateway, relay, and model group before copying mutable
state. Rollback does the same. Both use the sealed candidate copy retained in
the recovery directory, even after the target runtime has been exchanged.

Regressions cover gateway loss during startup and after readiness, a router
that exits before its model, stubborn descendants, identity reuse, incomplete
records, and activation failure before the state snapshot. The cumulative
manifest also retains the existing generic relay lifetime cases. This patch
does not change embedding request timeouts or claim model readiness.
