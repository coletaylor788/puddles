# Plan 027 — iMessage approval channel for gated tools (skill_workshop, etc.)

**Status:** 📝 Drafting (awaiting user review)
**Author:** Cole + Puddles
**Depends on:** Nothing — this is its own track.
**Related patches:** [`skill-workshop-sandbox-fix`](../openclaw-setup/patches/skill-workshop-sandbox-fix.md) (the patch that surfaces `skill_workshop` to sandboxed agents in the first place; without an approval channel, its `apply` action is unusable for any non-`"auto"` policy).

---

## Summary

OpenClaw's `skill_workshop apply` (and any other tool whose `before_tool_call` returns `requireApproval`) dispatches via `plugin.approval.request` to a channel plugin that advertises the `nativeApprovals` runtime capability. The built-in allowlist is hardcoded:

```js
const KNOWN_NATIVE_APPROVAL_PROMPT_CHANNELS = new Set([
  "discord", "matrix", "qqbot", "slack", "telegram", "signal"
]);
```

The puddles main agent is reached over **iMessage**. iMessage is not in that set and the channel plugin does not declare `nativeApprovals`. So approval requests have no responder: they wait `DEFAULT_PLUGIN_APPROVAL_TIMEOUT_MS` (~60s) then time out with the default `deny`, producing `{"error": "Approval timed out"}` for the calling agent.

Workaround in place today: `skills.workshop.approvalPolicy: "auto"` (see `~/.openclaw/openclaw.json`, applied 2026-06-07). This removes the gate entirely for `skill_workshop`. Acceptable for puddles because the user converses with puddles directly and approves content in-conversation by saying "Apply it." But it doesn't generalize — other gated tools that grow `requireApproval` returns will hit the same timeout, and the next user who clones puddles and wires up a different LLM provider may want stricter gating than we do.

This plan adds an iMessage-native approval flow so any tool that returns `requireApproval` can prompt the owner via iMessage and act on a "yes"/"no" reply.

---

## Goals / non-goals

**Goals:**
- An owner reachable via iMessage can approve or deny a pending `requireApproval` request by sending a short reply (`yes`/`no`, `allow`/`deny`, or a numbered prompt).
- The approval request times out cleanly if the owner doesn't respond inside `MAX_PLUGIN_APPROVAL_TIMEOUT_MS`.
- The iMessage channel plugin declares the `nativeApprovals` capability so OpenClaw routes approval requests to it via the same `plugin.approval.request` / `plugin.approval.waitDecision` pair already used by discord/slack/etc.
- The implementation is contained in `openclaw-plugins/imessage-channel/` (or wherever the iMessage channel plugin lives in this repo). No upstream OpenClaw patch required.
- Re-enabling `skills.workshop.approvalPolicy: "pending"` after this lands restores the intended human-in-the-loop flow without breaking puddles.

**Non-goals:**
- A general "OpenClaw control UI" approval surface (web app, push notifications, etc.) — out of scope; iMessage is sufficient for the puddles owner.
- Multi-owner approval (quorum, escalation, etc.). One owner, one reply, one decision.
- Approval routing for sub-agents whose owner isn't the human iMessage contact. If the gateway ever spawns approval requests for agents reached over a different channel, those still need their own surface.
- Rewriting how OpenClaw's `KNOWN_NATIVE_APPROVAL_PROMPT_CHANNELS` allowlist works. The runtime capability check (`channelPluginHasNativeApprovalPromptUi`) already short-circuits on the plugin-declared capability before consulting that allowlist, so we only need the capability flag, not an upstream allowlist edit.

---

## Background — how OpenClaw approval routing works (as of 2026.6.1)

Trace through `dist/agent-tools.before-tool-call-CDXSxqiL.js`:

1. `resolveSkillWorkshopToolApproval` (line 399) returns `{ requireApproval: { description, allowedDecisions, ... } }` for any `skill_workshop` lifecycle action when `approvalPolicy !== "auto"`.
2. The before-tool-call pipeline reaches `callGatewayTool("plugin.approval.request", { timeoutMs: gatewayTimeoutMs }, ...)` (line 770).
3. The gateway dispatches to all installed channel plugins. Each plugin's `pluginManifest.approval` block can declare `{ native: true, nativeRuntime: true }` to signal it can render an approval prompt natively.
4. `callGatewayTool("plugin.approval.waitDecision", { timeoutMs: gatewayTimeoutMs }, { id })` (line 809) blocks on the plugin's decision.
5. On timeout, `approval.timeoutBehavior ?? "deny"` decides the fallback. `"deny"` produces the user-visible `Approval timed out` error.

The iMessage channel plugin in puddles currently does **not** declare `approval.native` or `approval.nativeRuntime`. So the gateway has no candidate plugin and the request times out.

`KNOWN_NATIVE_APPROVAL_PROMPT_CHANNELS` is a *hint* set used elsewhere (e.g. for telling the agent which channels can show an interactive prompt in their system message). The actual routing is capability-driven, not name-driven. So we don't need iMessage added to that set for routing to work — just for any UX hints that consult it.

---

## Design

### 1. iMessage channel plugin — declare `nativeApprovals` capability

In the iMessage channel plugin's manifest:

```ts
export const manifest: ChannelPluginManifest = {
  // ... existing fields ...
  approval: {
    native: true,
    nativeRuntime: true,
  },
};
```

This makes `channelPluginHasNativeApprovalPromptUi(plugin)` return `true` for the iMessage plugin, which causes:
- The plugin to be a candidate for `plugin.approval.request` dispatch.
- The runtime to advertise `NATIVE_APPROVAL_PROMPT_RUNTIME_CAPABILITY` (`"nativeApprovals"`) to agents on this channel.

