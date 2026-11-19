# Join gateway-owned local services

OpenClaw v2026.11.5 starts provider services through its service-child relay.
A model child can outlive its router, and launchd label removal does not prove
either process has exited. This patch adds durable local-service ownership to
the current relay and group-anchor flow. Its independent group anchor owns
graceful termination and the bounded hard kill of descendants. Windows keeps
the existing process-tree path.

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

The 2026.11.5 relay returns its adapter before readiness settles. The local
service owner retains that adapter and joins preparation before stopping it.
Upstream's protections for late lease release, concurrent reacquisition and
failed exit observation stay in place. Its current lineage and closing
acknowledgment protocol owns group cleanup.

The standalone-anchor packaging regression lives in
`test/scripts/service-child-ownership-bundle.test.ts`. It builds the real
packaging configuration and verifies the artifact has no native runtime imports.
Like upstream packaging tests, it runs in the native `tooling` project and
`test-root-scripts` type graph. Keeping the build configuration out of the core
test graph preserves the existing extension import boundary.

The service fixtures keep listener blocks outside the kernel client-port ranges
on Linux and macOS. The macOS tests assert the ranges returned by the mocked
`sysctl`, real socket bindability, and no overlap with existing listeners. They
do not assume the older fixed 30000–64999 allocation range.

The health-response cancellation fixture drains its incoming request before
observing the client's disconnect. Its response stays unfinished, so the existing
closure assertion still requires response-body cancellation. This accommodates
Node 26.13.1 socket observation without changing runtime cleanup or test timeouts.
