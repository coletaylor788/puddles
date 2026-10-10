# Talk conversation and native progress

This OpenClaw 2026.9.6 patch makes Live conversation the default, including
reasoning, explanation, brainstorming, and iteration while backend work runs.
It delegates missing memory or context, information requiring a tool lookup,
and external actions. Follow-ups reuse available results unless they need a new
lookup or action. Task controls still require a fresh host result.

The provider prompt, consultation tool description, and automatic session
instructions share that boundary. Explicit always-consult instructions remain
available for operators who select that behavior.

The existing consultation callback forwards completed user-facing preambles as
silent context. The built-in harness emits these independently of its reasoning
stream. The Copilot bridge projects completed root `assistant.message` events
only when their phase is `commentary`, excluding reasoning and final answers.
A harness without that event produces no automatic progress; it still
returns its final answer normally. This does not add a summarizer or poll tools.

The runtime bounds updates and removes consecutive duplicates. Gateway ownership
and the provider connection fence late output. During steering, progress waits
for an accepted presentation target; rejected steering retains the original
target. Final delivery and retained child results use their existing claims. Normal transport retirement also fences pending steering before the provider acknowledges closure, preserving accepted host work. Explicit cancellation still aborts it.

The cumulative manifest includes runtime event filtering, Gateway callback
propagation, native provider channel routing, steering and call retirement tests.
These use recording fixtures and need no model calls. Physical voice quality
still needs client testing. See [plan 050](../../plans/050-talk-conversation-progress.md).

Rollback restores the previous managed runtime and configuration. This patch
adds no stored state or configuration.
