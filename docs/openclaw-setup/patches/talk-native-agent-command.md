# Native agent command for Talk

Based on [upstream PR #199379](https://github.com/openclaw/openclaw/pull/199379),
head `6f7f68c4092718ceec5ff99a0694cc20b6291e02`, ported to OpenClaw 2026.11.5.
The [approved design](../../plans/realtime-cli-steering-and-results.md) covers
this patch and its qualification requirements.

Talk consultations enter the normal agent command. That command selects the
session's configured runtime, including Claude CLI, instead of always selecting
the embedded runner. Native command and controller owners retain admission,
steering, compaction, cancellation, and terminal settlement. Ordinary typed turns
keep their current route. Copilot remains stock.

The upstream changes also follow committed session successors after compaction,
retain the current relay owner, and reject failed or incomplete CLI settlement.
Talk's machine thinking preference is normalized without changing explicit user
commands. Private reply metadata stays attached without changing serialized
payloads.

The .5 port preserves its new transcript custody rule: generated consult input
is hidden and excluded from later context. The regression targets are registered
in the cumulative patch suite. Local and installed acceptance must prove a real
subscription CLI task can be steered while conversation continues and can deliver
its result proactively. Imported upstream tests alone do not prove that outcome.
