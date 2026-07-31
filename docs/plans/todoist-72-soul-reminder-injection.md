# SOUL reminder injection

**Status:** Awaiting design approval  
**Issue:** [#72](https://github.com/coletaylor788/puddles/issues/72)  
**Last updated:** 2026-07-30

## Human design

### Problem

The agent receives its voice and writing guidance at the start of a conversation, but that guidance can fade during a long exchange. Repeating the full guidance would waste context, expose personal details to more prompt surfaces, and make the prompt noisy.

### Outcome

Every conversational turn for an enabled persona agent gets this private reminder immediately after the user's request:

`<system_reminder>Keep your tone, personality, and writing style aligned with SOUL.md.</system_reminder>`

The reminder is not saved in conversation history or shown to the user. Other agents and background work are unchanged.

### Approach

Add a small plugin at the final prompt-building boundary. It appends the fixed reminder only when a user starts the turn and the current agent is on an explicit allowlist. The reminder is added on every eligible turn, including the first. This costs only a few tokens and is more reliable than keeping counters that can drift after compaction, retries, or restarts.

The plugin points back to the guidance already loaded for that agent. It never reads, copies, parses, or stores SOUL.md. Appending the reminder to the current turn keeps it close to the response the model is about to write instead of adding another instruction near the start of the conversation.

### Safety and rollout

The plugin is off unless an operator enables prompt injection and names the agents that should receive it. It ignores heartbeats, scheduled jobs, memory work, manual maintenance, and all agents outside that list. The reminder exists only in the model-bound copy of the current prompt, so retries can recreate it without adding duplicate transcript entries.

Tests will use synthetic conversations and will not call a live model, deliver messages, or touch personal data. Rollout starts with one persona agent. Disabling the plugin and restarting the gateway restores the old behavior immediately. Implementation will not begin until Cole approves this design.

## Agent details

### State

Research is complete and the proposal is ready. Implementation is blocked on Cole's explicit approval.

### Scope and acceptance criteria

- Add one provider-neutral OpenClaw plugin for this behavior.
- On every `user`-triggered prompt build for an explicitly configured agent, append exactly:
  `<system_reminder>Keep your tone, personality, and writing style aligned with SOUL.md.</system_reminder>`
- Include the first user turn. Do not maintain counters or session state.
- Leave unconfigured agents and non-user triggers byte-for-byte unchanged.
- Keep the reminder fixed in code. Do not read or interpolate SOUL.md.
- Keep the reminder transient. It must reach the model after the current user text but must not be written to the transcript.
- Reject missing, empty, duplicate, or malformed agent allowlists through the plugin configuration schema.
- Require the host's explicit prompt-injection permission for activation.
- Add focused tests and a committed regression to the shared integration pool.
- Do not implement until Cole approves the design.

### Architecture and decisions

- Implement `openclaw-plugins/soul-reminder/` as a standalone plugin. This uses the supported extension boundary and avoids an OpenClaw source patch or a machine-local internal hook.
- Register a synchronous `before_prompt_build` handler. The repository's pinned OpenClaw revision exposes this hook with `prompt`, prepared session messages, agent context, and `appendContext`.
- Return `appendContext` only when `ctx.trigger === "user"` and `ctx.agentId` is in the configured allowlist. The model sees the reminder after the current user text, where recency can reinforce the opening persona guidance.
- Use `appendContext`, not `appendSystemContext`. The latter remains near the opening system prompt and does not solve instruction fading. OpenClaw applies prompt context through a temporary model transform while preserving the original transcript prompt.
- Inject on every eligible turn rather than every N turns. The reminder is ten words, while a counter would add mutable state, reset semantics, compaction ambiguity, and weaker coverage.
- Configure a required `agentIds` array with at least one unique, non-empty string and no unknown fields. Production starts with `main`; more persona-bearing agents can be added explicitly later.
- Enable `plugins.entries.soul-reminder.hooks.allowPromptInjection`. `allowConversationAccess` is not needed because `before_prompt_build` is a prompt-mutation hook, not a conversation-access hook in the pinned runtime.
- Do not log prompts, reminder decisions, agent conversation data, or SOUL.md content. Normal plugin load diagnostics are sufficient.

### Implementation

No implementation is authorized yet. After approval:

1. Add `openclaw-plugins/soul-reminder/src/plugin.ts` with the fixed reminder, strict eligibility helper, and `before_prompt_build` registration.
2. Add the plugin manifest, package metadata, TypeScript and test configuration, distribution-manifest script, and README under `openclaw-plugins/soul-reminder/`, following the existing plugin build layout.
3. Add unit tests under `openclaw-plugins/soul-reminder/tests/` for the exact reminder, allowed and denied agents, every trigger class, repeated calls, and invalid configuration.
4. Add `packages/e2e/tests/soul-reminder-plugin.test.ts` to exercise plugin registration and the transient model-bound prompt shape through a recording fake.
5. Add the plugin to `openclaw-plugins/README.md` and document install, enablement, inspection, and rollback in the plugin README.
6. Update this plan before each substantive implementation, validation, review, rollout, and landing milestone.

### Validation

Research evidence:

- `packages/e2e/openclaw-patch-suite.json` pins OpenClaw revision `0790d9f593ad30c940ed93b5872a8cf6d6f3cf8c`.
- That revision provides the modern `before_prompt_build` hook and marks the legacy combined hook as deprecated.
- Its prompt boundary composes `appendContext` after the current prompt through a temporary model transform, while the transcript keeps the original user text.
- Its plugin policy has a dedicated `allowPromptInjection` gate. The hook does not require raw conversation-access permission.
- The repository has no existing SOUL reminder or `<system_reminder>` injection.
- Existing bootstrap behavior already loads SOUL.md for persona agents. This feature only refreshes attention to it.

After approval, run the soul-reminder package lint, build, and tests, then the repository build, lint, and test commands. Finish with the required accumulated integration command:

`node packages/e2e/bin/openclaw-test-env.mjs ci`

The regression must prove exact placement, exact text, no transcript persistence, scope denial, trigger denial, repeated-turn behavior, and config rejection. No automated test may call a configured agent or live delivery channel.

### Rollout and rollback

No rollout is authorized before approval and implementation review.

The test environment will load the built plugin with synthetic agent context and recording fakes. Production rollout will build the merged plugin, install its self-contained distribution through OpenClaw's local plugin installer, configure `agentIds: ["main"]`, explicitly allow prompt injection, and restart the gateway. Read-only checks will confirm the plugin is loaded, the hook is registered, and the configuration is active. Automated production validation will not send a message or invoke a live model.

Rollback disables the plugin entry and restarts the gateway. The plugin has no state, migration, or persisted prompt content, so no data recovery is needed. The installed package may remain disabled or be uninstalled after health is restored.

### Review log

- 2026-07-30: Repository and pinned-runtime research found a supported transient prompt hook, a dedicated host permission gate, and no need for an OpenClaw source patch.
- 2026-07-30: Chose every eligible user turn over periodic cadence to avoid state and compaction ambiguity.
- 2026-07-30: Chose an explicit agent allowlist and user-trigger filter so workers and background runs remain unchanged.
- 2026-07-30: Chose fixed reminder text with no SOUL.md reads or interpolation to minimize prompt size and personal-data exposure.

### Checklist

- [x] Verify the Todoist tracking comment.
- [x] Verify the issue ledger shape.
- [x] Create the normalized plan before runtime research.
- [x] Trace the existing prompt and hook lifecycle.
- [x] Confirm the design against the repository's pinned OpenClaw revision.
- [x] Finalize the proposal and acceptance criteria.
- [x] Request Cole's explicit approval.
- [ ] Implement only after approval.
- [ ] Add focused and shared-pool regressions.
- [ ] Validate in the managed test environment.
- [ ] Complete independent adversarial review.
- [ ] Promote, validate, land, and verify.
