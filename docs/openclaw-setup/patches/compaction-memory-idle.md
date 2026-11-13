# Compaction memory snapshots and idle maintenance

Compaction notifications retain a detached conversation snapshot before starting a separate internal memory session. The source conversation does not wait for memory inference. The saver uses detached gateway work admission, which gives it its own asynchronous work scope through cleanup after the triggering request closes. Retained jobs use OpenClaw's existing keyed state store, preserve the source harness and all supplied policy constraints, omitting absent optional metadata before durable serialization, and serialize appends to each workspace. Duplicate notifications reuse the same snapshot job. Interrupted jobs that may have written are held for reconciliation, never automatically replayed.

`agents.defaults.compaction.memoryFlush.compactionHooks` opts selected harnesses into this path. Those harnesses are excluded from the separate token, byte and post-reply memory-save triggers. The memory session receives the selected conversation history in bounded text parts, with private replay metadata and display-only messages excluded. Claude uses its native PreCompact callback to retain the active native parent chain, including quoted tool results, before acknowledging compaction. Manual and idle requests use this same callback; later status events do not capture again. The reader scans backwards in bounded chunks and stops at the current root, excluding obsolete compacted branches from the snapshot size limit. Its tool surface remains read plus append-only write to the captured day's memory file.

`agents.defaults.compaction.idle` selects harnesses, quiet minutes and the input usage ratio. The timer holds no writer or command budget. At expiry, existing maintenance admission rechecks current configuration, session identity, queued input, delivery and delegated work. Native compaction uses a fresh bounded owner and the same snapshot hook. Ordinary foreground activity cancels the timer and can preempt admitted native maintenance. This does not change a harness's own automatic compaction thresholds.

Claude manual and idle operations use the SDK transport on a host-admitted, resume-only command path, so native PreCompact reaches the registered snapshot callback. The command is sent once through the protocol, without a duplicate positional argument. A native compaction acknowledgement remains required. Native safe mode disables customizations while retaining built-in `/compact`; empty tools, strict empty MCP configuration and host permission denial prevent tool execution. Ordinary turns keep `--disable-slash-commands`. A prompt containing `/compact` cannot select this control path.

This patch includes core integration and regressions. Native adapter integration may be supplied by a companion patch. Required release checks include installed native cancellation/resume, complete snapshot input, policy-preserving writes and recorded channel delivery. Passing isolated tests alone is not installed acceptance.

Snapshot memory inference selects the existing native CLI runner for a CLI source. It keeps the captured in-memory session, mediated append target, source policy and its own lifecycle. The live native session is not reused.

Each snapshot save creates its own hidden user-turn recorder from the maintenance prompt. The recorder has no durable target or foreground admission; native adapters can validate the submitted prompt without appending to the source conversation.

Claude transcript readiness and orphan-tool checks resolve the same account directory as the native process. An explicit prepared backend directory takes precedence over inherited `CLAUDE_CONFIG_DIR`; without either, the standard home directory remains the default. Cold restart and binding-flush checks therefore do not discard a persisted session merely because its transcript lives outside the standard directory. The selected directory is checked directly, without searching other accounts.

Idle maintenance forwards the admitted persisted native session binding into the shared compaction entry point. Without it, native control rejects the request before PreCompact, even when the source session has a valid binding. A regression uses real SQLite persistence and the real memory-to-compaction path, replacing only the external CLI execution.

Snapshot restoration requires a resolved session-store path. The caller uses the same native store resolver as ordinary memory saves, honoring either an explicit path or the configured default while keeping a distinct internal session identity.

On v2026.11.3, retained input enters native memory-flush preparation. Native plan
selection, memory audience delegation, tool projection and release remain the
owners. The retained job records the source session incarnation and compaction
count and session restrictions. Its saver reads the canonical source through the
native worker and holds a native generation lease through completion. Native
delayed-work helpers intersect captured and current restrictions, then fence
new restrictions at effect boundaries. A reset or revoked source refuses the
save; old jobs without those facts remain for reconciliation. The original
owner fact selects the memory audience separately from the nonowner maintenance
execution.

Each bounded retained input has a deterministic part identity under its job.
The native memory mutation identity adds a separate retained-part suffix, while
ordinary flush identities stay unchanged. File plans retain the captured day's
target. Native provider plans use native coding-tool assembly once, retaining only the
declared owner's persistence and lookup tools plus read.
Both use an exact mediated CLI tool ceiling intersected with source policy.
Memory audiences and persistence callbacks stay in the native host grant, outside
child-visible context, and follow its existing transfer and revocation rules.

Compatibility qualification is in progress. A composed core type check passes;
focused native tests, complete patch composition and installed qualification are
still required before release.
