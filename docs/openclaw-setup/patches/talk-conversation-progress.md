# Talk conversation and native progress

This OpenClaw 2026.9.6 patch lets the Live model discuss available context while
backend work runs. It delegates unavailable facts, tools, actions and careful
reasoning. Task controls still require a fresh host result.

The existing consultation callback forwards completed user-facing preambles as
silent context. The built-in harness emits these independently of its reasoning
stream. The Copilot bridge projects completed root `assistant.message` events
only when their phase is `commentary`, excluding reasoning and final answers.
A harness without that event produces no automatic progress; it still
returns its final answer normally. This does not add a summarizer or poll tools.

The runtime bounds updates and removes consecutive duplicates. Gateway ownership
and the provider connection fence late output. During steering, progress waits
for an accepted presentation target; rejected steering retains the original
target. Final delivery and retained child results use their existing claims.

The cumulative manifest includes runtime event filtering, Gateway callback
propagation, native provider channel routing, steering and call retirement tests.
These use recording fixtures and need no model calls. Physical voice quality
still needs client testing. See [plan 050](../../plans/050-talk-conversation-progress.md).

Rollback restores the previous managed runtime and configuration. This patch
adds no stored state or configuration.
