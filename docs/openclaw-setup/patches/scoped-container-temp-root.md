# Scoped container environment staging

OpenClaw v2026.9.3 stages Docker and Podman environment values in a private
short-lived file. Its default prefers a shared OpenClaw temporary root even
when a caller isolates its ordinary temporary directory.

The maintained `resolveSandboxContext` entrypoint accepts an optional `tempRoot`.
It carries that explicit path through backend creation to container environment
staging, including a sandbox browser. Low-level `createContainerEnvFile` and
`withContainerEnvFile` accept `{ rootDir }`. An invalid selected root fails
instead of falling back elsewhere. Existing filesystem helpers still own
private directory and file permissions and cleanup.

This is a trusted host composition option, not an agent tool argument or a
configuration override. Without it, production staging is unchanged. It does
not change database locations, lock authority, sandbox policy, mounts, or tool
permissions. A caller must keep its selected root outside shared resources
and available until provisioning settles.

The cumulative pool covers real staging and cleanup after success and failure,
invalid-root rejection, context and backend propagation, and both container
and browser creation. Engine operations use recording doubles. Rollback
restores the previous runtime archive without changing stored state.
