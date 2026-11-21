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

A successful native CLI yield settles the command acknowledgement and preserves
the existing promoted requester-final attachment. Previously the adapter only
claimed visible non-yielded completion, so it revoked that attachment before the
resumed parent answer could reach voice. The correction retains terminal-write
draining, abort/error refusal, receipt identity and current-voice checks. The
regression covers current and stale non-embedded yields alongside embedded runs;
it fails on the previous adapter and passes after the correction.

Settled speech uses the command's terminal-answer snapshot. Claude may retain an
answer produced before a refinement as interim history, then return the corrected
answer in the same command. Joining all result payloads spoke both. The terminal
snapshot already identifies the final model answer; silent and empty snapshots
cannot revive earlier text. Runtimes without that metadata retain the existing
payload projection. Cancellation and timeout checks still precede speech.

The .5 port preserves its new transcript custody rule: generated consult input
is hidden and excluded from later context. The regression targets are registered
in the cumulative patch suite. Local and installed acceptance must prove a real
subscription CLI task can be steered while conversation continues and can deliver
its result proactively. Imported upstream tests alone do not prove that outcome.