### 2. Approval request handler — render prompt as iMessage

When the gateway dispatches `plugin.approval.request` to the iMessage plugin, the plugin:

1. Looks up the owner contact for the requesting agent (already known — that's the same routing used for normal agent → owner messages).
2. Sends an iMessage formatted like:
   ```
   🛂 Approval needed for puddles
   skill_workshop apply: weekly-meal-plan-20260607-8c84a4f843
   Reply: yes / no
   ```
   Includes the proposal ID or other discriminator so the owner has context. If the proposal text is short, optionally include a preview snippet (capped at ~500 chars to avoid spam).
3. Stores the pending approval `{ id, requestedAt, agentId, ownerHandle, allowedDecisions }` in plugin state (in-memory + persisted to a small file under `~/.openclaw/plugins/imessage-channel/pending-approvals.json` so a gateway restart mid-approval doesn't silently drop it).
4. Returns control to the gateway with `{ id }`.

### 3. Approval inbox handler — match owner replies

The iMessage channel plugin already has an inbound-message pipeline (that's how it delivers messages *to* the agent). Before forwarding a message to the agent, intercept it:

1. Is the sender a known owner with a pending approval? Scan `pending-approvals.json` for a record whose `ownerHandle` matches.
2. Does the message body parse as a decision? Accept (case-insensitive): `yes`, `y`, `allow`, `allow-once`, `approve`, `ok`, `👍` → `allow-once`. `no`, `n`, `deny`, `reject`, `👎`, `nope` → `deny`. If `allowedDecisions` doesn't include the parsed decision, ignore the message and let it flow to the agent as normal (avoids hijacking a normal reply that happens to be "yes").
3. If a decision is parsed, call `gateway.plugins.notifyApprovalDecision(id, decision)` (or whatever the gateway-side API is — see `dist/plugin-approvals-*.js` for the exact entry point), remove the record from `pending-approvals.json`, and **do not** forward the message to the agent. Optionally send a one-line confirmation back to the owner: `✓ Approved.` or `✗ Denied.`
4. If there are multiple pending approvals for the same owner, the prompt sent in step 2.2 should include a short prefix (e.g. `[A]`, `[B]`) and the parser should accept `yes A`, `deny B`, etc. Punt on this in v1 unless it turns out the owner sees overlapping prompts in practice.

### 4. Timeout handling

The gateway handles the timeout itself — the plugin doesn't have to. But the plugin should:

- Clean up the entry in `pending-approvals.json` when it receives the `plugin.approval.cancel` (or equivalent) notification from the gateway after timeout.
- Optionally send a follow-up iMessage: `⌛ Approval timed out (denied).` so the owner isn't left wondering whether a stale reply still applies.

### 5. Restore `skills.workshop.approvalPolicy: "pending"`

Once the iMessage approval flow is verified end-to-end:

1. Remove `skills.workshop.approvalPolicy` from `~/.openclaw/openclaw.json` (default restores to `"pending"`).
2. Restart gateway.
3. Have puddles draft a `skill_workshop update` and `apply`. Owner gets iMessage prompt, replies `yes`, proposal applies. Confirm `~/.openclaw/skill-workshop/proposals.json` shows the proposal as `applied` and the on-disk SKILL.md reflects the change.

---

## Open questions

- **Exact gateway-side API for notifying a decision.** `dist/plugin-approvals-WkXJ-bse.js` is the most likely entry point. Need to read that module to confirm the function signature plugins use to push a decision back. If it's not a public plugin API, this plan needs to either fall back to polling (plugin polls a queue the gateway already exposes) or this work needs an upstream contribution to expose the notification path.
- **Handling concurrent approvals across multiple agents.** If browser-agent or another agent also gains gated tools later, the plugin's pending-approvals state needs to disambiguate by `agentId`, not just by owner. v1 only deals with the main agent.
- **Owner identity binding.** Puddles knows its owner via the contacts-as-trust system (plan 018). The iMessage channel plugin should consult the same trust store to identify the owner handle, not hardcode a phone number.

---

## Rollout

1. Land the iMessage channel plugin changes (manifest capability + handlers + state file).
2. Smoke-test end-to-end with a deliberately-triggered approval (e.g. set `skills.workshop.approvalPolicy: "pending"` temporarily, have puddles try to apply a no-op skill update, reply `yes` in iMessage, verify it applies).
3. Remove the `approvalPolicy: "auto"` override from openclaw.json (or downgrade it to a per-agent override if the schema supports one).
4. Document the new behavior in `docs/openclaw-setup/imessage-channel.md` (the existing iMessage setup doc — add an "Approvals" section).
5. Update `docs/openclaw-setup/patches/skill-workshop-sandbox-fix.md` to note that the recommended config is `approvalPolicy: "pending"` once the iMessage channel handles approvals, with the `"auto"` setting flagged as a fallback for setups without an approval-capable channel.

---

## Why this matters

Right now puddles applies its own skill proposals because the alternative is "never applies anything." That's fine for the current trust model (single owner, conversational approval already happening), but it means the in-flight `before_tool_call` approval pipeline is essentially dead code for puddles. As more tools start returning `requireApproval` — egress approvals (plan 014), per-tier budget overages (plan 026), future skill plugins — the same dead-routing failure surfaces everywhere, and each one would need its own per-tool `*.approvalPolicy: "auto"` escape hatch.

Fixing the channel once gives every gated tool a working approval surface for free.
