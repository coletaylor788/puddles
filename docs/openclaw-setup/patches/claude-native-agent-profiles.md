# Claude native agent profiles

This opt-in patch keeps native Claude file operations and shell sandboxing while
preserving OpenClaw's policy vetoes and human approval delivery. It targets the
pinned OpenClaw 2026.9.6 source and requires Claude Code 2.1.301 or newer.

## Permission flow

The Claude adapter distinguishes the pre-tool policy check from a native request
for permission. A passing pre-check continues Claude permission evaluation. A
native escalation always uses the existing allow-once/deny approval transport.
Standing grants and full/off shortcuts cannot satisfy that escalation. Rewritten
arguments, active-run checks, policy vetoes and cancellation remain enforced.
Other backends and agents without a profile retain their behavior.

## Profiles

Configure the Anthropic plugin's `cliConfigDir` and `cliProfiles` by agent ID:
`workspace` enables native file tools and a fail-closed shell sandbox;
`diagnostic` retains the explicitly selected diagnostic exception;
`restricted` selects the existing MCP-only path from that agent's explicit tool
allowance. Tighter per-run caps still win. The rendered MCP grant uses the same
intersection as the advertised tools.

Workspace profiles use the admitted workspace, disable ambient settings and
hooks, deny protected credential paths and temporary MCP credential files, and
allow no direct shell network domains. Their launch environment removes inherited
service credentials even if a preservation override is present. Native subscription
login is required; forwarded API credentials are rejected. Managed settings and
actual CLI path/sandbox behavior need installed acceptance, not just argv tests.

## Scope and validation

The patch touches the bundled Anthropic normalizer and transport, the CLI backend
contract, preparation, environment clearing and the existing permission handler.
Native history import and cold-resume probes also use the selected profile login
directory. Agents without a profile keep their default directory. This preserves
the existing transcript parser, redaction, session binding and account admission.
A native-only default lets Claude evaluate workspace permissions without changing
MCP or fallback exec policy. Explicit exec denials remain effective. No custom
file writer, path classifier, approval service or transcript converter is added.

Registered regressions cover phase opt-in, rewrites, one-time approval, legacy
behavior, restricted caps, inherited credentials and profile/version selection.
The plan tracks installed sandbox, approval, exact-model and continuity gates.

## Code Mode composition

Apply this patch after `code-mode-additive-surface` and `claude-code-mode-mcp`.
Preparation intersects backend profile limits with caller limits before Code Mode
advertises its controls. The underlying grant retains the original execution
provenance, so a node-only `exec` cannot become gateway execution when names are
frozen. Native file tools stay outside the script catalog. Empty MCP limits add
no controls. Registered preparation tests exercise workspace, diagnostic and
restricted profiles with direct and scripted calls and disconnected nodes.
