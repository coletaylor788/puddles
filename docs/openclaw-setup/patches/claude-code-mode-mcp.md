# Claude Code Mode over MCP

`claude-code-mode-mcp.patch` connects native Claude's existing MCP adapter to the
shared additive Code Mode runtime. Apply it after
`code-mode-additive-surface.patch`. It does not replace Claude's model loop,
authentication, compaction, or sessions.

Preparation preserves the original filtered tool allowlist and advertises the
two controls separately. Each nested tool call uses the MCP dispatcher's existing
preparation, hooks, approval, parameter validation, current-grant check, execution,
and result capture. Hooks run once. Hook changes to either script-code alias are
reconciled before execution. Guarded raw results enter Code Mode before transport
serialization.

The grant also preserves how the original catalog constructed its coding tools.
An exact list of callable names must not turn node-only `exec` into gateway or
sandbox execution. This host-owned selection stays separate from the name
allowlist and cannot be supplied by an MCP client.

The shared runtime belongs to the current grant and capture. It outlives the
short schema cache so a later `code_wait` can resume work. Grant replacement,
deactivation, revocation, and shutdown dispose it and abort pending work. A later
warm-process turn cannot resume the prior turn's cells. Existing cancellation
and approval waits remain in force; programs gain no transaction or replay
guarantee.

Skill reads select the authorized catalog. Container-visible locations resolve
to the exact delivered source through the existing scoped reader. Guest input
cannot choose a host path.

The cumulative manifest includes real QuickJS over loopback MCP, direct calls,
single hook execution, rewritten or denied inputs, pending approvals, revocation,
cross-agent and warm-turn isolation, scoped skill reads, transport errors, and
native preparation regressions. Installed Claude and Copilot probes remain part
of the [design's release acceptance](../../plans/programmatic-tool-calling.md).

Rollback restores configuration and runtime together through the managed
controller. Disposed cells cannot be resumed and completed writes are not replayed.
