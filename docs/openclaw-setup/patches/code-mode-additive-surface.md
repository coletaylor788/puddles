# Additive Code Mode

`code-mode-additive-surface.patch` adds optional contained scripting alongside
an agent's existing direct tools. Set `tools.codeMode.surface` to `"additive"`
and enable the bundled `code-mode-quickjs` plugin. Existing compact Code Mode
remains the default.

The added controls are `code_exec` and `code_wait`; shell `exec` stays unchanged.
Both invocation paths use the same authorized catalog and scheduling rules.
Controls cannot call themselves through the catalog. Direct calls retain rich
results and discovery. Tool-less runs gain no controls.

Additive mode requires the bundled QuickJS executor. It rejects Node VM execution
and executor replacement. Guest computation has no ambient filesystem, process,
network, environment, or module access. Existing scoped tool calls and authorized
skill reads remain available. Skill readers preserve the delivered library and
workspace boundaries in embedded and native harnesses.

Control identity survives tool wrappers, so hook metadata and restart handling
distinguish scripting from shell execution. Both direct and scripted calls retain
the existing tool policy and approval path.

The cumulative patch manifest runs the configuration, executor, guest, catalog,
native Copilot bridge, embedded client-tool, prompt, and wrapper regressions.
The [design](../../plans/programmatic-tool-calling.md) records scope and acceptance.
Claude also requires [its MCP integration](claude-code-mode-mcp.md).

Disable additive Code Mode to remove the extra controls. Restore configuration
with its matching runtime through the managed release controller. Never replay
interrupted or uncertain writes.
